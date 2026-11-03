// Pile Cam: the far end of the vortex portal, in a split view next to the tunnel.
//
// This is World Builder's Shred Pile (CrumpLabSandbox/Worldbuilder, src/shredPile.js) ported
// to stand alone. It reads the same mailbox, uses the same constants and seeds each drop's
// layout from its id, so the heap matches Matt's pile piece for piece, minus his planet around it.
// New drops fall out of the sky portal as they arrive; your own drops are shown straight away.
// Alternatively the pane can show a live World Builder (iframe) when one is reachable.
import { inflateDrop } from './dropcodec.js';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEG = Math.PI / 180;
const PILE_R = 64;
const CELLS = 64, CELL = (PILE_R * 2) / CELLS;
const REPOSE = Math.tan(38 * DEG);
const PORTAL_ALT = 150, PORTAL_R = 28;
const GRAV = 9.81 * 2.2;
const POLL = 8, POLL_MAX = 120;  // the pile naps: checks back off to every two minutes when nothing arrives
                                 // (your own drops are shown straight away, without asking the mailbox)
const SCALE = 10;                // pieces arrive big, but not instant-mountain big
const COMPACT_AT = 32;           // heap height (m) that brings the compactor
const BALE_SQUASH = 0.22;        // a bale keeps ~22% of the heap's loose volume

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.canvas = cv;
  return t;
}
const portalMaterial = (uniforms) => new THREE.ShaderMaterial({
  uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    varying vec2 vUv; uniform float uTime; uniform float uPulse;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    void main(){
      vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
      float a = atan(p.y, p.x);
      float sw = a - 3.2 / (r + 0.18) + uTime * 1.4;
      float arms = 0.5 + 0.5 * sin(sw * 4.0 + noise(vec2(sw * 1.5, r * 6.0 - uTime)) * 3.0);
      float fil = noise(vec2(cos(sw) * 3.0 + uTime * 0.3, r * 9.0 - uTime * 1.2));
      vec3 deep = vec3(0.06, 0.0, 0.14), violet = vec3(0.55, 0.12, 1.0), cyan = vec3(0.2, 0.95, 1.0);
      vec3 c = mix(deep, violet, arms * smoothstep(1.0, 0.25, r));
      c = mix(c, cyan, pow(arms * fil, 3.0) * smoothstep(0.95, 0.4, r) * 1.4);
      c = mix(c, vec3(0.92, 0.98, 1.0), smoothstep(0.24, 0.0, r) * (0.6 + uPulse));
      c += (violet * 1.6 + vec3(0.3)) * smoothstep(0.82, 0.97, r) * smoothstep(1.0, 0.96, r);
      gl_FragColor = vec4(c * (1.25 + uPulse), smoothstep(1.0, 0.94, r));
    }`,
});

function pieceGeometry(pc, scale) {
  const pts = [];
  for (let i = 0; i + 2 < pc.p.length; i += 3) pts.push(new THREE.Vector3(pc.p[i], pc.p[i + 1], pc.p[i + 2]));
  let ext = 0;
  for (const v of pts) ext = Math.max(ext, v.length());
  const s = Math.min(scale, 16 / Math.max(ext, 1e-3));
  for (const v of pts) v.multiplyScalar(s);
  let g;
  try { g = new ConvexGeometry(pts); } catch { return null; }
  const pos = g.attributes.position;
  if (!pos || pos.count < 12) { g.dispose(); return null; }
  g.computeBoundingSphere();
  const r = g.boundingSphere.radius, cen = g.boundingSphere.center;
  const outer = new THREE.Color(pc.c), inner = new THREE.Color(pc.i || pc.c), col = new THREE.Color(), v = new THREE.Vector3();
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = Math.min(1, v.distanceTo(cen) / (r || 1));
    col.copy(inner).lerp(outer, t * t);
    cols.set([col.r, col.g, col.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  g.computeBoundingBox();
  const sz = g.boundingBox.getSize(new THREE.Vector3());
  return { geo: g, radius: r, half: Math.min(sz.x, sz.y, sz.z) / 2, volume: sz.x * sz.y * sz.z * 0.5 };
}

export class PileCam {
  constructor(canvas, mailboxUrl) {
    this.canvas = canvas;
    this.mailbox = mailboxUrl;
    this.running = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#8fb3d9');
    scene.fog = new THREE.Fog('#a9c3df', 260, 900);
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 3000);
    this.camera.position.set(-40, 70, -175);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(40, 14, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 30; this.controls.maxDistance = 600;
    this.controls.autoRotate = true; this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; clearTimeout(this._ar); });
    this.controls.addEventListener('end', () => { clearTimeout(this._ar); this._ar = setTimeout(() => { this.controls.autoRotate = true; }, 8000); });
    scene.add(new THREE.HemisphereLight('#dfeaff', '#4d5a36', 1.1));
    const sun = new THREE.DirectionalLight('#fff3dd', 2.2);
    sun.position.set(-160, 260, -120); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 10, far: 700 });
    scene.add(sun);
    // a patch of World Builder-ish meadow
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      map: canvasTexture(512, 512, (c, w, h) => {
        c.fillStyle = '#6f8f45'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(${40 + Math.random() * 60},${90 + Math.random() * 70},${30 + Math.random() * 40},0.35)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      }), roughness: 1 }));
    ground.material.map.wrapS = ground.material.map.wrapT = THREE.RepeatWrapping; ground.material.map.repeat.set(40, 40);
    ground.receiveShadow = true; scene.add(ground);
    this._buildPile();
    this.clock = new THREE.Clock(false);
  }

  _buildPile() {
    const g = this.g = new THREE.Group(); this.scene.add(g);
    const yard = new THREE.Mesh(new THREE.CircleGeometry(PILE_R + 14, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      map: canvasTexture(512, 512, (c, w, h) => {
        const gr = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
        gr.addColorStop(0, '#2b2430'); gr.addColorStop(0.7, '#4a4038'); gr.addColorStop(1, 'rgba(90,80,70,0)');
        c.fillStyle = gr; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(${20 + Math.random() * 60},${15 + Math.random() * 40},${30 + Math.random() * 50},0.25)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      }), transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    yard.position.y = 0.3; yard.receiveShadow = true; g.add(yard);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf2b311, roughness: 0.6, flatShading: true });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x16161a, roughness: 0.6, flatShading: true });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 7, 8), i % 2 ? postMat : stripeMat);
      post.position.set(Math.cos(a) * (PILE_R + 10), 3.5, Math.sin(a) * (PILE_R + 10)); post.castShadow = true; g.add(post);
    }
    this.board = canvasTexture(1024, 640, () => {});
    const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(48, 30), new THREE.MeshStandardMaterial({ map: this.board, roughness: 0.7, side: THREE.DoubleSide }));
    boardMesh.position.set(0, 26, PILE_R + 26); boardMesh.rotation.y = Math.PI; g.add(boardMesh);
    for (const x of [-20, 20]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 26, 1.6), stripeMat); leg.position.set(x, 13, PILE_R + 26.5); g.add(leg); }
    this.log = []; this.total = { pieces: 0, kg: 0 };

    const portal = new THREE.Group(); portal.position.y = PORTAL_ALT; g.add(portal);
    this.uniforms = { uTime: { value: 0 }, uPulse: { value: 0 } };
    portal.add(new THREE.Mesh(new THREE.CircleGeometry(PORTAL_R, 96).rotateX(Math.PI / 2), portalMaterial(this.uniforms)));
    this.rimMat = new THREE.MeshStandardMaterial({ color: 0x2b0a4a, emissive: 0x9b4dff, emissiveIntensity: 1.6, metalness: 0.6, roughness: 0.3 });
    portal.add(new THREE.Mesh(new THREE.TorusGeometry(PORTAL_R + 1, 1.3, 12, 96).rotateX(Math.PI / 2), this.rimMat));
    this.runes = new THREE.Group(); portal.add(this.runes);
    const runeMat = new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0x40e0ff, emissiveIntensity: 1.3, flatShading: true });
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(2.2), runeMat);
      const a = (i / 12) * Math.PI * 2; m.position.set(Math.cos(a) * (PORTAL_R + 7), 0, Math.sin(a) * (PORTAL_R + 7)); this.runes.add(m);
    }
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(PORTAL_R * 0.8, PILE_R * 0.7, PORTAL_ALT, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x8b5cff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.beam.position.y = PORTAL_ALT / 2; g.add(this.beam);
    this.light = new THREE.PointLight(0x9b5cff, 3, 420, 1.2); this.light.position.y = PORTAL_ALT - 8; g.add(this.light);

    this.H = new Float32Array(CELLS * CELLS);
    this.pieceMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.05 });
    this.pileGroup = new THREE.Group(); g.add(this.pileGroup);
    this.seen = new Set(); this.lastAt = 0; this.first = true; this.busy = false; this.pollClock = POLL; this.pollEvery = POLL; this.napping = false;
    this.falling = []; this.arriving = []; this.pending = new Map(); this.emergeClock = 0;
    // particles
    const NP = this.NP = 1200;
    this.pPos = new Float32Array(NP * 3); this.pVel = new Float32Array(NP * 3); this.pCol = new Float32Array(NP * 3); this.pLife = new Float32Array(NP);
    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const points = new THREE.Points(this.pGeo, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    points.frustumCulled = false; g.add(points); this.pNext = 0;
    // the compactor and the brick yard
    this.bales = []; this.baleGroup = new THREE.Group(); g.add(this.baleGroup);
    this.colTop = [0, 0, 0, 0]; this.baleMoves = []; this.compacting = null;
    this.heapLog = { pieces: 0, kg: 0, colors: [], drops: 0 };
    this.press = new THREE.Group(); this.press.visible = false; g.add(this.press);
    const pressMat = new THREE.MeshStandardMaterial({ map: canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#f2b311'; c.fillRect(0, 0, w, h); c.fillStyle = '#16161a';
      for (let i = -h; i < w; i += 48) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 24, 0); c.lineTo(i + 24 + h, h); c.lineTo(i + h, h); c.fill(); }
    }), roughness: 0.5, metalness: 0.4 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(PILE_R * 1.9, 5, PILE_R * 1.9), pressMat); plate.castShadow = true; this.press.add(plate);
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xd6dbe0, metalness: 0.9, roughness: 0.25 });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const rod = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 300, 16), rodMat); rod.position.set(x * PILE_R * 0.7, 152.5, z * PILE_R * 0.7); this.press.add(rod); }
    this.drawBoard();
  }

  // ---- heap
  heightAt(x, z) {
    const fx = (x + PILE_R) / CELL - 0.5, fz = (z + PILE_R) / CELL - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, H = this.H;
    const at = (a, b) => (a < 0 || b < 0 || a >= CELLS || b >= CELLS ? 0 : H[b * CELLS + a]);
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  }
  deposit(x, z, vol, rad) {
    const H = this.H, ci = Math.floor((x + PILE_R) / CELL), cj = Math.floor((z + PILE_R) / CELL), n = Math.max(1, Math.ceil(rad / CELL));
    let wsum = 0; const cells = [];
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
      if (i < 0 || j < 0 || i >= CELLS || j >= CELLS) continue;
      const dx = (i + 0.5) * CELL - PILE_R - x, dz = (j + 0.5) * CELL - PILE_R - z, d = Math.hypot(dx, dz);
      if (d > rad + CELL) continue;
      const w = 1 - d / (rad + CELL); cells.push([j * CELLS + i, w]); wsum += w;
    }
    for (const [k, w] of cells) H[k] += (vol / (CELL * CELL)) * (w / (wsum || 1)) * 0.7;
    for (let pass = 0; pass < 3; pass++) {
      for (let j = Math.max(1, cj - n - 3); j < Math.min(CELLS - 1, cj + n + 4); j++) {
        for (let i = Math.max(1, ci - n - 3); i < Math.min(CELLS - 1, ci + n + 4); i++) {
          const k = j * CELLS + i;
          for (const kk of [k + 1, k - 1, k + CELLS, k - CELLS]) { const diff = H[k] - H[kk] - CELL * REPOSE; if (diff > 0) { H[k] -= diff / 2; H[kk] += diff / 2; } }
        }
      }
    }
  }
  settleDrop(d) {
    const rng = mulberry32(hashString(d.id));
    const cx = (rng() - 0.5) * PILE_R * 0.5, cz = (rng() - 0.5) * PILE_R * 0.5;
    const geos = [];
    for (const pc of d.pieces) {
      const pg = pieceGeometry(pc, SCALE);
      if (!pg) continue;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (6 + Math.sqrt(d.pieces.length) * 2.5);
      const x = THREE.MathUtils.clamp(cx + Math.cos(a) * r, -PILE_R * 0.9, PILE_R * 0.9), z = THREE.MathUtils.clamp(cz + Math.sin(a) * r, -PILE_R * 0.9, PILE_R * 0.9);
      const y = this.heightAt(x, z) + pg.half * 0.7;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.3, rng() * 6.3, rng() * 6.3)), new THREE.Vector3(1, 1, 1));
      geos.push(pg.geo.applyMatrix4(m));
      this.deposit(x, z, pg.volume, pg.radius);
    }
    this.addMerged(geos); this.note(d);
    this.logHeap(d); this.maybeCompact(false);
  }
  addMerged(geos) {
    if (!geos.length) return;
    const merged = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)));
    geos.forEach((x) => x.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, this.pieceMat); mesh.castShadow = mesh.receiveShadow = true;
    this.pileGroup.add(mesh);
  }
  note(d) {
    this.total.pieces += d.pieces.length; this.total.kg += d.object?.mass || 0;
    this.log.unshift(d); if (this.log.length > 20) this.log.pop();
    this.onNote?.(this.total, d);
  }
  drawBoard() {
    const c = this.board.userData.canvas.getContext('2d'), w = 1024, h = 640;
    c.fillStyle = '#f2b311'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#111'; c.lineWidth = 16; c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#111'; c.textAlign = 'center';
    c.font = '900 92px Impact, "Arial Black", sans-serif'; c.fillText('THE SHRED PILE', w / 2, 112);
    c.font = '700 30px "Arial Black", sans-serif'; c.fillText('FRESH FROM THE SHRED HOLE · VIA VORTEX PORTAL', w / 2, 158);
    c.textAlign = 'left'; c.font = '600 34px system-ui, sans-serif';
    if (!this.log.length) c.fillText('Nothing yet. Go and shred something.', 60, 260);
    this.log.slice(0, 7).forEach((d, i) => {
      const mins = Math.max(0, Math.round((Date.now() - d.at) / 60000));
      const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
      c.fillText(`${d.object.icon} ${d.object.name} — ${d.object.verdict || 'arrived'} · ${d.pieces.length} pcs · ${ago}`, 60, 240 + i * 52);
    });
    c.textAlign = 'right'; c.font = '700 26px "Arial Black", sans-serif';
    c.fillText(`${this.total.pieces.toLocaleString()} PIECES · ${this.total.kg.toFixed(1)} KG OF REAL-WORLD MASS`, w - 50, h - 40);
    c.textAlign = 'left';
    const nb = this.bales ? this.bales.length : 0;
    const tags = [nb ? `${nb} BALE${nb === 1 ? '' : 'S'} COMPACTED` : '', this.napping ? '💤 NAPPING' : ''].filter(Boolean);
    if (tags.length) c.fillText(tags.join(' · '), 50, h - 40);
    this.board.needsUpdate = true;
  }

  // ---- the compactor: a tall heap gets squashed into a bale, stacked in the brick yard
  heapMax() { let m = 0; for (const v of this.H) if (v > m) m = v; return m; }
  heapVolume() { let v = 0; for (const x of this.H) v += x; return v * CELL * CELL; }
  logHeap(d) {
    const L = this.heapLog; L.pieces += d.pieces.length; L.kg += d.object?.mass || 0; L.drops++;
    for (const c of d.colors || []) if (!L.colors.includes(c)) L.colors.push(c);
  }
  takeHeap() {
    const L = this.heapLog, info = { volume: this.heapVolume(), pieces: L.pieces, kg: L.kg, colors: L.colors.slice(0, 8), drops: L.drops };
    this.heapLog = { pieces: 0, kg: 0, colors: [], drops: 0 };
    return info;
  }
  clearHeap() {
    this.H.fill(0);
    for (const m of [...this.pileGroup.children]) { if (this.falling.some((p) => p.mesh === m)) continue; this.pileGroup.remove(m); m.geometry.dispose(); }
    this.pileGroup.scale.y = 1;
  }
  baleSlot(col) { return [[PILE_R + 34, -22], [PILE_R + 34, 22], [PILE_R + 78, -22], [PILE_R + 78, 22]][col]; }
  addBale(info, waitAtCentre) {
    const n = this.bales.length + 1;
    const side = THREE.MathUtils.clamp(Math.cbrt(info.volume * BALE_SQUASH), 6, 40);
    const col = (n - 1) % 4, [bx, bz] = this.baleSlot(col);
    const y = this.colTop[col] + side / 2; this.colTop[col] += side;
    const tex = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#2a2622'; c.fillRect(0, 0, w, h);
      const cols = info.colors.length ? info.colors : ['#888888', '#aa8866', '#666666'];
      const rnd = mulberry32(n * 7919 + 13);
      for (let i = 0; i < 420; i++) {
        c.fillStyle = cols[Math.floor(rnd() * cols.length)]; c.globalAlpha = 0.55 + rnd() * 0.45;
        const x = rnd() * w, yy = rnd() * h, bw = 6 + rnd() * 30, bh = 3 + rnd() * 10;
        c.save(); c.translate(x, yy); c.rotate((rnd() - 0.5) * 0.7); c.fillRect(-bw / 2, -bh / 2, bw, bh); c.restore();
      }
      c.globalAlpha = 1; c.fillStyle = '#15171a';
      for (const yy of [0.3, 0.7]) c.fillRect(0, h * yy - 4, w, 8);
      c.fillStyle = '#f2b311'; c.fillRect(w - 92, h - 40, 84, 30);
      c.fillStyle = '#111'; c.font = '900 20px Impact, sans-serif'; c.fillText(`BALE ${n}`, w - 86, h - 18);
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(side, side, side), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true; mesh.rotation.y = (mulberry32(n)() - 0.5) * 0.25;
    this.baleGroup.add(mesh);
    const target = new THREE.Vector3(bx, y, bz);
    if (waitAtCentre) mesh.position.set(0, side / 2, 0); else mesh.position.copy(target);
    this.bales.push({ n, side, target, ...info });
    return mesh;
  }
  maybeCompact(animate) {
    if (this.compacting || this.heapMax() < COMPACT_AT) return;
    if (!animate) { const info = this.takeHeap(); this.clearHeap(); this.addBale(info, false); this.onBale?.(this.bales.length); return; }
    this.compactNow();
  }
  compactNow() {
    if (this.compacting) return;
    const top = Math.max(this.heapMax(), 8);
    this.compacting = { t: 0, top };
    this.press.visible = true; this.press.position.y = top + 90;
  }
  stepCompactor(dt) {
    for (let i = this.baleMoves.length - 1; i >= 0; i--) {
      const m = this.baleMoves[i]; m.t = Math.min(1, m.t + dt / 2.5);
      const e = m.t * m.t * (3 - 2 * m.t);
      m.mesh.position.lerpVectors(m.from, m.to, e); m.mesh.position.y += Math.sin(e * Math.PI) * 25;
      if (m.t >= 1) this.baleMoves.splice(i, 1);
    }
    const C = this.compacting; if (!C) return;
    C.t += dt;
    if (C.t < 2.6) {
      const k = C.t / 2.6, y = (C.top + 90) * (1 - k * k) + 2.5 * k * k;
      this.press.position.y = y;
      this.pileGroup.scale.y = THREE.MathUtils.clamp((y - 2.5) / C.top, 0.08, 1);
    } else if (!C.done) {
      C.done = true;
      const info = this.takeHeap(); this.clearHeap();
      C.bale = this.addBale(info, true);
      for (let k = 0; k < 140; k++) { const a = Math.random() * 6.283, r = Math.random() * PILE_R * 0.8; this.emitP(Math.cos(a) * r, 2, Math.sin(a) * r, Math.cos(a) * 14, 6 + Math.random() * 10, Math.sin(a) * 14, '#8a7a68', 2 + Math.random() * 2); }
      this.drawBoard(); this.onBale?.(this.bales.length);
    } else if (C.t < 5) {
      const k = (C.t - 3) / 2;
      if (k > 0) this.press.position.y = 2.5 + k * k * (C.top + 120);
    } else {
      this.press.visible = false;
      const b = this.bales[this.bales.length - 1];
      this.baleMoves.push({ mesh: C.bale, from: C.bale.position.clone(), to: b.target, t: 0 });
      this.compacting = null;
    }
  }

  // ---- arrivals
  // local: a drop this page just sent. It's shown now; it doesn't move the "since" mark (other
  // people's drops from just before it must still be fetched) or wake the polling up.
  arrive(d, { local = false } = {}) {
    inflateDrop(d);
    const key = d.id || `${d.at}:${d.object?.name}`;
    if (this.seen.has(key) || !Array.isArray(d.pieces)) return;
    this.seen.add(key);
    if (!local) { this.lastAt = Math.max(this.lastAt, d.at || 0); this.setPace(POLL); }
    this.note(d); this.logHeap(d); this.drawBoard();
    this.uniforms.uPulse.value = 1.5;
    const rng = mulberry32(hashString(d.id || key));
    this.pending.set(key, { geos: [], left: 0 });
    d.pieces.forEach((pc, k) => this.arriving.push({ pc, key, at: k * 0.04 + rng() * 0.3, rng }));
    this.burst(d.colors?.length ? d.colors : ['#ffffff'], 160);
  }
  emerge(dt) {
    this.emergeClock += dt;
    while (this.arriving.length && this.arriving[0].at <= this.emergeClock) {
      const { pc, key, rng } = this.arriving.shift();
      const pg = pieceGeometry(pc, SCALE);
      if (!pg) continue;
      const mesh = new THREE.Mesh(pg.geo, this.pieceMat); mesh.castShadow = true;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * PORTAL_R * 0.55;
      mesh.position.set(Math.cos(a) * r, PORTAL_ALT - 2, Math.sin(a) * r);
      if (pc.q) mesh.quaternion.set(pc.q[0], pc.q[1], pc.q[2], pc.q[3]).normalize();
      this.pileGroup.add(mesh);
      const v = pc.v || [0, -10, 0];
      const vel = new THREE.Vector3(v[0] * 1.5 - Math.sin(a) * 8, Math.min(-4, v[1] * 1.2), v[2] * 1.5 + Math.cos(a) * 8);
      this.falling.push({ mesh, vel, axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), spin: 1 + rng() * 5, half: pg.half, radius: pg.radius, volume: pg.volume, key });
      this.pending.get(key).left++;
    }
    if (!this.arriving.length) this.emergeClock = 0;
  }
  fall(dt) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const p = this.falling[i], m = p.mesh;
      p.vel.y -= GRAV * dt; p.vel.multiplyScalar(Math.exp(-0.15 * dt));
      m.position.addScaledVector(p.vel, dt); m.rotateOnAxis(p.axis, p.spin * dt);
      const rr = Math.hypot(m.position.x, m.position.z);
      if (rr > PILE_R * 0.92) { m.position.x *= PILE_R * 0.92 / rr; m.position.z *= PILE_R * 0.92 / rr; p.vel.x *= -0.3; p.vel.z *= -0.3; }
      const floor = this.heightAt(m.position.x, m.position.z) + p.half * 0.7;
      if (m.position.y <= floor) {
        if (p.vel.y < -14 && !p.bounced) { p.bounced = true; m.position.y = floor; p.vel.y *= -0.25; p.vel.x *= 0.5; p.vel.z *= 0.5; p.spin *= 0.6; this.puff(m.position, 10); continue; }
        m.position.y = floor;
        this.deposit(m.position.x, m.position.z, p.volume, p.radius);
        this.falling.splice(i, 1);
        const pend = this.pending.get(p.key);
        m.updateMatrix(); pend.geos.push(m.geometry.clone().applyMatrix4(m.matrix));
        this.pileGroup.remove(m); m.geometry.dispose();
        if (--pend.left <= 0 && !this.arriving.some((a) => a.key === p.key)) { this.addMerged(pend.geos); this.pending.delete(p.key); this.maybeCompact(true); }
      }
    }
  }
  emitP(x, y, z, vx, vy, vz, color, life) {
    const i = this.pNext; this.pNext = (this.pNext + 1) % this.NP;
    this.pPos.set([x, y, z], i * 3); this.pVel.set([vx, vy, vz], i * 3); this.pLife[i] = life;
    const c = new THREE.Color(color); this.pCol.set([c.r, c.g, c.b], i * 3);
  }
  burst(colors, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, r = Math.random() * PORTAL_R * 0.8;
      this.emitP(Math.cos(a) * r, PORTAL_ALT - 1, Math.sin(a) * r, -Math.sin(a) * 6 + (Math.random() - 0.5) * 4, -Math.random() * 6, Math.cos(a) * 6 + (Math.random() - 0.5) * 4, colors[k % colors.length], 9 + Math.random() * 5);
    }
  }
  puff(p, n) { for (let k = 0; k < n; k++) this.emitP(p.x, p.y, p.z, (Math.random() - 0.5) * 10, Math.random() * 7, (Math.random() - 0.5) * 10, '#8a7a68', 1.5 + Math.random()); }
  stepParticles(dt) {
    const { pPos, pVel, pLife } = this;
    for (let i = 0; i < this.NP; i++) {
      if (pLife[i] <= 0) { pPos[i * 3 + 1] = -1e4; continue; }
      pLife[i] -= dt; pVel[i * 3 + 1] -= 3 * dt;
      for (let k = 0; k < 3; k++) { pVel[i * 3 + k] *= Math.exp(-0.6 * dt); pPos[i * 3 + k] += pVel[i * 3 + k] * dt; }
      const fl = this.heightAt(pPos[i * 3], pPos[i * 3 + 2]) + 0.4;
      if (pPos[i * 3 + 1] < fl) { pPos[i * 3 + 1] = fl; pVel[i * 3] = pVel[i * 3 + 1] = pVel[i * 3 + 2] = 0; }
    }
    this.pGeo.attributes.position.needsUpdate = true; this.pGeo.attributes.color.needsUpdate = true;
  }

  // ---- mailbox
  async poll() {
    if (this.busy || !this.mailbox) return;
    this.busy = true;
    try {
      const r = await fetch(`${this.mailbox}?since=${this.first ? 0 : this.lastAt}`, { cache: 'no-store' });   // a plain GET: no CORS preflight
      if (r.ok) {
        const j = await r.json();
        const got = (Array.isArray(j.drops) ? j.drops : []).map(inflateDrop).sort((a, b) => a.at - b.at);
        let fresh = 0;
        for (const d of got) {
          const key = d.id || `${d.at}:${d.object?.name}`;
          if (this.seen.has(key) || !Array.isArray(d.pieces)) continue;
          fresh++;
          if (this.first) { this.seen.add(key); this.lastAt = Math.max(this.lastAt, d.at || 0); this.settleDrop(d); }
          else this.arrive(d);
        }
        if (this.first) this.drawBoard();
        else this.setPace(fresh ? POLL : Math.min(POLL_MAX, this.pollEvery * 1.5));
        this.first = false;
      }
    } catch { /* offline: try again next time */ }
    this.busy = false;
  }

  setPace(sec) {
    this.pollEvery = sec;
    const nap = sec >= 30;
    if (nap !== this.napping) { this.napping = nap; this.onNap?.(); this.drawBoard(); }
  }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  start() {
    if (this.running) return;
    this.running = true; this.resize(); this.clock.start();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.t = (this.t || 0) + dt;
      this.uniforms.uTime.value = this.t;
      this.uniforms.uPulse.value *= Math.exp(-1.5 * dt);
      this.runes.rotation.y = this.t * 0.25;
      this.runes.children.forEach((m, i) => { m.rotation.x = this.t + i; m.position.y = Math.sin(this.t * 1.3 + i) * 3; });
      this.rimMat.emissiveIntensity = 1.4 + 0.4 * Math.sin(this.t * 2) + this.uniforms.uPulse.value;
      this.light.intensity = 3 + 2 * this.uniforms.uPulse.value;
      this.beam.material.opacity = 0.04 + 0.05 * this.uniforms.uPulse.value;
      this.pollClock += dt;
      if (this.pollClock >= this.pollEvery && !document.hidden) { this.pollClock = 0; this.poll(); }
      if (this.arriving.length) this.emerge(dt);
      if (this.falling.length) this.fall(dt);
      this.stepCompactor(dt);
      this.stepParticles(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
  stop() { this.running = false; this.clock.stop(); }
  // look up at the portal while something is coming through, then settle back
  watchArrival() {
    if (!this.controls.autoRotate) return;
    this.controls.target.lerp(new THREE.Vector3(0, 60, 0), 0.5);
  }
}
