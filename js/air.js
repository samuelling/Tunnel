// The air: a kinematic flow model of the tunnel, built from textbook pieces rather than CFD.
//  • Mean speed set by the fan (fan law: U ∝ ω), with a lag for the air column's inertia.
//  • Turbulent wall boundary layer growing from the intake lip (δ = 0.37 x Re_x^-1/5, 1/7-power
//    profile inside it, core sped up to conserve mass flow).
//  • A sink-like intake that sucks in things thrown near the bellmouth.
//  • Flow splitting around the fan hub, swirl behind the rotor, and a spreading exit jet.
//  • Free-stream turbulence as a sum of random Fourier modes that are divergence-free by
//    construction (amplitude ⟂ wavevector), with a Kolmogorov-like k^-5/6 amplitude spectrum,
//    advected with the flow (Taylor's frozen-turbulence hypothesis).
//  • With Real Air on, two corrections from the lattice-Boltzmann slice (js/realair.js): a per-body
//    nudge (wakes, drafting, shielding, jets round things) and a blockage that cuts the fan's flow.
import { TUN, FAN, NU, PORTAL } from './config.js';

export class Air {
  constructor() {
    this.U = 0;          // mean tube speed, m/s
    this.t = 0;
    this.adv = 0;        // ∫U dt, for frozen-turbulence advection
    this.TI = 0.07;      // turbulence intensity
    this.omega = 0;
    this.gust = 0;
    this.dir = 1; this.Us = 0; this.flowDir = 1;
    this.nudge = null;          // [x,y,z] m/s added to mean() while one body's loads are worked out
    this.block = 0; this.blockT = 0;   // share of the fan's flow lost to things jammed above it
    const modes = [];
    let e = 0;
    for (let i = 0; i < 14; i++) {
      const lam = 0.45 * Math.pow(9, Math.random());           // 0.45 … 4 m
      const k = 2 * Math.PI / lam;
      const th = Math.acos(2 * Math.random() - 1), ph = Math.random() * Math.PI * 2;
      const kv = [k * Math.sin(th) * Math.cos(ph), k * Math.cos(th), k * Math.sin(th) * Math.sin(ph)];
      // random amplitude direction orthogonal to k
      let a = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
      const kk = kv[0] * kv[0] + kv[1] * kv[1] + kv[2] * kv[2];
      const d = (a[0] * kv[0] + a[1] * kv[1] + a[2] * kv[2]) / kk;
      a = [a[0] - d * kv[0], a[1] - d * kv[1], a[2] - d * kv[2]];
      const an = Math.hypot(...a) || 1;
      const amp = Math.pow(k, -5 / 6);
      a = a.map(v => v / an * amp);
      e += amp * amp / 2;
      modes.push({ k: kv, a, ph: Math.random() * 6.283, w: 0.6 + Math.random() * 2.5 });
    }
    const s = 1 / Math.sqrt(e / 3);       // unit rms per velocity component
    for (const m of modes) m.a = m.a.map(v => v * s);
    this.modes = modes;
  }

  update(dt, omega) {
    this.omega = omega;
    // the blades are pitched to push air down the tube; run backwards they still move air the
    // other way, but less efficiently (reversed axial fans deliver ~60–70% of their forward flow)
    if (Math.abs(omega) > 0.3) this.dir = omega >= 0 ? 1 : -1;
    let target = FAN.phi * Math.abs(omega) * FAN.Rtip * (omega < 0 ? FAN.reverseEff : 1);
    this.block += (this.blockT - this.block) * (1 - Math.exp(-dt / 0.5));
    target *= 1 - this.block;
    if (this.gust > 0) { target *= 1 + 0.5 * Math.sin(Math.PI * (1 - this.gust / 2.5)) ** 2; this.gust = Math.max(0, this.gust - dt); }
    // the air column has to stop before it can reverse: track a signed speed, report its size
    this.Us = this.Us ?? 0;
    this.Us += (target * (this.dir || 1) - this.Us) * (1 - Math.exp(-dt / 0.6));
    this.U = Math.abs(this.Us);
    this.flowDir = this.Us >= 0 ? 1 : -1;
    this.t += dt;
    this.adv += this.Us * dt;
  }

