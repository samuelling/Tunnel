// Tunnel — app shell: UI, interaction, instrumentation, and the simulation loop.
import { createGL } from './gl.js';
import { Solver, MAX_OBJ } from './lbm.js';
import { SHAPES, buildShape, thumbnail, textDraw, imageSilhouette, canvasDraw, strokeDraw } from './shapes.js';
import { Body, angDiff } from './body.js';
import { FLUIDS, MATERIALS, MOUNTS, GRAVITY, latticeScale, fmt, fmtSI } from './units.js';

const $ = (id) => document.getElementById(id);
const RES = { low: [480, 180], med: [768, 288], high: [1024, 384], ultra: [1536, 576] };
const DEG = Math.PI / 180;
const isTouch = matchMedia('(pointer: coarse)').matches;

const st = {
  fluid: 'air', U: 5, ti: 0.004, slip: 1, gravity: 'down', H: 0.5,
  res: (isTouch || innerWidth < 860) ? 'med' : 'high', cs: 0.12, sub: 0,
  running: true, mode: 0, rake: true, rainbow: false, rakeN: 26, smoke: 0.55, range: 1,
  parts: false, streak: true, arrows: true, frame: true, tool: 'move',
};

const QS = new URLSearchParams(location.search);
if (QS.get('res') && RES[QS.get('res')]) st.res = QS.get('res');
if (QS.get('sub')) st.sub = +QS.get('sub');
if (QS.get('mode')) st.mode = +QS.get('mode');

let gl, solver, W, H, sc, bodies = [], sel = null;
let simTime = 0, frameNo = 0, nsub = 8, version = 0, dirty = true;
let uinCur = 0, gust = 0, modesBase = [];
let probes = [], hover = null;
const shapeCache = new Map();
const view = { x: 0, y: 0, w: 1, h: 1, dpr: 1, cw: 1, ch: 1 };
const perf = { ema: 16.7, last: performance.now(), mlups: 0, simRate: 0 };

// ------------------------------------------------------------------ setup
function fatal(msg) {
  const f = $('fatal'); f.hidden = false;
  f.innerHTML = `<div><h2 style="color:#ff7a1a;font-family:var(--mono);letter-spacing:.3em">TUNNEL</h2><p>${msg}</p><p class="hint">Tunnel needs WebGL2 with float render targets (recent Chrome, Edge, Firefox or Safari 15+).</p></div>`;
}

function init() {
  try { gl = createGL($('gl')); } catch (e) { fatal(e.message); return; }
  buildUI();
  buildSolver();
  const cyl = SHAPES.find(s => s.id === 'cylinder');
  addFromLibrary(cyl, { x: 0.27, y: 0.5, silent: true });
  layout();
  addEventListener('resize', layout);
  if (innerWidth < 600 && innerHeight > innerWidth) setTimeout(() => toast('Tip: turn your phone sideways for a bigger tunnel'), 1500);
  requestAnimationFrame(loop);
}

function buildSolver() {
  const keep = bodies.map(b => ({ b, fx: b.P[0] / W, fy: b.P[1] / H }));
  if (solver) solver.dispose();
  [W, H] = RES[st.res];
  solver = new Solver(gl, W, H, { particleRows: st.res === 'low' ? 96 : st.res === 'ultra' ? 256 : 160 });
  solver.p.sponge = Math.round(W * 0.11);
  modesBase = Array.from({ length: 8 }, () => ({ k: 1 + Math.random() * 11, ph: Math.random() * Math.PI * 2, amp: 0.5 }));
  updateScale(true);
  for (const { b, fx, fy } of keep) { b.geom(sc.dx); b.P = [fx * W, fy * H]; b.home = null; b.setHome(); }
  uploadSDFs();
  syncBodies(); solver.rasterize();
  uinCur = sc.Ulb;
  solver.init(uinCur);
  simTime = 0; version++;
  bodies.forEach(clearHist);
  layout();
}

function updateScale(silent) {
  const fl = FLUIDS[st.fluid];
  const old = sc;
  sc = latticeScale({ U: st.U, nu: fl.nu, H: st.H, gridH: H });
  if (old && !silent && Math.abs(old.dx - sc.dx) < 1e-12) bodies.forEach(b => b.rescaleTime(sc.dt / old.dt));
  solver.p.tau0 = sc.tau;
  solver.p.cs2 = st.cs * st.cs;
  solver.p.slip = st.slip;
  solver.p.ti = st.ti;
  const m = new Float32Array(32);
  modesBase.forEach((md, i) => m.set([md.k, sc.Ulb * 2 * Math.PI * md.k / H, md.ph, md.amp], i * 4));
  solver.p.modes = m;
  bodies.forEach(b => b.geom(sc.dx));
  dirty = true;
  updateDerived();
}

function env() {
  const g = GRAVITY[st.gravity].g, k = sc.dt * sc.dt / sc.dx;
  return {
    g: [g[0] * k, g[1] * k], rhoF: FLUIDS[st.fluid].rho, dtHz: 2 * Math.PI * sc.dt,
    box: { x0: 6, x1: W - solver.p.sponge - 3, y0: 0.6, y1: H - 1.6 },
  };
}

function uploadSDFs() { bodies.forEach((b, i) => solver.setSDF(i, b.shape.sdf)); }
function syncBodies() { solver.setBodies(bodies.map(b => b.forSolver())); }

// ------------------------------------------------------------------ bodies
function getShape(meta) {
  if (!shapeCache.has(meta.id)) shapeCache.set(meta.id, buildShape(meta.draw, { name: meta.name, ref: meta.ref, id: meta.id }));
  return shapeCache.get(meta.id);
}

const SPOTS = [[0.27, 0.5], [0.5, 0.5], [0.27, 0.27], [0.27, 0.73], [0.5, 0.27], [0.5, 0.73], [0.68, 0.5], [0.16, 0.5]];
function freeSpot(sizeCells) {
  for (const [fx, fy] of SPOTS) {
    const x = fx * W, y = fy * H;
    if (bodies.every(b => Math.hypot(b.P[0] - x, b.P[1] - y) > (b.rmax + sizeCells * 0.6))) return [fx, fy];
  }
  return [0.3 + Math.random() * 0.3, 0.3 + Math.random() * 0.4];
}

function addBody(shape, opts, where) {
  if (bodies.length >= MAX_OBJ) { toast(`The balance takes up to ${MAX_OBJ} models at once.`); return null; }
  const b = new Body(shape, opts);
  const maxM = 0.8 * st.H, minM = 6 * sc.dx;
  b.sizeM = Math.min(maxM, Math.max(minM, b.sizeM));
  b.geom(sc.dx);
  if (where && where.tex) b.placeTexCenter(where.tex[0], where.tex[1]);
  else {
    const [fx, fy] = where && where.x != null ? [where.x, where.y] : freeSpot(b.sizeM / sc.dx);
    b.placeTexCenter(fx * W, fy * H);
  }
  if (b.mount === 'spring') tuneSpring(b);
  b.setHome();
  bodies.push(b);
  uploadSDFs(); version++; dirty = true;
  select(b);
  return b;
}

