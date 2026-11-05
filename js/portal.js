// On the wire drops travel as Debris Drop v2 (js/dropcodec.js: hull points as base64 bytes,
// about 4× smaller); in the page they stay in the v1 shape below.
// The far side of the portal: debris that falls in is packed into a "Debris Drop" (v1) and
// posted to World Builder's mailbox(es). Format (all lengths in metres, colours #rrggbb):
// {
//   v: 1, id, at (ms since epoch), source: "shred-hole",
//   object: { name, icon, verdict, quip, mass },
//   spray, colors: [...],
//   pieces: [ { c: outer colour, i: inner colour, m: mass kg,
//               p: [x,y,z, x,y,z, …] convex-hull points in the piece's own frame,
//               q: [x,y,z,w] the piece's orientation in the world (y up) as it entered,
//               o: [x,y,z] offset from the object's centre (world axes; 0 for loose chunks),
//               v: [vx,vy,vz] velocity entering the portal (world: y up) } ],
//   particles: { count, colors }
// }
import { WORKER_URL, DROP_URLS } from './settings.js';
import { thinPoints, slimDrop, WIRE_POINTS } from './dropcodec.js';

const MAX_PIECES = 120, MAX_POINTS = WIRE_POINTS;
const MAX_PAYLOAD_PIECES = 400;   // a hatch payload: several objects in one delivery

export function dropTargets() {
  const out = new Set(DROP_URLS || []);
  if (WORKER_URL) out.add(WORKER_URL.replace(/\/$/, '') + '/drops');
  try {
    const q = new URLSearchParams(location.search).get('drop');
    if (q) localStorage.setItem('shredDrop', q);
    const s = localStorage.getItem('shredDrop');
    if (s) out.add(s);
  } catch (e) { /* storage blocked */ }
  return [...out];
}

const r3 = (v) => Math.round(v * 1000) / 1000;

// points: Vector3[] in the piece's own frame → compact flat array (≤ MAX_POINTS points)
export function packPoints(points) {
  const flat = [];
  for (const p of points) flat.push(r3(p.x), r3(p.y), r3(p.z));
  return thinPoints(flat, MAX_POINTS);
}

const isRelay = (url) => !!WORKER_URL && url.startsWith(WORKER_URL.replace(/\/$/, ''));
const fuelUntil = () => { try { return +localStorage.getItem('shredNoFuelUntil') || 0; } catch (e) { return 0; } };

export class DropCollector {
  constructor({ onSent, onParked, onFail, onJudge, onNoFuel }) {
    this.onNoFuel = onNoFuel;
    this.onJudge = onJudge;
    this.open = new Map();
    this.onSent = onSent; this.onParked = onParked; this.onFail = onFail;
    this.sentPieces = (() => { try { return +localStorage.getItem('shredSent') || 0; } catch (e) { return 0; } })();
    this.last = null;
    this.hold = false;      // payload hatch closed: finished drops wait in the outbox
    this.slim = false;      // set when the relay reports wire: 2 (it stores slim drops either way)
    this.outbox = [];
    setTimeout(() => this.resendParked(), 4000);
    setInterval(() => { if (this.parkedCount()) this.resendParked(); }, 10 * 60000);
  }

  add(root, pieces, particles = 0) {
    let d = this.open.get(root.id);
    if (!d) { d = { root, pieces: [], particles: 0, t: 0 }; this.open.set(root.id, d); }
    d.pieces.push(...pieces);
    d.particles += particles;
    d.t = performance.now();
  }

  // call every frame; a drop is sent once its object has been judged and nothing more is
  // arriving (every piece accounted for, or the portal has been quiet for a while)
  tick() {
    const now = performance.now(), q = (d) => now - d.t;
    for (const [id, d] of this.open) {
      const settled = d.root.live.size === 0 && (d.root.done || !d.root.firstHit);
      if (!((settled && q(d) > 900) || q(d) > 12000)) continue;
      this.open.delete(id);
      if (d.root.firstHit && !d.root.done) this.onJudge?.(d.root);   // judge it now if still pending
      const drop = this.build(d);
      if (this.hold) this.outbox.push(drop); else { delete drop._root; this.dispatch(drop); }
    }
  }

