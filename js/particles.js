// Spray: juice, sparks, confetti, glass, smoke tracers… simple drag particles that ride the
// same air model as the rigid bodies, splat on the floor and stick to the tube walls.
import * as THREE from 'three';
import { TUN } from './config.js';

const TYPES = {
  juice: { col: '#d4142a', size: 0.026, drag: 2.2, grav: 1, stick: 1, life: 9 },
  yolk: { col: '#ffbf1a', size: 0.03, drag: 2.2, grav: 1, stick: 1, life: 9 },
  pulp: { size: 0.03, drag: 3, grav: 1, stick: 1, life: 9 },
  seeds: { col: '#1d140c', size: 0.012, drag: 3, grav: 1, stick: 1, life: 9 },
  confetti: { size: 0.026, drag: 9, grav: 1, flutter: 1, stick: 1, life: 10, palette: 1 },
  paper: { col: '#f4f4ee', size: 0.032, drag: 11, grav: 1, flutter: 1, stick: 1, life: 12 },
  cash: { col: '#7dbb5a', size: 0.034, drag: 11, grav: 1, flutter: 1, stick: 1, life: 12 },
  feathers: { col: '#ffffff', size: 0.045, drag: 16, grav: 1, flutter: 1.5, stick: 1, life: 12 },
  dust: { size: 0.06, drag: 7, grav: 0.15, alpha: 0.45, life: 2.4, grow: 1 },
  shards: { size: 0.02, drag: 1.4, grav: 1, stick: 1, life: 9 },
  glass: { col: '#d9f4ff', size: 0.016, drag: 1.2, grav: 1, stick: 1, life: 8, add: 1 },
  sparks: { col: '#ffa22e', size: 0.022, drag: 0.6, grav: 0.5, life: 0.55, add: 1 },
  foam: { col: '#f2efe4', size: 0.035, drag: 6, grav: 1, stick: 1, life: 9 },
  plastic: { size: 0.03, drag: 6, grav: 1, flutter: 0.6, stick: 1, life: 10, palette: 1 },
  fabric: { size: 0.035, drag: 9, grav: 1, flutter: 1, stick: 1, life: 10, palette: 1 },
  food: { size: 0.028, drag: 3, grav: 1, stick: 1, life: 9, palette: 1 },
  smoke: { col: '#cfd8e3', size: 0.22, drag: 40, grav: 0, alpha: 0.18, life: 3.2, grow: 1, turb: 1 },
};

const VS = `
attribute float size; attribute vec4 pcol;
uniform float uScale;
varying vec4 vCol;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(size * uScale / -mv.z, 1.5, 80.0);
  vCol = pcol;
}`;
const FS = `
varying vec4 vCol;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = vCol.a * smoothstep(0.5, 0.25, r);
  gl_FragColor = vec4(vCol.rgb, a);
}`;

class Pool {
  constructor(n, additive) {
    this.n = n; this.count = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.base = new Float32Array(n);
    this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.flut = new Float32Array(n);
    this.stick = new Uint8Array(n); this.stuck = new Uint8Array(n); this.grow = new Uint8Array(n); this.turb = new Uint8Array(n); this.a0 = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('pcol', this.aCol); g.setAttribute('size', this.aSize);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(10, 3, 0), 1000);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { uScale: { value: 600 } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.geo = g;
  }
  copy(i, j) {
    const s = (a, w) => { for (let k = 0; k < w; k++) a[i * w + k] = a[j * w + k]; };
    s(this.pos, 3); s(this.vel, 3); s(this.col, 4);
    for (const a of [this.size, this.life, this.max, this.base, this.drag, this.grav, this.flut, this.stick, this.stuck, this.grow, this.turb, this.a0]) a[i] = a[j];
  }
}

export class Particles {
  constructor(scene) {
    this.normal = new Pool(9000, false);
    this.add = new Pool(2500, true);
    scene.add(this.normal.points, this.add.points);
    this.tmp = new Float32Array(4); this.tmp2 = new Float32Array(4);
  }

  setScale(s) { this.normal.mat.uniforms.uScale.value = s; this.add.mat.uniforms.uScale.value = s; }

