// Physical constants and the tunnel's dimensions (SI units throughout: m, kg, s).
export const RHO = 1.204;       // air density, kg/m^3 (20 °C)
export const NU = 1.516e-5;     // kinematic viscosity, m^2/s
export const G = 9.81;

// The tunnel stands vertically. Physics runs in a "tube frame": x runs DOWN the tube axis
// (intake at x = 0 at the top, exit at x = L), gravity is +x, and the floor with the portal is the
// plane x = groundX. The renderer rotates this frame upright (world y = groundX − x).
// The plant is built at S × the original design (a 4.8 m tube): about 14 m across and 36 m tall,
// big enough for cars and buses. TUN0/FAN0 are the original 1× numbers; the visual builders draw
// at 1× inside groups scaled by S, physics uses the scaled TUN/FAN below.
export const S = 3;
export const TUN0 = { R: 2.4, L: 12, y0: 0, fanX: 10.4, groundX: 15.4, wall: 0.1 };
export const TUN = {
  R: TUN0.R * S,          // tube inner radius (7.2 m)
  L: TUN0.L * S,          // tube length (36 m)
  y0: 0,                  // tube axis offset (axis passes through y = z = 0)
  fanX: TUN0.fanX * S,    // fan disc position
  groundX: TUN0.groundX * S,   // the floor (and the portal in it)
  wall: TUN0.wall * S,
};
export const PORTAL0 = { R: 3.4 };
export const PORTAL = { R: PORTAL0.R * S };

export const FAN0 = { Rtip: 2.3, Rhub: 0.55, zone: 0.28 };
export const FAN = {
  blades: 6,
  Rtip: FAN0.Rtip * S,    // 6.9 m blades
  Rhub: FAN0.Rhub * S,
  // six hollow ~320 kg blades (S² the mass, S² the lever arm): a big flywheel, but a car visibly
  // bogs it down and a bus can stop it
  I: 420 * S ** 4,
  Pmax: 1.2e6 * S ** 2,   // motor power, W: same air speed through S² the area (~11 MW)
  Tmax: 32000 * S ** 3,   // motor stall torque, N m
  omegaMax: 48 / S,       // rad/s at full power (~150 rpm): the same 110 m/s tip speed
  pitch: 32 * Math.PI / 180,  // blade angle used for the push direction
  restitution: 0.25,
  zone: FAN0.zone * S,    // half-thickness of the swept blade disc (axial)
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
