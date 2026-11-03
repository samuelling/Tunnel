// "Share my pile": everything this session sent through the portal, heaped up and photographed,
// with a list of what went in and what it was made of. Shared as a PNG through the phone's share
// sheet (Messages, Mail…), or saved / emailed / texted as a fallback.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MATERIALS } from './objects.js';

export const MAT_LABEL = {
  metal: 'steel & aluminium', chrome: 'chrome-plated steel', steel: 'hardened steel', iron: 'cast iron',
  ceramic: 'porcelain & ceramic', glass: 'glass', stone: 'stone', wood: 'wood', plastic: 'plastic',
  rubber: 'rubber & vinyl', fabric: 'fabric & stuffing', paper: 'paper & card', fruit: 'fruit', food: 'food', glow: 'electronics',
};
const MAT_COLOR = {
  metal: '#9aa3ad', chrome: '#d7dde4', steel: '#5d6b63', iron: '#4a4d52', ceramic: '#f2efe8', glass: '#9fd8ff', stone: '#8d877d',
  wood: '#8b5a2b', plastic: '#ff8a3d', rubber: '#ff5fa2', fabric: '#c08cff', paper: '#f7f3dc', fruit: '#e63946', food: '#f2c14e', glow: '#39ff14',
};

export class SessionPile {
  constructor() { this.pieces = []; this.items = []; this.started = new Date(); }
  addPieces(list) {
    for (const p of list) { if (this.pieces.length < 900) this.pieces.push(p); }
  }
  // mats: { matKind: kg }
  addItem(recipe, head, kg, mats) {
    this.items.push({ name: recipe.name, icon: recipe.icon || '✨', kg, head, mats });
  }
  summary() {
    const byName = new Map();
    for (const it of this.items) {
      const e = byName.get(it.name) || { name: it.name, icon: it.icon, n: 0, kg: 0, blended: 0, jammed: 0 };
      e.n++; e.kg += it.kg;
      if (it.head.startsWith('IT BLENDS') || it.head.startsWith('PART')) e.blended++;
      if (it.head.includes('JAMMED')) e.jammed++;
      byName.set(it.name, e);
    }
    const mats = {};
    for (const it of this.items) for (const [k, v] of Object.entries(it.mats)) mats[k] = (mats[k] || 0) + v;
    const kg = this.items.reduce((s, it) => s + it.kg, 0);
    const list = [...byName.values()].sort((a, b) => b.kg - a.kg);
    const matList = Object.entries(mats).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, label: MAT_LABEL[k] || k, kg: v, frac: v / (kg || 1) })).filter((m, i) => i < 2 || m.frac >= 0.005);
    return { list, matList, kg, n: this.items.length, pieces: this.pieces.length };
  }
  text(extra = '') {
    const s = this.summary();
    const things = s.list.map(e => `${e.n > 1 ? e.n + '× ' : ''}${e.name.toLowerCase()}`).join(', ');
    const mats = s.matList.slice(0, 5).map(m => `${pct(m.frac)} ${m.label}`).join(', ');
    return `My Shred Hole pile: ${things}. ${fmtKg(s.kg)} in all, ${s.pieces} pieces through the vortex portal. Made of ${mats}.${extra}`;
  }
}
const pct = (f) => f < 0.01 ? '<1%' : `${Math.round(f * 100)}%`;
export const fmtKg = (kg) => kg >= 1000 ? `${(kg / 1000).toFixed(2)} t` : kg >= 1 ? `${kg.toFixed(kg < 10 ? 1 : 0)} kg` : `${Math.round(kg * 1000)} g`;