  // close out everything still collecting (the hatch has opened: whatever made it is in)
  finalizeAll() {
    for (const [id, d] of this.open) {
      this.open.delete(id);
      if (!d.pieces.length) continue;
      if (d.root.firstHit && !d.root.done) this.onJudge?.(d.root);
      this.outbox.push(this.build(d));
    }
  }

  // send the outbox as one payload (one request, one write at the relay)
  flushPayload() {
    const raw = this.outbox.splice(0);
    if (!raw.length) return null;
    // an object's pieces can be closed out in more than one batch: put them back together
    const byRoot = new Map();
    for (const d of raw) {
      const g = byRoot.get(d._root);
      if (!g) { byRoot.set(d._root, { ...d, pieces: [...d.pieces], particles: { ...d.particles } }); continue; }
      g.pieces.push(...d.pieces); g.particles.count += d.particles?.count || 0;
      if (d.object.verdict && d.object.verdict !== 'SHREDDED' && d.object.verdict !== 'SENT THROUGH WHOLE') g.object = d.object;
    }
    const list = [...byRoot.values()];
    for (const d of list) { delete d._root; d.pieces.sort((a, b) => b.m - a.m); d.pieces = d.pieces.slice(0, MAX_PIECES); }
    const drop = list.length === 1 ? list[0] : mergeDrops(list);
    this.dispatch(drop);
    return drop;
  }

  resendParked() {
    if (fuelUntil() > Date.now() && dropTargets().every(isRelay)) return;   // still out of fuel: leave them be
    let q = [];
    try { q = JSON.parse(localStorage.getItem('shredQueue') || '[]'); localStorage.removeItem('shredQueue'); this._parked = 0; } catch (e) { return; }
    if (!dropTargets().length) { for (const d of q.reverse()) this.park(d); return; }
    for (const d of q.reverse()) { this.sentPieces -= d.pieces.length; this.dispatch(d); }
  }

  build(d) {
    const r = d.root.recipe;
    const pieces = d.pieces.sort((a, b) => b.m - a.m).slice(0, MAX_PIECES);
    return {
      _root: d.root.id,
      v: 1,
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
      at: Date.now(),
      source: 'shred-hole',
      object: { name: r.name, icon: r.icon || '✨', verdict: d.root.verdictHead || (d.root.firstHit ? 'SHREDDED' : 'SENT THROUGH WHOLE'), quip: d.root.verdictQuip || '', mass: +d.root.mass0.toFixed(3) },
      spray: r.spray,
      colors: [...new Set(r.parts.map(p => p.color).concat(r.inner || []))].slice(0, 8),
      pieces,
      particles: { count: d.particles, colors: [r.inner || '#cccccc'] },
    };
  }