  // type: key of TYPES; p: position; v: base velocity; n: count; spread: speed spread (m/s)
  emit(type, p, v, n, spread, colors) {
    const T = TYPES[type] || TYPES.dust;
    const pool = T.add ? this.add : this.normal;
    const palette = colors && colors.length ? colors.map(c => new THREE.Color(c)) : null;
    const fixed = new THREE.Color(T.col || (palette ? palette[0] : '#bbbbbb'));
    for (let k = 0; k < n; k++) {
      let i = pool.count;
      if (i >= pool.n) i = (Math.random() * pool.n) | 0; else pool.count++;
      const th = Math.random() * 6.283, u = 2 * Math.random() - 1, s = Math.sqrt(1 - u * u), sp = spread * Math.cbrt(Math.random());
      pool.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.04; pool.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.04; pool.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.04;
      pool.vel[i * 3] = v.x + sp * s * Math.cos(th); pool.vel[i * 3 + 1] = v.y + sp * u; pool.vel[i * 3 + 2] = v.z + sp * s * Math.sin(th);
      const c = (T.palette && palette) ? palette[(Math.random() * palette.length) | 0] : (T.palette ? new THREE.Color().setHSL(Math.random(), 0.85, 0.6) : fixed);
      const sh = 0.85 + Math.random() * 0.3;
      pool.col[i * 4] = c.r * sh; pool.col[i * 4 + 1] = c.g * sh; pool.col[i * 4 + 2] = c.b * sh;
      pool.a0[i] = T.alpha ?? 1; pool.col[i * 4 + 3] = pool.a0[i];
      pool.base[i] = T.size * 1.8 * (0.6 + Math.random() * 0.8); pool.size[i] = pool.base[i];
      pool.max[i] = T.life * (0.6 + Math.random() * 0.6); pool.life[i] = pool.max[i];
      pool.drag[i] = T.drag * (0.7 + Math.random() * 0.6); pool.grav[i] = T.grav;
      pool.flut[i] = T.flutter || 0; pool.stick[i] = T.stick || 0; pool.stuck[i] = 0; pool.grow[i] = T.grow || 0; pool.turb[i] = T.turb || 0;
    }
  }

  update(dt, air) {
    for (const pool of [this.normal, this.add]) this._update(pool, dt, air);
  }

  _update(P, dt, air) {
    const R = TUN.R, y0 = TUN.y0, L = TUN.L, u = this.tmp;
    for (let i = 0; i < P.count; i++) {
      P.life[i] -= dt;
      const ix = i * 3;
      let x = P.pos[ix], y = P.pos[ix + 1], z = P.pos[ix + 2];
      if (P.life[i] <= 0 || x > L + 14 || y < -2 || Math.abs(z) > 40) { P.count--; P.copy(i, P.count); i--; continue; }
      const fade = Math.min(1, P.life[i] / Math.min(1.5, P.max[i] * 0.5));
      if (P.grow[i]) P.size[i] = P.base[i] * (1 + 1.5 * (1 - P.life[i] / P.max[i]));
      P.col[i * 4 + 3] = P.a0[i] * fade;
      if (P.stuck[i]) continue;
      if (P.turb[i]) air.vel(x, y, z, u, true); else air.mean(x, y, z, u);
      const k = P.drag[i];
      let vx = P.vel[ix], vy = P.vel[ix + 1], vz = P.vel[ix + 2];
      vx = (vx + dt * k * u[0]) / (1 + dt * k);
      vy = (vy + dt * (k * u[1] - 9.81 * P.grav[i])) / (1 + dt * k);
      vz = (vz + dt * k * u[2]) / (1 + dt * k);
      if (P.flut[i]) { const f = P.flut[i] * 6; vx += (Math.random() - 0.5) * f * dt * 10; vy += (Math.random() - 0.5) * f * dt * 10; vz += (Math.random() - 0.5) * f * dt * 10; }
      const nx = x + vx * dt, ny = y + vy * dt, nz = z + vz * dt;
      // tube wall: stick (juice on glass) or bounce
      const inLen = nx > 0 && nx < L;
      const r0 = Math.hypot(y - y0, z), r1 = Math.hypot(ny - y0, nz);
      if (inLen && r0 < R && r1 >= R - 0.01) {
        if (P.stick[i]) { P.stuck[i] = 1; const s = (R - 0.012) / r1; P.pos[ix] = nx; P.pos[ix + 1] = y0 + (ny - y0) * s; P.pos[ix + 2] = nz * s; P.life[i] = Math.min(P.life[i], 6 + Math.random() * 4); continue; }
        const nrx = (ny - y0) / r1, nrz = nz / r1, vn = vy * nrx + vz * nrz;
        vy -= 1.6 * vn * nrx; vz -= 1.6 * vn * nrz;
        P.vel[ix] = vx; P.vel[ix + 1] = vy; P.vel[ix + 2] = vz;
        continue;
      }
      if (ny < 0.004) {
        if (P.stick[i]) { P.stuck[i] = 1; P.pos[ix] = nx; P.pos[ix + 1] = 0.004; P.pos[ix + 2] = nz; P.life[i] = Math.min(P.life[i], 5 + Math.random() * 4); continue; }
        vy = Math.abs(vy) * 0.3;
      }
      P.pos[ix] = nx; P.pos[ix + 1] = Math.max(0.004, ny); P.pos[ix + 2] = nz;
      P.vel[ix] = vx; P.vel[ix + 1] = vy; P.vel[ix + 2] = vz;
    }
    P.geo.setDrawRange(0, P.count);
    P.aPos.needsUpdate = true; P.aCol.needsUpdate = true; P.aSize.needsUpdate = true;
  }

  clear() { this.normal.count = 0; this.add.count = 0; }
}
