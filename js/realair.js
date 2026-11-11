// "Real air": the lab's lattice-Boltzmann solver running on a slice through the tube.
//
// The Shred Hole's own air is a quick kinematic model that can't see the objects. This runs real
// 2D CFD (D2Q9 with an LES sub-grid model, lab/js/lbm.js) on the plane through the tube's axis
// that faces the camera, and draws it as a glowing cut-away inside the glass. The biggest things
// near that plane (and the fan hub) are cut into it as moving obstacles, each a silhouette
// turning with its body, so you see their real wakes, vortex shedding and the jet round the hub.
//
// It also steers the physics (option 2). About ten times a second the slice's velocity field is
// read back from the GPU (asynchronously, so nothing waits on it). Each body near the plane looks
// a little upstream of itself in the slice and compares what it finds with the slice's own
// body-free reference flow: being in another thing's wake (drafting, shielding) or squeezed past
// it (a faster jet, a sideways push) shows up as a difference, which is added to the game's
// kinematic air for that body. Comparing against the body-free reference keeps the hub and walls,
// which the kinematic model already has, from being counted twice. A 2D slice overstates wakes
// (a 2D cylinder's wake is far longer and stronger than a 3D sphere's), so only half of the
// difference is used, and it fades with distance from the plane. Things jammed across the tube
// just above the fan block the slice too, and that cuts the fan's flow (fan law with an added
// resistance).
//
// Scale: 64 cells across the 14.4 m tube (22.5 cm cells), lattice speed 0.12 at 40 m/s. Each frame
// runs as many steps as keep the slice in step with the game's clock, up to a cap; on a slow GPU
// the slice's flow lags behind real time rather than dragging the frame rate down.
import * as THREE from 'three';
import { createGL } from '../lab/js/gl.js';
import { Solver, MAX_OBJ } from '../lab/js/lbm.js';
import { buildShape } from '../lab/js/shapes.js';
import { TUN, FAN, NU, S } from './config.js';

const GH = 64, R = TUN.R, DX = (2 * R) / GH, GW = Math.round(TUN.L / DX);
const ULB_REF = 0.12, U_REF = 40;
const DT = ULB_REF * DX / U_REF;            // seconds per lattice step
const MODES = { smoke: 0, swirl: 1 };
const BLEND = 0.5;        // share of the slice's disturbance the physics takes (2D overstates wakes)
const READ_EVERY = 0.1;   // seconds between velocity read-backs

