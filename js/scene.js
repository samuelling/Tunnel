// Renderer, hangar, the vertical Shred Hole tower, the portal, and the static colliders.
// The tunnel and everything that moves through it live in `rig`, a group that turns the
// physics tube frame (x down the axis) upright: world = (y, groundX − x, z).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TUN, FAN, PORTAL } from './config.js';

export function createRenderer(canvas, lowPower) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lowPower ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}

// tube-frame point → world
export const toWorld = (x, y, z) => new THREE.Vector3(y, TUN.groundX - x, z);

export function buildScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0b10');
  scene.fog = new THREE.Fog('#0a0b10', 34, 85);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const rig = new THREE.Group();
  rig.rotation.z = -Math.PI / 2;
  rig.position.set(0, TUN.groundX, 0);
  scene.add(rig);

  // lights
  scene.add(new THREE.HemisphereLight('#9fb4cc', '#2a2620', 0.45));
  const key = new THREE.DirectionalLight('#fff3e2', 2.1);
  key.position.set(9, 30, 14);
  key.target.position.set(0, 7, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 16, bottom: -14, near: 1, far: 70 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#7fa8ff', 0.45); fill.position.set(-12, 8, -10); scene.add(fill);
  for (const x of [3, 8]) { const pl = new THREE.PointLight('#ffffff', 6, 9, 1.6); pl.position.copy(toWorld(x, 1.4, 0.6)); scene.add(pl); }

  // concrete floor
  const floorTex = canvasTex(1024, 1024, (c, w, h) => {
    c.fillStyle = '#45474b'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) { const g = 62 + Math.random() * 40; c.fillStyle = `rgba(${g},${g},${g + 3},${0.05 + Math.random() * 0.1})`; c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3); }
    for (let i = 0; i < 18; i++) { c.fillStyle = `rgba(30,28,25,${0.02 + Math.random() * 0.035})`; c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 90, 20 + Math.random() * 60, Math.random() * 3, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(25,25,25,0.6)'; c.lineWidth = 3; c.strokeRect(0, 0, w, h);
  }, 12);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  // a ring of stencilled warnings around the portal
  const ringTex = canvasTex(2048, 256, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,198,26,0.85)'; c.font = '900 120px Impact, "Arial Black", sans-serif'; c.textAlign = 'center';
    const msg = 'PORTAL TO WORLD BUILDER  ·  MIND THE GAP  ·  NO REFUNDS  ·  ';
    c.fillText(msg, W / 2, 160);
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(PORTAL.R + 0.45, PORTAL.R + 1.25, 128, 1), new THREE.MeshStandardMaterial({ map: ringTex, transparent: true, roughness: 0.9, depthWrite: false }));
  // remap ring UVs so the text wraps around it
  const uv = ring.geometry.attributes.uv, pos = ring.geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), r = Math.hypot(x, y);
    uv.setXY(i, (Math.atan2(y, x) / (2 * Math.PI) + 0.5) * 2, (r - PORTAL.R - 0.45) / 0.8);
  }
  ringTex.wrapS = THREE.RepeatWrapping;
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; scene.add(ring);

  // hangar shell
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(52, 52, 36, 48, 1, true), new THREE.MeshStandardMaterial({ color: '#14171c', roughness: 0.9, side: THREE.BackSide }));
  shell.position.set(0, 18, 0); scene.add(shell);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff6e4' });
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.5), lampMat); lamp.position.set(Math.cos(a) * 18, 30, Math.sin(a) * 18); lamp.rotation.y = -a; scene.add(lamp); }

  const tunnel = buildTunnel(rig);
  const tower = buildTower(scene);
  const portal = buildPortal(scene);
  return { scene, rig, tunnel: { ...tunnel, ...tower }, portal, key };
}

