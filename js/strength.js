// How breakable is a thing? A contest between the object and the blade.
//
// Every object has two numbers, worked out from its parts' materials, its size and its mass
// (no hand-tuned toughness):
//
//  • E_break: energy needed to split it, E = Γ · A. Here Γ is the material's effective work of
//    fracture (J/m²), including the plastic and frictional losses around the crack, and A is the
//    fracture area: the smallest cross-section of a solid, or perimeter × wall for a hollow
//    shell. Hollowness comes from density. The real mass divided by the hull volume, against the
//    material's density, gives the solid fraction f, and from that an equivalent wall thickness
//    t = f·V/S. An 85 kg fridge in 0.9 m³ of steel works out to ~2 mm walls, which is right.
//
//  • F_need: the force the blade edge needs to cut into it, F = σ · fill · w · d. Here σ is the
//    material's crushing strength, fill is how much of the contact zone is solid, w is the blade
//    edge width and d is the engagement depth. Hollow and soft things need little force; solid
//    stone and solid steel need a lot.
//
// The blade has limits too: it starts to bend at F_y and snaps at F_u (a hollow 6.9 m blade,
// root section ≈ 0.4 × 0.05 m, hit about a metre out). On each strike the peak force is
//    F = min(F_imp, F_need),   with F_imp = (1+e)·m_eff·v² / d  (the impulse over the contact time d/v).
//  • F_need ≤ F_u: the blade can cut it, so it breaks if E ≥ E_break. Anything above F_y on the
//    way bends the blade.
//  • F_need > F_u: the object is stronger than the blade. It can't be cut, whatever the energy.
//    The blade takes the damage, and the thing bounces, wedges, or jams the rotor.

// rho kg/m³ · G (Γ) J/m² · sigma Pa. Orders of magnitude, rounded.
export const MAT_PHYS = {
  glass:   { rho: 2500, G: 3e3,   sigma: 50e6 },   // brittle; tensile-limited
  ceramic: { rho: 2400, G: 1.5e4, sigma: 60e6 },   // porcelain, earthenware
  stone:   { rho: 2700, G: 5e4,   sigma: 150e6 },  // granite-ish
  metal:   { rho: 7800, G: 3e5,   sigma: 250e6 },  // mild steel / aluminium sheet and sections
  chrome:  { rho: 7800, G: 3e5,   sigma: 250e6 },
  steel:   { rho: 7850, G: 6e5,   sigma: 600e6 },  // hardened / tool steel, armour plate
  iron:    { rho: 7200, G: 2e4,   sigma: 400e6 },  // cast iron: strong in compression, brittle
  wood:    { rho: 600,  G: 6e4,   sigma: 15e6 },   // across the grain
  plastic: { rho: 1100, G: 3e4,   sigma: 40e6 },
  rubber:  { rho: 1100, G: 2e4,   sigma: 3e6 },
  fabric:  { rho: 1300, G: 1e4,   sigma: 0.5e6 },
  paper:   { rho: 800,  G: 2e3,   sigma: 5e6 },
  fruit:   { rho: 950,  G: 1.5e3, sigma: 0.4e6 },
  food:    { rho: 900,  G: 800,   sigma: 0.2e6 },
  glow:    { rho: 1100, G: 3e4,   sigma: 40e6 },
};

export const BLADE = {
  // the 3× plant's 6.9 m blades: S² the section, so S² the strength
  Fy: 2.5e5 * 9,  // N — onset of bending
  Fu: 6.0e5 * 9,  // N — the blade snaps
  edge: 0.06,     // m — leading-edge width that does the cutting
};

// built = buildObject(recipe) result (parts carry hull volume, material and points about the COM)
export function strengthOf(recipe, built) {
  let V = 0, rho = 0, G = 0, sig = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of built.parts) {
    const m = MAT_PHYS[p.matKind] || MAT_PHYS.plastic, v = Math.max(p.volume, 1e-9);
    V += v; rho += v * m.rho; G += v * m.G; sig += v * m.sigma;
    for (const q of p.points) {
      const x = q.x + p.center.x, y = q.y + p.center.y, z = q.z + p.center.z;
      if (x < lo[0]) lo[0] = x; if (y < lo[1]) lo[1] = y; if (z < lo[2]) lo[2] = z;
      if (x > hi[0]) hi[0] = x; if (y > hi[1]) hi[1] = y; if (z > hi[2]) hi[2] = z;
    }
  }
  rho /= V; G /= V; sig /= V;
  const dims = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map(v => Math.max(v, 1e-3)).sort((a, b) => b - a);
  const [a, b, c] = dims;
  const f = Math.min(1, Math.max(0.002, recipe.mass / V / rho));       // solid fraction
  const S = 2 * (a * b + b * c + c * a);
  const t = Math.min(c / 2, f * V / S);                                 // equivalent wall thickness
  const A = 0.8 * Math.min(b * c, 2 * (b + c) * t);                     // fracture area
  const Ebreak = G * A;
  const d = Math.max(0.02, Math.min(0.4, c / 2));                       // engagement depth (the big blades bite up to 0.4 m)
  const fill = Math.max(f, Math.min(1, 2 * t / d));
  const Fneed = sig * fill * BLADE.edge * d;
  return { Ebreak, Fneed, d, f, t, G, sigma: sig, dims };
}

// strength of a fragment, scaled from its parent: fracture area ∝ size², cutting force ∝ size
export function scaleStrength(s, massRatio) {
  const k = Math.max(0.02, massRatio);
  return { ...s, Ebreak: s.Ebreak * Math.pow(k, 2 / 3), Fneed: s.Fneed * Math.pow(k, 1 / 3), d: Math.max(0.02, s.d * Math.pow(k, 1 / 3)) };
}

export const fmtForce = (F) => F >= 1e6 ? `${(F / 1e6).toFixed(1)} MN` : F >= 1e3 ? `${(F / 1e3).toFixed(0)} kN` : `${F.toFixed(0)} N`;
