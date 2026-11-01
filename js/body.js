// Rigid bodies: geometry in lattice units, mounts, and 3-DOF dynamics coupled to the fluid.
import { MATERIALS } from './units.js';
import { SDF_RES } from './lbm.js';

let NEXT = 1;
const rot = (c, s, v) => [c * v[0] - s * v[1], s * v[0] + c * v[1]];

export class Body {
  constructor(shape, o = {}) {
    this.uid = NEXT++;
    this.shape = shape;
    this.name = o.name || shape.name || 'Object';
    this.ref = o.ref || shape.ref || 'frontal';
    this.sizeM = o.size || 0.05;
    this.setMaterial(o.mat || 'aluminum');
    this.mount = o.mount || 'fixed';
    this.pivotFrac = [o.pivot ?? 0, 0];
    this.spring = { heave: true, pitch: true, fh: 4, fp: 6, zh: 0.005, zp: 0.005 };
    this.torsion = { f: 0, z: 0.02 };
    this.rpm = 1200;
    this.P = [0, 0]; this.th = (o.angle || 0) * Math.PI / 180;
    this.V = [0, 0]; this.w = 0; this.acc = [0, 0, 0];
    this.F = [0, 0, 0];           // fluid force & torque (about pivot), lattice units, frame-averaged
    this.home = null;
    this.hist = { t: [], cd: [], cl: [], cm: [], fx: [], fy: [], x: [], y: [], a: [] };
    this.avgStart = 0;
    this.dragging = false;
  }

  setMaterial(key) {
    this.mat = key;
    this.density = MATERIALS[key].rho;
    this.color = MATERIALS[key].color.slice();
  }

  // Recompute lattice geometry for the current scale (dx in metres per cell).
  geom(dx) {
    const sh = this.shape, bb = sh.bbox;
    const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
    const tcOld = this.pivL ? this.texCenter() : null;   // keep the body where it is
    this.ext = Math.max(bw, bh);
    this.S = (this.sizeM / dx) / this.ext;
    const S = this.S;
    this.cmL = [sh.cx * S, sh.cy * S];
    if (this.mount === 'free') this.pivL = this.cmL.slice();
    else this.pivL = [((bb.x0 + bb.x1) / 2 + this.pivotFrac[0] * bw) * S, ((bb.y0 + bb.y1) / 2 + this.pivotFrac[1] * bh) * S];
    this.Al = sh.area * S * S;
    this.Il = sh.I * S ** 4;
    this.chordL = bw * S;
    this.dil = Math.max(0, 1.25 - sh.maxIn * S);
    this.rmax = 0;
    for (const p of sh.hull) this.rmax = Math.max(this.rmax, Math.hypot(p[0] * S - this.pivL[0], p[1] * S - this.pivL[1]));
    if (tcOld) this.placeTexCenter(tcOld[0], tcOld[1]);
  }

  texCenter() {
    const c = Math.cos(this.th), s = Math.sin(this.th);
    const r = rot(c, s, this.pivL);
    return [this.P[0] - r[0], this.P[1] - r[1]];
  }

  placeTexCenter(x, y) {
    const c = Math.cos(this.th), s = Math.sin(this.th);
    const r = rot(c, s, this.pivL);
    this.P = [x + r[0], y + r[1]];
  }

  centroid() {
    const c = Math.cos(this.th), s = Math.sin(this.th);
    const r = rot(c, s, [this.cmL[0] - this.pivL[0], this.cmL[1] - this.pivL[1]]);
    return [this.P[0] + r[0], this.P[1] + r[1]];
  }

  hullWorld() {
    const tc = this.texCenter(), c = Math.cos(this.th), s = Math.sin(this.th), S = this.S;
    return this.shape.hull.map(p => { const r = rot(c, s, [p[0] * S, p[1] * S]); return [tc[0] + r[0], tc[1] + r[1]]; });
  }

  // Reference length in cells (for coefficients / Reynolds number)
  refLen() {
    if (this.ref === 'chord') return this.chordL;
    let y0 = 1e9, y1 = -1e9;
    for (const p of this.hullWorld()) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    return Math.max(1, y1 - y0 + 2 * this.dil);
  }

  sdfAt(q) {
    const tc = this.texCenter(), c = Math.cos(this.th), s = Math.sin(this.th);
    const dx = q[0] - tc[0], dy = q[1] - tc[1];
    const lx = (c * dx + s * dy) / this.S + 0.5, ly = (-s * dx + c * dy) / this.S + 0.5;
    if (lx <= 0 || ly <= 0 || lx >= 1 || ly >= 1) return 1e9;
    const R = SDF_RES;
    return this.shape.sdf[Math.floor(ly * R) * R + Math.floor(lx * R)] * this.S - this.dil;
  }

  isDynamic() { return this.mount !== 'fixed' || this.dragging; }

  setHome() { this.home = { P: this.P.slice(), th: this.th }; }

  rescaleTime(ratio) {
    this.V[0] *= ratio; this.V[1] *= ratio; this.w *= ratio;
    for (let i = 0; i < 3; i++) this.acc[i] *= ratio * ratio;
  }

  forSolver() {
    const tc = this.texCenter();
    return { cx: tc[0], cy: tc[1], c: Math.cos(this.th), s: Math.sin(this.th), S: this.S,
      omega: this.w, vx: this.V[0], vy: this.V[1], px: this.P[0], py: this.P[1], dil: this.dil };
  }

