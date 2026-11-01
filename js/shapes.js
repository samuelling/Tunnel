// Object library + silhouette → signed-distance-field pipeline.
// Every shape is a Canvas2D drawing in arbitrary units (y down, flow from the left).
// It is auto-fitted into the SDF texture, so only proportions matter.
import { SDF_RES } from './lbm.js';

const TAU = Math.PI * 2;
const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
const ellipse = (c, x, y, rx, ry, rot = 0) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.fill(); };
const poly = (c, pts) => { c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill(); };
const path = (c, d, rule = 'nonzero') => c.fill(new Path2D(d), rule);
const rect = (c, x, y, w, h) => { c.beginPath(); c.rect(x, y, w, h); c.fill(); };
const stroke = (c, w, fn) => { c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); fn(); c.stroke(); };

// NACA 4-digit section, chord 100, leading edge on the left, y down for canvas.
export function nacaPoints(m, p, t, n = 90) {
  const up = [], lo = [];
  for (let i = 0; i <= n; i++) {
    const b = Math.PI * i / n, x = 0.5 * (1 - Math.cos(b));
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0, dy = 0;
    if (m > 0) {
      if (x < p) { yc = m / (p * p) * (2 * p * x - x * x); dy = 2 * m / (p * p) * (p - x); }
      else { yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x); dy = 2 * m / ((1 - p) ** 2) * (p - x); }
    }
    const th = Math.atan(dy);
    up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  return [...up, ...lo.reverse().slice(1)].map(([x, y]) => [(x - 0.5) * 100, -y * 100]);
}
const naca = (code) => {
  const m = +code[0] / 100, p = +code[1] / 10, t = +code.slice(2) / 100;
  const pts = nacaPoints(m, p, t);
  return c => poly(c, pts);
};