function buildTunnel(rig) {
  const { R, L, fanX } = TUN;
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#4a5058', metalness: 0.85, roughness: 0.38 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#23272d', metalness: 0.7, roughness: 0.45 });

  const glassLen = fanX + 0.6;   // clear right through the rotor so you can watch the chop
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, glassLen, 72, 1, true),
    new THREE.MeshPhysicalMaterial({ color: '#cfe6ff', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1, envMapIntensity: 2.2 }));
  glass.rotation.z = Math.PI / 2; glass.position.set(glassLen / 2, 0, 0); glass.renderOrder = 2;
  g.add(glass);
  for (let x = 0; x <= glassLen + 0.01; x += 2) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(R + 0.06, 0.05, 10, 72), steel);
    rib.rotation.y = Math.PI / 2; rib.position.set(x, 0, 0); rib.castShadow = true; g.add(rib);
  }
  // bellmouth intake at the top
  const bell = [];
  for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI / 2; bell.push(new THREE.Vector2(R + 0.05 + 0.5 * (1 - Math.sin(a)), -0.5 * (1 - Math.cos(a)))); }
  const bellM = new THREE.Mesh(new THREE.LatheGeometry(bell, 72), new THREE.MeshStandardMaterial({ color: '#8c949e', metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide }));
  bellM.rotation.z = -Math.PI / 2; bellM.castShadow = true; g.add(bellM);
  // motor section below the rotor
  const hzTex = canvasTex(1024, 128, (c, w, h) => { c.fillStyle = '#16161a'; c.fillRect(0, 0, w, h); c.fillStyle = '#f2b311'; for (let i = -h; i < w + h; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 32, 0); c.lineTo(i + 32 + h, h); c.lineTo(i + h, h); c.fill(); } });
  hzTex.wrapS = THREE.RepeatWrapping; hzTex.repeat.set(4, 1);
  const housLen = L - glassLen;
  const hous = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.12, R + 0.12, housLen, 72, 1, true), new THREE.MeshStandardMaterial({ color: '#3a3f46', metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide }));
  hous.rotation.z = Math.PI / 2; hous.position.set(glassLen + housLen / 2, 0, 0); hous.castShadow = true; hous.receiveShadow = true; g.add(hous);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.135, R + 0.135, 0.45, 72, 1, true), new THREE.MeshStandardMaterial({ map: hzTex, roughness: 0.6 }));
  band.rotation.z = Math.PI / 2; band.position.set(fanX, 0, 0); g.add(band);
  for (const x of [glassLen, L]) { const fl = new THREE.Mesh(new THREE.TorusGeometry(R + 0.14, 0.08, 10, 72), darkSteel); fl.rotation.y = Math.PI / 2; fl.position.set(x, 0, 0); g.add(fl); }
  const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 1.5, 32), darkSteel);
  nac.rotation.z = Math.PI / 2; nac.position.set(fanX + 0.95, 0, 0); nac.castShadow = true; g.add(nac);
  for (let k = 0; k < 4; k++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, R - 0.45, 0.06), darkSteel);
    const a = Math.PI / 4 + k * Math.PI / 2;
    st.position.set(fanX + 1.1, Math.cos(a) * (R / 2 + 0.2), Math.sin(a) * (R / 2 + 0.2));
    st.rotation.x = -a; g.add(st);
  }
  rig.add(g);
  return { group: g };
}