function tuneSpring(b) {
  // pick natural frequencies in the interesting (lock-in / flutter) range for the current wind
  const L = b.sizeM;
  b.spring.fh = +(st.U / (6 * L)).toPrecision(2);
  b.spring.fp = +(st.U / (3.5 * L)).toPrecision(2);
}

function addFromLibrary(meta, where = {}) {
  const shape = getShape(meta);
  const b = addBody(shape, { name: meta.name, ref: meta.ref, size: meta.size * st.H / 0.5, mat: meta.mat, mount: meta.mount, angle: meta.angle, pivot: meta.pivot }, where);
  if (b && !where.silent) {
    let msg = `${meta.name} added · drag to move, twist or scroll to rotate`;
    if (b.mount === 'free' && st.gravity === 'down') msg = `${meta.name} is free-flying: try Flow → Gravity → vertical tunnel to levitate it`;
    toast(msg);
  }
}

function removeBody(b) {
  const i = bodies.indexOf(b);
  if (i < 0) return;
  bodies.splice(i, 1);
  if (sel === b) select(null);
  uploadSDFs(); version++; dirty = true;
}

function clearHist(b) { for (const k in b.hist) b.hist[k].length = 0; b.avgStart = 0; }

// ------------------------------------------------------------------ loop
function loop(now) {
  requestAnimationFrame(loop);
  const fdt = Math.min(100, now - perf.last); perf.last = now;
  perf.ema += (fdt - perf.ema) * 0.08;
  frameNo++;
  if (st.sub === 0 && frameNo % 20 === 0) {
    if (perf.ema < 18.5 && nsub < 60) nsub += 2;
    else if (perf.ema > 24 && nsub > 2) nsub = Math.max(2, Math.floor(nsub * 0.8));
  } else if (st.sub > 0) nsub = st.sub;

  handleReadback();

  const dyn = bodies.some(b => b.isDynamic());
  if (dirty) { syncBodies(); solver.rasterize(); dirty = false; }

  if (st.running) {
    const e = env();
    solver.beginForces();
    for (let s = 0; s < nsub; s++) {
      let target = sc.Ulb;
      if (gust > 0) { const ph = 1 - gust / 3000; target *= 1 + 0.6 * Math.sin(Math.PI * ph) ** 2; gust--; }
      uinCur += (target - uinCur) * 0.004;
      solver.p.uin = uinCur;
      if (dyn) {
        for (const b of bodies) b.integrate(e);
        syncBodies(); solver.rasterize();
      }
      solver.step(true);
    }
    solver.requestForces({ ver: version, t: simTime + nsub * sc.dt, nsub });
    simTime += nsub * sc.dt;
    perf.mlups = W * H * nsub / perf.ema / 1e3;
    perf.simRate = nsub * sc.dt / (perf.ema / 1000);
    solver.updateDye(nsub, [5, st.rakeN, st.rake ? 1 : 0, st.rainbow ? 1 : 0], wandState(), 0.9997);
    if (st.parts || st.mode === 5) solver.updateParticles(nsub, frameNo);
  }

  if (frameNo % 4 === 0) {
    probes.forEach((p, i) => solver.requestProbe(p.g[0], p.g[1], { probe: i }));
    if (hover && !drag) solver.requestProbe(hover.g[0], hover.g[1], { hover: true });
  }

  const refB = sel || bodies[0];
  solver.prepVis(uinCur, refB ? refB.refLen() : H / 8);
  const colors = new Float32Array(24);
  bodies.forEach((b, i) => colors.set(b.color, i * 3));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, view.cw, view.ch);
  gl.clearColor(0.035, 0.04, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  solver.render({ x: Math.round(view.x * view.dpr), y: Math.round(view.ch - (view.y + view.h) * view.dpr), w: Math.round(view.w * view.dpr), h: Math.round(view.h * view.dpr) }, {
    mode: st.mode, range: st.range, colors, sel: sel ? bodies.indexOf(sel) : -1,
    smokeGain: 0.4 + st.smoke * 6, particles: st.parts || st.mode === 5, streak: st.streak ? 6 : 0,
    U: uinCur, partAlpha: st.mode === 5 ? 0.55 : 0.35,
  });
  drawOverlay();
  if (frameNo % 6 === 0) updateReadouts();
  if (frameNo % 10 === 0 && $('tab-data').classList.contains('on')) drawChart();
}

function handleReadback() {
  for (const r of solver.reader.poll()) {
    const t = r.tag;
    if (t.kind === 'force') {
      if (t.ver !== version) continue;
      for (let i = 0; i < t.n && i < bodies.length; i++) {
        const b = bodies[i], d = r.data, n = d[i * 4 + 3] || 1;
        b.F = [d[i * 4] / n, d[i * 4 + 1] / n, d[i * 4 + 2] / n];
        record(b, t.t);
      }
    } else if (t.kind === 'probe') {
      const d = r.data, sp = Math.hypot(d[2], d[3]) * sc.dx / sc.dt;
      const cp = (d[1] - 1) / 3 / (0.5 * uinCur * uinCur);
      const val = { sp, cp, ang: Math.atan2(d[3], d[2]) / DEG };
      if (t.hover) { if (hover) hover.val = val; }
      else if (probes[t.probe]) probes[t.probe].val = val;
    }
  }
}

function coeffs(b) {
  const U = Math.max(uinCur, 1e-6), L = b.refLen(), q = 0.5 * U * U * L;
  return { cd: b.F[0] / q, cl: b.F[1] / q, cm: b.F[2] / (q * L), L };
}

function record(b, t) {
  const c = coeffs(b), h = b.hist;
  const kF = FLUIDS[st.fluid].rho * sc.dx ** 3 / (sc.dt * sc.dt);
  h.t.push(t); h.cd.push(c.cd); h.cl.push(c.cl); h.cm.push(c.cm);
  h.fx.push(b.F[0] * kF); h.fy.push(b.F[1] * kF);
  h.x.push(b.P[0] * sc.dx); h.y.push(b.P[1] * sc.dx); h.a.push(b.th / DEG);
  if (h.t.length > 8000) { for (const k in h) h[k].splice(0, 2000); b.avgStart = Math.max(0, b.avgStart - 2000); }
}

function stats(b) {
  const h = b.hist, n = h.t.length, i0 = Math.min(Math.max(b.avgStart, Math.floor(n * 0.25)), Math.max(0, n - 2));
  const s = { n: n - i0 };
  if (s.n < 4) return null;
  const mean = a => { let v = 0; for (let i = i0; i < n; i++) v += a[i]; return v / (n - i0); };
  const rms = (a, m) => { let v = 0; for (let i = i0; i < n; i++) v += (a[i] - m) ** 2; return Math.sqrt(v / (n - i0)); };
  s.cd = mean(h.cd); s.cl = mean(h.cl); s.cm = mean(h.cm);
  s.cdr = rms(h.cd, s.cd); s.clr = rms(h.cl, s.cl);
  s.fx = mean(h.fx); s.fy = mean(h.fy);
  // shedding frequency from upward zero-crossings of the lift fluctuation
  const cr = [];
  for (let i = i0 + 1; i < n; i++) if (h.cl[i - 1] < s.cl && h.cl[i] >= s.cl && s.clr > 1e-3) cr.push(h.t[i]);
  if (cr.length >= 3) {
    s.f = (cr.length - 1) / (cr[cr.length - 1] - cr[0]);
    s.st = s.f * b.refLen() * sc.dx / st.U;
  }
  s.T = h.t[n - 1] - h.t[i0];
  return s;
}

