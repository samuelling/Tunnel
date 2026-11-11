// The OUT OF ORDER sign. It drops on two chains from the top rim of the tower when the fan jams,
// swings like the ~5.5 m pendulum it is (T = 2π√(L/g) ≈ 4.7 s), and is winched away after repairs.
import * as THREE from 'three';
import { TUN, S } from './config.js';

function signTexture(times) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 560;
  const c = cv.getContext('2d');
  c.fillStyle = '#f4efe1'; c.fillRect(0, 0, 1024, 560);
  // grubby edges
  const g = c.createRadialGradient(512, 280, 200, 512, 280, 640);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(90,70,30,0.35)');
  c.fillStyle = g; c.fillRect(0, 0, 1024, 560);
  c.strokeStyle = '#c1121f'; c.lineWidth = 22; c.strokeRect(26, 26, 972, 508);
  c.fillStyle = '#c1121f';
  c.font = '900 150px Impact, "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('OUT OF', 512, 160);
  c.fillText('ORDER', 512, 305);
  c.fillStyle = '#222'; c.font = 'italic 600 40px Georgia, serif';
  c.fillText('Sorry for the inconvenience. — Mgmt.', 512, 430);
  // tape
  c.fillStyle = 'rgba(250,235,160,0.8)';
  for (const [x, y, r] of [[70, 50, -0.6], [954, 50, 0.6]]) { c.save(); c.translate(x, y); c.rotate(r); c.fillRect(-70, -18, 140, 36); c.restore(); }
  if (times > 1) {                                          // someone has had enough
    c.save(); c.translate(820, 470); c.rotate(-0.16);
    c.fillStyle = '#1d4ed8'; c.font = '700 54px "Comic Sans MS", "Marker Felt", cursive';
    c.fillText(times > 4 ? `AGAIN?! (×${times})` : 'again??', 0, 0); c.restore();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function buildOutOfOrder(scene) {
  const topY = TUN.groundX + 0.15;          // world height of the tube's top rim
  const hang = 4.6;                         // chain length to the sign's top edge
  const W = 3.6, H = 1.97;
  const group = new THREE.Group(); group.visible = false; group.scale.setScalar(2); scene.add(group);   // big enough to read on the 3× plant
  const pivot = new THREE.Group(); group.add(pivot);
  const boardMat = new THREE.MeshStandardMaterial({ map: signTexture(1), roughness: 0.75 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#d9d2bf', roughness: 0.8 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.04), [edgeMat, edgeMat, edgeMat, edgeMat, boardMat, edgeMat]);
  board.castShadow = true; pivot.add(board);
  const chainMat = new THREE.MeshStandardMaterial({ color: '#8a8f96', metalness: 0.8, roughness: 0.35 });
  const chains = [-1, 1].map(sx => {
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), chainMat);
    pivot.add(ch); return { ch, sx };
  });
  let state = 'hidden', t = 0, swing = 0, swingV = 0, sway = 0, times = 0, drop = 0;
  const place = (len) => {
    board.position.set(0, -len - H / 2, 0);
    for (const { ch, sx } of chains) {
      // chains run from the rim (slightly wider) down to the sign's top corners
      const top = new THREE.Vector3(sx * W * 0.42, 0, -0.05), bot = new THREE.Vector3(sx * W * 0.42, -len, 0);
      ch.position.copy(top).add(bot).multiplyScalar(0.5);
      ch.scale.set(1, Math.max(0.01, top.distanceTo(bot)), 1);
    }
  };
  return {
    get visible() { return state !== 'hidden'; },
    show() {
      times++; boardMat.map.dispose(); boardMat.map = signTexture(times); boardMat.needsUpdate = true;
      state = 'drop'; t = 0; group.visible = true; swing = 0.25; swingV = 0; sway = (Math.random() - 0.5) * 0.3;
    },
    hide() { if (state !== 'hidden') { state = 'lift'; t = 0; } },
    bump(k = 0.12) { swingV += k * (Math.random() < 0.5 ? -1 : 1); },
    update(dt, camera) {
      if (state === 'hidden') return;
      t += dt;
      if (state === 'drop') {                       // unspools fast, bounces on the chains
        const k = Math.min(1, t / 0.9);
        const bounce = k < 1 ? 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI * 3) * 0.08 * (1 - k) : 1;
        drop = hang * bounce; if (k >= 1) state = 'up';
      } else if (state === 'lift') {
        const k = Math.min(1, t / 0.8);
        drop = hang * (1 - k * k);
        if (k >= 1) { state = 'hidden'; group.visible = false; return; }
      }
      place(Math.max(0.05, drop));
      // pendulum about the rim: θ'' = −(g/L)θ − cθ'
      const Lp = Math.max(1, drop + H / 2);
      swingV += (-(9.81 / Lp) * swing - 0.12 * swingV) * dt;
      swing += swingV * dt;
      sway *= Math.exp(-dt * 0.4);
      pivot.rotation.x = swing; pivot.rotation.z = sway * Math.sin(t * 1.3);
      // hang on the side of the tower facing the camera
      // a little off to one side of the camera's line of sight so it never blocks the blades
      const a = Math.atan2(camera.position.x, camera.position.z) + 0.75;
      group.position.set(Math.sin(a) * (TUN.R + 0.55 * S), topY, Math.cos(a) * (TUN.R + 0.55 * S));
      group.rotation.y = a;
    },
  };
}