export class RealAir {
  constructor(rig, { maxSteps = 48 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = GW * 4; this.canvas.height = GH * 4;
    this.gl = createGL(this.canvas);   // throws where WebGL2 float targets are missing
    this.solver = new Solver(this.gl, GW, GH, { particleRows: 64 });
    const p = this.solver.p;
    p.tau0 = 3 * NU * DT / (DX * DX) + 0.5;  // ≈ 0.5: the LES model carries the small scales
    p.cs2 = 0.16 * 0.16; p.slip = 1; p.sponge = Math.round(GW * 0.08); p.ti = 0.01;
    for (let i = 0; i < 8; i++) p.modes.set([1 + Math.random() * 6, Math.random() * 6.28, 0.5, 0], i * 4);
    this.solver.setBodies([]); this.solver.rasterize(); this.solver.init(0);
    this.maxSteps = maxSteps; this.mode = 'smoke'; this.flip = 1;
    this.e = new THREE.Vector3(0, 0, 1); this.n = new THREE.Vector3(0, 1, 0);
    this.cache = new WeakMap(); this.queue = []; this.carry = 0;
    this.field = null; this.base = new Map(); this.readClock = 0; this.readId = 0; this.pend = null;
    this.felt = 0; this.feltMax = 0;
    // the fan hub, fixed in the slice
    this.hub = this.makeShape([[[-0.42 * S, -FAN.Rhub], [0.42 * S, -FAN.Rhub], [0.42 * S, FAN.Rhub], [-0.42 * S, FAN.Rhub]]]);
    // the cut-away: a glowing plane through the axis, added over the scene
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.minFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(TUN.L, 2 * R),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.8, toneMapped: false }));
    this.mesh.renderOrder = 5;
    rig.add(this.mesh);
    this.setVisible(false);
  }

  setVisible(on) { this.mesh.visible = on; this.on = on; if (!on) this.field = null; }
  setMode(m) { this.mode = m; }

  // silhouette (list of 2D polygons, metres) → a lab shape with its scale data
  makeShape(polys) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const pg of polys) for (const [x, y] of pg) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const shape = buildShape((c) => { for (const pg of polys) { c.beginPath(); pg.forEach(([x, y], i) => i ? c.lineTo(x * 100, -y * 100) : c.moveTo(x * 100, -y * 100)); c.closePath(); c.fill(); } });
    const bb = shape.bbox, extTex = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0), extM = Math.max(x1 - x0, y1 - y0, 1e-3);
    const S = (extM / DX) / extTex;
    return { shape, S, bc: [(x0 + x1) / 2, (y0 + y1) / 2], dil: Math.max(0, 1.25 - shape.maxIn * S) };
  }

  // a body's side-on silhouette in its own frame (each convex part's outline, z dropped)
  shapeFor(rec) {
    let s = this.cache.get(rec);
    if (s) return s;
    if (!this.queue.includes(rec)) this.queue.push(rec);
    return null;
  }
  buildQueued() {
    const rec = this.queue.shift();
    if (!rec || this.cache.has(rec)) return;
    const polys = [];
    for (const p of rec.parts || []) {
      const pts = (p.points || []).map(v => [v.x, v.y]);
      if (pts.length >= 3) polys.push(hull2(pts));
    }
    if (polys.length) { try { this.cache.set(rec, this.makeShape(polys)); } catch (e) { /* too small to draw */ } }
  }

  // tube-frame point → lattice coordinates on the slice
  toLattice(x, y, z) { const s = y * this.e.y + z * this.e.z; return [(this.flip > 0 ? x : TUN.L - x) / DX, (s + R) / DX]; }

  update(dt, { bodies, air, camera, rig, hub = true }) {
    if (!this.on) return;
    this.frame = (this.frame || 0) + 1;
    // the slice faces the camera: its normal is the camera's direction across the tube
    const c = rig.worldToLocal(camera.position.clone());
    const nn = new THREE.Vector3(0, c.y, c.z); if (nn.lengthSq() < 1e-6) nn.set(0, 1, 0);
    nn.normalize();
    this.n.lerp(nn, Math.min(1, dt * 4)).normalize();
    this.e.set(0, -this.n.z, this.n.y);
    this.flip = air.flowDir >= 0 ? 1 : -1;
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(this.flip, 0, 0), this.e, new THREE.Vector3(this.flip, 0, 0).cross(this.e));
    this.mesh.quaternion.setFromRotationMatrix(basis);
    this.mesh.position.set(TUN.L / 2, 0, 0);

    // obstacles: the hub, then the biggest bodies close to the plane
    const list = [], q = new THREE.Quaternion(), ax = new THREE.Vector3(), cen = new THREE.Vector3();
    const shapes = [];
    const put = (sh, cx, cy, th, vx, vy, w, px, py) => shapes.push(sh) && list.push({ cx, cy, c: Math.cos(th), s: Math.sin(th), S: sh.S, omega: w, vx, vy, px, py, dil: sh.dil });
    const [hx, hy] = this.toLattice(TUN.fanX, 0, 0);
    if (hub) put(this.hub, hx, hy, 0, 0, 0, 0, hx, hy);
    const cand = [];
    for (const b of bodies) {
      if (b.dead || !b.body || b.radius < 0.12) continue;
      const t = b.body.translation();
      if (t.x < -0.5 || t.x > TUN.L + 0.5) continue;
      const off = Math.abs(t.y * this.n.y + t.z * this.n.z);
      if (off < b.radius * 0.9) cand.push({ b, t, k: b.radius - off * 0.5 });
    }
    cand.sort((a, b) => b.k - a.k);
    const kLb = DT / DX;
    for (const { b, t } of cand) {
      if (list.length >= MAX_OBJ) break;
      const sh = this.shapeFor(b); if (!sh) continue;
      const r = b.body.rotation(); q.set(r.x, r.y, r.z, r.w);
      ax.set(1, 0, 0).applyQuaternion(q);
      const th = Math.atan2(ax.y * this.e.y + ax.z * this.e.z, this.flip * ax.x);
      cen.set(sh.bc[0], sh.bc[1], 0).applyQuaternion(q).add(t);
      const [cx, cy] = this.toLattice(cen.x, cen.y, cen.z), [px, py] = this.toLattice(t.x, t.y, t.z);
      const v = b.body.linvel(), w = b.body.angvel();
      const wn = (w.x * this.n.x + w.y * this.n.y + w.z * this.n.z) * this.flip;
      put(sh, cx, cy, th, this.flip * v.x * kLb, (v.y * this.e.y + v.z * this.e.z) * kLb, wn * DT, px, py);
    }
    this.buildQueued();   // at most one new silhouette per frame

    // the shapes go up to the GPU only when the set changes
    const key = shapes;
    if (key.length !== (this.lastKey?.length || -1) || key.some((s, i) => s !== this.lastKey[i])) {
      key.forEach((s, i) => this.solver.setSDF(i, s.shape.sdf));
      this.lastKey = key;
    }
    const sv = this.solver;
    sv.setBodies(list);
    // steps to keep up with the game's clock (capped; a slow GPU just lets the slice lag)
    this.carry += dt / DT;
    let n = Math.min(this.maxSteps, Math.floor(this.carry)); this.carry = Math.min(this.carry - n, this.maxSteps);
    const uin = Math.min(0.16, ULB_REF * air.U / U_REF);
    if (n > 0) {
      sv.rasterize();
      sv.beginForces();
      for (let i = 0; i < n; i++) { sv.p.uin += (uin - sv.p.uin) * 0.01; sv.step(false); }
      sv.updateDye(n, [5, 14, 1, 0], { v: [0, 0, 0, 0], col: [0, 0, 0] }, 0.9994);
    }
    sv.prepVis(Math.max(sv.p.uin, 1e-4), GH / 6);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    sv.render({ x: 0, y: 0, w: this.canvas.width, h: this.canvas.height }, {
      mode: MODES[this.mode] ?? 0, range: this.mode === 'swirl' ? 0.3 : 1, colors: new Float32Array(24), sel: -1,
      smokeGain: 1.3, particles: false, streak: 0, U: sv.p.uin, partAlpha: 0,
    });
    this.tex.needsUpdate = true;
    this.steps = n;
    this.sense(dt, list.length - (hub ? 1 : 0), hub);
  }

  // ---- option 2: the slice feeding back into the physics ----

  // read the velocity field (and the obstacle map) back from the GPU every READ_EVERY seconds
  sense(dt, nBodies, hub) {
    const sv = this.solver;
    for (const r of sv.reader.poll()) {
      const t = r.tag;
      if (t.kind !== 'ra') continue;
      if (t.part === 'u') this.pend = { ...t.meta, u: r.data };
      else if (this.pend?.id === t.id) { this.take({ ...this.pend, obs: r.data }); this.pend = null; }
    }
    this.readClock += dt;
    if (this.readClock >= READ_EVERY && sv.reader.pending.length < 4 && sv.p.uin > 0.004) {
      this.readClock = 0;
      const id = ++this.readId;
      const meta = { id, e: this.e.clone(), n: this.n.clone(), flip: this.flip, hub, uin: sv.p.uin, bodies: nBodies };
      sv.reader.request(sv.fboC[sv.cur], 0, 0, GW, GH, { kind: 'ra', part: 'u', id, meta });
      sv.reader.request(sv.obsFbo, 0, 0, GW, GH, { kind: 'ra', part: 'obs', id });
    }
  }

  take(f) {
    f.at = performance.now(); f.frame = this.frame;
    const u = f.u, N = GW * GH;
    // speeds are taken relative to each column's mean flow (the flow rate through the tube at that
    // point), not the inlet's: while the fan spins up or down the slice lags its inlet, and this
    // keeps that lag from looking like a wake
    const cm = f.colMean = new Float32Array(GW);
    for (let gx = 0; gx < GW; gx++) { let a = 0; for (let gy = 0; gy < GH; gy++) a += u[(gy * GW + gx) * 4 + 2]; cm[gx] = Math.max(a / GH, f.uin * 0.2, 1e-5); }
    // whenever the slice has nothing in it but the hub, and its flow has filled the whole tube
    // (every column carrying the inlet's flow rate to within 5%), it updates the reference flow
    let dev = 0; for (let gx = 0; gx < GW; gx++) dev = Math.max(dev, Math.abs(cm[gx] / f.uin - 1));
    if (f.bodies === 0 && dev < 0.05) {
      const key = `${f.flip}:${f.hub ? 1 : 0}`;
      let b = this.base.get(key);
      if (!b) { b = new Float32Array(N * 2); b.n = 0; this.base.set(key, b); }
      const a = 1 / Math.min(b.n + 1, 12); b.n++;
      for (let i = 0; i < N; i++) { const inv = 1 / cm[i % GW]; b[2 * i] += (u[4 * i + 2] * inv - b[2 * i]) * a; b[2 * i + 1] += (u[4 * i + 3] * inv - b[2 * i + 1]) * a; }
    }
    // fan blockage: the most-blocked column of the slice in the 1.4·S m above the fan, hub left out
    const o = f.obs, hubId = f.hub ? 0 : -1, fx = Math.round((f.flip > 0 ? TUN.fanX : TUN.L - TUN.fanX) / DX);
    let worst = 0;
    for (let gx = Math.max(0, fx - Math.round(1.4 * S / DX)); gx <= Math.min(GW - 1, fx); gx++) {
      let n = 0;
      for (let gy = 0; gy < GH; gy++) { const k = (gy * GW + gx) * 4; if (o[k] < 0 && o[k + 1] !== hubId) n++; }
      worst = Math.max(worst, n / GH);
    }
    f.block = worst;
    this.field = f;
  }

  // bilinear sample of a 2-component field (stride 4 at offset 2 for the raw read, stride 2 for the reference)
  sampleAt(arr, stride, off, gx, gy, out) {
    const x = Math.max(0, Math.min(GW - 1.001, gx)), y = Math.max(0, Math.min(GH - 1.001, gy));
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const k00 = (j * GW + i) * stride + off, k10 = k00 + stride, k01 = k00 + GW * stride, k11 = k01 + stride;
    for (let c = 0; c < 2; c++) {
      out[c] = (arr[k00 + c] * (1 - fx) + arr[k10 + c] * fx) * (1 - fy) + (arr[k01 + c] * (1 - fx) + arr[k11 + c] * fx) * fy;
    }
    return out;
  }

  // the slice's correction to the game's air for one body, tube frame (m/s). False when there is none.
  nudge(rec, t, air, out) {
    out[0] = out[1] = out[2] = 0;
    const f = this.field;
    if (!this.fresh() || air.U < 1 || t.x < 0 || t.x > TUN.L) return false;
    const r = Math.max(rec.radius || 0.3, 0.3);
    const off = Math.abs(t.y * f.n.y + t.z * f.n.z);
    const w = BLEND * Math.exp(-((off / r) ** 2));
    if (w < 0.02) return false;
    // look just upstream of the body, clear of its own outline
    const xs = f.flip > 0 ? t.x : TUN.L - t.x, s = t.y * f.e.y + t.z * f.e.z;
    const gx = xs / DX - (r / DX + 2), gy = (s + R) / DX;
    if (gx < 1) return false;
    const fanS = (f.flip > 0 ? TUN.fanX : TUN.L - TUN.fanX) / DX;
    const ref = this.base.get(`${f.flip}:${f.hub ? 1 : 0}`);
    if (!ref && f.hub && gx > fanS - 1.8 * S / DX && gx < fanS + S / DX) return false;   // no reference yet: keep out of the hub's own disturbance
    const cm = f.colMean, ci = Math.max(0, Math.min(GW - 1, Math.round(gx)));
    const us = this.sampleAt(f.u, 4, 2, gx, gy, S1), inv = 1 / cm[ci];
    const ub = ref ? this.sampleAt(ref, 2, 0, gx, gy, S2) : B0;
    let dx = (us[0] * inv - ub[0]) * air.U, de = (us[1] * inv - ub[1]) * air.U;
    const m = Math.hypot(dx, de), cap = 0.7 * air.U;
    if (m > cap) { dx *= cap / m; de *= cap / m; }
    out[0] = w * dx * f.flip; out[1] = w * de * f.e.y; out[2] = w * de * f.e.z;
    this.felt++; this.feltMax = Math.max(this.feltMax, -w * dx / air.U);
    return true;
  }

  // a read-back from the last ~20 frames (and 3 s), so a slow device still gets its feedback
  fresh() { const f = this.field; return !!(this.on && f && this.frame - f.frame < 20 && performance.now() - f.at < 3000); }

  // how much the slice says the cross-section above the fan is blocked (0…~0.4 cut in the fan's flow)
  blockage() {
    const f = this.field;
    if (!this.fresh()) return 0;
    return BLEND * Math.min(0.85, f.block) ** 1.5;
  }

  dispose() { this.mesh.parent?.remove(this.mesh); this.tex.dispose(); this.solver.dispose(); }
}

const S1 = [0, 0], S2 = [0, 0], B0 = [1, 0];

function hull2(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
