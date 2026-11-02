// Physical properties and lattice <-> SI conversion.

// rho in kg/m^3, nu (kinematic viscosity) in m^2/s
export const FLUIDS = {
  air: { name: 'Air · 20 °C, sea level', rho: 1.204, nu: 1.516e-5 },
  air10k: { name: 'Air · 10 km altitude', rho: 0.414, nu: 3.53e-5 },
  mars: { name: 'Mars atmosphere', rho: 0.020, nu: 5.4e-4 },
  helium: { name: 'Helium · 20 °C', rho: 0.166, nu: 1.18e-4 },
  water: { name: 'Water · 20 °C', rho: 998.2, nu: 1.004e-6 },
  seawater: { name: 'Seawater · 15 °C', rho: 1026, nu: 1.19e-6 },
  olive: { name: 'Olive oil', rho: 911, nu: 9.0e-5 },
  glycerin: { name: 'Glycerin', rho: 1260, nu: 1.18e-3 },
  honey: { name: 'Honey', rho: 1420, nu: 7.0e-3 },
};

// Densities in kg/m^3. "Effective" values fold real thin-shell / thin-sheet mass into the
// drawn cross-section so that mass per unit span matches the real object.
export const MATERIALS = {
  aluminum: { name: 'Aluminium', rho: 2700, color: [0.70, 0.74, 0.79] },
  steel: { name: 'Steel', rho: 7850, color: [0.55, 0.58, 0.62] },
  lead: { name: 'Lead', rho: 11340, color: [0.42, 0.44, 0.48] },
  gold: { name: 'Gold', rho: 19300, color: [0.95, 0.75, 0.25] },
  abs: { name: 'ABS plastic', rho: 1050, color: [0.86, 0.28, 0.22] },
  pine: { name: 'Pine wood', rho: 500, color: [0.78, 0.60, 0.38] },
  balsa: { name: 'Balsa', rho: 160, color: [0.90, 0.80, 0.60] },
  cork: { name: 'Cork', rho: 240, color: [0.70, 0.52, 0.36] },
  foam: { name: 'EPS foam', rho: 30, color: [0.93, 0.93, 0.90] },
  ceramic: { name: 'Ceramic', rho: 2400, color: [0.88, 0.90, 0.92] },
  ice: { name: 'Ice', rho: 917, color: [0.75, 0.88, 0.98] },
  duckrubber: { name: 'Hollow rubber (duck)', rho: 110, color: [1.0, 0.82, 0.12] },
  banana: { name: 'Banana', rho: 950, color: [0.98, 0.86, 0.30] },
  croissant: { name: 'Pastry', rho: 260, color: [0.86, 0.60, 0.28] },
  bird: { name: 'Bird (effective)', rho: 600, color: [0.55, 0.45, 0.38] },
  fish: { name: 'Fish', rho: 1050, color: [0.55, 0.70, 0.78] },
  card: { name: 'Card stock (thin sheet, effective)', rho: 170, color: [0.95, 0.95, 0.92] },
  leaf: { name: 'Leaf (thin, effective)', rho: 90, color: [0.42, 0.68, 0.30] },
  pingpong: { name: 'Celluloid shell (ping-pong, effective)', rho: 80, color: [0.98, 0.62, 0.20] },
};

// Mount types: which degrees of freedom are free.
export const MOUNTS = {
  fixed: { name: 'Fixed (force balance)' },
  pivot: { name: 'Pivot (free to rotate)' },
  motor: { name: 'Motor (driven spin)' },
  spring: { name: 'Spring mount (heave + pitch)' },
  free: { name: 'Free flight (3-DOF)' },
};

export const GRAVITY = {
  off: { name: 'Off', g: [0, 0] },
  down: { name: 'Down (horizontal tunnel)', g: [0, -9.81] },
  up: { name: 'Against flow (vertical tunnel)', g: [-9.81, 0] },
};

// Map physical tunnel settings to lattice parameters.
// The lattice inlet speed is capped at U_LB_MAX (lattice Mach ≈ 0.087) and lowered for very
// viscous flows so that the relaxation time stays in the stable, accurate range. A low
// lattice Mach number also keeps the (artificially slow) lattice sound waves away from
// vortex-shedding frequencies, which would otherwise lock onto transverse acoustic modes
// of the tunnel.
export const U_LB_MAX = 0.05;
export function latticeScale({ U, nu, H, gridH }) {
  const dx = H / gridH;
  const Ulb = Math.max(1e-4, Math.min(U_LB_MAX, 0.25 * U * dx / nu));
  const dt = Ulb * dx / Math.max(U, 1e-9);
  const nulb = nu * dt / (dx * dx);
  return { dx, dt, Ulb, nulb, tau: 3 * nulb + 0.5 };
}

export function fmt(v, digits = 3) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return v.toPrecision(digits);
}

export function fmtSI(v, unit) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  const pre = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ']];
  for (const [s, p] of pre) if (a >= s * 0.9999 || s === 1e-6) return (v / s).toPrecision(3) + ' ' + p + unit;
  return v.toPrecision(3) + ' ' + unit;
}