// ref: which length the coefficients are normalised by. 'chord' = streamwise
// length (airfoils), 'frontal' = projected height facing the wind (bluff bodies).
export const SHAPES = [
  // ---------- classics ----------
  { id: 'cylinder', name: 'Cylinder', cat: 'Classic', ref: 'frontal', mat: 'aluminum', size: 0.05, draw: c => circle(c, 0, 0, 50) },
  { id: 'square', name: 'Square', cat: 'Classic', ref: 'frontal', mat: 'aluminum', size: 0.045, draw: c => rect(c, -50, -50, 100, 100) },
  { id: 'triangle', name: 'Wedge', cat: 'Classic', ref: 'frontal', mat: 'aluminum', size: 0.05, draw: c => poly(c, [[-43.3, 0], [43.3, -50], [43.3, 50]]) },
  { id: 'plate', name: 'Flat plate', cat: 'Classic', ref: 'chord', mat: 'aluminum', size: 0.1, angle: 15, draw: c => rect(c, -50, -1.5, 100, 3) },
  { id: 'ellipse', name: 'Ellipse', cat: 'Classic', ref: 'frontal', mat: 'aluminum', size: 0.09, draw: c => ellipse(c, 0, 0, 50, 20) },
  { id: 'dsection', name: 'D-section', cat: 'Classic', ref: 'frontal', mat: 'aluminum', size: 0.05, draw: c => path(c, 'M 0 -50 A 50 50 0 0 0 0 50 Z') },
  { id: 'cup', name: 'Cup (open to wind)', cat: 'Classic', ref: 'frontal', mat: 'aluminum', size: 0.05, draw: c => path(c, 'M 0 -50 A 50 50 0 0 1 0 50 L 0 42 A 42 42 0 0 0 0 -42 Z') },
  { id: 'teardrop', name: 'Streamlined body', cat: 'Classic', ref: 'frontal', mat: 'aluminum', size: 0.11, draw: naca('0035') },
  // ---------- airfoils ----------
  { id: 'naca0012', name: 'NACA 0012', cat: 'Airfoil', ref: 'chord', mat: 'aluminum', size: 0.12, angle: 6, pivot: -0.25, draw: naca('0012') },
  { id: 'naca2412', name: 'NACA 2412', cat: 'Airfoil', ref: 'chord', mat: 'aluminum', size: 0.12, angle: 4, pivot: -0.25, draw: naca('2412') },
  { id: 'naca4412', name: 'NACA 4412', cat: 'Airfoil', ref: 'chord', mat: 'aluminum', size: 0.12, angle: 4, pivot: -0.25, draw: naca('4412') },
  { id: 'naca6409', name: 'NACA 6409 (high camber)', cat: 'Airfoil', ref: 'chord', mat: 'balsa', size: 0.12, angle: 3, pivot: -0.25, draw: naca('6409') },
  { id: 'naca0024', name: 'NACA 0024 (thick)', cat: 'Airfoil', ref: 'chord', mat: 'aluminum', size: 0.12, angle: 0, pivot: -0.25, draw: naca('0024') },
  { id: 'flutter', name: 'Flutter wing (sprung)', cat: 'Airfoil', ref: 'chord', mat: 'balsa', size: 0.12, angle: 2, pivot: -0.15, mount: 'spring', draw: naca('0012') },
  // ---------- structures & vehicles ----------
  { id: 'tacoma', name: 'Tacoma Narrows deck', cat: 'Structure', ref: 'chord', mat: 'steel', size: 0.16, mount: 'spring',
    draw: c => { rect(c, -50, -10, 2.6, 20); rect(c, 47.4, -10, 2.6, 20); rect(c, -50, -5, 100, 3); } },
  { id: 'boxgirder', name: 'Box-girder deck', cat: 'Structure', ref: 'chord', mat: 'steel', size: 0.16,
    draw: c => poly(c, [[-50, -2], [-40, -6], [40, -6], [50, -2], [35, 6], [-35, 6]]) },
  { id: 'house', name: 'House', cat: 'Structure', ref: 'frontal', mat: 'pine', size: 0.07,
    draw: c => poly(c, [[-40, 50], [-40, -5], [0, -45], [40, -5], [40, 50]]) },
  { id: 'sedan', name: 'Sedan', cat: 'Vehicle', ref: 'frontal', mat: 'abs', size: 0.16,
    draw: c => {
      path(c, 'M -50 6 C -50 -2 -46 -6 -38 -7 L -16 -10 C -10 -12 -4 -20 4 -21 L 20 -21 C 28 -20 34 -14 40 -10 L 48 -9 C 50 -8 51 -2 50 4 L 48 9 L 36 9 A 9 9 0 0 0 18 9 L -18 9 A 9 9 0 0 0 -36 9 L -46 9 C -49 9 -50 8 -50 6 Z');
      circle(c, 27, 9, 7.5); circle(c, -27, 9, 7.5);
    } },
  { id: 'bus', name: 'Bus', cat: 'Vehicle', ref: 'frontal', mat: 'abs', size: 0.16,
    draw: c => { c.beginPath(); c.roundRect(-50, -22, 100, 36, [9, 3, 3, 4]); c.fill(); circle(c, -30, 15, 7); circle(c, 30, 15, 7); } },
  { id: 'airliner', name: 'Airliner (side)', cat: 'Vehicle', ref: 'chord', mat: 'aluminum', size: 0.18,
    draw: c => path(c, 'M -50 0 C -50 -6 -43 -8 -32 -8 L 28 -7 L 42 -26 L 50 -26 L 48 -4 C 46 2 40 4 30 4 L -36 4 C -46 4 -50 3 -50 0 Z') },
  // ---------- weird ----------
  { id: 'duck', name: 'Rubber duck', cat: 'Weird', ref: 'frontal', mat: 'duckrubber', size: 0.08,
    draw: c => { ellipse(c, 8, 16, 38, 21); poly(c, [[30, 4], [50, -12], [44, 16]]); circle(c, -16, -14, 17); ellipse(c, -36, -11, 10, 4.5); } },
  { id: 'teapot', name: 'Teapot', cat: 'Weird', ref: 'frontal', mat: 'ceramic', size: 0.1,
    draw: c => {
      ellipse(c, 0, 8, 30, 22); rect(c, -16, 24, 32, 7); ellipse(c, 0, -14, 17, 5); circle(c, 0, -21, 5);
      path(c, 'M -24 4 C -38 2 -42 -6 -50 -17 L -45 -20 C -40 -12 -32 -9 -22 -7 Z');
      c.beginPath(); c.arc(30, 6, 14, 0, TAU); c.arc(30, 6, 8, 0, TAU, true); c.fill();
    } },
  { id: 'umbrella', name: 'Umbrella', cat: 'Weird', ref: 'frontal', mat: 'abs', size: 0.12,
    draw: c => {
      stroke(c, 5, () => c.arc(0, 12, 50, Math.PI + 0.38, TAU - 0.38));
      stroke(c, 4, () => { c.moveTo(0, -38); c.lineTo(0, 44); });
      stroke(c, 4, () => c.arc(-8, 44, 8, 0, Math.PI));
    } },
  { id: 'banana', name: 'Banana', cat: 'Weird', ref: 'frontal', mat: 'banana', size: 0.12,
    draw: c => { path(c, 'M -50 -10 C -30 32 30 32 50 -10 C 30 12 -30 12 -50 -10 Z'); poly(c, [[46, -6], [52, -16], [55, -14], [50, -4]]); } },
  { id: 'bird', name: 'Bird (gliding)', cat: 'Weird', ref: 'chord', mat: 'bird', size: 0.12,
    draw: c => { ellipse(c, 0, 0, 30, 9, 0.06); circle(c, -28, -4, 8); poly(c, [[-35, -7], [-47, -3], [-34, -1]]); poly(c, [[24, -2], [50, -9], [50, 5]]); } },
  { id: 'fish', name: 'Fish', cat: 'Weird', ref: 'frontal', mat: 'fish', size: 0.1,
    draw: c => { ellipse(c, -6, 0, 34, 17); poly(c, [[22, 0], [48, -18], [42, 0], [48, 18]]); poly(c, [[-12, -14], [8, -27], [10, -12]]); } },
  { id: 'star', name: 'Star', cat: 'Weird', ref: 'frontal', mat: 'abs', size: 0.08,
    draw: c => poly(c, Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 20 : 50, a = -Math.PI / 2 + i * Math.PI / 5; return [r * Math.cos(a), r * Math.sin(a)]; })) },
  { id: 'heart', name: 'Heart', cat: 'Weird', ref: 'frontal', mat: 'abs', size: 0.07, draw: c => path(c, 'M 0 40 C -60 0 -40 -50 0 -20 C 40 -50 60 0 0 40 Z') },
  { id: 'spoon', name: 'Spoon', cat: 'Weird', ref: 'chord', mat: 'steel', size: 0.13,
    draw: c => { ellipse(c, -30, 0, 20, 12); c.beginPath(); c.roundRect(-14, -3, 64, 6, 3); c.fill(); } },
  { id: 'card', name: 'Playing card', cat: 'Weird', ref: 'chord', mat: 'card', size: 0.088, mount: 'free', angle: 20, draw: c => rect(c, -50, -1, 100, 2) },
  { id: 'leaf', name: 'Leaf (curved)', cat: 'Weird', ref: 'chord', mat: 'leaf', size: 0.07, mount: 'free', angle: 10,
    draw: c => stroke(c, 3, () => { c.moveTo(-50, 6); c.quadraticCurveTo(0, -14, 50, 6); }) },
  { id: 'pingpong', name: 'Ping-pong ball', cat: 'Weird', ref: 'frontal', mat: 'pingpong', size: 0.04, mount: 'free', draw: c => circle(c, 0, 0, 50) },
  { id: 'frisbee', name: 'Frisbee', cat: 'Weird', ref: 'chord', mat: 'abs', size: 0.12, angle: 4,
    draw: c => path(c, 'M -50 6 C -50 -5 -30 -10 0 -10 C 30 -10 50 -5 50 6 L 45 6 C 44 0 30 -4 0 -4 C -30 -4 -44 0 -45 6 Z') },
  { id: 'boomerang', name: 'Boomerang', cat: 'Weird', ref: 'chord', mat: 'pine', size: 0.12,
    draw: c => poly(c, [[-50, -18], [-42, -27], [0, 6], [42, -27], [50, -18], [0, 24]]) },
  { id: 'croissant', name: 'Croissant', cat: 'Weird', ref: 'frontal', mat: 'croissant', size: 0.1,
    draw: c => path(c, 'M -50 10 C -42 -38 42 -38 50 10 C 30 -8 -30 -8 -50 10 Z') },
  { id: 'pretzel', name: 'Pretzel', cat: 'Weird', ref: 'frontal', mat: 'croissant', size: 0.09,
    draw: c => { c.lineWidth = 8; c.lineCap = 'round'; c.beginPath(); c.arc(-17, -6, 21, 0, TAU); c.stroke(); c.beginPath(); c.arc(17, -6, 21, 0, TAU); c.stroke(); c.beginPath(); c.moveTo(-32, 9); c.quadraticCurveTo(0, 52, 32, 9); c.stroke(); } },
  // ---------- machines ----------
  { id: 'savonius', name: 'Savonius rotor', cat: 'Machine', ref: 'frontal', mat: 'aluminum', size: 0.09, mount: 'pivot',
    draw: c => { stroke(c, 4, () => c.arc(-12, 0, 25, 0, Math.PI)); stroke(c, 4, () => c.arc(12, 0, 25, Math.PI, TAU)); } },
  { id: 'vane', name: 'Weathervane', cat: 'Machine', ref: 'chord', mat: 'aluminum', size: 0.13, mount: 'pivot', angle: 45, pivot: -0.18,
    draw: c => { rect(c, -38, -2.5, 66, 5); poly(c, [[-50, 0], [-34, -10], [-34, 10]]); poly(c, [[24, -3], [50, -17], [50, 17], [24, 3]]); } },
  { id: 'magnus', name: 'Spinning cylinder', cat: 'Machine', ref: 'frontal', mat: 'aluminum', size: 0.05, mount: 'motor', draw: c => circle(c, 0, 0, 50) },
];

