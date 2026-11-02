// Shatter a mesh into convex chunks (Voronoi-style partition of its vertices around random
// interior seeds). Each chunk is a convex hull, so it doubles as an exact Rapier collider.
// Vertex colours fade from the object's skin (surface vertices) to its insides (seed point).
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { MATERIALS } from './objects.js';

const chunkMats = new Map();
export function chunkMaterial(kind) {
  if (chunkMats.has(kind)) return chunkMats.get(kind);
  const m = MATERIALS[kind] || MATERIALS.plastic;
  const mat = m.glass
    ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.5, clearcoat: 1, depthWrite: false })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: Math.max(0.25, m.rough), metalness: m.metal * 0.85, flatShading: true });
  chunkMats.set(kind, mat);
  return mat;
}

export function shatterMesh(mesh, k, outer, inner) {
  const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index;
  const pts = [];
  const seen = new Set();
  const push = (v) => {
    const key = `${Math.round(v.x * 2000)},${Math.round(v.y * 2000)},${Math.round(v.z * 2000)}`;
    if (!seen.has(key)) { seen.add(key); pts.push(v); }
  };
  const step = Math.max(1, Math.floor(pos.count / 300));
  for (let i = 0; i < pos.count; i += step) push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix));
  // add area-weighted samples on the surface so low-poly shapes still fracture into chunky pieces
  const nt = idx ? idx.count / 3 : pos.count / 3;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const areas = new Float32Array(nt); let tot = 0;
  const vi = (t, k) => idx ? idx.getX(t * 3 + k) : t * 3 + k;
  for (let t = 0; t < nt; t++) {
    A.fromBufferAttribute(pos, vi(t, 0)); B.fromBufferAttribute(pos, vi(t, 1)); C.fromBufferAttribute(pos, vi(t, 2));
    tot += B.sub(A).cross(C.sub(A)).length() / 2; areas[t] = tot;
  }
  for (let k = 0; k < 240 && tot > 0; k++) {
    const x = Math.random() * tot;
    let lo = 0, hi = nt - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (areas[m] < x) lo = m + 1; else hi = m; }
    A.fromBufferAttribute(pos, vi(lo, 0)); B.fromBufferAttribute(pos, vi(lo, 1)); C.fromBufferAttribute(pos, vi(lo, 2));
    let u = Math.random(), w = Math.random(); if (u + w > 1) { u = 1 - u; w = 1 - w; }
    push(A.clone().addScaledVector(B.sub(A), u).addScaledVector(C.sub(A), w).applyMatrix4(mesh.matrix));
  }
  if (pts.length < 8) return [];
  const center = new THREE.Vector3();
  for (const p of pts) center.add(p);
  center.divideScalar(pts.length);
  k = Math.max(2, Math.min(k, Math.floor(pts.length / 5)));
  const seeds = [];
  for (let i = 0; i < k; i++) seeds.push(pts[(Math.random() * pts.length) | 0].clone().lerp(center, 0.25 + Math.random() * 0.5));
  const cells = seeds.map(() => []);
  for (const p of pts) {
    let best = 0, bd = Infinity;
    for (let s = 0; s < k; s++) { const d = p.distanceToSquared(seeds[s]); if (d < bd) { bd = d; best = s; } }
    cells[best].push(p);
  }
  const co = new THREE.Color(outer), ci = new THREE.Color(inner);
  const out = [];
  for (let s = 0; s < k; s++) {
    const cell = cells[s];
    if (cell.length < 3) continue;
    const sd = seeds[s];
    const ext = cell.reduce((m, p) => Math.max(m, p.distanceTo(sd)), 0);
    const j = ext * 0.08;
    const set = cell.concat([sd, sd.clone().add(new THREE.Vector3(j, 0, 0)), sd.clone().add(new THREE.Vector3(0, j, 0)), sd.clone().add(new THREE.Vector3(0, 0, j))]);
    let g;
    try { g = new ConvexGeometry(set); } catch (e) { continue; }
    const p = g.attributes.position;
    if (!p || p.count < 12) { g.dispose(); continue; }
    // centroid + volume (tetrahedra from the seed)
    let vol = 0; const cen = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i).sub(sd); b.fromBufferAttribute(p, i + 1).sub(sd); c.fromBufferAttribute(p, i + 2).sub(sd);
      const tv = Math.abs(a.dot(b.clone().cross(c))) / 6;
      vol += tv;
      cen.addScaledVector(a.clone().add(b).add(c), tv / 4);
    }
    if (vol < 1e-9) { g.dispose(); continue; }
    cen.divideScalar(vol).add(sd);
    g.translate(-cen.x, -cen.y, -cen.z);
    const cols = new Float32Array(p.count * 3);
    const sdl = sd.clone().sub(cen), tmp = new THREE.Vector3(), col = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      tmp.fromBufferAttribute(p, i);
      const t = Math.min(1, tmp.distanceTo(sdl) / (ext * 0.6 + 1e-6));
      col.copy(ci).lerp(co, t * t);
      cols.set([col.r, col.g, col.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const hp = new Float32Array(p.array);
    out.push({ geo: g, centroid: cen, volume: vol, points: hp, size: ext });
  }
  return out;
}
