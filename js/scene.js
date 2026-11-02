// Renderer, hangar, the tunnel itself, and its static colliders.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TUN, FAN } from './config.js';

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

export function buildScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0d11');
  scene.fog = new THREE.Fog('#0b0d11', 30, 75);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  // lights
  scene.add(new THREE.HemisphereLight('#9fb4cc', '#2a2620', 0.5));
  const key = new THREE.DirectionalLight('#fff3e2', 2.2);
  key.position.set(4, 18, 10);
  key.target.position.set(9, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -16, right: 16, top: 10, bottom: -10, near: 1, far: 50 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#7fa8ff', 0.5); fill.position.set(-10, 6, -12); scene.add(fill);
  for (const x of [4, 11]) { const pl = new THREE.PointLight('#ffffff', 6, 9, 1.6); pl.position.set(x, TUN.y0 + 1.6, 0); scene.add(pl); }

  // concrete floor with markings
  const floorTex = canvasTex(1024, 1024, (c, w, h) => {
    c.fillStyle = '#4a4c50'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) { const g = 70 + Math.random() * 40; c.fillStyle = `rgba(${g},${g},${g + 3},${0.05 + Math.random() * 0.1})`; c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3); }
    for (let i = 0; i < 18; i++) { c.fillStyle = `rgba(30,28,25,${0.02 + Math.random() * 0.035})`; c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 90, 20 + Math.random() * 60, Math.random() * 3, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(25,25,25,0.6)'; c.lineWidth = 3;
    c.strokeRect(0, 0, w, h);
  }, 12);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  // floor stencils
  const stencil = (text, sub, w, h, x, z, rot) => {
    const t = canvasTex(1024, 256, (c, W, H) => {
      c.clearRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,198,26,0.85)'; c.font = '900 120px Impact, "Arial Black", sans-serif'; c.textAlign = 'center';
      c.fillText(text, W / 2, 130);
      c.font = '700 44px "Arial Black", sans-serif'; c.fillText(sub, W / 2, 210);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.9, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(x, 0.006, z); m.receiveShadow = true; scene.add(m);
  };
  stencil('DO NOT FEED THE FAN', 'NO, SERIOUSLY. ESPECIALLY NOT DUCKS.', 8, 2, -4.2, 0, -Math.PI / 2);
  // hazard zone behind the exit
  const hz = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#16161a'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8b417'; for (let i = -w; i < w * 2; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 32, 0); c.lineTo(i + 32 - h, h); c.lineTo(i - h, h); c.fill(); } });
  hz.wrapS = hz.wrapT = THREE.RepeatWrapping; hz.repeat.set(12, 1);
  const hzm = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.7 });
  for (const z of [-5.5, 5.5]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(TUN.L + 8, 0.35), hzm); s.rotation.x = -Math.PI / 2; s.position.set(TUN.L / 2 + 2, 0.005, z); s.receiveShadow = true; scene.add(s); }

  // hangar shell (gives reflections something to show)
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(48, 48, 26, 48, 1, true), new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.9, side: THREE.BackSide }));
  shell.position.set(9, 13, 0); scene.add(shell);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff6e4' });
  for (let i = 0; i < 6; i++) for (const z of [-7, 7]) { const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.5), lampMat); lamp.position.set(-6 + i * 6, 14, z); scene.add(lamp); }

  const tunnel = buildTunnel();
  scene.add(tunnel.group);
  return { scene, tunnel, key };
}