// ------------------------------------------------------------------ layout + overlay
function layout() {
  const stage = $('stage');
  const narrow = innerWidth <= 860;
  if (narrow) {
    const w = stage.clientWidth || innerWidth;
    const hh = Math.min(innerHeight * 0.7, (w - 46) * H / W + 92);
    document.documentElement.style.setProperty('--stageH', Math.round(hh) + 'px');
  }
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  view.dpr = dpr;
  view.cw = Math.round(r.width * dpr); view.ch = Math.round(r.height * dpr);
  for (const c of [$('gl'), $('ov')]) { c.width = view.cw; c.height = view.ch; }
  const ml = st.frame ? 30 : 6, mr = st.frame ? 14 : 6, mt = st.frame ? 18 : 6, mb = (st.frame ? 58 : 50) + (narrow ? 16 : 0);
  const aw = r.width - ml - mr, ah = r.height - mt - mb, asp = W / H;
  if (aw / ah > asp) { view.h = ah; view.w = ah * asp; } else { view.w = aw; view.h = aw / asp; }
  view.x = ml + (aw - view.w) / 2; view.y = mt + (ah - view.h) / 2;
}

const g2s = (gx, gy) => [view.x + (gx + 0.5) / W * view.w, view.y + (1 - (gy + 0.5) / H) * view.h];
const s2g = (sx, sy) => [(sx - view.x) / view.w * W - 0.5, (1 - (sy - view.y) / view.h) * H - 0.5];

function drawOverlay() {
  const cv = $('ov'), c = cv.getContext('2d');
  c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  const { x, y, w, h } = view;
  const ppc = w / W;   // px per cell

  // sponge / diffuser + safety screen
  const xs = g2s(W - solver.p.sponge, 0)[0];
  const grd = c.createLinearGradient(xs, 0, x + w, 0);
  grd.addColorStop(0, 'rgba(9,10,12,0.0)'); grd.addColorStop(1, 'rgba(9,10,12,0.75)');
  c.fillStyle = grd; c.fillRect(xs, y, x + w - xs, h);
  c.strokeStyle = 'rgba(190,200,210,0.35)'; c.setLineDash([2, 3]); c.lineWidth = 1;
  c.beginPath(); c.moveTo(xs + 0.5, y); c.lineTo(xs + 0.5, y + h); c.stroke(); c.setLineDash([]);

  if (st.frame) {
    // rails
    const rail = (yy, hh) => {
      const g = c.createLinearGradient(0, yy, 0, yy + hh);
      g.addColorStop(0, '#343b45'); g.addColorStop(0.5, '#222830'); g.addColorStop(1, '#171b20');
      c.fillStyle = g; c.fillRect(x - 26, yy, w + 38, hh);
      c.fillStyle = '#4a525e';
      for (let bx = x - 18; bx < x + w + 8; bx += 56) { c.beginPath(); c.arc(bx, yy + hh / 2, 1.8, 0, 7); c.fill(); }
    };
    rail(y - 10, 10); rail(y + h, 10);
    // honeycomb flow straightener at the inlet
    c.save(); c.beginPath(); c.rect(x - 26, y, 24, h); c.clip();
    c.fillStyle = '#12161b'; c.fillRect(x - 26, y, 24, h);
    c.strokeStyle = '#3a424d'; c.lineWidth = 1;
    const r6 = 4.2;
    for (let row = 0, yy = y; yy < y + h + r6; row++, yy += r6 * 1.5) {
      for (let xx = x - 26 + (row % 2) * r6 * 0.866; xx < x; xx += r6 * 1.732) {
        c.beginPath();
        for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; c.lineTo(xx + r6 * Math.cos(a), yy + r6 * Math.sin(a)); }
        c.closePath(); c.stroke();
      }
    }
    c.restore();
    c.fillStyle = '#7f8995'; c.font = '600 9px ui-monospace, Menlo, monospace';
    c.save(); c.translate(x - 30 + 1, y + h / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText('INLET ▸ HONEYCOMB', 0, -2); c.restore();
    c.textAlign = 'right'; if (w > 520) c.fillText('SAFETY SCREEN ▸ DIFFUSER', x + w - 4, y - 13);
    c.textAlign = 'left'; c.fillText(`TEST SECTION · ${fmtLen(st.H)} × ${fmtLen(st.H * W / H)}`, x, y - 13);
    // ruler
    const mPerPx = sc.dx * W / w;
    const nice = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
    const minor = nice.find(v => v / mPerPx >= 7) || 50;
    const major = nice.find(v => v >= minor * 5 && v / mPerPx >= 50) || minor * 10;
    const ry = y + h + 12;
    c.strokeStyle = '#59626e'; c.fillStyle = '#8b95a1'; c.textAlign = 'center';
    for (let i = 0; i * minor <= W * sc.dx + 1e-9; i++) {
      const v = i * minor, px = x + v / mPerPx;
      const isMaj = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      c.beginPath(); c.moveTo(px + 0.5, ry); c.lineTo(px + 0.5, ry + (isMaj ? 7 : 3.5)); c.stroke();
      if (isMaj) c.fillText(fmtLen(v), px, ry + 16);
    }
    // gravity indicator
    const gk = st.gravity;
    if (gk !== 'off') {
      const gx = x + w - 16, gy = y + h - 18;
      c.strokeStyle = 'rgba(220,226,232,0.65)'; c.fillStyle = c.strokeStyle; c.lineWidth = 1.5;
      const [dx, dy] = gk === 'down' ? [0, 1] : [-1, 0];
      c.beginPath(); c.moveTo(gx - dx * 8, gy - dy * 8); c.lineTo(gx + dx * 8, gy + dy * 8); c.stroke();
      c.beginPath(); c.moveTo(gx + dx * 11, gy + dy * 11); c.lineTo(gx + dx * 5 - dy * 4, gy + dy * 5 + dx * 4); c.lineTo(gx + dx * 5 + dy * 4, gy + dy * 5 - dx * 4); c.fill();
      c.font = 'italic 600 11px Georgia, serif'; c.fillText('g', gx - 12, gy + 4);
    }
  }

  // bodies: force vectors, selection
  for (const b of bodies) {
    const isSel = b === sel;
    if (st.arrows && b.hist.t.length) {
      const co = coeffs(b), cen = g2s(...b.centroid());
      const k = Math.min(70, Math.max(26, b.refLen() * ppc * 0.9));
      arrow(c, cen[0], cen[1], co.cd * k, 0, 'rgba(255,122,26,0.95)');
      arrow(c, cen[0], cen[1], 0, -co.cl * k, 'rgba(70,200,240,0.95)');
    }
    if (isSel) {
      const hull = b.hullWorld().map(p => g2s(p[0], p[1]));
      c.strokeStyle = 'rgba(255,122,26,0.7)'; c.setLineDash([4, 4]); c.lineWidth = 1;
      c.beginPath(); hull.forEach(([a, bb], i) => i ? c.lineTo(a, bb) : c.moveTo(a, bb)); c.closePath(); c.stroke(); c.setLineDash([]);
      const pv = g2s(b.P[0], b.P[1]);
      c.strokeStyle = '#fff'; c.lineWidth = 1.2;
      c.beginPath(); c.arc(pv[0], pv[1], 4, 0, 7); c.stroke();
      c.beginPath(); c.moveTo(pv[0] - 7, pv[1]); c.lineTo(pv[0] + 7, pv[1]); c.moveTo(pv[0], pv[1] - 7); c.lineTo(pv[0], pv[1] + 7); c.stroke();
      if (b.mount !== 'motor') {
        const hp = handlePos(b), hs = g2s(hp[0], hp[1]);
        c.strokeStyle = 'rgba(255,255,255,0.4)'; c.beginPath(); c.moveTo(pv[0], pv[1]); c.lineTo(hs[0], hs[1]); c.stroke();
        c.fillStyle = '#ff7a1a'; c.beginPath(); c.arc(hs[0], hs[1], isTouch ? 9 : 6, 0, 7); c.fill();
        c.fillStyle = '#111'; c.font = '700 9px sans-serif'; c.textAlign = 'center'; c.fillText('⟲', hs[0], hs[1] + 3);
      }
    }
  }

  // balance box
  if (sel && sel.hist.t.length) {
    const co = coeffs(sel);
    const re = st.U * co.L * sc.dx / FLUIDS[st.fluid].nu;
    const small = h < 220;
    const lines = small ? [`Cd ${co.cd.toFixed(2)} Cl ${co.cl.toFixed(2)}`]
      : [sel.name.toUpperCase(), `Cd ${co.cd.toFixed(3)}   Cl ${co.cl >= 0 ? ' ' : ''}${co.cl.toFixed(3)}`, `Re ${fmtRe(re)}   α ${(sel.th / DEG).toFixed(1)}°`];
    const fs = small ? 9.5 : 11, lh = fs + 3;
    c.font = `${fs}px ui-monospace, Menlo, monospace`;
    const bw = Math.max(...lines.map(l => c.measureText(l).width)) + 12;
    const bh = lines.length * lh + 8;
    c.fillStyle = 'rgba(12,14,17,0.72)'; c.fillRect(x + 4, y + 4, bw, bh);
    c.textAlign = 'left';
    lines.forEach((l, i) => { c.fillStyle = i || small ? '#46c8f0' : '#ff9a4a'; c.fillText(l, x + 10, y + 4 + lh * (i + 1) - 2); });
  }

  // probes
  c.font = '10.5px ui-monospace, Menlo, monospace';
  for (const p of probes) {
    const s = g2s(p.g[0], p.g[1]);
    c.strokeStyle = '#ffe14a'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(s[0] - 6, s[1]); c.lineTo(s[0] + 6, s[1]); c.moveTo(s[0], s[1] - 6); c.lineTo(s[0], s[1] + 6); c.stroke();
    if (p.val) label(c, s[0] + 8, s[1] - 8, `${p.val.sp.toPrecision(3)} m/s · Cp ${p.val.cp.toFixed(2)}`, '#ffe14a');
  }
  if (hover && hover.val && !drag && !isTouch) {
    const s = g2s(hover.g[0], hover.g[1]);
    label(c, s[0] + 12, s[1] + 18, `${hover.val.sp.toPrecision(3)} m/s  ${hover.val.ang.toFixed(0)}°  Cp ${hover.val.cp.toFixed(2)}`, 'rgba(220,226,232,0.85)');
  }
  // draw-tool stroke
  if (drag && drag.kind === 'draw' && drag.pts.length > 1) {
    c.strokeStyle = '#ff7a1a'; c.lineWidth = Math.max(2, 3 * ppc); c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); drag.pts.forEach((p, i) => { const s = g2s(p[0], p[1]); i ? c.lineTo(s[0], s[1]) : c.moveTo(s[0], s[1]); }); c.stroke();
  }
  if (!st.running) {
    c.fillStyle = 'rgba(255,122,26,0.9)'; c.font = '700 11px ui-monospace, Menlo, monospace'; c.textAlign = 'right';
    c.fillText('❚❚ PAUSED', x + w - 10, y + 20);
  }
}

