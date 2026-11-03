// The Shred Hole's daily safety board, on two posts beside the portal:
// DAYS SINCE THE FAN JAMMED (shared by everyone), PORTAL FUEL, and whether the Fabricator is open.
// In December a string of Christmas lights is draped over it; during Hanukkah they all turn blue.
// (Preview any time with ?holiday=christmas, ?holiday=hanukkah or ?holiday=none.)
import * as THREE from 'three';

// ---- which holiday is it? Hanukkah runs from the evening before 25 Kislev for eight nights;
// the Hebrew date comes from the browser's own calendar support, with a table as a fallback.
const HANUKKAH_25_KISLEV = { 2026: '12-05', 2027: '12-25', 2028: '12-13', 2029: '12-02', 2030: '12-21', 2031: '12-10', 2032: '11-28', 2033: '12-17', 2034: '12-07', 2035: '12-26' };
function kislev25(year) {
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-hebrew', { month: 'long', day: 'numeric', timeZone: 'UTC' });
    for (let t = Date.UTC(year, 10, 15); t <= Date.UTC(year, 11, 31); t += 864e5) {
      const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
      if (/^Kislev$/i.test(p.month) && p.day === '25') return new Date(t);
    }
  } catch (e) { /* no Hebrew calendar here */ }
  const md = HANUKKAH_25_KISLEV[year];
  return md ? new Date(`${year}-${md}T00:00:00Z`) : null;
}
export function holidayOn(now = new Date()) {
  try { const q = new URLSearchParams(location.search).get('holiday'); if (q) return /^han|^chan/i.test(q) ? 'hanukkah' : /^(christ|xmas|dec)/i.test(q) ? 'christmas' : null; } catch (e) { /* not a page */ }
  const day = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  for (const y of [now.getFullYear(), now.getFullYear() - 1]) {
    const k = kislev25(y);
    if (k && day >= +k - 864e5 && day <= +k + 7 * 864e5) return 'hanukkah';
  }
  return now.getMonth() === 11 ? 'christmas' : null;
}

const XMAS = ['#ff2a2a', '#22e04a', '#2a6bff', '#ffc21a', '#ff7a1a', '#d84cff'];
const BLUES = ['#1e5bff', '#5aa8ff', '#2f7dff'];

// a string of C9 bulbs swagged along the top of the board, with a tail dangling down each side
function buildLights(W, top) {
  const g = new THREE.Group();
  const x0 = -W / 2 - 0.06, x1 = W / 2 + 0.06, z = 0.07, sag = 0.34;
  const pts = [new THREE.Vector3(x0 - 0.1, top - 1.25, z + 0.05), new THREE.Vector3(x0 - 0.06, top - 0.6, z + 0.03), new THREE.Vector3(x0, top + 0.03, z)];
  const swags = 3;
  for (let i = 0; i < swags; i++) {
    const a = x0 + (x1 - x0) * i / swags, b = x0 + (x1 - x0) * (i + 1) / swags;
    for (const f of [0.25, 0.5, 0.75]) pts.push(new THREE.Vector3(a + (b - a) * f, top + 0.03 - sag * Math.sin(Math.PI * f), z + 0.02));
    pts.push(new THREE.Vector3(b, top + 0.03, z));
  }
  pts.push(new THREE.Vector3(x1 + 0.07, top - 0.55, z + 0.03), new THREE.Vector3(x1 + 0.12, top - 1.05, z + 0.05));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.016, 6, false), new THREE.MeshStandardMaterial({ color: '#14381f', roughness: 0.6 }));
  wire.castShadow = true; g.add(wire);
  const N = 30, bulbGeo = new THREE.SphereGeometry(0.068, 12, 10), sockGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.07, 8);
  bulbGeo.scale(1, 1.55, 1);
  const sockMat = new THREE.MeshStandardMaterial({ color: '#163d22', roughness: 0.5 });
  const mats = [0, 1, 2, 3, 4, 5].map(() => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.5, roughness: 0.25, transparent: true, opacity: 0.95, toneMapped: false }));
  const bulbs = [];
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N, p = curve.getPointAt(u);
    const b = new THREE.Group(); b.position.copy(p);
    b.rotation.z = (Math.random() - 0.5) * 0.7; b.rotation.x = 0.25 + (Math.random() - 0.5) * 0.3;   // they hang, a bit untidily
    const sock = new THREE.Mesh(sockGeo, sockMat); sock.position.y = -0.04; b.add(sock);
    const bulb = new THREE.Mesh(bulbGeo, mats[i % mats.length]); bulb.position.y = -0.14; b.add(bulb);
    g.add(b); bulbs.push(bulb);
  }
  const glow = new THREE.PointLight('#ffffff', 0, 3.2, 2); glow.position.set(0, top - 0.4, 0.7); g.add(glow);
  let palette = null;
  return {
    group: g,
    set(kind) {
      const pal = kind === 'hanukkah' ? BLUES : XMAS;
      if (pal === palette) return;
      palette = pal;
      mats.forEach((m, i) => { const c = pal[i % pal.length]; m.color.set(c); m.emissive.set(c); });
      glow.color.set(kind === 'hanukkah' ? '#4a8cff' : '#ffb070');
    },
    tick(t) {
      // a slow twinkle, each colour on its own beat, with a chase rippling through now and then
      mats.forEach((m, i) => { m.emissiveIntensity = 1.1 + 0.9 * Math.max(0, Math.sin(t * (0.9 + i * 0.23) + i * 1.7)) + (Math.sin(t * 0.5) > 0.92 ? 1.2 * Math.max(0, Math.sin(t * 9 - i)) : 0); });
      glow.intensity = 1.6 + 0.5 * Math.sin(t * 1.3);
    },
  };
}

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

  // holiday lights: put up and taken down by the calendar (checked every few minutes)
  let lights = null, holiday = null, checkedAt = -1e9;
  function seasonCheck(t) {
    if (t - checkedAt < 300) return;
    checkedAt = t;
    const h = holidayOn();
    if (h === holiday) return;
    holiday = h;
    if (h && !lights) { lights = buildLights(W, face.position.y + H / 2); g.add(lights.group); }
    if (lights) { lights.group.visible = !!h; if (h) lights.set(h); }
  }
  seasonCheck(0);

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
    get holiday() { return holiday; },
    tick(t) { seasonCheck(t); if (holiday && lights) lights.tick(t); },
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