// Steel tower holding the tube up, a catwalk at the top, signs and a warning beacon (world space).
function buildTower(scene) {
  const { R, L, fanX, groundX } = TUN;
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: '#f2b311', metalness: 0.3, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2e35', metalness: 0.7, roughness: 0.45 });
  const top = groundX + 0.15, legR = R + 0.75;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, x = Math.cos(a) * legR, z = Math.sin(a) * legR;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.26, top, 0.26), yellow);
    leg.position.set(x, top / 2, z); leg.castShadow = true; g.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.7), dark); foot.position.set(x, 0.06, z); g.add(foot);
  }
  // collars + braces every few metres
  for (const y of [top - 0.6, groundX - 4, groundX - fanX - 0.3, groundX - L + 0.1]) {
    const col = new THREE.Mesh(new THREE.TorusGeometry(R + 0.2, 0.07, 8, 64), yellow);
    col.rotation.x = Math.PI / 2; col.position.y = y; col.castShadow = true; g.add(col);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const br = new THREE.Mesh(new THREE.BoxGeometry(legR - R - 0.15, 0.1, 0.1), yellow);
      br.position.set(Math.cos(a) * (R + 0.45), y, Math.sin(a) * (R + 0.45)); br.rotation.y = -a; g.add(br);
    }
  }
  // diagonal cross-bracing between the legs (low section)
  for (let k = 0; k < 4; k++) {
    const a0 = Math.PI / 4 + k * Math.PI / 2, a1 = a0 + Math.PI / 2;
    const p0 = new THREE.Vector3(Math.cos(a0) * legR, 0.4, Math.sin(a0) * legR), p1 = new THREE.Vector3(Math.cos(a1) * legR, groundX - L, Math.sin(a1) * legR);
    const d = p1.clone().sub(p0), len = d.length();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, len, 0.08), dark);
    b.position.copy(p0).add(p1).multiplyScalar(0.5);
    b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(b);
  }
  // catwalk round the intake
  const deck = new THREE.Mesh(new THREE.RingGeometry(R + 0.6, R + 1.9, 64), new THREE.MeshStandardMaterial({ color: '#30353c', metalness: 0.75, roughness: 0.5, side: THREE.DoubleSide }));
  deck.rotation.x = -Math.PI / 2; deck.position.y = top - 0.05; deck.receiveShadow = true; deck.castShadow = true; g.add(deck);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(R + 1.85, 0.035, 6, 72), yellow);
  rail.rotation.x = Math.PI / 2; rail.position.y = top + 1.05; g.add(rail);
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.05), yellow);
    p.position.set(Math.cos(a) * (R + 1.85), top + 0.52, Math.sin(a) * (R + 1.85)); g.add(p);
  }
  // signs
  const sign = (text, sub, w, h, pos, ry, bg = '#f2b311', fg = '#111') => {
    const t = canvasTex(1024, Math.round(1024 * h / w), (c, W, H) => {
      c.fillStyle = bg; c.fillRect(0, 0, W, H); c.strokeStyle = fg; c.lineWidth = 14; c.strokeRect(14, 14, W - 28, H - 28);
      c.fillStyle = fg; c.textAlign = 'center'; c.font = `900 ${H * 0.38 | 0}px Impact, "Arial Black", sans-serif`; c.fillText(text, W / 2, H * 0.55);
      c.font = `700 ${H * 0.12 | 0}px "Arial Black", sans-serif`; c.fillText(sub, W / 2, H * 0.8);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, side: THREE.DoubleSide }));
    m.position.copy(pos); m.rotation.y = ry; m.castShadow = true; g.add(m);
    return m;
  };
  const sy = groundX - fanX;
  sign('THE SHRED HOLE', 'FAN DIVISION · AUTHORISED DUCKS ONLY', 4.4, 1.15, new THREE.Vector3(0, top + 2.1, 0), Math.PI / 4);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), dark); post.position.set(0, top + 1.0, 0); g.add(post);
  sign('BLADES', 'DO NOT FEED · ESPECIALLY NOT DUCKS', 2.4, 0.8, new THREE.Vector3(Math.cos(Math.PI / 4) * (R + 0.95), sy + 1.6, Math.sin(Math.PI / 4) * (R + 0.95)), -Math.PI / 4 + Math.PI / 2);
  // beacon on the catwalk
  const beaconMat = new THREE.MeshStandardMaterial({ color: '#ff6a00', emissive: '#ff6a00', emissiveIntensity: 0.2, transparent: true, opacity: 0.9 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), beaconMat);
  beacon.position.set(-(R + 1.5), top + 1.35, 0); g.add(beacon);
  const beaconLight = new THREE.SpotLight('#ff7a1a', 0, 26, 0.35, 0.5, 1.2);
  beaconLight.position.copy(beacon.position); g.add(beaconLight); g.add(beaconLight.target);
  scene.add(g);
  return { tower: g, beacon, beaconMat, beaconLight };
}

