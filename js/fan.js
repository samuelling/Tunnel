// The fan: a 1-DOF rotor (θ, ω) with a speed-controlled motor limited by stall torque and
// power, an aerodynamic load torque k·ω² (fan law), and blade strikes that exchange momentum
// with whatever wanders into the disc. Plus its geometry: twisted, tapered blades.
import * as THREE from 'three';
import { FAN, FAN0, TUN, S } from './config.js';

export class Rotor {
  constructor() {
    this.theta = 0; this.omega = 0; this.setpoint = 0; this.torque = 0; this.hits = 0;
  }
  step(dt) {
    if (this.locked) {                         // jammed: something is jammed against the blades
      this.omega *= Math.exp(-dt / 0.1); if (Math.abs(this.omega) < 0.05) this.omega = 0;
      this.torque = 0; this.prevTheta = this.theta; this.theta += this.omega * dt; return;
    }
    // setpoint −1 … +1: positive pushes air down the tube (shred), negative runs the rotor
    // backwards and blows air up it
    const w = this.omega, target = this.setpoint * FAN.omegaMax;
    const aero = FAN.kAero * w * Math.abs(w) + 60 * Math.sign(w);
    // speed controller: feed-forward the air load, proportional on the error
    let tq = aero + FAN.I * (target - w) / 0.6;
    // torque along the spin direction is motoring (power-limited); against it is braking
    const drive = Math.min(FAN.Tmax, FAN.Pmax / Math.max(Math.abs(w), 2)), brake = 0.35 * FAN.Tmax;
    tq = w > 0.5 ? Math.max(-brake, Math.min(drive, tq)) : w < -0.5 ? Math.max(-drive, Math.min(brake, tq)) : Math.max(-drive, Math.min(drive, tq));
    if (this.setpoint === 0 && Math.abs(w) < 0.5) tq = 0;
    this.torque = tq;
    this.omega += (tq - aero) / FAN.I * dt;
    if (this.setpoint === 0 && Math.abs(this.omega) < 0.05) this.omega = 0;
    this.prevTheta = this.theta;
    this.theta += this.omega * dt;
    if (Math.abs(this.theta) > 1e4) { this.theta -= 2 * Math.PI * Math.floor(this.theta / (2 * Math.PI)); this.prevTheta = this.theta - this.omega * dt; }
  }
  get rpm() { return this.omega * 60 / (2 * Math.PI); }
  get power() { return Math.max(0, this.torque * this.omega); }
}

// Blade angle (from the rotation plane) at radius r — steeper near the hub, flatter at the tip.
export const bladeAngle = (r, F = FAN) => {
  const s = (r - F.Rhub) / (F.Rtip - F.Rhub);
  return (52 - 30 * Math.max(0, Math.min(1, s))) * Math.PI / 180;
};

// Has a blade swept over a body this step? Returns contact info or null.
// p: body centre relative to the fan centre; rad: body radius; th0→th1: rotor angle this step.
export function bladeSweep(p, rad, th0, th1) {
  if (Math.abs(p.x) > FAN.zone + rad) return null;
  const r = Math.hypot(p.y, p.z);
  if (r + rad < FAN.Rhub || r - rad > FAN.Rtip) return null;
  const s = 2 * Math.PI / FAN.blades;
  const phi = Math.atan2(p.z, p.y);
  const w = Math.asin(Math.min(1, rad / Math.max(r, rad)));
  const dth = th1 - th0;
  let d = ((phi - th0) % s + s) % s;      // angular distance ahead of the nearest trailing blade
  const hit = dth >= 0 ? (d < dth + w || d > s - w) : ((s - d) < -dth + w || d < w);
  if (!hit) return null;
  const rc = Math.max(FAN.Rhub, Math.min(FAN.Rtip, r));
  return { r: rc, phi };
}