// ---------------------------------------------------------------------------
function renderFit(draw, R, fit = 0.7) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = R;
  const c = cv.getContext('2d', { willReadFrequently: true });
  const paint = (s, tx, ty) => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, R, R);
    c.setTransform(s, 0, 0, s, R / 2 + tx, R / 2 + ty);
    c.fillStyle = '#fff'; c.strokeStyle = '#fff';
    draw(c);
    return c.getImageData(0, 0, R, R).data;
  };
  let s0 = R * 0.004, d, x0, x1, y0, y1;
  for (let attempt = 0; attempt < 6; attempt++) {
    d = paint(s0, 0, 0);
    x0 = R; x1 = -1; y0 = R; y1 = -1;
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      if (d[(y * R + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) throw new Error('Shape is empty');
    if (x0 > 0 && y0 > 0 && x1 < R - 1 && y1 < R - 1) break;   // not clipped
    s0 /= 3;
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const k = fit * R / Math.max(w, h);
  const cx = (x0 + x1 + 1) / 2 - R / 2, cy = (y0 + y1 + 1) / 2 - R / 2;
  d = paint(s0 * k, -cx * k, -cy * k);
  return { data: d, canvas: cv };
}

function dt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
function edt(g, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
}

function convexHull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Build physics data for a drawing. All lengths are in "tex units" (1 = SDF texture side),
// with y up and the origin at the texture centre.
export function buildShape(draw, meta = {}) {
  const R = SDF_RES;
  const { data } = renderFit(draw, R);
  const N = R * R;
  const inside = new Uint8Array(N);
  for (let i = 0; i < N; i++) inside[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  const gIn = new Float64Array(N), gOut = new Float64Array(N);
  for (let i = 0; i < N; i++) { gIn[i] = inside[i] ? 1e20 : 0; gOut[i] = inside[i] ? 0 : 1e20; }
  edt(gIn, R, R); edt(gOut, R, R);
  const raw = new Float32Array(N);
  let maxIn = 0;
  for (let i = 0; i < N; i++) {
    if (inside[i]) { const di = Math.sqrt(gIn[i]); raw[i] = -(di - 0.5); if (di > maxIn) maxIn = di; }
    else raw[i] = Math.sqrt(gOut[i]) - 0.5;
  }
  // light smoothing removes pixel staircases; flip so texture row 0 = bottom (y up)
  const sdf = new Float32Array(N);
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    let s = 0, n = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = x + i, yy = y + j;
      if (xx < 0 || yy < 0 || xx >= R || yy >= R) continue;
      s += raw[yy * R + xx]; n++;
    }
    sdf[(R - 1 - y) * R + x] = s / n / R;
  }
  // mass properties (uniform density), bbox, hull
  let A = 0, sx = 0, sy = 0, bx0 = 1, bx1 = -1, by0 = 1, by1 = -1;
  const edge = [];
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    if (!inside[y * R + x]) continue;
    const px = (x + 0.5) / R - 0.5, py = 0.5 - (y + 0.5) / R;
    A++; sx += px; sy += py;
    if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py;
    const b = x === 0 || y === 0 || x === R - 1 || y === R - 1 || !inside[y * R + x - 1] || !inside[y * R + x + 1] || !inside[(y - 1) * R + x] || !inside[(y + 1) * R + x];
    if (b) edge.push([px, py]);
  }
  const cx = sx / A, cy = sy / A;
  let I = 0;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    if (!inside[y * R + x]) continue;
    const px = (x + 0.5) / R - 0.5, py = 0.5 - (y + 0.5) / R;
    I += (px - cx) ** 2 + (py - cy) ** 2;
  }
  const pa = 1 / (R * R);
  let hull = convexHull(edge);
  if (hull.length > 72) { const st = hull.length / 72; hull = Array.from({ length: 72 }, (_, i) => hull[Math.floor(i * st)]); }
  // CPU copy for hit-testing (coarser)
  return {
    ...meta, sdf, area: A * pa, cx, cy, I: I * pa,
    bbox: { x0: bx0 - 0.5 / R, x1: bx1 + 0.5 / R, y0: by0 - 0.5 / R, y1: by1 + 0.5 / R },
    hull, maxIn: maxIn / R,
  };
}

