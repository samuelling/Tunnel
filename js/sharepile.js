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

// ---------------------------------------------------------------- postcard
// The same pile as a two-sided picture postcard: the front is the heap under big vintage
// "Greetings from the SHRED HOLE" lettering; the back has a handwritten note, a Shred Post
// stamp and a Vortex Portal postmark. Both sides are PNGs, so Messages and Mail send them
// as pictures.
const HAND = '"Bradley Hand", "Segoe Print", "Segoe Script", "Comic Sans MS", "Chalkboard SE", cursive';
const SERIF = 'Georgia, "Times New Roman", serif';
const BLOCK = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';

function wrap(c, text, x, y, maxW, lh, maxLines = 99) {
  const words = String(text).split(/\s+/); let line = '', n = 0;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y); y += lh; line = w; if (++n >= maxLines - 1) break; }
    else line = t;
  }
  if (line) { c.fillText(line, x, y); y += lh; }
  return y;
}

export function postcardNote(pile) {
  const s = pile.summary();
  if (!s.n) return 'Wish you were here!';
  const names = s.list.slice(0, 4).map(e => `${e.n > 1 ? e.n + ' ' : 'a '}${e.name.toLowerCase()}${e.n > 1 && !/s$/.test(e.name) ? 's' : ''}`);
  const more = s.list.length > 4 ? ` and ${s.list.length - 4} more things` : '';
  const top = s.matList[0];
  return `Wish you were here! Today I fed ${names.join(', ')}${more} into the Shred Hole. ${fmtKg(s.kg)} in all, ${s.pieces.toLocaleString()} pieces, mostly ${top ? top.label.toLowerCase() : 'stuff'}. It all went through the vortex portal.`;
}