export function buildFan(blades = FAN.blades) {
  const group = new THREE.Group();
  const rotor = new THREE.Group();
  group.add(rotor);
  const bladeMat = new THREE.MeshStandardMaterial({ color: '#d9dde2', metalness: 0.75, roughness: 0.32, transparent: true, opacity: 1 });
  const tipMat = new THREE.MeshStandardMaterial({ color: '#ffc21a', metalness: 0.2, roughness: 0.5, transparent: true, opacity: 1 });
  const geo = bladeGeometry();
  const tip = new THREE.BoxGeometry(0.03, 0.18, 0.5);
  const mats = [bladeMat, tipMat];
  const bends = [];
  for (let k = 0; k < blades; k++) {
    const b = new THREE.Group();
    const bend = new THREE.Group(); b.add(bend);      // damage: bent / snapped (see setBladeDamage)
    const m = new THREE.Mesh(geo, bladeMat); m.castShadow = true; bend.add(m);
    const tm = new THREE.Mesh(tip, tipMat);
    const beta = bladeAngle(FAN0.Rtip - 0.09, FAN0);
    tm.position.set(0, FAN0.Rtip - 0.09, 0); tm.rotation.y = -(Math.PI / 2 - beta); bend.add(tm);
    bends.push({ bend, tip: tm });
    b.rotation.x = k * 2 * Math.PI / blades;
    rotor.add(b);
  }
  // hub with spinner nose
  const hubMat = new THREE.MeshStandardMaterial({ color: '#2a2e35', metalness: 0.6, roughness: 0.35 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(FAN0.Rhub, FAN0.Rhub, 0.5, 32), hubMat);
  hub.rotation.z = Math.PI / 2; rotor.add(hub);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(FAN0.Rhub, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffc21a', metalness: 0.3, roughness: 0.35 }));
  nose.rotation.z = Math.PI / 2; nose.position.x = -0.25; nose.scale.set(1, 1.6, 1); rotor.add(nose);
  // stripes on the nose so you can see it spin
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.9, 0.12), hubMat);
  stripe.position.x = -0.62; rotor.add(stripe);
  // motion-blur disc (fades in with speed)
  const discTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c = cv.getContext('2d'), g = c.createRadialGradient(128, 128, 128 * FAN0.Rhub / FAN0.Rtip, 128, 128, 128);
    g.addColorStop(0, 'rgba(200,205,212,0.0)'); g.addColorStop(0.08, 'rgba(200,205,212,0.55)'); g.addColorStop(0.9, 'rgba(200,205,212,0.35)');
    g.addColorStop(0.94, 'rgba(255,194,26,0.6)'); g.addColorStop(1, 'rgba(255,194,26,0.0)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(FAN0.Rtip, 64), new THREE.MeshBasicMaterial({ map: discTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.y = Math.PI / 2;
  group.add(disc);
  group.position.set(TUN.fanX, TUN.y0, 0);
  group.scale.setScalar(S);   // drawn at 1×
  // d: 0 = straight, 1 = bent into the housing, ≥1.5 = snapped off
  const setBladeDamage = (k, d) => {
    const { bend, tip } = bends[k];
    const snapped = d >= 1.5, b = Math.min(d, 1);
    bend.rotation.z = 0.45 * b;                 // folded downstream
    bend.rotation.y = 0.3 * b;                  // twisted
    bend.scale.y = snapped ? 0.42 : 1;
    tip.visible = !snapped;
  };
  return { group, rotor, disc, mats, setBladeDamage };
}

function bladeGeometry() {
  const nr = 12, nc = 14;
  const pos = [], idx = [];
  for (let i = 0; i <= nr; i++) {
    const r = FAN0.Rhub * 0.9 + (FAN0.Rtip - FAN0.Rhub * 0.9) * i / nr;
    const s = i / nr;
    const c = 0.95 - 0.38 * s;
    const beta = bladeAngle(r, FAN0);
    const cb = Math.cos(beta), sb = Math.sin(beta);
    for (const side of [1, -1]) {
      for (let j = 0; j <= nc; j++) {
        const u = j / nc;                        // 0 = leading edge, 1 = trailing edge
        const camber = 0.07 * c * 4 * u * (1 - u);
        const th = 0.06 * c * (1 - u) * Math.sqrt(u) * 1.6 + 0.004;
        const yc = camber + side * th / 2;       // offset normal to chord
        const xc = (0.5 - u) * c;                // along chord (LE at +)
        // chord direction: LE at (−x sinβ, +z cosβ); normal (cosβ,0,sinβ)
        const X = -xc * sb + yc * cb, Z = xc * cb + yc * sb;
        pos.push(X, r, Z);
      }
    }
  }
  const row = (nc + 1) * 2;
  for (let i = 0; i < nr; i++) {
    for (const off of [0, nc + 1]) {
      for (let j = 0; j < nc; j++) {
        const a = i * row + off + j, b = a + 1, c = a + row, d = c + 1;
        if (off === 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
