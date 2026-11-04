// The Shred Hole's objects, as silhouettes for the lab's lattice-Boltzmann tunnel.
//
// The Shred Hole moves its air with a quick kinematic model (it has to run on a phone next to a
// rigid-body sim of dozens of pieces). This is the other way round: real 2D CFD, the same
// objects drawn as side-view cut-outs (flow from the left), at their real size and with a 2D
// "effective density" so the per-span mass matches the real thing:
//     mass per metre of span = mass / depth      ρ_eff = (mass / depth) / silhouette area
// Built-ins come from the Shred Hole's catalogue; anything in the Warehouse (designed by Claude)
// is fetched from the Worker on demand.
import { CATALOG, buildObject, sanitizeRecipe } from '../../js/objects.js';
import { WORKER_URL } from '../../js/settings.js';
import { MATERIALS } from './units.js';
import { canvasDraw } from './shapes.js';

export const SHRED_TUBE_H = 4.8;   // the Shred Hole's tube is 4.8 m across

// side view of a built object as a white-on-transparent canvas, plus its real dimensions
export function silhouetteOf(recipe, px = 420) {
  const built = buildObject(recipe);
  const g = built.group;
  g.updateMatrixWorld(true);
  const tris = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, m = o.matrixWorld.elements;
    const P = (i) => {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy; if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
      return [wx, wy];
    };
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      tris.push(P(a), P(b), P(c));
    }
  });
  const w = x1 - x0, h = y1 - y0, ext = Math.max(w, h) || 0.1;
  const k = px / ext, cw = Math.max(8, Math.ceil(w * k) + 8), ch = Math.max(8, Math.ceil(h * k) + 8);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.lineJoin = 'round';
  // each triangle filled on its own: one big path would let opposite windings cancel into holes
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, d] = [tris[i], tris[i + 1], tris[i + 2]];
    c.beginPath();
    c.moveTo(4 + (a[0] - x0) * k, 4 + (y1 - a[1]) * k);   // y up in the world, down on a canvas
    c.lineTo(4 + (b[0] - x0) * k, 4 + (y1 - b[1]) * k);
    c.lineTo(4 + (d[0] - x0) * k, 4 + (y1 - d[1]) * k);
    c.closePath(); c.fill(); c.stroke();   // the hairline stroke closes the seams between triangles
  }
  const data = c.getImageData(0, 0, cw, ch).data;
  let filled = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 127) filled++;
  const area = filled / (k * k);                       // m², side view
  const depth = Math.max(0.01, z1 - z0);
  const mass = +recipe.mass || 1;
  return { canvas: cv, width: w, height: h, depth, area, mass, size: ext };
}

const hex = (s) => { const m = /^#?([0-9a-f]{6})$/i.exec(s || ''); const n = m ? parseInt(m[1], 16) : 0xbbbbbb; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const mainColor = (r) => { const by = new Map(); for (const p of r.parts || []) { const v = (p.size || []).reduce((a, b) => a * Math.abs(b || 1), 1); by.set(p.color, (by.get(p.color) || 0) + v); } return [...by].sort((a, b) => b[1] - a[1])[0]?.[0] || '#bbbbbb'; };

// a library entry the lab can add like any other shape
export function shredShape(recipe, cat = 'Shred Hole') {
  const r = sanitizeRecipe(recipe);
  const s = silhouetteOf(r);
  const key = 'shred:' + (recipe.id || r.name);
  const rho = Math.max(1, (s.mass / s.depth) / Math.max(1e-6, s.area));
  MATERIALS[key] = { name: `${r.name} (effective, from ${s.mass.toPrecision(3)} kg)`, rho, color: hex(mainColor(r)) };
  return {
    id: key, name: `${r.icon || ''} ${r.name}`.trim(), cat, ref: 'frontal', mat: key, mount: 'fixed', realSize: s.size,
    info: `${s.width.toFixed(2)} × ${s.height.toFixed(2)} m side view · ${s.depth.toFixed(2)} m deep · ${s.mass.toPrecision(3)} kg · ρ_eff ${rho.toPrecision(3)} kg/m³`,
    draw: canvasDraw(s.canvas), recipe: r,
  };
}

export function catalogShape(id) { const r = CATALOG.find(x => x.id === id); return r ? shredShape(r) : null; }

export function catalogShapes() {
  const out = [];
  for (const r of CATALOG) { try { out.push(shredShape(r)); } catch (e) { /* skip one that won't build */ } }
  return out;
}

const base = () => (WORKER_URL || '').replace(/\/$/, '');
export async function warehouseList() {
  if (!base()) return [];
  try { const r = await fetch(base() + '/warehouse'); return r.ok ? (await r.json()).items || [] : []; } catch (e) { return []; }
}
export async function warehouseShape(item) {
  const r = await fetch(base() + '/warehouse/item?k=' + encodeURIComponent(item.k));
  if (!r.ok) throw new Error('not on the shelf');
  const recipe = (await r.json()).recipe;
  return shredShape({ ...recipe, id: 'wh-' + item.k }, 'Warehouse');
}
