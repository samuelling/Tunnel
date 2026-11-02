// Aerodynamic loads on rigid bodies.
//
// Bluff bodies use a panel model: each surface facet feels Newtonian impact pressure on its
// windward side (∝ ρ (w·n)²), separated-wake suction on its leeward side and skin friction.
// Summing facet forces at their own positions gives drag, side force and — importantly — the
// torques that make things tumble, weathercock and autorotate. Constants are tuned so a flat
// plate face-on has C_D ≈ 1.1–1.2 and a sphere ≈ 0.6.
//
// Thin flat things (cards, paper planes, pizza slices…) use a quasi-steady flat-plate model
// in the spirit of Andersen, Pesavento & Wang (J. Fluid Mech. 2005): normal-force coefficient
// C_N(α), centre of pressure sliding from quarter-chord (α→0) to mid-chord (α=90°), and
// rotational damping. That combination is what produces fluttering and tumbling.
//
// Spinning round bodies add a Magnus force; everything gets buoyancy (ρ V g).
import { RHO, G } from './config.js';

const CN = 0.5, CB = 0.12, CF = 0.006;

// Turn a triangle soup (body frame) into ≤ ~maxN area-weighted panels by merging facets that
// share a similar normal and octant.
export function makePanels(pos, center = [0, 0, 0], q = 2) {
  const buckets = new Map();
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3] - ax, by = pos[i + 4] - ay, bz = pos[i + 5] - az;
    const cx = pos[i + 6] - ax, cy = pos[i + 7] - ay, cz = pos[i + 8] - az;
    let nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    const dbl = Math.hypot(nx, ny, nz);
    if (dbl < 1e-12) continue;
    const A = dbl / 2; nx /= dbl; ny /= dbl; nz /= dbl;
    const mx = ax + (bx + cx) / 3, my = ay + (by + cy) / 3, mz = az + (bz + cz) / 3;
    const key = `${Math.round(nx * q)},${Math.round(ny * q)},${Math.round(nz * q)},${mx > center[0] ? 1 : 0}${my > center[1] ? 1 : 0}${mz > center[2] ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) { b = [0, 0, 0, 0, 0, 0, 0]; buckets.set(key, b); }
    b[0] += mx * A; b[1] += my * A; b[2] += mz * A; b[3] += nx * A; b[4] += ny * A; b[5] += nz * A; b[6] += A;
  }
  const out = new Float32Array(buckets.size * 7);
  let j = 0;
  for (const b of buckets.values()) {
    const A = b[6], nn = Math.hypot(b[3], b[4], b[5]) || 1;
    // effective area keeps the projected area of the merged group
    out.set([b[0] / A, b[1] / A, b[2] / A, b[3] / nn, b[4] / nn, b[5] / nn, nn], j); j += 7;
  }
  return out;
}

const tmp = new Float32Array(4), tb = new Float32Array(4);

function rotate(q, x, y, z, o) {   // rotate (x,y,z) by unit quaternion q {x,y,z,w}
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  o[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  o[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  o[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return o;
}

const P = [0, 0, 0], N = [0, 0, 0];

// Returns [Fx,Fy,Fz,Tx,Ty,Tz] in world frame (about the centre of mass) for a body record.
export function aeroLoads(rec, air, t, q, v, w, out) {
  out.fill(0);
  // turbulence sampled once per body (it is coherent over the body size anyway)
  air.mean(t.x, t.y, t.z, tb);
  const tw = tb[3];
  const uc0 = tb[0], uc1 = tb[1], uc2 = tb[2];
  air.turb(t.x, t.y, t.z, tw, tmp);
  const ut0 = tmp[0], ut1 = tmp[1], ut2 = tmp[2];
  const half = 0.5 * RHO;

  const pan = rec.panels;
  if (pan) {
    for (let i = 0; i < pan.length; i += 7) {
      rotate(q, pan[i], pan[i + 1], pan[i + 2], P);
      rotate(q, pan[i + 3], pan[i + 4], pan[i + 5], N);
      const A = pan[i + 6];
      const px = t.x + P[0], py = t.y + P[1], pz = t.z + P[2];
      air.mean(px, py, pz, tmp);
      // relative air velocity at the facet: wind − (v + ω × r)
      const wx = tmp[0] + ut0 - (v.x + w.y * P[2] - w.z * P[1]);
      const wy = tmp[1] + ut1 - (v.y + w.z * P[0] - w.x * P[2]);
      const wz = tmp[2] + ut2 - (v.z + w.x * P[1] - w.y * P[0]);
      const wn = wx * N[0] + wy * N[1] + wz * N[2];
      const w2 = wx * wx + wy * wy + wz * wz;
      let fx = 0, fy = 0, fz = 0;
      if (wn < 0) { const f = -RHO * CN * A * wn * wn; fx = f * N[0]; fy = f * N[1]; fz = f * N[2]; }
      else if (w2 > 1e-8) { const f = half * CB * A * w2 * (wn / Math.sqrt(w2)); fx = f * N[0]; fy = f * N[1]; fz = f * N[2]; }
      const tx = wx - wn * N[0], ty = wy - wn * N[1], tz = wz - wn * N[2];
      const tm = Math.sqrt(tx * tx + ty * ty + tz * tz), ff = half * CF * A * tm;
      fx += ff * tx; fy += ff * ty; fz += ff * tz;
      out[0] += fx; out[1] += fy; out[2] += fz;
      out[3] += P[1] * fz - P[2] * fy; out[4] += P[2] * fx - P[0] * fz; out[5] += P[0] * fy - P[1] * fx;
    }
  }

  const pl = rec.plates;
  if (pl) {
    for (const p of pl) {
      rotate(q, p.c[0], p.c[1], p.c[2], P);
      rotate(q, p.n[0], p.n[1], p.n[2], N);
      const px = t.x + P[0], py = t.y + P[1], pz = t.z + P[2];
      air.mean(px, py, pz, tmp);
      const wx = tmp[0] + ut0 - (v.x + w.y * P[2] - w.z * P[1]);
      const wy = tmp[1] + ut1 - (v.y + w.z * P[0] - w.x * P[2]);
      const wz = tmp[2] + ut2 - (v.z + w.x * P[1] - w.y * P[0]);
      const W2 = wx * wx + wy * wy + wz * wz;
      if (W2 < 1e-6) continue;
      const W = Math.sqrt(W2);
      const wn = wx * N[0] + wy * N[1] + wz * N[2];
      const s = Math.min(1, Math.abs(wn) / W), c2 = 1 - s * s;
      const alpha = Math.asin(s);
      const CNa = 1.25 * s + 0.9 * s * c2;
      const fN = half * W2 * p.A * CNa * Math.sign(wn);
      let fx = fN * N[0], fy = fN * N[1], fz = fN * N[2];
      // in-plane flow direction; the centre of pressure sits upstream of the centre at low α
      let tx = wx - wn * N[0], ty = wy - wn * N[1], tz = wz - wn * N[2];
      const tm = Math.sqrt(tx * tx + ty * ty + tz * tz);
      let ox = 0, oy = 0, oz = 0;
      if (tm > 1e-6) {
        tx /= tm; ty /= tm; tz /= tm;
        const off = -p.chord * 0.25 * (1 - 2 * alpha / Math.PI);
        ox = tx * off; oy = ty * off; oz = tz * off;
        const ff = half * 0.03 * p.A * tm * tm;
        fx += ff * tx; fy += ff * ty; fz += ff * tz;
      }
      const rx = P[0] + ox, ry = P[1] + oy, rz = P[2] + oz;
      out[0] += fx; out[1] += fy; out[2] += fz;
      out[3] += ry * fz - rz * fy; out[4] += rz * fx - rx * fz; out[5] += rx * fy - ry * fx;
      // rotational damping of a fluttering plate (quadratic in spin rate)
      const wm = Math.hypot(w.x, w.y, w.z), kd = 0.06 * RHO * p.A * p.chord ** 3 * wm;
      out[3] -= kd * w.x; out[4] -= kd * w.y; out[5] -= kd * w.z;
    }
  }

  // Magnus lift on spinning round things
  if (rec.round) {
    const r = rec.round;
    const Wx = uc0 + ut0 - v.x, Wy = uc1 + ut1 - v.y, Wz = uc2 + ut2 - v.z;
    const W = Math.hypot(Wx, Wy, Wz), wm = Math.hypot(w.x, w.y, w.z);
    if (W > 0.05 && wm > 0.05) {
      const CL = Math.min(0.35, 0.5 * r * wm / W);
      let cx = w.y * Wz - w.z * Wy, cy = w.z * Wx - w.x * Wz, cz = w.x * Wy - w.y * Wx;
      const cm = Math.hypot(cx, cy, cz);
      if (cm > 1e-9) {
        const f = half * Math.PI * r * r * W * W * CL / cm;
        out[0] += f * cx; out[1] += f * cy; out[2] += f * cz;
      }
    }
  }
  out[1] += RHO * rec.volume * G;   // buoyancy
  return out;
}
