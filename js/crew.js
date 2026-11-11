// Scale cues for the 3× plant: real-size people and a caged ladder, so the eye reads the true size
// of the thing. Three crew in hi-vis: one walking the catwalk round the intake 46 m up, one halfway
// up the ladder on the tower leg facing the Overview camera, and one on the floor with a clipboard
// by the safety board. They duck when something heavy hits.
import * as THREE from 'three';
import { TUN0, S } from './config.js';

const skin = ['#f1c9a5', '#c68863', '#8d5524', '#e0ac69'];
export const face = (g, dx, dz) => { g.rotation.y = -Math.atan2(dz, dx); };   // people are built facing +x

export function person(i) {
  const g = new THREE.Group();
  const M = (c, opt = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...opt });
  const vest = M('#ff6a13', { emissive: '#ff4d00', emissiveIntensity: 0.25 });
  const stripe = M('#e8eef2', { emissive: '#ffffff', emissiveIntensity: 0.35, metalness: 0.3 });
  const trousers = M('#2c3440'), boots = M('#2a1d12'), faceMat = M(skin[i % skin.length]);
  const hat = M(['#ffd21f', '#ffffff', '#ff8a00'][i % 3], { roughness: 0.4 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  // legs (pivot at the hip so they can swing)
  const legs = [-1, 1].map(s => {
    const hip = new THREE.Group(); hip.position.set(0, 0.92, s * 0.1); g.add(hip);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.72, 4, 8), trousers); leg.position.y = -0.44; leg.castShadow = true; hip.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.12), boots); boot.position.set(0.05, -0.87, 0); hip.add(boot);
    return hip;
  });
  add(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), vest, 0, 1.24, 0).scale.set(0.75, 1, 1);
  for (const y of [1.12, 1.3]) add(new THREE.CylinderGeometry(0.155, 0.155, 0.04, 14), stripe, 0, y, 0).scale.set(1, 1, 1.32);
  add(new THREE.SphereGeometry(0.1, 14, 10), faceMat, 0, 1.62, 0);
  add(new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat, 0, 1.66, 0);
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.015, 16), hat, 0.02, 1.665, 0);
  const arms = [-1, 1].map(s => {
    const sh = new THREE.Group(); sh.position.set(0, 1.45, s * 0.24); g.add(sh);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.5, 4, 8), vest); arm.position.y = -0.3; arm.castShadow = true; sh.add(arm);
    return sh;
  });
  return { g, legs, arms };
}