function buildTunnel() {
  const { R, L, y0, fanX } = TUN;
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#4a5058', metalness: 0.85, roughness: 0.38 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#23272d', metalness: 0.7, roughness: 0.45 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#f2b311', metalness: 0.25, roughness: 0.5 });

  // clear acrylic test section
  const glassLen = fanX + 0.6;   // clear right through the rotor so you can watch the chop
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, glassLen, 72, 1, true),
    new THREE.MeshPhysicalMaterial({ color: '#cfe6ff', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1, envMapIntensity: 2.2 }));
  glass.rotation.z = Math.PI / 2; glass.position.set(glassLen / 2, y0, 0); glass.renderOrder = 2;
  g.add(glass);
  // ribs every 2 m
  for (let x = 0; x <= glassLen + 0.01; x += 2) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(R + 0.06, 0.05, 10, 72), steel);
    rib.rotation.y = Math.PI / 2; rib.position.set(x, y0, 0); rib.castShadow = true; g.add(rib);
  }
  // bellmouth intake
  const bell = [];
  for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI / 2; bell.push(new THREE.Vector2(R + 0.05 + 0.5 * (1 - Math.sin(a)), -0.5 * (1 - Math.cos(a)))); }
  const bellGeo = new THREE.LatheGeometry(bell, 72);
  const bellM = new THREE.Mesh(bellGeo, new THREE.MeshStandardMaterial({ color: '#8c949e', metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide }));
  bellM.rotation.z = -Math.PI / 2; bellM.position.set(0, y0, 0); bellM.castShadow = true; g.add(bellM);
  // fan housing: opaque steel drum with hazard band
  const hzTex = canvasTex(1024, 128, (c, w, h) => { c.fillStyle = '#16161a'; c.fillRect(0, 0, w, h); c.fillStyle = '#f2b311'; for (let i = -h; i < w + h; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 32, 0); c.lineTo(i + 32 + h, h); c.lineTo(i + h, h); c.fill(); } });
  hzTex.wrapS = THREE.RepeatWrapping; hzTex.repeat.set(4, 1);
  const housLen = L - glassLen;
  const hous = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.12, R + 0.12, housLen, 72, 1, true), [steel]);
  hous.material = new THREE.MeshStandardMaterial({ color: '#3a3f46', metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide });
  hous.rotation.z = Math.PI / 2; hous.position.set(glassLen + housLen / 2, y0, 0); hous.castShadow = true; hous.receiveShadow = true; g.add(hous);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.135, R + 0.135, 0.45, 72, 1, true), new THREE.MeshStandardMaterial({ map: hzTex, roughness: 0.6 }));
  band.rotation.z = Math.PI / 2; band.position.set(fanX, y0, 0); g.add(band);
  for (const x of [glassLen, L]) { const fl = new THREE.Mesh(new THREE.TorusGeometry(R + 0.14, 0.08, 10, 72), darkSteel); fl.rotation.y = Math.PI / 2; fl.position.set(x, y0, 0); g.add(fl); }
  // motor nacelle + struts behind the rotor
  const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 1.5, 32), darkSteel);
  nac.rotation.z = Math.PI / 2; nac.position.set(fanX + 0.95, y0, 0); nac.castShadow = true; g.add(nac);
  for (let k = 0; k < 4; k++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, R - 0.45, 0.06), darkSteel);
    const a = Math.PI / 4 + k * Math.PI / 2;
    st.position.set(fanX + 1.1, y0 + Math.cos(a) * (R / 2 + 0.2), Math.sin(a) * (R / 2 + 0.2));
    st.rotation.x = -a; g.add(st);
  }
  // stands
  for (const x of [1.5, 6, 10.5, 15, 17]) {
    for (const z of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, y0 - R * 0.55, 0.18), yellow);
      leg.position.set(x, (y0 - R * 0.55) / 2, z * R * 0.7); leg.rotation.x = z * 0.18; leg.castShadow = true; g.add(leg);
    }
    const cradle = new THREE.Mesh(new THREE.TorusGeometry(R + 0.09, 0.07, 8, 36, Math.PI * 0.5), yellow);
    cradle.rotation.y = Math.PI / 2; cradle.rotation.z = Math.PI * 1.25; cradle.position.set(x, y0, 0); g.add(cradle);
  }
  // signs
  const sign = (text, sub, w, h, pos, ry, bg = '#f2b311', fg = '#111') => {
    const t = canvasTex(1024, 512 * h / w * 2 | 0 || 256, (c, W, H) => {
      c.fillStyle = bg; c.fillRect(0, 0, W, H); c.strokeStyle = fg; c.lineWidth = 14; c.strokeRect(14, 14, W - 28, H - 28);
      c.fillStyle = fg; c.textAlign = 'center'; c.font = `900 ${H * 0.38 | 0}px Impact, "Arial Black", sans-serif`; c.fillText(text, W / 2, H * 0.55);
      c.font = `700 ${H * 0.12 | 0}px "Arial Black", sans-serif`; c.fillText(sub, W / 2, H * 0.8);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
    m.position.copy(pos); m.rotation.y = ry; m.castShadow = true; g.add(m);
    return m;
  };
  sign('THE SHRED HOLE', 'FAN DIVISION · AUTHORISED DUCKS ONLY', 4.2, 1.1, new THREE.Vector3(fanX + 0.4, y0 + R + 1.0, 0.02), 0);
  sign('THE SHRED HOLE', 'FAN DIVISION · AUTHORISED DUCKS ONLY', 4.2, 1.1, new THREE.Vector3(fanX + 0.4, y0 + R + 1.0, -0.02), Math.PI);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), darkSteel); post.position.set(fanX + 0.4, y0 + R + 0.35, 0); g.add(post);
  // warning beacon on the housing
  const beaconMat = new THREE.MeshStandardMaterial({ color: '#ff6a00', emissive: '#ff6a00', emissiveIntensity: 0.2, transparent: true, opacity: 0.9 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), beaconMat);
  beacon.position.set(glassLen + 0.5, y0 + R + 0.3, 0); g.add(beacon);
  const beaconLight = new THREE.SpotLight('#ff7a1a', 0, 22, 0.35, 0.5, 1.2);
  beaconLight.position.copy(beacon.position); g.add(beaconLight); g.add(beaconLight.target);

  return { group: g, beacon, beaconMat, beaconLight };
}

// Static physics: floor, tube shell (ring of plates), fan hub and nacelle.
export function buildColliders(world, RAPIER) {
  const { R, L, y0, fanX } = TUN;
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(80, 0.5, 80).setTranslation(10, -0.5, 0).setFriction(0.8).setRestitution(0.2), fixed);
  const N = 36, t = 0.06;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
    const cd = RAPIER.ColliderDesc.cuboid(L / 2, t, (R + t) * Math.PI / N * 1.08)
      .setTranslation(L / 2, y0 + (R + t) * Math.cos(a), (R + t) * Math.sin(a))
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.5).setRestitution(0.3);
    world.createCollider(cd, fixed);
  }
  world.createCollider(RAPIER.ColliderDesc.ball(FAN.Rhub).setTranslation(fanX - 0.15, y0, 0).setRestitution(0.4), fixed);
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.75, 0.5).setTranslation(fanX + 0.95, y0, 0).setRotation({ x: qz.x, y: qz.y, z: qz.z, w: qz.w }), fixed);
}