// The vortex portal: an animated spiral shader in the floor with an event-horizon centre,
// a glowing rim, a light that washes the tower in purple, and a faint up-beam.
function buildPortal(scene) {
  const g = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uPulse: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float uTime; uniform float uPulse;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
        float a = atan(p.y, p.x);
        float sw = a + 3.2 / (r + 0.18) - uTime * 1.6;              // log-ish spiral, wound tighter inside
        float arms = 0.5 + 0.5 * sin(sw * 4.0 + noise(vec2(sw * 1.5, r * 6.0 - uTime)) * 3.0);
        float fil = noise(vec2(cos(sw) * 3.0 + uTime * 0.3, r * 9.0 - uTime * 1.2));
        vec3 deep = vec3(0.06, 0.0, 0.14), violet = vec3(0.55, 0.12, 1.0), cyan = vec3(0.2, 0.95, 1.0), white = vec3(1.0);
        vec3 c = mix(deep, violet, arms * smoothstep(1.0, 0.25, r));
        c = mix(c, cyan, pow(arms * fil, 3.0) * smoothstep(0.95, 0.4, r) * 1.4);
        float hole = smoothstep(0.22, 0.05, r);                     // event horizon
        c = mix(c, vec3(0.0), hole);
        float rim = smoothstep(0.82, 0.97, r) * smoothstep(1.0, 0.96, r);
        c += (violet * 1.6 + white * 0.3) * rim;
        c += cyan * uPulse * smoothstep(0.9, 0.0, r) * 0.9;
        float alpha = smoothstep(1.0, 0.94, r);
        gl_FragColor = vec4(c * (1.2 + uPulse), alpha);
      }`,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(PORTAL.R, 96), mat);
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.02; g.add(disc);
  const rimMat = new THREE.MeshStandardMaterial({ color: '#2b0a4a', emissive: '#9b4dff', emissiveIntensity: 1.6, metalness: 0.6, roughness: 0.3 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(PORTAL.R + 0.12, 0.14, 12, 96), rimMat);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.06; g.add(rim);
  // floating rune stones orbiting the rim
  const runes = new THREE.Group(); g.add(runes);
  const runeMat = new THREE.MeshStandardMaterial({ color: '#1a1030', emissive: '#40e0ff', emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.4 });
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), runeMat);
    const a = i / 9 * Math.PI * 2; m.position.set(Math.cos(a) * (PORTAL.R + 0.7), 0.6 + (i % 3) * 0.2, Math.sin(a) * (PORTAL.R + 0.7)); runes.add(m);
  }
  // up-beam
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(PORTAL.R * 0.75, PORTAL.R, TUN.groundX - TUN.L, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: '#8b5cff', transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = (TUN.groundX - TUN.L) / 2; g.add(beam);
  const light = new THREE.PointLight('#9b5cff', 40, 18, 1.4); light.position.y = 1.2; g.add(light);
  scene.add(g);
  let pulse = 0;
  return {
    group: g,
    flash(k = 1) { pulse = Math.min(2, pulse + k); },
    update(t, dt) {
      pulse *= Math.pow(0.08, dt);
      uniforms.uTime.value = t; uniforms.uPulse.value = pulse;
      runes.rotation.y = t * 0.35;
      runes.children.forEach((m, i) => { m.rotation.x = t * 1.3 + i; m.position.y = 0.7 + Math.sin(t * 1.6 + i) * 0.25; });
      light.intensity = 40 + 25 * Math.sin(t * 3) + pulse * 120;
      rimMat.emissiveIntensity = 1.4 + 0.4 * Math.sin(t * 2.2) + pulse;
      beam.material.opacity = 0.05 + 0.04 * pulse;
    },
  };
}

// Static physics (tube frame): floor plane, tube shell (ring of plates), fan hub and nacelle.
export function buildColliders(world, RAPIER) {
  const { R, L, fanX, groundX } = TUN;
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 80, 80).setTranslation(groundX + 0.5, 0, 0).setFriction(0.8).setRestitution(0.2), fixed);
  const N = 36, t = 0.06;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
    const cd = RAPIER.ColliderDesc.cuboid(L / 2, t, (R + t) * Math.PI / N * 1.08)
      .setTranslation(L / 2, (R + t) * Math.cos(a), (R + t) * Math.sin(a))
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.5).setRestitution(0.3);
    world.createCollider(cd, fixed);
  }
  world.createCollider(RAPIER.ColliderDesc.ball(FAN.Rhub).setTranslation(fanX - 0.15, 0, 0).setRestitution(0.4), fixed);
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.75, 0.5).setTranslation(fanX + 0.95, 0, 0).setRotation({ x: qz.x, y: qz.y, z: qz.z, w: qz.w }), fixed);
}