function label(c, x, y, txt, col) {
  const w = c.measureText(txt).width + 10;
  c.fillStyle = 'rgba(10,12,15,0.8)'; c.fillRect(x, y - 12, w, 17);
  c.fillStyle = col; c.textAlign = 'left'; c.fillText(txt, x + 5, y);
}

function arrow(c, x, y, dx, dy, col) {
  const L = Math.hypot(dx, dy);
  if (L < 3) return;
  const ux = dx / L, uy = dy / L;
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + dx - ux * 6, y + dy - uy * 6); c.stroke();
  c.beginPath(); c.moveTo(x + dx, y + dy); c.lineTo(x + dx - ux * 8 - uy * 4, y + dy - uy * 8 + ux * 4); c.lineTo(x + dx - ux * 8 + uy * 4, y + dy - uy * 8 - ux * 4); c.fill();
}

function handlePos(b) {
  const d = b.rmax + 22 / (view.w / W);
  return [b.P[0] - Math.sin(b.th) * d, b.P[1] + Math.cos(b.th) * d];
}

const fmtLen = (m) => m === 0 ? '0' : m >= 1 ? `${+m.toPrecision(3)} m` : m >= 0.01 ? `${+(m * 100).toPrecision(3)} cm` : `${+(m * 1000).toPrecision(3)} mm`;
const fmtRe = (re) => re >= 1e4 ? re.toExponential(2).replace('e+', '×10^').replace(/\^(\d+)/, (_, d) => sup(d)) : re.toPrecision(3);
const sup = (d) => d.split('').map(ch => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+ch]).join('');

// ------------------------------------------------------------------ pointer
let drag = null;
const pointers = new Map();

function hitBody(g) {
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i], tol = Math.max(2, (isTouch ? 14 : 5) / (view.w / W));
    if (b.sdfAt(g) < tol) return b;
  }
  return null;
}