export async function renderPostcard(pile, { url = '', to = '', note = '', bill = 0 } = {}) {
  const W = 1800, H = 1200, s = pile.summary();
  const toBlob = (cv) => new Promise(res => cv.toBlob(b => res(b), 'image/png'));
  // ---- front
  const f = document.createElement('canvas'); f.width = W; f.height = H;
  const c = f.getContext('2d');
  c.fillStyle = '#f3ead4'; c.fillRect(0, 0, W, H);                      // the card's cream border
  const B = 44;
  c.save(); roundRect(c, B, B, W - 2 * B, H - 2 * B, 18); c.clip();
  if (s.pieces) { const h = renderHeap(pile.pieces, W - 2 * B, H - 2 * B); c.fillStyle = '#20242c'; c.fillRect(B, B, W, H); c.drawImage(h.canvas, B, B + 150); }   // heap below the lettering
  else { c.fillStyle = '#20242c'; c.fillRect(B, B, W, H); }
  // a warm, slightly faded print
  const tint = c.createLinearGradient(0, B, 0, H - B); tint.addColorStop(0, 'rgba(255,170,60,0.20)'); tint.addColorStop(0.55, 'rgba(255,120,60,0.06)'); tint.addColorStop(1, 'rgba(40,10,60,0.35)');
  c.fillStyle = tint; c.fillRect(B, B, W - 2 * B, H - 2 * B);
  const vig = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  c.fillStyle = vig; c.fillRect(B, B, W - 2 * B, H - 2 * B);
  c.restore();
  // "Greetings from"
  c.save(); c.translate(W / 2, 250); c.rotate(-0.05);
  c.font = `italic 700 108px ${SERIF}`; c.textAlign = 'center';
  c.lineWidth = 10; c.strokeStyle = 'rgba(20,10,30,0.85)'; c.strokeText('Greetings from the', 0, 0);
  c.fillStyle = '#fff7e2'; c.fillText('Greetings from the', 0, 0);
  c.restore();
  // big block letters with a 3D extrude, sized to fit
  const word = 'SHRED HOLE';
  c.save(); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  let size = 330; c.font = `900 ${size}px ${BLOCK}`;
  while (c.measureText(word).width > W - 220 && size > 120) { size -= 10; c.font = `900 ${size}px ${BLOCK}`; }
  const by = 300 + size * 0.95;
  for (let d = 26; d > 0; d -= 2) { c.fillStyle = d > 4 ? '#3a1556' : '#1a0a26'; c.fillText(word, W / 2 + d, by + d); }
  const g = c.createLinearGradient(0, by - size * 0.8, 0, by);
  g.addColorStop(0, '#fff3a8'); g.addColorStop(0.45, '#ffc21a'); g.addColorStop(1, '#ff6a1a');
  c.lineWidth = 14; c.strokeStyle = '#1a0a26'; c.strokeText(word, W / 2, by);
  c.fillStyle = g; c.fillText(word, W / 2, by);
  c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,0.55)'; c.strokeText(word, W / 2 - 3, by - 3);
  c.restore();
  // ribbon
  c.save(); c.textAlign = 'center';
  const rw = 940, ry = by + 70;
  c.fillStyle = '#6b2fb0'; c.beginPath(); c.moveTo(W / 2 - rw / 2 - 40, ry); c.lineTo(W / 2 + rw / 2 + 40, ry); c.lineTo(W / 2 + rw / 2, ry + 44); c.lineTo(W / 2 + rw / 2 + 40, ry + 88); c.lineTo(W / 2 - rw / 2 - 40, ry + 88); c.lineTo(W / 2 - rw / 2, ry + 44); c.closePath(); c.fill();
  c.fillStyle = '#f3ead4'; c.font = `800 46px ${BLOCK}`; c.fillText('VORTEX PORTAL  ·  SHRED POST  ·  EST. 2026', W / 2, ry + 62);
  c.restore();
  // stat line at the bottom of the picture
  c.save(); c.font = `italic 600 44px ${SERIF}`; c.textAlign = 'center';
  const stat = s.n ? `${s.n} thing${s.n === 1 ? '' : 's'} · ${fmtKg(s.kg)} · ${s.pieces.toLocaleString()} pieces · ${pile.started.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}` : 'Nothing shredded yet';
  c.lineWidth = 8; c.strokeStyle = 'rgba(10,5,20,0.8)'; c.strokeText(stat, W / 2, H - B - 46);
  c.fillStyle = '#fff7e2'; c.fillText(stat, W / 2, H - B - 46);
  c.restore();

  // ---- back
  const k = document.createElement('canvas'); k.width = W; k.height = H;
  const b = k.getContext('2d');
  b.fillStyle = '#f6efdc'; b.fillRect(0, 0, W, H);
  const rnd = rng(H * 7 + s.pieces);                                     // paper grain
  for (let i = 0; i < 2600; i++) { b.fillStyle = `rgba(120,90,40,${0.02 + rnd() * 0.04})`; b.fillRect(rnd() * W, rnd() * H, 2, 2); }
  b.strokeStyle = '#c9b48a'; b.lineWidth = 3; b.strokeRect(24, 24, W - 48, H - 48);
  b.fillStyle = '#7a6a4a'; b.font = `700 46px ${SERIF}`; b.textAlign = 'center'; b.fillText('P O S T   C A R D', W / 2, 112); b.textAlign = 'left';
  b.font = `500 22px ${SERIF}`; b.fillStyle = '#9a8a6a'; b.fillText('SHRED POST · CORRESPONDENCE', 70, 112);
  b.strokeStyle = '#b9a47a'; b.lineWidth = 3; b.beginPath(); b.moveTo(W / 2, 170); b.lineTo(W / 2, H - 110); b.stroke();
  // message (left)
  b.fillStyle = '#23305e'; b.font = `600 50px ${HAND}`;
  let y = wrap(b, note || postcardNote(pile), 80, 240, W / 2 - 150, 66, 11);
  if (s.list.length) {
    y = Math.max(y + 10, 0);
    b.font = `600 34px ${HAND}`; b.fillStyle = '#3b4a7e';
    for (const e of s.list.slice(0, Math.max(0, Math.min(5, Math.floor((H - 210 - y) / 46))))) { b.fillText(`${e.icon} ${e.n > 1 ? e.n + ' × ' : ''}${e.name} — ${fmtKg(e.kg)}`, 96, y); y += 46; }
  }
  // made-of strip along the bottom left
  if (s.matList.length) {
    const bx = 80, bw = W / 2 - 150, byy = H - 170;
    b.fillStyle = '#7a6a4a'; b.font = `700 22px ${SERIF}`; b.fillText('MADE OF', bx, byy - 14);
    roundRect(b, bx, byy, bw, 26, 8); b.save(); b.clip();
    let x = bx; for (const m of s.matList) { const w = bw * m.frac; b.fillStyle = MAT_COLOR[m.k] || '#888'; b.fillRect(x, byy, w + 1, 26); x += w; }
    b.restore();
    b.fillStyle = '#5a4a2a'; b.font = `500 22px ${SERIF}`;
    b.fillText(s.matList.slice(0, 4).map(m => `${pct(m.frac)} ${m.label}`).join(' · '), bx, byy + 58);
  }
  // stamp (top right)
  const sx = W - 330, sy = 150, sw = 230, sh = 270;
  b.save();
  b.fillStyle = '#fffaf0'; b.fillRect(sx - 12, sy - 12, sw + 24, sh + 24);
  b.fillStyle = '#f6efdc'; for (let i = 0; i <= 12; i++) { for (const [px, py] of [[sx - 12 + i * (sw + 24) / 12, sy - 12], [sx - 12 + i * (sw + 24) / 12, sy + sh + 12]]) { b.beginPath(); b.arc(px, py, 7, 0, 7); b.fill(); } }
  for (let i = 0; i <= 14; i++) { for (const [px, py] of [[sx - 12, sy - 12 + i * (sh + 24) / 14], [sx + sw + 12, sy - 12 + i * (sh + 24) / 14]]) { b.beginPath(); b.arc(px, py, 7, 0, 7); b.fill(); } }
  const sg = b.createLinearGradient(0, sy, 0, sy + sh); sg.addColorStop(0, '#3b1d6b'); sg.addColorStop(1, '#0d2a4a');
  b.fillStyle = sg; b.fillRect(sx, sy, sw, sh);
  // a little fan on the stamp
  b.translate(sx + sw / 2, sy + 118);
  b.strokeStyle = '#ffc21a'; b.lineWidth = 6; b.beginPath(); b.arc(0, 0, 70, 0, 7); b.stroke();
  b.fillStyle = '#ffc21a';
  for (let i = 0; i < 6; i++) { b.save(); b.rotate(i * Math.PI / 3); b.beginPath(); b.ellipse(0, -34, 14, 30, 0.5, 0, 7); b.fill(); b.restore(); }
  b.beginPath(); b.arc(0, 0, 12, 0, 7); b.fillStyle = '#1a0a26'; b.fill();
  b.restore();
  b.fillStyle = '#f3ead4'; b.textAlign = 'center'; b.font = `900 34px ${BLOCK}`; b.fillText('SHRED POST', sx + sw / 2, sy + 236);
  b.font = `800 26px ${BLOCK}`; b.fillStyle = '#ffc21a'; b.fillText('42¢', sx + sw - 34, sy + 38); b.textAlign = 'left';
  // postmark, over the stamp's corner
  b.save(); b.translate(sx - 40, sy + 200); b.rotate(-0.18);
  b.strokeStyle = 'rgba(40,40,60,0.75)'; b.lineWidth = 5; b.beginPath(); b.arc(0, 0, 105, 0, 7); b.stroke();
  b.lineWidth = 3; b.beginPath(); b.arc(0, 0, 80, 0, 7); b.stroke();
  b.fillStyle = 'rgba(40,40,60,0.8)'; b.textAlign = 'center'; b.font = `800 22px ${SERIF}`;
  b.fillText('VORTEX PORTAL', 0, -20);
  b.font = `700 26px ${SERIF}`; b.fillText(pile.started.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase(), 0, 14);
  b.font = `700 22px ${SERIF}`; b.fillText(String(pile.started.getFullYear()), 0, 44);
  b.lineWidth = 5; b.strokeStyle = 'rgba(40,40,60,0.65)';
  for (let i = 0; i < 4; i++) { b.beginPath(); for (let x = 120; x < 460; x += 8) b.lineTo(x, -40 + i * 26 + Math.sin(x / 22) * 8); b.stroke(); }
  b.restore();
  // address (right)
  const ax = W / 2 + 70, aw = W / 2 - 160;
  b.strokeStyle = '#b9a47a'; b.lineWidth = 3;
  for (let i = 0; i < 4; i++) { const ly = 640 + i * 110; b.beginPath(); b.moveTo(ax, ly); b.lineTo(ax + aw, ly); b.stroke(); }
  b.fillStyle = '#23305e'; b.font = `600 58px ${HAND}`;
  b.fillText(to ? `To: ${to}` : 'To: you', ax + 10, 620);
  b.font = `600 40px ${HAND}`; b.fillStyle = '#3b4a7e';
  b.fillText('Somewhere past the vortex', ax + 10, 730);
  b.fillText('World Builder', ax + 10, 840);
  b.fillStyle = '#7a6a4a'; b.font = `500 24px ${SERIF}`;
  b.fillText(`Send your own: ${url}  ·  megazine.org`, ax, H - 130);
  if (bill) b.fillText(`Fan repair bill so far: $${bill.toLocaleString()}`, ax, H - 94);
  return { front: await toBlob(f), back: await toBlob(k) };
}
