// Physical constants and the tunnel's dimensions (SI units throughout: m, kg, s).
export const RHO = 1.204;       // air density, kg/m^3 (20 °C)
export const NU = 1.516e-5;     // kinematic viscosity, m^2/s
export const G = 9.81;

// The tunnel stands vertically. Physics runs in a "tube frame": x runs DOWN the tube axis
// (intake at x = 0 at the top, exit at x = L), gravity is +x, and the floor with the portal is the
// plane x = groundX. The renderer rotates this frame upright (world y = groundX − x).
export const TUN = {
  R: 2.4,          // tube inner radius
  L: 12,           // tube length
  y0: 0,           // tube axis offset (axis passes through y = z = 0)
  fanX: 10.4,      // fan disc position
  groundX: 15.4,   // the floor (and the portal in it)
  wall: 0.1,
};
export const PORTAL = { R: 3.4 };

export const FAN = {
  blades: 6,
  Rtip: 2.3,
  Rhub: 0.55,
  I: 420,                 // rotor moment of inertia, kg m^2 (six ~35 kg steel blades)
  Pmax: 1.2e6,            // motor power, W
  Tmax: 32000,            // motor stall torque, N m
  omegaMax: 48,           // rad/s at full power (~460 rpm)
  pitch: 32 * Math.PI / 180,  // blade angle used for the push direction
  restitution: 0.25,
  zone: 0.28,             // half-thickness of the swept blade disc (axial)
};
// air-load coefficient so that full power balances at omegaMax: P = k w^3
FAN.kAero = FAN.Pmax / FAN.omegaMax ** 3;
// flow coefficient: mean tube speed = phi * omega * Rtip (≈ 40 m/s flat out)
FAN.phi = 40 / (FAN.omegaMax * FAN.Rtip);
// run backwards, the pitched blades move air the other way at reduced efficiency
FAN.reverseEff = 0.65;

export const BEAUFORT = [
  [0.5, 'Calm'], [1.6, 'Light air'], [3.4, 'Light breeze'], [5.5, 'Gentle breeze'],
  [8.0, 'Moderate breeze'], [10.8, 'Fresh breeze'], [13.9, 'Strong breeze'], [17.2, 'Near gale'],
  [20.8, 'Gale'], [24.5, 'Strong gale'], [28.5, 'Storm'], [32.7, 'Violent storm'], [1e9, 'Hurricane force'],
];
export function beaufort(u) {
  for (let i = 0; i < BEAUFORT.length; i++) if (u < BEAUFORT[i][0]) return { n: i, name: BEAUFORT[i][1] };
  return { n: 12, name: 'Hurricane force' };
}