function onDown(e) {
  const ov = $('ov');
  ov.setPointerCapture(e.pointerId);
  const r = ov.getBoundingClientRect();
  const g = s2g(e.clientX - r.left, e.clientY - r.top);
  pointers.set(e.pointerId, { g, sx: e.clientX, sy: e.clientY });
  if (pointers.size === 2 && sel) {
    const [a, b] = [...pointers.values()];
    drag = { kind: 'twist', a0: Math.atan2(b.sy - a.sy, b.sx - a.sx), th0: sel.th };
    return;
  }
  if (st.tool === 'move') {
    if (sel && sel.mount !== 'motor') {
      const hp = handlePos(sel), hs = g2s(hp[0], hp[1]);
      if (Math.hypot(hs[0] - (e.clientX - r.left), hs[1] - (e.clientY - r.top)) < (isTouch ? 18 : 10)) {
        drag = { kind: 'rotate', b: sel }; return;
      }
    }
    const b = hitBody(g);
    select(b);
    if (b) {
      drag = { kind: 'move', b, off: [b.P[0] - g[0], b.P[1] - g[1]], last: g, t: performance.now() };
      if (b.mount === 'free') { b.dragging = true; b.V = [0, 0]; b.w = 0; }
    }
  } else if (st.tool === 'smoke') {
    drag = { kind: 'smoke', g };
  } else if (st.tool === 'draw') {
    drag = { kind: 'draw', pts: [g] };
  } else if (st.tool === 'probe') {
    const i = probes.findIndex(p => Math.hypot(p.g[0] - g[0], p.g[1] - g[1]) < 12 / (view.w / W));
    if (i >= 0) probes.splice(i, 1); else { probes.push({ g }); if (probes.length > 5) probes.shift(); }
  }
}

function onMove(e) {
  const r = $('ov').getBoundingClientRect();
  const g = s2g(e.clientX - r.left, e.clientY - r.top);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { g, sx: e.clientX, sy: e.clientY });
  hover = (g[0] >= 0 && g[1] >= 0 && g[0] < W && g[1] < H) ? { g, val: hover && hover.val } : null;
  if (!drag) return;
  if (drag.kind === 'twist' && pointers.size === 2 && sel) {
    const [a, b] = [...pointers.values()];
    const ang = Math.atan2(b.sy - a.sy, b.sx - a.sx);
    setAngle(sel, drag.th0 - (ang - drag.a0));
  } else if (drag.kind === 'rotate') {
    const b = drag.b;
    setAngle(b, Math.atan2(-(g[0] - b.P[0]), g[1] - b.P[1]));
  } else if (drag.kind === 'move') {
    const b = drag.b;
    const nx = Math.min(W - solver.p.sponge - 2, Math.max(4, g[0] + drag.off[0]));
    const ny = Math.min(H - 1, Math.max(0, g[1] + drag.off[1]));
    if (b.mount === 'free') {
      const steps = Math.max(1, nsub);
      b.V = [(nx - b.P[0]) / steps, (ny - b.P[1]) / steps];
      const sp = Math.hypot(...b.V); if (sp > 0.15) { b.V[0] *= 0.15 / sp; b.V[1] *= 0.15 / sp; }
    }
    b.P = [nx, ny];
    if (b.home) b.home.P = [nx, ny];
    dirty = true;
  } else if (drag.kind === 'smoke') {
    drag.g = g;
  } else if (drag.kind === 'draw') {
    const l = drag.pts[drag.pts.length - 1];
    if (Math.hypot(g[0] - l[0], g[1] - l[1]) > 0.8) drag.pts.push(g);
  }
}

function onUp(e) {
  pointers.delete(e.pointerId);
  if (!drag) return;
  if (drag.kind === 'move' && drag.b.mount === 'free') { drag.b.dragging = false; drag.b.home = null; }
  if (drag.kind === 'draw') finishDrawing(drag.pts);
  if (drag.kind === 'twist' && pointers.size === 1) { drag = null; return; }
  drag = null;
}

function setAngle(b, th) {
  b.th = th; b.w = 0;
  if (b.home) b.home.th = th;
  dirty = true;
  if (b === sel) syncSelControls();
}

function onWheel(e) {
  if (!sel) return;
  e.preventDefault();
  const step = (e.shiftKey ? 0.1 : 1) * DEG * Math.sign(e.deltaY);
  setAngle(sel, sel.th - step);
}

function wandState() {
  if (drag && drag.kind === 'smoke') {
    const col = st.rainbow ? [1.0, 0.55, 0.2] : [1, 1, 1];
    return { v: [drag.g[0], drag.g[1], Math.max(2, H / 110), 0.7], col };
  }
  return { v: [0, 0, 1, 0], col: [1, 1, 1] };
}

function finishDrawing(pts) {
  if (pts.length < 4) return;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const ext = Math.max(x1 - x0, y1 - y0);
  if (ext < 5) { toast('Draw a bit bigger'); return; }
  const width = 3.2;
  const closed = pts.length > 8 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.18 * ext;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rel = pts.map(([x, y]) => [x - cx, y - cy]);
  const shape = buildShape(strokeDraw(rel, closed, width), { name: closed ? 'Drawn solid' : 'Drawn plate', ref: closed ? 'frontal' : 'chord' });
  addBody(shape, { name: closed ? 'Drawn solid' : 'Drawn plate', ref: shape.ref, size: (ext + width) * sc.dx, mat: 'abs', keepSize: true }, { tex: [cx, cy] });
  toast(closed ? 'Solid created from your loop' : 'Plate created from your stroke');
}

// ------------------------------------------------------------------ UI
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3200);
}

const logMap = (v, a, b) => a * Math.pow(b / a, v / 1000);
const logInv = (x, a, b) => Math.round(1000 * Math.log(x / a) / Math.log(b / a));