export function thumbnail(draw, size = 64, color = '#cfd6de') {
  const { canvas } = renderFit(draw, size * 2, 0.78);
  const out = document.createElement('canvas');
  out.width = out.height = size * 2;
  const c = out.getContext('2d');
  c.drawImage(canvas, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = color;
  c.fillRect(0, 0, out.width, out.height);
  return out;
}

// ---------- user-made objects ----------
export function textDraw(text, font = '800 100px "Helvetica Neue", Arial, sans-serif') {
  return c => { c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 0, 0); };
}

// Turn an image into a silhouette canvas. Transparent PNGs use alpha; photos use an
// Otsu threshold on luminance (object assumed darker than background unless inverted).
export function imageSilhouette(img, invert = false) {
  const maxd = 512;
  const sc = Math.min(1, maxd / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(img, 0, 0, w, h);
  const id = c.getImageData(0, 0, w, h), d = id.data;
  let transparent = 0;
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] < 200) transparent++;
  const useAlpha = transparent > w * h * 0.05;
  const lum = new Float32Array(w * h);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < w * h; i++) {
    const L = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    lum[i] = L; hist[Math.min(255, L | 0)]++;
  }
  let thr = 128;
  if (!useAlpha) { // Otsu
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = w * h - wB; if (!wF) break;
      sB += t * hist[t];
      const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) ** 2;
      if (between > best) { best = between; thr = t; }
    }
  }
  for (let i = 0; i < w * h; i++) {
    let on = useAlpha ? d[i * 4 + 3] > 127 : lum[i] < thr;
    if (invert) on = !on;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = on ? 255 : 0;
  }
  c.putImageData(id, 0, 0);
  return cv;
}
export const canvasDraw = (cv) => c => c.drawImage(cv, -cv.width / 2, -cv.height / 2);

// A freehand stroke (lattice coords, y up). Closed loops are filled; open strokes
// become a bent plate of the given thickness.
export function strokeDraw(pts, closed, width) {
  return c => {
    c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath();
    pts.forEach(([x, y], i) => i ? c.lineTo(x, -y) : c.moveTo(x, -y));
    if (closed) { c.closePath(); c.fill(); }
    c.stroke();
  };
}