  async dispatch(drop) {
    this.last = drop;
    const targets = dropTargets();
    const n = drop.pieces.length;
    this.sentPieces += n;
    try { localStorage.setItem('shredSent', String(this.sentPieces)); } catch (e) { /* ignore */ }
    if (!targets.length) { this.park(drop); this.onParked?.(drop); return; }
    // the portal said it's out of fuel: don't knock again until it has refuelled
    const dry = fuelUntil() - Date.now();
    if (dry > 0 && targets.every(isRelay)) { this.park(drop); this.onNoFuel?.(drop, dry); return; }
    let ok = false, noFuel = null;
    // slim (v2) only once the relay has said it understands it; an older relay gets v1
    const wire = JSON.stringify(this.slim ? slimDrop(drop) : drop);
    Object.defineProperty(drop, '_wireBytes', { value: wire.length, writable: true, configurable: true });   // for the ride along (not sent)
    await Promise.all(targets.map(async (url) => {
      try {
        // text/plain keeps it a "simple" request: no CORS preflight, so one request instead of two
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': isRelay(url) ? 'text/plain' : 'application/json' }, body: wire });
        if (res.status === 503 && res.headers.get('x-portal') === 'out-of-fuel') {
          try { noFuel = (await res.json()).refuelIn || 0; } catch (e) { noFuel = 0; }
          try { localStorage.setItem('shredNoFuelUntil', String(Date.now() + Math.max(noFuel, 60000))); } catch (e) { /* ignore */ }
          return;
        }
        if (res.ok) {
          ok = true;
          // the relay assigns the drop's id (which seeds its place on the pile); keep it
          // (only our own mailbox's id: World Builder's own id would mislabel it in Pile Cam)
          if (isRelay(url) || (!WORKER_URL && url.endsWith('/drops'))) { try { const j = await res.json(); if (j && j.id) { drop.id = j.id; drop.at = j.at || drop.at; for (const [k, v] of [['_colo', j.colo], ['_fuelLeft', j.fuelLeft]]) Object.defineProperty(drop, k, { value: v, writable: true, configurable: true }); } } catch (e) { /* not json */ } }
        }
      } catch (e) { /* unreachable target */ }
    }));
    if (ok) this.onSent?.(drop);
    else if (noFuel !== null) { this.park(drop); this.onNoFuel?.(drop, noFuel); }
    else { this.park(drop); this.onFail?.(drop); }
  }

  parkedCount() {
    if (this._parked === undefined) { try { this._parked = JSON.parse(localStorage.getItem('shredQueue') || '[]').length; } catch (e) { this._parked = 0; } }
    return this._parked;
  }

  // Lost & Found: keep a few undelivered drops locally (newest first)
  park(drop) {
    try {
      const q = JSON.parse(localStorage.getItem('shredQueue') || '[]');
      q.unshift(drop);
      while (q.length > 12 || JSON.stringify(q).length > 3e6) q.pop();
      localStorage.setItem('shredQueue', JSON.stringify(q));
      this._parked = q.length;
    } catch (e) { /* storage full or blocked */ }
  }
}

// Several drops → one payload. Each object keeps a fair share of the piece budget, and pieces
// carry fewer hull points when the payload is big, so it stays well under the relay's size limit.
export function mergeDrops(list) {
  const total = list.reduce((s, d) => s + d.pieces.length, 0);
  const budget = Math.min(MAX_PAYLOAD_PIECES, total);
  const pts = total > 200 ? 12 : MAX_POINTS;
  const pieces = [];
  for (const d of list) {
    const share = Math.max(Math.min(8, d.pieces.length), Math.round(budget * d.pieces.length / total));
    for (const pc of d.pieces.slice(0, share)) {
      const n = pc.p.length / 3, step = Math.max(1, Math.ceil(n / pts));
      const p = [];
      for (let i = 0; i < n; i += step) p.push(pc.p[i * 3], pc.p[i * 3 + 1], pc.p[i * 3 + 2]);
      pieces.push({ ...pc, p });
    }
  }
  const objects = list.map(d => ({ name: d.object.name, icon: d.object.icon, verdict: d.object.verdict, mass: d.object.mass, pieces: d.pieces.length }));
  const names = objects.map(o => o.name).join(', ');
  return {
    v: 1,
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
    at: Date.now(),
    source: 'shred-hole',
    payload: true,
    object: { name: `Payload: ${objects.length} things`, icon: '📦', verdict: 'PAYLOAD DELIVERED', quip: names.slice(0, 200), mass: +objects.reduce((s, o) => s + (o.mass || 0), 0).toFixed(3) },
    objects,
    spray: list[0].spray,
    colors: [...new Set(list.flatMap(d => d.colors || []))].slice(0, 8),
    pieces: pieces.slice(0, MAX_PAYLOAD_PIECES),
    particles: { count: list.reduce((s, d) => s + (d.particles?.count || 0), 0), colors: [...new Set(list.flatMap(d => d.particles?.colors || []))].slice(0, 4) },
  };
}
