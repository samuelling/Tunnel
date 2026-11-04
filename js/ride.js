// "Ride along": the trip a payload takes from the Shred Hole to World Builder, drawn as a flight
// down a glowing internet tube. The debris you just flushed tumbles ahead of you (the real pieces,
// from the drop that was sent), other people's traffic streams past the other way, and each ring
// is a real hop: your network, Cloudflare's edge (named, when the Worker says which one), the
// Worker, its mailbox, World Builder asking "anything new?", then the sky portal.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

const LEN = 1500;          // tube length (units)
const RADIUS = 7;
const DURATION = 11.5;     // seconds from the Shred Hole to the sky portal

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export class TubeRide {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05030c');
    this.camera = new THREE.PerspectiveCamera(74, 1, 0.1, 900);
    this.scene.add(new THREE.HemisphereLight('#bfe6ff', '#2a0b4a', 1.4));
    this.headlight = new THREE.PointLight('#ffffff', 60, 40, 1.6); this.scene.add(this.headlight);
    this.uniforms = { uTime: { value: 0 }, uWarp: { value: 0 } };
    this.debris = []; this.parts = [];
  }

  // build the tube for this trip (seeded, so a payload always takes "its" route)
  build(seed, hops) {
    const rng = mulberry32(seed);
    const pts = [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const z = -i * LEN / n, amp = i === 0 || i === n ? 0 : 55;
      pts.push(new THREE.Vector3((rng() - 0.5) * amp * 2, (rng() - 0.5) * amp * 1.4, z));
    }
    this.path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const geo = new THREE.TubeGeometry(this.path, 900, RADIUS, 28, false);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, uniforms: this.uniforms,
      vertexShader: `varying vec2 vUv; varying float vDepth;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime; uniform float uWarp; varying vec2 vUv; varying float vDepth;
        void main() {
          float along = vUv.x * 520.0, around = vUv.y;
          float ring = smoothstep(0.92, 1.0, fract(along - uTime * 0.6)) + 0.35 * smoothstep(0.97, 1.0, fract(along * 4.0));
          float rib = smoothstep(0.94, 1.0, fract(around * 14.0));
          float pulse = smoothstep(0.985, 1.0, fract(around * 3.0 + along * 0.02 - uTime * 0.9));
          vec3 base = mix(vec3(0.05, 0.02, 0.14), vec3(0.10, 0.03, 0.22), 0.5 + 0.5 * sin(along * 0.05));
          vec3 col = base + vec3(0.25, 0.85, 1.0) * ring * 0.9 + vec3(0.55, 0.25, 1.0) * rib * 0.5 + vec3(1.0, 0.8, 0.3) * pulse * 0.8;
          col += vec3(0.6, 0.9, 1.0) * uWarp * 0.25;
          float fog = exp(-vDepth * 0.012);
          gl_FragColor = vec4(mix(vec3(0.02, 0.01, 0.05), col, fog), 1.0);
        }`,
    });
    this.tube = new THREE.Mesh(geo, mat); this.scene.add(this.tube);
    // a glowing gate at each hop
    this.gates = hops.map((h) => {
      const g = new THREE.Mesh(new THREE.TorusGeometry(RADIUS * 0.96, 0.32, 10, 64), new THREE.MeshBasicMaterial({ color: h.color || '#7df9ff', toneMapped: false }));
      const p = this.path.getPointAt(h.at), tng = this.path.getTangentAt(h.at);
      g.position.copy(p); g.lookAt(p.clone().add(tng)); this.scene.add(g);
      return g;
    });
    // other people's traffic, coming the other way
    const N = 260, box = new THREE.BoxGeometry(0.28, 0.28, 1.1);
    this.traffic = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ toneMapped: false }), N);
    const palette = ['#7df9ff', '#ff6bd6', '#ffd23f', '#9b8cff', '#6bff9e'];
    this.trafficData = Array.from({ length: N }, (_, i) => {
      this.traffic.setColorAt(i, new THREE.Color(palette[i % palette.length]));
      return { u: rng(), a: rng() * Math.PI * 2, r: 1.5 + rng() * (RADIUS - 2.5), speed: 0.02 + rng() * 0.05 };
    });
    this.scene.add(this.traffic);
    this.tmpM = new THREE.Matrix4(); this.tmpQ = new THREE.Quaternion();
  }

  // the payload: the biggest pieces of the drop, scaled up so the bundle is a few units across
  setDebris(drop) {
    for (const m of this.debris) { this.scene.remove(m.mesh); m.mesh.geometry.dispose(); }
    this.debris = [];
    const pcs = (drop?.pieces || []).filter(p => Array.isArray(p.p) && p.p.length >= 12).sort((a, b) => b.m - a.m).slice(0, 70);
    let ext = 0;
    for (const pc of pcs) for (let i = 0; i < pc.p.length; i++) ext = Math.max(ext, Math.abs(pc.p[i]));
    const scale = ext ? Math.min(40, 1.1 / ext) : 1;
    const mats = new Map(), rng = mulberry32(pcs.length * 7919 + 1);
    pcs.forEach((pc) => {
      const pts = [];
      for (let i = 0; i + 2 < pc.p.length; i += 3) pts.push(new THREE.Vector3(pc.p[i] * scale, pc.p[i + 1] * scale, pc.p[i + 2] * scale));
      let geo; try { geo = new ConvexGeometry(pts); } catch (e) { return; }
      const c = pc.c || '#cccccc';
      if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1, emissive: c, emissiveIntensity: 0.15, flatShading: true }));
      const mesh = new THREE.Mesh(geo, mats.get(c));
      this.scene.add(mesh);
      this.debris.push({ mesh, a: rng() * Math.PI * 2, r: rng() * 3.6, lead: 0.004 + rng() * 0.014, axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), spin: 0.6 + rng() * 3, bob: rng() * 6 });
    });
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // u: 0 → 1 along the tube; t: seconds
  frame(u, t, dt) {
    const path = this.path, cam = this.camera;
    this.uniforms.uTime.value = t;
    const uc = Math.min(0.995, u), p = path.getPointAt(uc), ahead = path.getPointAt(Math.min(1, uc + 0.01));
    cam.position.copy(p);
    cam.up.set(Math.sin(t * 0.7) * 0.25, 1, 0).normalize();
    cam.lookAt(ahead);
    this.headlight.position.copy(path.getPointAt(Math.min(1, uc + 0.006)));
    // frame of reference along the tube, for placing things around its axis
    const tng = path.getTangentAt(uc), side = new THREE.Vector3().crossVectors(tng, new THREE.Vector3(0, 1, 0)).normalize(), upv = new THREE.Vector3().crossVectors(side, tng).normalize();
    for (const d of this.debris) {
      const ud = Math.min(1, uc + d.lead + 0.0015 * Math.sin(t * 1.3 + d.bob)), c = path.getPointAt(ud);
      const tn = path.getTangentAt(ud), sd = new THREE.Vector3().crossVectors(tn, new THREE.Vector3(0, 1, 0)).normalize(), up2 = new THREE.Vector3().crossVectors(sd, tn).normalize();
      const a = d.a + t * 0.35;
      d.mesh.position.copy(c).addScaledVector(sd, Math.cos(a) * d.r).addScaledVector(up2, Math.sin(a) * d.r * 0.8);
      d.mesh.rotateOnAxis(d.axis, d.spin * dt);
    }
    // traffic streams back past the camera
    this.trafficData.forEach((q, i) => {
      q.u -= q.speed * dt; if (q.u < uc - 0.02) q.u += 0.12 + Math.random() * 0.1;
      const uu = Math.max(0, Math.min(1, q.u)), c = path.getPointAt(uu), tn = path.getTangentAt(uu);
      const sd = new THREE.Vector3().crossVectors(tn, new THREE.Vector3(0, 1, 0)).normalize(), up2 = new THREE.Vector3().crossVectors(sd, tn).normalize();
      c.addScaledVector(sd, Math.cos(q.a) * q.r).addScaledVector(up2, Math.sin(q.a) * q.r);
      this.tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tn);
      this.tmpM.compose(c, this.tmpQ, new THREE.Vector3(1, 1, 1));
      this.traffic.setMatrixAt(i, this.tmpM);
    });
    this.traffic.instanceMatrix.needsUpdate = true;
    this.gates.forEach((g, i) => { g.material.color.offsetHSL(0, 0, 0); g.rotation.z += dt * (i % 2 ? 0.6 : -0.6); });
    void side; void upv;
    this.renderer.render(this.scene, cam);
  }

  dispose() {
    this.scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    this.renderer.dispose();
  }
}

export const RIDE_SECONDS = DURATION;