// seeded RNG so the same session photographs the same way
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Heap the pieces on a height field (cells take a piece's bulk; the heap spreads at the
// angle of repose) and render it.
function renderHeap(pieces, W, H) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14161c');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;

  const R = rng(pieces.length * 7919 + 17);
  // units: the parts of one rigid body (an intact safe, a separated limb) are kept assembled
  const groups = new Map();
  for (const pc of pieces) { const k = pc.g ?? Math.random(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(pc); }
  const items = [];
  let vol = 0;
  for (const list of groups.values()) {
    const parts = [];
    for (const pc of list) {
      const pts = [];
      for (let i = 0; i + 2 < pc.p.length; i += 3) pts.push(new THREE.Vector3(pc.p[i], pc.p[i + 1], pc.p[i + 2]));
      if (pts.length < 4) continue;
      let g;
      try { g = new ConvexGeometry(pts); } catch { continue; }
      g.computeBoundingSphere();
      const q = pc.q ? new THREE.Quaternion(pc.q[0], pc.q[1], pc.q[2], pc.q[3]) : new THREE.Quaternion();
      const o = list.length > 1 && pc.o ? new THREE.Vector3(pc.o[0], pc.o[1], pc.o[2]) : new THREE.Vector3();
      parts.push({ g, pc, q, o, r: g.boundingSphere.radius });
    }
    if (!parts.length) continue;
    const c = new THREE.Vector3(); for (const p of parts) c.add(p.o); c.divideScalar(parts.length);
    let r = 0.01; for (const p of parts) { p.o.sub(c); r = Math.max(r, p.o.length() + p.r); }
    vol += r * r * r;
    items.push({ parts, r });
  }
  items.sort((a, b) => b.r - a.r);
  const Rp = Math.min(8, Math.max(0.45, Math.cbrt(vol) * 1.5));
  const N = 72, cell = (2.6 * Rp) / N, hf = new Float32Array(N * N);
  const ci = (x) => Math.max(0, Math.min(N - 1, Math.floor(x / cell + N / 2)));
  const repose = Math.tan(38 * Math.PI / 180);
  const mats = new Map();
  const matFor = (pc) => {
    const key = pc.c + (pc.k || '');
    if (!mats.has(key)) {
      const m = MATERIALS[pc.k] || MATERIALS.plastic;
      mats.set(key, new THREE.MeshStandardMaterial({ color: pc.c, roughness: Math.max(0.2, m.rough), metalness: m.metal * 0.85, flatShading: true,
        transparent: !!m.glass, opacity: m.glass ? 0.7 : 1 }));
    }
    return mats.get(key);
  };
  let top = 0;
  for (const it of items) {
    // centre-weighted drop point, then it rolls a little downhill
    const a = R() * Math.PI * 2, rr = Rp * 0.85 * Math.pow(R(), 1.6);
    let x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    for (let s = 0; s < 3; s++) {
      const i = ci(x), j = ci(z), h = hf[i * N + j];
      let bi = i, bj = j, bh = h;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = Math.max(0, Math.min(N - 1, i + di)), jj = Math.max(0, Math.min(N - 1, j + dj)); if (hf[ii * N + jj] < bh - cell * repose) { bh = hf[ii * N + jj]; bi = ii; bj = jj; } }
      if (bi === i && bj === j) break;
      x = (bi - N / 2 + 0.5) * cell; z = (bj - N / 2 + 0.5) * cell;
    }
    const rc = Math.ceil(it.r / cell);
    const i0 = ci(x), j0 = ci(z);
    let base = 0;
    for (let di = -rc; di <= rc; di++) for (let dj = -rc; dj <= rc; dj++) {
      const ii = i0 + di, jj = j0 + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      if (di * di + dj * dj <= rc * rc) base = Math.max(base, hf[ii * N + jj]);
    }
    const y = base + it.r * 0.45;
    const unit = new THREE.Group();
    for (const p of it.parts) {
      const mesh = new THREE.Mesh(p.g, matFor(p.pc));
      mesh.position.copy(p.o); mesh.quaternion.copy(p.q);
      mesh.castShadow = mesh.receiveShadow = true;
      unit.add(mesh);
    }
    unit.position.set(x, y, z);
    // loose chunks land any old way; assembled things land roughly the way they came out
    if (it.parts.length > 1) unit.rotation.y = R() * 6.28;
    else unit.quaternion.setFromEuler(new THREE.Euler(R() * 6.28, R() * 6.28, R() * 6.28));
    scene.add(unit);
    for (let di = -rc; di <= rc; di++) for (let dj = -rc; dj <= rc; dj++) {
      const ii = i0 + di, jj = j0 + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const d = Math.sqrt(di * di + dj * dj) * cell;
      if (d <= it.r) hf[ii * N + jj] = Math.max(hf[ii * N + jj], y + it.r * 0.5 * (1 - d / it.r));
    }
    // relax to the angle of repose so it reads as a heap, not a column
    for (let pass = 0; pass < 2; pass++) for (let ii = 1; ii < N - 1; ii++) for (let jj = 1; jj < N - 1; jj++) {
      const k = ii * N + jj;
      for (const n of [k + 1, k - 1, k + N, k - N]) { const ex = hf[k] - hf[n] - cell * repose; if (ex > 0) { hf[k] -= ex * 0.25; hf[n] += ex * 0.25; } }
    }
    top = Math.max(top, y + it.r);
  }
  // ground: concrete with the portal's scorch ring
  const gtex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; const c = cv.getContext('2d');
    c.fillStyle = '#2a2d33'; c.fillRect(0, 0, 512, 512);
    const g = c.createRadialGradient(256, 256, 40, 256, 256, 256);
    g.addColorStop(0, 'rgba(155,77,255,0.35)'); g.addColorStop(0.55, 'rgba(64,224,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1400; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; c.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const ground = new THREE.Mesh(new THREE.CircleGeometry(Rp * 3, 64), new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  scene.add(new THREE.HemisphereLight('#c9d6ff', '#20160c', 0.7));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.position.set(Rp * 1.6, Rp * 3 + top, Rp * 1.2); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -Rp * 1.8; sc.right = sc.top = Rp * 1.8; sc.near = 0.1; sc.far = Rp * 10 + top * 3;
  scene.add(sun);
  const rim = new THREE.PointLight('#9b4dff', 6 * Rp * Rp, Rp * 8); rim.position.set(-Rp * 1.5, Rp * 0.6, -Rp * 1.2); scene.add(rim);

  const camera = new THREE.PerspectiveCamera(34, W / H, 0.01, 200);
  const span = Math.max(Rp * 1.25, top * 1.1);
  const dist = span / Math.tan(17 * Math.PI / 180) * 1.05;
  camera.position.set(dist * 0.72, top * 0.45 + dist * 0.42, dist * 0.55);
  camera.lookAt(0, top * 0.32, 0);
  renderer.render(scene, camera);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  out.getContext('2d').drawImage(renderer.domElement, 0, 0);
  // tidy up the second WebGL context
  scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
  for (const m of mats.values()) m.dispose();
  gtex.dispose(); pmrem.dispose(); renderer.dispose(); renderer.forceContextLoss();
  return { canvas: out, Rp };
}

function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

// Compose the shareable picture: heap photo on top, the inventory below.
export async function renderPileImage(pile, { url, bill } = {}) {
  const W = 1080, PH = 1000;
  const s = pile.summary();
  const listRows = Math.min(8, s.list.length);
  const H = PH + 150 + listRows * 52 + (s.list.length > 8 ? 44 : 0) + 250;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#0d0e12'; c.fillRect(0, 0, W, H);
  let Rp = 1;
  if (s.pieces) { const h = renderHeap(pile.pieces, W, PH); c.drawImage(h.canvas, 0, 0); Rp = h.Rp; }
  else { c.fillStyle = '#9aa3b2'; c.font = '600 40px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('Nothing through the portal yet.', W / 2, PH / 2); c.textAlign = 'left'; }
  // title over the photo
  const grad = c.createLinearGradient(0, 0, 0, 240); grad.addColorStop(0, 'rgba(10,11,14,0.85)'); grad.addColorStop(1, 'rgba(10,11,14,0)');
  c.fillStyle = grad; c.fillRect(0, 0, W, 240);
  c.fillStyle = '#ffc21a'; c.font = '900 92px Impact, "Arial Black", sans-serif'; c.fillText('MY SHRED PILE', 48, 112);
  c.fillStyle = '#c9b8ff'; c.font = '700 30px system-ui, sans-serif';
  c.fillText(`Shred Hole (Vortex Portal) · ${pile.started.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`, 52, 160);
  // scale bar
  if (s.pieces) {
    const m = Rp > 3 ? 2 : Rp > 1.2 ? 1 : 0.5;
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = '600 24px system-ui, sans-serif';
    c.fillText(`heap ≈ ${(Rp * 2).toFixed(1)} m across`, W - 330, PH - 34);
  }
  // inventory
  let y = PH + 64;
  c.fillStyle = '#f2f4f8'; c.font = '800 40px system-ui, sans-serif';
  c.fillText(`${s.n} thing${s.n === 1 ? '' : 's'} · ${fmtKg(s.kg)} · ${s.pieces.toLocaleString()} pieces`, 48, y);
  y += 26;
  c.font = '500 34px system-ui, sans-serif';
  for (const e of s.list.slice(0, 8)) {
    y += 52;
    c.fillStyle = '#f2f4f8'; c.fillText(`${e.icon}  ${e.n > 1 ? e.n + ' × ' : ''}${e.name}`, 56, y);
    c.fillStyle = e.jammed ? '#ff6b6b' : e.blended ? '#ffc21a' : '#57b8ff';
    const tag = e.jammed ? 'jammed the fan' : e.blended === e.n ? 'blended' : e.blended ? `${e.blended} blended` : 'survived';
    c.textAlign = 'right'; c.fillText(`${fmtKg(e.kg)} · ${tag}`, W - 52, y); c.textAlign = 'left';
  }
  if (s.list.length > 8) { y += 44; c.fillStyle = '#9aa3b2'; c.font = '500 28px system-ui, sans-serif'; c.fillText(`+ ${s.list.length - 8} more`, 56, y); }
  // what it was made of: stacked bar + legend
  y += 54;
  c.fillStyle = '#9aa3b2'; c.font = '700 26px system-ui, sans-serif'; c.fillText('MADE OF', 48, y);
  y += 18;
  let x = 48; const bw = W - 96;
  roundRect(c, 48, y, bw, 34, 10); c.save(); c.clip();
  for (const m of s.matList) { const w = bw * m.frac; c.fillStyle = MAT_COLOR[m.k] || '#888'; c.fillRect(x, y, w + 1, 34); x += w; }
  c.restore();
  y += 72; x = 48;
  c.font = '500 26px system-ui, sans-serif';
  for (const m of s.matList.slice(0, 6)) {
    const label = `${pct(m.frac)} ${m.label}`;
    const w = c.measureText(label).width + 44;
    if (x + w > W - 40) { x = 48; y += 38; }
    c.fillStyle = MAT_COLOR[m.k] || '#888'; roundRect(c, x, y - 20, 22, 22, 5); c.fill();
    c.fillStyle = '#dfe3ea'; c.fillText(label, x + 30, y); x += w;
  }
  // footer
  c.fillStyle = '#6f7787'; c.font = '500 24px system-ui, sans-serif';
  c.fillText((bill ? `Fan repair bill: $${bill.toLocaleString()} · ` : '') + (url || ''), 48, H - 30);
  return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
}