function buildUI() {
  // header
  $('btnRun').onclick = toggleRun;
  $('btnReset').onclick = $('btnReset2').onclick = resetFlow;
  $('btnGust').onclick = () => { gust = 3000; toast('Gust: +60% for a moment'); };
  // tools
  document.querySelectorAll('#tools button').forEach(b => b.onclick = () => {
    st.tool = b.dataset.tool;
    document.querySelectorAll('#tools button').forEach(x => x.classList.toggle('on', x === b));
    if (st.tool === 'draw') toast('Draw on the tunnel: close the loop for a solid, leave it open for a plate');
    if (st.tool === 'smoke') toast('Drag in the flow to release smoke');
    if (st.tool === 'probe') toast('Tap to place a pitot probe, tap it again to remove');
  });
  // tabs
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

  // flow
  const fluid = $('fluid');
  for (const [k, f] of Object.entries(FLUIDS)) fluid.add(new Option(f.name, k));
  fluid.value = st.fluid;
  fluid.onchange = () => { st.fluid = fluid.value; updateScale(); };
  const speed = $('speed');
  speed.value = logInv(st.U, 0.01, 100);
  const speedTxt = () => $('speedOut').textContent = st.U >= 1 ? `${st.U.toPrecision(3)} m/s` : `${(st.U * 100).toPrecision(3)} cm/s`;
  speed.oninput = () => { st.U = logMap(+speed.value, 0.01, 100); speedTxt(); updateScale(); };
  speedTxt();
  const ti = $('ti'); ti.value = Math.round(st.ti * 1000);
  ti.oninput = () => { st.ti = ti.value / 1000; $('tiOut').textContent = (st.ti * 100).toFixed(1) + ' %'; if (solver) solver.p.ti = st.ti; };
  ti.oninput();
  $('walls').value = String(st.slip);
  $('walls').onchange = () => { st.slip = +$('walls').value; solver.p.slip = st.slip; };
  const grav = $('gravity');
  for (const [k, g] of Object.entries(GRAVITY)) grav.add(new Option(g.name, k));
  grav.value = st.gravity;
  grav.onchange = () => { st.gravity = grav.value; bodies.forEach(b => { if (b.mount === 'free') b.home = null; }); };
  $('height').value = String(st.H);
  $('height').onchange = () => { st.H = +$('height').value; updateScale(); syncSelControls(); };
  $('res').value = st.res;
  $('res').onchange = () => { st.res = $('res').value; buildSolver(); syncSelControls(); };
  const cs = $('cs'); cs.value = Math.round(st.cs * 100);
  cs.oninput = () => { st.cs = cs.value / 100; $('csOut').textContent = st.cs.toFixed(2); if (solver) solver.p.cs2 = st.cs * st.cs; };
  cs.oninput();
  const sub = $('sub'); sub.value = st.sub;
  sub.oninput = () => { st.sub = +sub.value; $('subOut').textContent = st.sub ? st.sub : 'auto'; };
  sub.oninput();

  // library
  const lib = $('library');
  const cats = [...new Set(SHAPES.map(s => s.cat))];
  for (const cat of cats) {
    lib.insertAdjacentHTML('beforeend', `<h4>${cat}</h4>`);
    const grid = document.createElement('div'); grid.className = 'lib';
    for (const s of SHAPES.filter(x => x.cat === cat)) {
      const btn = document.createElement('button');
      btn.title = s.name;
      btn.appendChild(thumbnail(s.draw, 54, '#cdd5de'));
      btn.insertAdjacentHTML('beforeend', `<span>${s.name}</span>`);
      btn.onclick = () => addFromLibrary(s);
      grid.appendChild(btn);
    }
    lib.appendChild(grid);
  }
  $('btnText').onclick = () => {
    const t = $('textIn').value.trim();
    if (!t) { toast('Type something first'); return; }
    const shape = buildShape(textDraw(t), { name: `“${t}”`, ref: 'frontal' });
    addBody(shape, { name: `“${t}”`, ref: 'frontal', size: Math.min(0.6 * st.H, 0.05 * Math.max(2, t.length) * st.H / 0.5), mat: 'abs' });
  };
  $('imgIn').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      try {
        const sil = imageSilhouette(img, $('imgInvert').checked);
        const nm = f.name.replace(/\.[^.]+$/, '').slice(0, 18) || 'Image';
        const shape = buildShape(canvasDraw(sil), { name: nm, ref: 'frontal' });
        addBody(shape, { name: nm, ref: 'frontal', size: 0.2 * st.H, mat: 'abs' });
        toast('Silhouette created — tick “invert” and re-upload if it came out inside-out');
      } catch (err) { toast('Could not find an object in that image'); }
      URL.revokeObjectURL(img.src);
      e.target.value = '';
    };
    img.src = URL.createObjectURL(f);
  };
  $('btnClear').onclick = () => { bodies = []; select(null); version++; dirty = true; };

  // selected
  const mat = $('mat');
  for (const [k, m] of Object.entries(MATERIALS)) mat.add(new Option(`${m.name} · ${m.rho} kg/m³`, k));
  const mount = $('mount');
  for (const [k, m] of Object.entries(MOUNTS)) mount.add(new Option(m.name, k));
  $('size').oninput = () => {
    if (!sel) return;
    const minM = 6 * sc.dx, maxM = 0.85 * st.H;
    const tc = sel.texCenter();
    sel.sizeM = logMap(+$('size').value, minM, maxM);
    sel.geom(sc.dx); sel.placeTexCenter(tc[0], tc[1]); sel.setHome();
    dirty = true; syncSelControls();
  };
  $('angle').oninput = () => { if (sel) setAngle(sel, +$('angle').value * DEG); };
  mat.onchange = () => { if (!sel) return; sel.setMaterial(mat.value); syncSelControls(); };
  $('dens').onchange = () => { if (!sel) return; sel.density = Math.max(1, +$('dens').value); };
  mount.onchange = () => {
    if (!sel) return;
    const tc = sel.texCenter();
    sel.mount = mount.value;
    sel.V = [0, 0]; sel.w = 0; sel.acc = [0, 0, 0];
    sel.geom(sc.dx); sel.placeTexCenter(tc[0], tc[1]);
    if (sel.mount === 'spring') tuneSpring(sel);
    sel.setHome();
    if (sel.mount === 'free' && st.gravity === 'down') toast('Free flight in a horizontal tunnel will fall to the floor — try Gravity → vertical tunnel');
    dirty = true; syncSelControls();
  };
  $('pivot').oninput = () => {
    if (!sel) return;
    const tc = sel.texCenter();
    sel.pivotFrac[0] = +$('pivot').value / 100;
    sel.geom(sc.dx); sel.placeTexCenter(tc[0], tc[1]); sel.setHome();
    dirty = true; syncSelControls();
  };
  $('heave').onchange = () => { if (sel) { sel.spring.heave = $('heave').checked; sel.V[1] = 0; } };
  $('pitch').onchange = () => { if (sel) { sel.spring.pitch = $('pitch').checked; sel.w = 0; } };
  $('fh').oninput = () => { if (sel) { sel.spring.fh = +logMap(+$('fh').value, 0.05, 300).toPrecision(3); syncSelControls(); } };
  $('fp').oninput = () => { if (sel) { sel.spring.fp = +logMap(+$('fp').value, 0.05, 300).toPrecision(3); syncSelControls(); } };
  $('zeta').oninput = () => { if (sel) { sel.spring.zh = sel.spring.zp = +$('zeta').value / 500; sel.torsion.z = Math.max(0.005, sel.spring.zh); syncSelControls(); } };
  $('tor').oninput = () => { if (sel) { const v = +$('tor').value; sel.torsion.f = v === 0 ? 0 : +logMap(v, 0.05, 300).toPrecision(3); sel.setHome(); syncSelControls(); } };
  $('rpm').oninput = () => { if (sel) { sel.rpm = +$('rpm').value; syncSelControls(); } };
  $('btnHome').onclick = () => {
    if (!sel) return;
    if (sel.home) { sel.P = sel.home.P.slice(); sel.th = sel.home.th; }
    sel.V = [0, 0]; sel.w = 0; sel.acc = [0, 0, 0]; dirty = true; syncSelControls();
  };
  $('btnDel').onclick = () => sel && removeBody(sel);
  $('btnDup').onclick = () => {
    if (!sel) return;
    const s = sel;
    const b = addBody(s.shape, { name: s.name, ref: s.ref, size: s.sizeM, mat: s.mat, mount: s.mount, angle: s.th / DEG, pivot: s.pivotFrac[0], keepSize: true });
    if (b) { b.density = s.density; b.spring = { ...s.spring }; b.torsion = { ...s.torsion }; b.rpm = s.rpm; syncSelControls(); }
  };

  // view
  document.querySelectorAll('#modes button').forEach(b => b.onclick = () => {
    st.mode = +b.dataset.mode;
    document.querySelectorAll('#modes button').forEach(x => x.classList.toggle('on', x === b));
  });
  const chk = (id, key, fn) => { $(id).checked = st[key]; $(id).onchange = () => { st[key] = $(id).checked; fn && fn(); }; };
  chk('rake', 'rake'); chk('rainbow', 'rainbow'); chk('parts', 'parts'); chk('streak', 'streak');
  chk('arrows', 'arrows'); chk('frame', 'frame', layout);
  const rk = $('rakeN'); rk.value = st.rakeN;
  rk.oninput = () => { st.rakeN = +rk.value; $('rakeNOut').textContent = st.rakeN; }; rk.oninput();
  const sm = $('smoke'); sm.value = Math.round(st.smoke * 100);
  sm.oninput = () => { st.smoke = sm.value / 100; $('smokeOut').textContent = sm.value + ' %'; }; sm.oninput();
  const rg = $('range'); rg.value = 0;
  rg.oninput = () => { st.range = Math.pow(4, rg.value / 100); $('rangeOut').textContent = '×' + st.range.toFixed(2); }; rg.oninput();

  // data
  $('btnAvg').onclick = () => { if (sel) { sel.avgStart = sel.hist.t.length; toast('Averaging restarted'); } };
  $('btnCsv').onclick = exportCSV;

  // pointer
  const ov = $('ov');
  ov.addEventListener('pointerdown', onDown);
  ov.addEventListener('pointermove', onMove);
  ov.addEventListener('pointerup', onUp);
  ov.addEventListener('pointercancel', onUp);
  ov.addEventListener('pointerleave', () => { if (!drag) hover = null; });
  ov.addEventListener('wheel', onWheel, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); toggleRun(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) removeBody(sel);
    if (e.key === 'ArrowLeft' && sel) setAngle(sel, sel.th + (e.shiftKey ? 0.1 : 1) * DEG);
    if (e.key === 'ArrowRight' && sel) setAngle(sel, sel.th - (e.shiftKey ? 0.1 : 1) * DEG);
  });
}

