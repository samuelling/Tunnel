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

const MAX_PIECES = 120, MAX_POINTS = 40;

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
  const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  const out = [];
  for (let i = 0; i < points.length; i += step) { const p = points[i]; out.push(r3(p.x), r3(p.y), r3(p.z)); }
  return out;
}

export class DropCollector {
  constructor({ onSent, onParked, onFail, onJudge }) {
    this.onJudge = onJudge;
    this.open = new Map();
    this.onSent = onSent; this.onParked = onParked; this.onFail = onFail;
    this.sentPieces = (() => { try { return +localStorage.getItem('shredSent') || 0; } catch (e) { return 0; } })();
    this.last = null;
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
      this.dispatch(this.build(d));
    }
  }

  build(d) {
    const r = d.root.recipe;
    const pieces = d.pieces.sort((a, b) => b.m - a.m).slice(0, MAX_PIECES);
    return {
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
    let ok = false;
    await Promise.all(targets.map(async (url) => {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(drop) });
        if (res.ok) {
          ok = true;
          // the relay assigns the drop's id (which seeds its place on the pile); keep it
          if (url.includes('workers.dev') || url.endsWith('/drops')) { try { const j = await res.json(); if (j && j.id) { drop.id = j.id; drop.at = j.at || drop.at; } } catch (e) { /* not json */ } }
        }
      } catch (e) { /* unreachable target */ }
    }));
    if (ok) this.onSent?.(drop); else { this.park(drop); this.onFail?.(drop); }
  }

  // keep a few undelivered drops locally (newest first)
  park(drop) {
    try {
      const q = JSON.parse(localStorage.getItem('shredQueue') || '[]');
      q.unshift(drop);
      while (q.length > 6 || JSON.stringify(q).length > 1.5e6) q.pop();
      localStorage.setItem('shredQueue', JSON.stringify(q));
    } catch (e) { /* storage full or blocked */ }
  }
}
