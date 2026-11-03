// Debris Drop v2 wire format: the same drop, about 5× smaller.
//
// A piece's convex-hull points used to travel as a JSON list of floats ("p": [x,y,z, …], ~16 chars
// a number). In v2 they travel as signed bytes, scaled to the piece's own reach, in base64:
//   "s": 0.0261            the largest |coordinate| in the piece (metres)
//   "b": "f0Hx…"           Int8 x,y,z triples, value = byte / 127 * s
// That's ~0.4% of the piece's size per step: invisible at any scale the pile shows.
// Readers call inflateDrop() and get "p" back, so everything downstream is unchanged.
// Shared by the page (js/portal.js, js/pilecam.js) and the Worker (worker/worker.js).
// World Builder carries its own copy (src/dropCodec.js); keep them in step.

export const WIRE_POINTS = 16;   // hull points per piece on the wire (a chunk still reads as a chunk)

const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };
const fromB64 = (str) => { const s = atob(str), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
const sig = (v, n = 3) => (v ? +(+v).toPrecision(n) : 0);
const fix = (a, d) => (Array.isArray(a) ? a.map(x => +(+x || 0).toFixed(d)) : a);

// flat [x,y,z,…] → at most `max` distinct points. Hull points are the far-out ones, so keep the
// points farthest from the piece's centre: the chunk keeps its size and most of its shape.
export function thinPoints(flat, max = WIRE_POINTS) {
  const seen = new Set(), pts = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const key = `${flat[i]},${flat[i + 1]},${flat[i + 2]}`;
    if (seen.has(key)) continue;
    seen.add(key); pts.push([flat[i], flat[i + 1], flat[i + 2]]);
  }
  const keep = pts.length <= max ? pts
    : pts.map((p, i) => [p[0] * p[0] + p[1] * p[1] + p[2] * p[2], i]).sort((a, b) => b[0] - a[0]).slice(0, max).sort((a, b) => a[1] - b[1]).map(([, i]) => pts[i]);
  return keep.flat();
}

export function encodePoints(flat) {
  let m = 0;
  for (const v of flat) m = Math.max(m, Math.abs(v));
  const s = +((m || 1e-4) * 1.0005).toPrecision(4);   // rounded up, so nothing clips
  const bytes = new Int8Array(flat.length);
  for (let i = 0; i < flat.length; i++) bytes[i] = Math.max(-127, Math.min(127, Math.round(flat[i] / s * 127)));
  return { s, b: toB64(new Uint8Array(bytes.buffer)) };
}

export function decodePoints(b, s) {
  const bytes = new Int8Array(fromB64(b).buffer), out = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = +(bytes[i] / 127 * s).toPrecision(4);
  return out;
}

// one piece → its slim wire form (pieces already slim pass straight through)
export function slimPiece(pc, maxPoints = WIRE_POINTS) {
  if (!pc || typeof pc.b === 'string') return pc;
  const { p, ...rest } = pc;
  const enc = encodePoints(thinPoints(Array.isArray(p) ? p : [], maxPoints));
  return { ...rest, m: sig(pc.m), ...enc, q: fix(pc.q, 3), o: fix(pc.o, 3), v: fix(pc.v, 1) };
}

export function slimDrop(d, maxPoints = WIRE_POINTS) {
  if (!d || !Array.isArray(d.pieces)) return d;
  return { ...d, v: 2, pieces: d.pieces.map(pc => slimPiece(pc, maxPoints)) };
}

// a received drop → pieces with "p" again (v1 drops are untouched)
export function inflateDrop(d) {
  if (!d || !Array.isArray(d.pieces)) return d;
  for (const pc of d.pieces) {
    if (pc && !Array.isArray(pc.p) && typeof pc.b === 'string') {
      try { pc.p = decodePoints(pc.b, +pc.s || 0); } catch (e) { pc.p = []; }
    }
  }
  return d;
}