function showTab(t) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + t));
  if (t === 'data') drawChart();
}

function toggleRun() {
  st.running = !st.running;
  $('btnRun').textContent = st.running ? '❚❚' : '▶';
}

function resetFlow() {
  for (const b of bodies) {
    if (b.home && b.mount !== 'free') { b.P = b.home.P.slice(); b.th = b.home.th; }
    b.V = [0, 0]; b.w = 0; b.acc = [0, 0, 0]; b.F = [0, 0, 0];
    clearHist(b);
  }
  syncBodies(); solver.rasterize();
  uinCur = sc.Ulb * 0.25;
  solver.init(uinCur);
  simTime = 0; version++;
}

function select(b) {
  sel = b;
  $('selNone').hidden = !!b; $('selBox').hidden = !b;
  if (b) syncSelControls();
}

function syncSelControls() {
  if (!sel || !sc) return;
  const b = sel;
  $('selName').textContent = b.name;
  const minM = 6 * sc.dx, maxM = 0.85 * st.H;
  $('size').value = logInv(Math.min(maxM, Math.max(minM, b.sizeM)), minM, maxM);
  $('sizeOut').textContent = fmtLen(b.sizeM);
  let deg = b.th / DEG; deg = ((deg + 180) % 360 + 360) % 360 - 180;
  $('angle').value = deg; $('angleOut').textContent = deg.toFixed(1) + '°';
  $('mat').value = b.mat; $('dens').value = Math.round(b.density);
  $('mount').value = b.mount;
  $('rowPivot').hidden = b.mount === 'free';
  $('pivot').value = Math.round(b.pivotFrac[0] * 100);
  $('pivotOut').textContent = (b.pivotFrac[0] >= 0 ? '+' : '') + b.pivotFrac[0].toFixed(2);
  $('springBox').hidden = b.mount !== 'spring';
  $('heave').checked = b.spring.heave; $('pitch').checked = b.spring.pitch;
  $('fh').value = logInv(b.spring.fh, 0.05, 300); $('fhOut').textContent = b.spring.fh + ' Hz';
  $('fp').value = logInv(b.spring.fp, 0.05, 300); $('fpOut').textContent = b.spring.fp + ' Hz';
  $('zeta').value = Math.round(b.spring.zh * 500); $('zetaOut').textContent = b.spring.zh.toFixed(3);
  $('rowTorsion').hidden = b.mount !== 'pivot';
  $('tor').value = b.torsion.f ? logInv(b.torsion.f, 0.05, 300) : 0; $('torOut').textContent = b.torsion.f ? b.torsion.f + ' Hz' : 'none';
  $('rowRpm').hidden = b.mount !== 'motor';
  $('rpm').value = b.rpm; $('rpmOut').textContent = b.rpm + ' rpm';
  $('dataName').textContent = b.name;
}

function ro(label, val) { return `<div><label>${label}</label><output>${val}</output></div>`; }

