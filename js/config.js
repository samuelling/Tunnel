// Physical constants and the tunnel's dimensions (SI units throughout: m, kg, s).
export const RHO = 1.204;       // air density, kg/m^3 (20 °C)
export const NU = 1.516e-5;     // kinematic viscosity, m^2/s
export const G = 9.81;

export const TUN = {
  R: 2.4,          // tube inner radius
  L: 18,           // tube length (intake at x = 0, exit at x = L)
  y0: 3.0,         // height of the tube axis
  fanX: 16.0,      // fan disc position
  wall: 0.1,
};

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

export const BEAUFORT = [
  [0.5, 'Calm'], [1.6, 'Light air'], [3.4, 'Light breeze'], [5.5, 'Gentle breeze'],
  [8.0, 'Moderate breeze'], [10.8, 'Fresh breeze'], [13.9, 'Strong breeze'], [17.2, 'Near gale'],
  [20.8, 'Gale'], [24.5, 'Strong gale'], [28.5, 'Storm'], [32.7, 'Violent storm'], [1e9, 'Hurricane force'],
];
export function beaufort(u) {
  for (let i = 0; i < BEAUFORT.length; i++) if (u < BEAUFORT[i][0]) return { n: i, name: BEAUFORT[i][1] };
  return { n: 12, name: 'Hurricane force' };
}
