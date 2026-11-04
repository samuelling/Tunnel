// "Real air": the lab's lattice-Boltzmann solver running on a slice through the tube.
//
// The Shred Hole's own air is a quick kinematic model that can't see the objects. This runs real
// 2D CFD (D2Q9 with an LES sub-grid model, lab/js/lbm.js) on the plane through the tube's axis
// that faces the camera, and draws it as a glowing cut-away inside the glass. The biggest things
// near that plane (and the fan hub) are cut into it as moving obstacles, each a silhouette
// turning with its body, so you see their real wakes, vortex shedding and the jet round the hub.
// It is a picture only (option 1): the game's physics still uses its own air model.
//
// Scale: 64 cells across the 4.8 m tube (7.5 cm cells), lattice speed 0.12 at 40 m/s. Each frame
// runs as many steps as keep the slice in step with the game's clock, up to a cap; on a slow GPU
// the slice's flow lags behind real time rather than dragging the frame rate down.
import * as THREE from 'three';
import { createGL } from '../lab/js/gl.js';
import { Solver, MAX_OBJ } from '../lab/js/lbm.js';
import { buildShape } from '../lab/js/shapes.js';
import { TUN, FAN, NU } from './config.js';

const GH = 64, R = TUN.R, DX = (2 * R) / GH, GW = Math.round(TUN.L / DX);
const ULB_REF = 0.12, U_REF = 40;
const DT = ULB_REF * DX / U_REF;            // seconds per lattice step
const MODES = { smoke: 0, swirl: 1 };

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
    // the fan hub, fixed in the slice
    this.hub = this.makeShape([[[-0.42, -FAN.Rhub], [0.42, -FAN.Rhub], [0.42, FAN.Rhub], [-0.42, FAN.Rhub]]]);
    // the cut-away: a glowing plane through the axis, added over the scene
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.minFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(TUN.L, 2 * R),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.8, toneMapped: false }));
    this.mesh.renderOrder = 5;
    rig.add(this.mesh);
    this.setVisible(false);
  }

  setVisible(on) { this.mesh.visible = on; this.on = on; }
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

  update(dt, { bodies, air, camera, rig }) {
    if (!this.on) return;
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
    put(this.hub, hx, hy, 0, 0, 0, 0, hx, hy);
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
  }

  dispose() { this.mesh.parent?.remove(this.mesh); this.tex.dispose(); this.solver.dispose(); }
}

function hull2(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
