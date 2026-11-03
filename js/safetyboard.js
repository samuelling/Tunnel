// The Shred Hole's daily safety board, on two posts beside the portal:
// DAYS SINCE THE FAN JAMMED (shared by everyone), PORTAL FUEL, and whether the Fabricator is open.
import * as THREE from 'three';

export function buildSafetyBoard(scene) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 680;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const W = 4.4, H = W * cv.height / cv.width;
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  face.position.y = 1.15 + H / 2; face.castShadow = true; g.add(face);
  const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, H + 0.12, 0.06), new THREE.MeshStandardMaterial({ color: '#1f7a3a', roughness: 0.6 }));
  back.position.set(0, face.position.y, -0.04); back.castShadow = true; g.add(back);
  const postMat = new THREE.MeshStandardMaterial({ color: '#c9ced4', metalness: 0.8, roughness: 0.35 });
  for (const x of [-W * 0.38, W * 0.38]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2 + H, 10), postMat); p.position.set(x, (1.2 + H) / 2, -0.09); p.castShadow = true; g.add(p); }
  scene.add(g);
  // beside the portal, on the camera's left in the Overview shot, turned to face it
  g.position.set(-1.6, 0, 6.6);
  g.rotation.y = Math.atan2(22 - g.position.x, 12 - g.position.z);

  let state = { days: null, fuel: null, open: null, tickets: null, excuse: '', shelf: null, jammedNow: false };
  function draw() {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    c.fillStyle = '#f6f4ec'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f7a3a'; c.fillRect(0, 0, w, 96);
    c.fillStyle = '#fff'; c.font = '900 50px Impact, "Arial Black", sans-serif'; c.textAlign = 'center';
    c.fillText('⚠  SHRED HOLE SAFETY BOARD  ⚠', w / 2, 66);
    c.textAlign = 'left'; c.fillStyle = '#151515';
    // days since the fan jammed
    c.font = '800 40px "Arial Black", system-ui, sans-serif';
    c.fillText('DAYS SINCE THE', 40, 178); c.fillText('FAN JAMMED', 40, 226);
    const days = state.jammedNow ? '0' : state.days === null ? '–' : state.days === Infinity ? '∞' : String(Math.min(999, state.days));
    c.fillStyle = '#111'; roundRect(c, 620, 120, 340, 150, 14); c.fill();
    c.fillStyle = state.jammedNow || state.days === 0 ? '#ff4a4a' : '#f4f4f4';
    c.font = '130px Impact, "Arial Black", sans-serif'; c.textAlign = 'center'; c.fillText(days, 790, 245); c.textAlign = 'left';
    if (state.jammedNow) { c.save(); c.translate(560, 280); c.rotate(-0.12); c.strokeStyle = '#d61f1f'; c.lineWidth = 6; c.strokeRect(-10, -48, 250, 62); c.fillStyle = '#d61f1f'; c.font = '900 44px Impact, sans-serif'; c.fillText('RESET!', 20, 2); c.restore(); }
    c.fillStyle = '#151515'; c.fillRect(40, 300, w - 80, 4);
    // portal fuel
    c.font = '800 36px "Arial Black", system-ui, sans-serif'; c.fillText('PORTAL FUEL', 40, 368);
    const f = state.fuel;
    roundRect(c, 400, 330, 470, 48, 10); c.fillStyle = '#ddd'; c.fill();
    if (f !== null) {
      c.save(); roundRect(c, 400, 330, 470, 48, 10); c.clip();
      c.fillStyle = f > 0.5 ? '#2fa84f' : f > 0.2 ? '#f2b311' : '#d61f1f'; c.fillRect(400, 330, 470 * f, 48); c.restore();
    }
    c.fillStyle = '#151515'; c.font = '700 34px system-ui, sans-serif'; c.fillText(f === null ? '–' : f <= 0 ? 'EMPTY' : `${Math.round(f * 100)}%`, 890, 368);
    // the Fabricator
    c.font = '800 36px "Arial Black", system-ui, sans-serif'; c.fillText('FABRICATOR', 40, 458);
    if (state.open === null) { c.font = '700 36px system-ui, sans-serif'; c.fillText('–', 400, 458); }
    else if (state.open) {
      c.fillStyle = '#1f7a3a'; c.font = '900 50px Impact, sans-serif'; c.fillText('OPEN', 400, 462);
      c.fillStyle = '#333'; c.font = '600 30px system-ui, sans-serif'; c.fillText(`${state.tickets} ticket${state.tickets === 1 ? '' : 's'} left this hour`, 540, 456);
    } else {
      c.fillStyle = '#b3121c'; c.font = '900 50px Impact, sans-serif'; c.fillText('CLOSED', 400, 462);
      c.fillStyle = '#333'; c.font = 'italic 600 28px Georgia, serif'; c.fillText(state.excuse.slice(0, 34), 590, 456);
    }
    c.fillStyle = '#151515'; c.fillRect(40, 500, w - 80, 4);
    c.font = '600 30px system-ui, sans-serif'; c.fillStyle = '#333';
    c.fillText(state.shelf === null ? 'Wear eye protection. Do not feed the fan ducks.' : `WAREHOUSE: ${state.shelf} object${state.shelf === 1 ? '' : 's'} on the shelf · all free`, 40, 562);
    c.font = 'italic 26px Georgia, serif'; c.fillStyle = '#666';
    c.fillText('Report all jams to the management. The management is a fan.', 40, 626);
    tex.needsUpdate = true;
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  draw();
  return {
    group: g,
    update(q, { jammed = false } = {}) {
      if (q) {
        state.days = q.lastJam ? Math.floor((Date.now() - q.lastJam) / 86400000) : Infinity;
        state.fuel = typeof q.fuel === 'number' ? q.fuel : null;
        state.open = q.on ? q.open !== false : null;
        state.tickets = q.poolLeft; state.excuse = q.excuse || ''; state.shelf = typeof q.shelf === 'number' ? q.shelf : null;
      }
      state.jammedNow = jammed;
      draw();
    },
  };
}