  // One lattice time step. env: { g:[gx,gy] (lattice), rr: rho_solid/rho_fluid handled here,
  //   rhoF, dtHz: 2π·dt (rad per step per Hz), box: {x0,x1,y0,y1} }
  integrate(env) {
    if (this.dragging || this.mount === 'fixed') return;
    if (!this.home) this.setHome();
    const r = this.density / env.rhoF;          // density ratio (fluid density = 1 in lattice)
    const m = r * this.Al, Ic = r * this.Il;
    const md = this.Al;                          // displaced fluid mass
    const c = Math.cos(this.th), s = Math.sin(this.th);
    const a = rot(c, s, [this.cmL[0] - this.pivL[0], this.cmL[1] - this.pivL[1]]);
    const a2 = a[0] * a[0] + a[1] * a[1];

    if (this.mount === 'motor') {
      const target = this.rpm / 60 * env.dtHz;     // rad per step
      this.w += (target - this.w) * 0.002;
      this.th += this.w;
      this.V = [0, 0];
      return;
    }

    let free;
    if (this.mount === 'pivot') free = [0, 0, 1];
    else if (this.mount === 'spring') free = [0, this.spring.heave ? 1 : 0, this.spring.pitch ? 1 : 0];
    else free = [1, 1, 1];

    // generalised forces about the pivot
    const Q = [this.F[0], this.F[1], this.F[2]];
    const wg = (m - md);                          // weight minus buoyancy
    const Fg = [wg * env.g[0], wg * env.g[1]];
    Q[0] += Fg[0]; Q[1] += Fg[1]; Q[2] += a[0] * Fg[1] - a[1] * Fg[0];
    Q[0] += m * this.w * this.w * a[0]; Q[1] += m * this.w * this.w * a[1];

    const Ip = Ic + m * a2;
    if (this.mount === 'spring' && this.home) {
      const wh = this.spring.fh * env.dtHz, wp = this.spring.fp * env.dtHz;
      Q[1] += -m * wh * wh * (this.P[1] - this.home.P[1]) - 2 * this.spring.zh * m * wh * this.V[1];
      Q[2] += -Ip * wp * wp * angDiff(this.th, this.home.th) - 2 * this.spring.zp * Ip * wp * this.w;
    }
    if (this.mount === 'pivot') {
      if (this.torsion.f > 0 && this.home) {
        const wt = this.torsion.f * env.dtHz;
        Q[2] += -Ip * wt * wt * angDiff(this.th, this.home.th) - 2 * this.torsion.z * Ip * wt * this.w;
      } else {
        Q[2] += -1e-4 * Ip * this.w;            // bearing friction (tiny)
      }
    }
    if (this.mount === 'free') this._contacts(Q, m, env);

    // mass matrix (with lagged added-mass stabilisation for light bodies)
    const ma = md, Ia = Math.max(this.Il, 0.25 * md * this.chordL * this.chordL / 12);
    const M = [
      [m + ma, 0, -m * a[1]],
      [0, m + ma, m * a[0]],
      [-m * a[1], m * a[0], Ip + Ia],
    ];
    const rhs = [Q[0] + ma * this.acc[0], Q[1] + ma * this.acc[1], Q[2] + Ia * this.acc[2]];
    const idx = [0, 1, 2].filter(i => free[i]);
    const acc = [0, 0, 0];
    if (idx.length) {
      const sub = idx.map(i => idx.map(j => M[i][j]));
      const b = idx.map(i => rhs[i]);
      const x = solve(sub, b);
      idx.forEach((i, k) => acc[i] = x[k]);
    }
    this.acc = acc;
    this.V[0] = free[0] ? this.V[0] + acc[0] : 0;
    this.V[1] = free[1] ? this.V[1] + acc[1] : 0;
    this.w = free[2] ? this.w + acc[2] : 0;
    // keep surface speeds well below the lattice sound speed
    const vmax = Math.hypot(this.V[0], this.V[1]) + Math.abs(this.w) * this.rmax;
    if (vmax > 0.2) { const k = 0.2 / vmax; this.V[0] *= k; this.V[1] *= k; this.w *= k; }
    this.P[0] += this.V[0]; this.P[1] += this.V[1]; this.th += this.w;
  }

  _contacts(Q, m, env) {
    const box = env.box;
    const k = m * (2 * Math.PI / 60) ** 2, cdamp = 2 * 0.6 * Math.sqrt(k * m);
    const hull = this.hullWorld();
    const n = hull.length;
    const kk = k / Math.max(1, n / 8), cc = cdamp / Math.max(1, n / 8);
    for (const p of hull) {
      const rx = p[0] - this.P[0], ry = p[1] - this.P[1];
      const vx = this.V[0] - this.w * ry, vy = this.V[1] + this.w * rx;
      let fx = 0, fy = 0;
      const push = (pen, nx, ny) => {
        const vn = vx * nx + vy * ny;
        const fn = Math.max(0, kk * pen - cc * vn);
        fx += fn * nx; fy += fn * ny;
        const tx = -ny, ty = nx, vt = vx * tx + vy * ty;      // Coulomb-ish friction
        const ft = Math.max(-0.4 * fn, Math.min(0.4 * fn, -cc * vt));
        fx += ft * tx; fy += ft * ty;
      };
      if (p[1] < box.y0) push(box.y0 - p[1], 0, 1);
      if (p[1] > box.y1) push(p[1] - box.y1, 0, -1);
      if (p[0] < box.x0) push(box.x0 - p[0], 1, 0);
      if (p[0] > box.x1) push(p[0] - box.x1, -1, 0);
      if (fx || fy) { Q[0] += fx; Q[1] += fy; Q[2] += rx * fy - ry * fx; }
    }
  }

  mass(rhoF) { return (this.density / rhoF) * this.Al; }
}

export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / d;
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}