export function buildCrew(scene) {
  const { R, groundX, L } = TUN0;
  const deckY = (groundX + 0.1) * S, legR = (R + 0.75) * S;
  const steel = new THREE.MeshStandardMaterial({ color: '#c9ced4', metalness: 0.7, roughness: 0.4 });

  // caged ladder up the outside of the leg at 45° (the one facing the Overview camera)
  const a = Math.PI / 4, out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  const base = out.clone().multiplyScalar(legR + 0.45);
  const ladder = new THREE.Group(); scene.add(ladder);
  for (const s of [-0.24, 0.24]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, deckY, 0.05), steel);
    rail.position.copy(base).addScaledVector(side, s); rail.position.y = deckY / 2; ladder.add(rail);
  }
  const nR = Math.floor(deckY / 0.3);
  const rungs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.016, 0.016, 0.48, 6).rotateX(Math.PI / 2), steel, nR);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
  for (let i = 0; i < nR; i++) { m4.compose(new THREE.Vector3(base.x, 0.3 * (i + 1), base.z), q, new THREE.Vector3(1, 1, 1)); rungs.setMatrixAt(i, m4); }
  ladder.add(rungs);
  // safety cage: hoops every metre from 2.4 m up, and five vertical straps
  const nH = Math.floor((deckY - 2.4) / 1.0);
  const hoop = new THREE.TorusGeometry(0.38, 0.015, 4, 16, Math.PI * 1.25).rotateX(Math.PI / 2).rotateY(Math.PI * 0.375);
  const hoops = new THREE.InstancedMesh(hoop, steel, nH);
  const c0 = base.clone().addScaledVector(out, 0.3);
  const qh = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
  for (let i = 0; i < nH; i++) { m4.compose(new THREE.Vector3(c0.x, 2.4 + i, c0.z), qh, new THREE.Vector3(1, 1, 1)); hoops.setMatrixAt(i, m4); }
  ladder.add(hoops);
  for (let k = 0; k < 5; k++) {
    const phi = (k / 4 - 0.5) * 1.1 * Math.PI;
    const dir = out.clone().multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi));
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.04, deckY - 2.4, 0.01), steel);
    st.position.copy(c0).addScaledVector(dir, 0.38); st.position.y = 2.4 + (deckY - 2.4) / 2;
    st.rotation.y = -Math.atan2(dir.z, dir.x);
    ladder.add(st);
  }

  // the crew
  const crew = [0, 1, 2].map(person);
  for (const c of crew) scene.add(c.g);
  const [walker, climber, boss] = crew;
  const ringR = (R + 1.35) * S;   // middle of the catwalk
  // the climber faces the ladder
  face(climber.g, -out.x, -out.z);
  // the floor crew stands by the safety board, looking up at the tower
  boss.g.position.set(17.2, 0, 9.2);   // between the portal and the Overview camera, by the parked car
  face(boss.g, -boss.g.position.x, -boss.g.position.z);
  boss.arms[1].rotation.x = -0.9; boss.arms[1].rotation.z = 0.5;   // clipboard arm
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.22), new THREE.MeshStandardMaterial({ color: '#8a5a2b' }));
  clip.position.set(0.26, 1.18, 0.18); boss.g.add(clip);

  let duck = 0;
  return {
    crew,
    // t: seconds; jolt: camera shake level (0…1), makes everyone flinch
    tick(t, dt, jolt = 0) {
      duck = Math.max(duck * Math.pow(0.15, dt), jolt > 0.35 ? jolt : 0);
      const crouch = Math.min(1, duck);
      // catwalk patrol: a slow lap of the intake (about 4 minutes), legs swinging
      const th = t * 0.026;
      walker.g.position.set(Math.cos(th) * ringR, deckY - crouch * 0.35, Math.sin(th) * ringR);
      face(walker.g, -Math.sin(th), Math.cos(th));   // walking along the ring
      const sw = Math.sin(t * 5.2) * 0.45 * (1 - crouch);
      walker.legs[0].rotation.z = sw; walker.legs[1].rotation.z = -sw;
      walker.arms[0].rotation.z = -sw * 0.8; walker.arms[1].rotation.z = sw * 0.8;
      // ladder: up and down the tower, ~0.4 m/s, pausing at the deck and the floor
      const H = deckY - 1.8, period = 2 * H / 0.4 + 40, u = (t % period);
      let y = u < 20 ? 0 : u < 20 + H / 0.4 ? (u - 20) * 0.4 : u < 40 + H / 0.4 ? H : H - (u - 40 - H / 0.4) * 0.4;
      y = Math.max(0, Math.min(H, y));
      climber.g.position.copy(base).addScaledVector(out, 0.28); climber.g.position.y = y;
      const cl = Math.sin(y / 0.3 * Math.PI) * 0.5;
      climber.arms[0].rotation.z = 2.6 + cl * 0.4; climber.arms[1].rotation.z = 2.6 - cl * 0.4;
      climber.legs[0].rotation.z = 0.3 + cl * 0.35; climber.legs[1].rotation.z = 0.3 - cl * 0.35;
      // floor crew: a little sway; hands over the hard hat when the plant shakes
      boss.g.position.y = -crouch * 0.3;
      boss.arms[0].rotation.z = crouch * 2.6;
      boss.g.rotation.z = Math.sin(t * 0.7) * 0.015;
    },
  };
}