  // Mean (ensemble-averaged) velocity at a point. Returns turbulence weight in out[3].
  // Worked out in a "stream" coordinate s that runs from the upstream lip to the downstream
  // end, so forward flow (down the tube) and reversed flow (up the tube) share one model.
  mean(x, y, z, out) {
    const R = TUN.R, L = TUN.L, U = this.U, D = this.flowDir || 1;
    const dy = y - TUN.y0, dz = z, r = Math.sqrt(dy * dy + dz * dz);
    let us = 0, uy = 0, uz = 0, tf = 0;
    if (U < 1e-4) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
    const xs = D > 0 ? x : L - x, fanS = D > 0 ? TUN.fanX : L - TUN.fanX;
    const rot = Math.sign(this.omega || 1);
    if (xs >= 0 && xs <= L) {
      if (r < R) {
        const xd = Math.max(xs, 0.05);
        const Rex = Math.max(1e3, U * xd / NU);
        const delta = Math.min(R * 0.9, 0.37 * xd * Math.pow(Rex, -0.2));
        const yw = R - r;
        const prof = yw >= delta ? 1 : Math.pow(Math.max(yw, 1e-4) / delta, 1 / 7);
        us = U * prof / (1 - 2 * (delta / 8) / R);
        tf = 1 + 1.5 * (1 - prof);
        const dxf = xs - fanS;
        if (dxf > -1.6 && dxf < 0) {               // stream splits around the hub
          const s = (dxf + 1.6) / 1.6, hub = FAN.Rhub * 1.3;
          const k = Math.exp(-((r / hub) ** 2)) * s;
          us *= 1 - 0.75 * k;
          if (r > 1e-3) { const vr = 0.55 * U * k * Math.min(1, r / hub); uy += vr * dy / r; uz += vr * dz / r; }
        } else if (dxf >= 0 && r > 1e-3) {         // swirl left behind by the rotor
          const sw = 0.28 * U * Math.min(1, r / R) * rot;
          uy += -sw * dz / r; uz += sw * dy / r; us *= 1.06; tf *= 1.6;
        }
      }
    } else if (xs < 0) {                             // intake: converging, sink-like inflow
      const cx = 0.35 * R, ddx = xs - cx, d2 = ddx * ddx + r * r, d = Math.sqrt(d2) + 1e-6;
      const mag = U * R * R / (R * R + 1.8 * d2);
      us = -ddx / d * mag; uy = -dy / d * mag; uz = -dz / d * mag;
      tf = 0.35 * mag / U;
    } else {                                         // exit jet, spreading ~12% per length
      const xe = xs - L, width = R * (1 + 0.12 * xe);
      const k = (R / width) * Math.exp(-1.5 * (r / width) ** 2);
      us = 1.1 * U * k;
      if (r > 1e-3) { const sw = 0.25 * U * k * rot; uy += -sw * dz / r; uz += sw * dy / r; }
      tf = 1.4 * k;
    }
    let ux = us * D;
    // the portal's vortex below the tube: a Lamb–Oseen-like swirl with inflow and downdraft,
    // strengthening towards the floor. Forward flow feeds it with the exit jet; in reverse it
    // only has its own (magical) strength and the tube's intake is drawing air up out of it.
    if (x > L) {
      const Uf = D > 0 ? U : 0;
      const s = Math.min(1, Math.max(0, (x - L) / (TUN.groundX - L)));
      const rc = 0.9, g = 4 + 0.25 * Uf, swirl = g * r / (r * r + rc * rc) * (0.4 + s);
      const sink = (1.5 + 0.08 * Uf) * s * Math.min(1, r / rc) * Math.exp(-((r / (PORTAL.R * 1.6)) ** 2));
      if (r > 1e-3) { uy += (-swirl * dz - sink * dy) / r; uz += (swirl * dy - sink * dz) / r; }
      ux += (2 + 0.1 * Uf) * s * Math.exp(-((r / PORTAL.R) ** 2));
    }
    const nu = this.nudge;
    if (nu) { ux += nu[0]; uy += nu[1]; uz += nu[2]; }
    out[0] = ux; out[1] = uy; out[2] = uz; out[3] = tf;
    return out;
  }

  // Turbulent fluctuation (unit-intensity field × TI × U × local weight).
  turb(x, y, z, weight, out) {
    const q = this.TI * this.U * weight;
    out[0] = out[1] = out[2] = 0;
    if (q < 1e-4) return out;
    const X = x - this.adv, t = this.t;
    for (const m of this.modes) {
      const c = Math.cos(m.k[0] * X + m.k[1] * y + m.k[2] * z + m.w * t + m.ph) * q;
      out[0] += m.a[0] * c; out[1] += m.a[1] * c; out[2] += m.a[2] * c;
    }
    return out;
  }

  vel(x, y, z, out, withTurb = true) {
    this.mean(x, y, z, out);
    if (withTurb && out[3] > 0) {
      const tf = out[3], ux = out[0], uy = out[1], uz = out[2];
      this.turb(x, y, z, tf, out);
      out[0] += ux; out[1] += uy; out[2] += uz; out[3] = tf;
    }
    return out;
  }
}