function updateReadouts() {
  // header
  const fl = FLUIDS[st.fluid];
  $('hudU').textContent = st.U >= 1 ? `${st.U.toPrecision(3)} m/s` : `${(st.U * 100).toPrecision(3)} cm/s`;
  const rb = sel || bodies[0];
  $('hudRe').textContent = rb ? fmtRe(st.U * rb.refLen() * sc.dx / fl.nu) : '—';
  $('hudT').textContent = simTime < 1 ? `${(simTime * 1000).toFixed(1)} ms` : `${simTime.toFixed(3)} s`;
  const r = perf.simRate;
  $('hudRate').textContent = !st.running ? 'paused' : r < 1 ? `1/${(1 / r).toFixed(0)}× slow-mo` : `${r.toFixed(1)}× real`;
  $('hudPerf').textContent = `${perf.mlups.toFixed(0)} MLUPS · ${nsub} st/f`;

  if (sel && !$('selBox').hidden) {
    const b = sel, co = coeffs(b), s = stats(b);
    const kF = fl.rho * sc.dx ** 3 / (sc.dt * sc.dt);
    const re = st.U * co.L * sc.dx / fl.nu;
    const massSpan = b.mass(fl.rho) * fl.rho * sc.dx * sc.dx;
    let html = ro('Re', fmtRe(re)) + ro('C<sub>D</sub>', s ? s.cd.toFixed(3) : co.cd.toFixed(3)) + ro('C<sub>L</sub>', s ? s.cl.toFixed(3) : co.cl.toFixed(3))
      + ro('Drag', fmtSI(b.F[0] * kF, 'N/m')) + ro('Lift', fmtSI(b.F[1] * kF, 'N/m')) + ro('C<sub>M</sub>', co.cm.toFixed(3))
      + ro('Strouhal', s && s.st ? s.st.toFixed(3) : '—') + ro('Mass', fmtSI(massSpan, 'kg/m')) + ro('L<sub>ref</sub>', fmtLen(co.L * sc.dx));
    if (b.mount !== 'fixed') {
      const vs = Math.hypot(...b.V) * sc.dx / sc.dt;
      html += ro('Speed', fmtSI(vs, 'm/s')) + ro('Spin', `${(b.w / sc.dt / (2 * Math.PI) * 60).toFixed(0)} rpm`) + ro('α', `${(b.th / DEG).toFixed(1)}°`);
    }
    $('readouts').innerHTML = html;
    if (b.mount !== 'fixed' && document.activeElement !== $('angle')) {
      let deg = b.th / DEG; deg = ((deg + 180) % 360 + 360) % 360 - 180;
      $('angle').value = deg; $('angleOut').textContent = deg.toFixed(1) + '°';
    }
  }
  if ($('tab-data').classList.contains('on')) {
    const b = sel || bodies[0];
    const s = b && stats(b);
    $('stats').innerHTML = s ? ro('C<sub>D</sub> mean', s.cd.toFixed(3)) + ro('C<sub>D</sub> rms', s.cdr.toFixed(3)) + ro('C<sub>L</sub> mean', s.cl.toFixed(3))
      + ro('C<sub>L</sub> rms', s.clr.toFixed(3)) + ro('Shedding', s.f ? `${s.f.toPrecision(3)} Hz` : '—') + ro('Strouhal', s.st ? s.st.toFixed(3) : '—')
      + ro('C<sub>M</sub> mean', s.cm.toFixed(3)) + ro('Window', s.T < 1 ? `${(s.T * 1000).toFixed(0)} ms` : `${s.T.toFixed(2)} s`) + ro('Samples', s.n) : '<p class="hint">Collecting data…</p>';
  }
}

function updateDerived() {
  const fl = FLUIDS[st.fluid];
  const mach = st.U / (st.fluid.startsWith('air') ? 343 : st.fluid === 'mars' ? 240 : st.fluid === 'helium' ? 1007 : 1480);
  $('derived').innerHTML =
    `grid <b>${W}×${H}</b> · Δx <b>${fmtLen(sc.dx)}</b> · Δt <b>${fmtSI(sc.dt, 's')}</b><br>` +
    `ν <b>${fmt(fl.nu)} m²/s</b> · ρ <b>${fl.rho} kg/m³</b> · Ma <b>${mach.toFixed(3)}</b><br>` +
    `lattice U <b>${sc.Ulb.toFixed(3)}</b> · τ₀ <b>${sc.tau.toFixed(5)}</b><br>` +
    `Re (per tunnel height) <b>${fmtRe(st.U * st.H / fl.nu)}</b>` +
    (sc.tau < 0.505 ? `<br><span style="color:#ffb35c">Re well beyond grid resolution → LES sub-grid model carries the small scales.</span>` : '');
}

function drawChart() {
  const cv = $('chart'), b = sel || bodies[0];
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = r.width, h = r.height;
  c.clearRect(0, 0, w, h);
  if (!b || b.hist.t.length < 2) return;
  $('dataName').textContent = b.name;
  const hst = b.hist, n = hst.t.length, i0 = Math.max(0, n - 1500);
  const series = [[hst.cd, '#ff7a1a'], [hst.cl, '#46c8f0'], [hst.cm, '#b48cf2']];
  let lo = 1e9, hi = -1e9;
  for (const [a] of series) for (let i = Math.max(i0, Math.floor(n * 0.05)); i < n; i++) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); }
  if (!isFinite(lo)) return;
  const pad = (hi - lo) * 0.1 + 0.05; lo -= pad; hi += pad;
  const t0 = hst.t[i0], t1 = hst.t[n - 1];
  const X = t => 36 + (t - t0) / Math.max(1e-12, t1 - t0) * (w - 44), Y = v => 8 + (1 - (v - lo) / (hi - lo)) * (h - 26);
  c.strokeStyle = '#20252c'; c.fillStyle = '#6d7782'; c.font = '10px ui-monospace, Menlo, monospace'; c.lineWidth = 1;
  const step = niceStep((hi - lo) / 4);
  c.textAlign = 'right';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { const yy = Y(v); c.beginPath(); c.moveTo(36, yy); c.lineTo(w - 8, yy); c.stroke(); c.fillText(+v.toFixed(3), 32, yy + 3); }
  if (lo < 0 && hi > 0) { c.strokeStyle = '#39414b'; c.beginPath(); c.moveTo(36, Y(0)); c.lineTo(w - 8, Y(0)); c.stroke(); }
  c.textAlign = 'center';
  c.fillText(`t = ${fmtSI(t0, 's')} … ${fmtSI(t1, 's')}`, w / 2, h - 4);
  for (const [a, col] of series) {
    c.strokeStyle = col; c.lineWidth = 1.4; c.beginPath();
    for (let i = i0; i < n; i++) { const xx = X(hst.t[i]), yy = Y(a[i]); i === i0 ? c.moveTo(xx, yy) : c.lineTo(xx, yy); }
    c.stroke();
  }
}
const niceStep = (x) => { const p = Math.pow(10, Math.floor(Math.log10(x))); const m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };

function exportCSV() {
  const b = sel || bodies[0];
  if (!b || !b.hist.t.length) { toast('No data yet'); return; }
  const h = b.hist;
  const fl = FLUIDS[st.fluid];
  let s = `# Tunnel export — ${b.name}; fluid ${fl.name}; U=${st.U} m/s; Lref=${(b.refLen() * sc.dx).toFixed(5)} m; mount ${b.mount}\n`;
  s += 't_s,Cd,Cl,Cm,drag_N_per_m,lift_N_per_m,x_m,y_m,angle_deg\n';
  for (let i = 0; i < h.t.length; i++) s += [h.t[i].toExponential(6), h.cd[i].toFixed(5), h.cl[i].toFixed(5), h.cm[i].toFixed(5), h.fx[i].toExponential(5), h.fy[i].toExponential(5), h.x[i].toFixed(5), h.y[i].toFixed(5), h.a[i].toFixed(3)].join(',') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' }));
  a.download = `tunnel-${b.name.replace(/[^\w]+/g, '_')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// small console/debug handle
window.tunnel = {
  st, get bodies() { return bodies; }, get sel() { return sel; },
  add: (id, where = {}) => addFromLibrary(SHAPES.find(s => s.id === id), where),
  clear: () => { bodies = []; select(null); version++; dirty = true; },
  setMount: (b, m) => { $('mount').value = m; select(b); $('mount').onchange(); },
  setGravity: (g) => { $('gravity').value = g; $('gravity').onchange(); },
  setMode: (m) => document.querySelector(`#modes button[data-mode="${m}"]`).click(),
  resetFlow, get time() { return simTime; },
};

init();
