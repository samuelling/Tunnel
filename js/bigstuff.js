// Big, weird things. Same recipe format as the rest of the catalogue (sizes in metres, y up,
// x = "front"). Masses and toughness are realistic-ish. Toughness is the blade-strike energy in
// joules needed to shatter the object. A tip strike delivers E = ½ m_eff v_t², with
// m_eff = 1/(1/m + r²/I), so the heaviest things also stall the fan: Δω = (1+e) m_eff v_t r / I.
const d = (a) => a * Math.PI / 180;

// piano keys: 3 octaves of white keys, with black keys in groups of 2 and 3
const pianoKeys = (() => {
  const out = [], W = 21, w = 1.3 / W, x0 = -0.65;
  for (let i = 0; i < W; i++) {
    if ([0, 1, 3, 4, 5].includes(i % 7) && i < W - 1) {
      out.push({ shape: 'box', size: [0.022, 0.022, 0.095], pos: [x0 + (i + 1) * w, -0.045, 0.215], color: '#111111', material: 'plastic' });
    }
  }
  return out;
})();

// vending machine snacks behind the glass, 4 rows x 4
const snacks = (() => {
  const cols = ['#ffbe0b', '#fb5607', '#3a86ff', '#8338ec', '#06d6a0', '#ff006e', '#e9c46a', '#2a9d8f'];
  const out = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    out.push({ shape: 'box', size: [0.06, 0.15, 0.1], pos: [0.36, 0.62 - r * 0.26, -0.31 + c * 0.14], color: cols[(r * 3 + c) % cols.length], material: 'paper' });
  }
  return out;
})();

// office chair: five-star base with casters
const chairBase = Array.from({ length: 5 }, (_, i) => {
  const a = i * 72, c = Math.cos(d(a)), s = Math.sin(d(a));
  return [
    { shape: 'box', size: [0.34, 0.045, 0.055], pos: [0.17 * c, 0.12, 0.17 * s], rot: [0, -a, 0], color: '#1f1f1f', material: 'plastic' },
    { shape: 'sphere', size: [0.035, 0.035, 0.035], pos: [0.33 * c, 0.06, 0.33 * s], color: '#111111', material: 'rubber' },
  ];
}).flat();

const cartLegs = [[0.34, 0.2], [0.34, -0.2], [-0.34, 0.2], [-0.34, -0.2]].flatMap(([x, z]) => [
  { shape: 'cylinder', size: [0.014, 0.014, 0.34], pos: [x, 0.27, z], color: '#b8bec6', material: 'chrome' },
  { shape: 'cylinder', size: [0.055, 0.055, 0.035], pos: [x, 0.055, z], rot: [90, 0, 0], color: '#1a1a1a', material: 'rubber' },
]);

export const BIG_STUFF = [
  { id: 'fridge', name: 'Fridge', icon: '🧊', mass: 85, toughness: 14000, spray: 'food', sound: 'clang', inner: '#e8f4ff',
    blend: 'IT BLENDS. Leftovers, redistributed.', survive: 'IT DID NOT BLEND. The light is still on.',
    fact: '85 kg of stainless steel, foam and compressor. Each blade hit takes a big bite out of the fan’s angular momentum.',
    parts: [
      { shape: 'roundbox', size: [0.66, 1.75, 0.7], radius: 0.03, color: '#c9ced4', material: 'metal' },
      { shape: 'roundbox', size: [0.06, 0.52, 0.68], radius: 0.02, pos: [0.36, 0.6, 0], color: '#d5dade', material: 'metal' },
      { shape: 'roundbox', size: [0.06, 1.16, 0.68], radius: 0.02, pos: [0.36, -0.28, 0], color: '#d5dade', material: 'metal' },
      { shape: 'capsule', size: [0.014, 0.32], pos: [0.42, 0.48, 0.27], color: '#eeeeee', material: 'chrome' },
      { shape: 'capsule', size: [0.014, 0.6], pos: [0.42, -0.02, 0.27], color: '#eeeeee', material: 'chrome' },
      { shape: 'box', size: [0.004, 0.26, 0.19], pos: [0.392, -0.12, -0.12], rot: [4, 0, 0], color: '#fffdf4', material: 'paper' },
      { shape: 'box', size: [0.004, 0.2, 0.14], pos: [0.392, -0.5, 0.06], rot: [-6, 0, 0], color: '#ffd166', material: 'paper' },
      { shape: 'sphere', size: [0.02, 0.02, 0.012], pos: [0.396, 0.01, -0.12], color: '#e63946', material: 'plastic' },
      { shape: 'sphere', size: [0.02, 0.02, 0.012], pos: [0.396, -0.41, 0.06], color: '#3a86ff', material: 'plastic' },
    ] },

  { id: 'mannequin', name: 'Mannequin', icon: '🧍', mass: 9, toughness: 900, impact: 2500, spray: 'plastic', sound: 'crack', inner: '#f3e0cc',
    blend: 'IT BLENDS. Everything must go. Everything went.', survive: 'Still posing. Deeply unsettling.',
    fact: 'A fibreglass shell about 3 mm thick. The limbs are designed to pop off at the joints, so they go first.',
    parts: [
      { shape: 'sphere', size: [0.1, 0.125, 0.1], pos: [0.01, 0.76, 0], color: '#efe3d3', material: 'plastic' },
      { shape: 'cylinder', size: [0.042, 0.05, 0.13], pos: [0, 0.62, 0], color: '#efe3d3', material: 'plastic' },
      { shape: 'torus', size: [0.065, 0.024], pos: [0, 0.58, 0], rot: [90, 0, 0], color: '#d62828', material: 'fabric' },
      { shape: 'sphere', size: [0.13, 0.3, 0.2], pos: [0, 0.3, 0], color: '#efe3d3', material: 'plastic' },
      { shape: 'sphere', size: [0.12, 0.14, 0.18], pos: [0, 0.0, 0], color: '#efe3d3', material: 'plastic' },
      { shape: 'capsule', size: [0.04, 0.55], pos: [0, 0.21, -0.25], rot: [8, 0, 0], color: '#efe3d3', material: 'plastic' },
      { shape: 'sphere', size: [0.035, 0.06, 0.03], pos: [0, -0.14, -0.31], color: '#efe3d3', material: 'plastic' },
      { shape: 'capsule', size: [0.04, 0.55], pos: [0, 0.8, 0.36], rot: [25, 0, 0], color: '#efe3d3', material: 'plastic' },
      { shape: 'sphere', size: [0.035, 0.06, 0.03], pos: [0, 1.12, 0.5], rot: [25, 0, 0], color: '#efe3d3', material: 'plastic' },
      { shape: 'capsule', size: [0.065, 0.75], pos: [0, -0.5, 0.09], color: '#efe3d3', material: 'plastic' },
      { shape: 'capsule', size: [0.065, 0.75], pos: [0, -0.5, -0.09], color: '#efe3d3', material: 'plastic' },
      { shape: 'roundbox', size: [0.24, 0.07, 0.09], radius: 0.03, pos: [0.06, -0.95, 0.09], color: '#efe3d3', material: 'plastic' },
      { shape: 'roundbox', size: [0.24, 0.07, 0.09], radius: 0.03, pos: [0.06, -0.95, -0.09], color: '#efe3d3', material: 'plastic' },
      { shape: 'cylinder', size: [0.012, 0.012, 0.1], pos: [0, -1.03, -0.09], color: '#cccccc', material: 'chrome' },
      { shape: 'cylinder', size: [0.22, 0.22, 0.02], pos: [0, -1.08, 0], color: '#cccccc', material: 'chrome' },
    ] },

  { id: 'toilet', name: 'Toilet', icon: '🚽', mass: 40, toughness: 2500, impact: 6000, spray: 'shards', sound: 'shatter', inner: '#ffffff',
    blend: 'IT BLENDS. Flushed with success.', survive: 'The porcelain throne remains seated.',
    fact: 'Vitreous china fired at about 1200 °C: very hard, very brittle, and it breaks into razor-edged shards.',
    parts: [
      { shape: 'lathe', points: [[0, 0], [0.13, 0], [0.12, 0.06], [0.16, 0.2], [0.21, 0.37], [0.2, 0.4], [0.17, 0.39], [0.06, 0.13], [0, 0.13]], pos: [0.08, 0, 0], color: '#f6f6f4', material: 'ceramic' },
      { shape: 'torus', size: [0.175, 0.025], pos: [0.08, 0.415, 0], rot: [90, 0, 0], color: '#ffffff', material: 'plastic' },
      { shape: 'cylinder', size: [0.2, 0.2, 0.02], pos: [-0.09, 0.62, 0], rot: [0, 0, 84], color: '#ffffff', material: 'plastic' },
      { shape: 'roundbox', size: [0.18, 0.4, 0.46], radius: 0.03, pos: [-0.2, 0.6, 0], color: '#f6f6f4', material: 'ceramic' },
      { shape: 'roundbox', size: [0.21, 0.04, 0.49], radius: 0.015, pos: [-0.2, 0.82, 0], color: '#f6f6f4', material: 'ceramic' },
      { shape: 'box', size: [0.06, 0.015, 0.02], pos: [-0.09, 0.75, 0.18], color: '#e0e0e0', material: 'chrome' },
    ] },

  { id: 'cart', name: 'Shopping cart', icon: '🛒', mass: 15, toughness: 6000, spray: 'sparks', sound: 'clang', inner: '#999999',
    blend: 'IT BLENDS. Cleanup on aisle fan.', survive: 'Still has one wonky wheel. Always will.',
    fact: 'Chrome-plated steel wire: it bends a long way before it breaks, and sparks when it does.',
    parts: [
      { shape: 'box', size: [0.82, 0.012, 0.52], pos: [0, 0.45, 0], color: '#b8bec6', material: 'chrome' },
      { shape: 'box', size: [0.82, 0.4, 0.012], pos: [0, 0.65, 0.26], color: '#b8bec6', material: 'chrome' },
      { shape: 'box', size: [0.82, 0.4, 0.012], pos: [0, 0.65, -0.26], color: '#b8bec6', material: 'chrome' },
      { shape: 'box', size: [0.012, 0.4, 0.52], pos: [0.41, 0.65, 0], color: '#b8bec6', material: 'chrome' },
      { shape: 'box', size: [0.012, 0.4, 0.52], pos: [-0.41, 0.65, 0], color: '#b8bec6', material: 'chrome' },
      { shape: 'cylinder', size: [0.018, 0.018, 0.58], pos: [-0.5, 0.9, 0], rot: [90, 0, 0], color: '#d62828', material: 'plastic' },
      { shape: 'box', size: [0.1, 0.014, 0.014], pos: [-0.455, 0.87, 0.24], color: '#b8bec6', material: 'chrome' },
      { shape: 'box', size: [0.1, 0.014, 0.014], pos: [-0.455, 0.87, -0.24], color: '#b8bec6', material: 'chrome' },
      { shape: 'box', size: [0.72, 0.03, 0.04], pos: [0, 0.1, 0.2], color: '#b8bec6', material: 'chrome' },
      { shape: 'box', size: [0.72, 0.03, 0.04], pos: [0, 0.1, -0.2], color: '#b8bec6', material: 'chrome' },
      ...cartLegs,
    ] },

  { id: 'chair', name: 'Office chair', icon: '🪑', mass: 14, toughness: 3000, spray: 'foam', sound: 'crunch', inner: '#ffd27f',
    blend: 'IT BLENDS. Your lumbar support has been terminated.', survive: 'Spinning faster than ever. Productivity up.',
    fact: 'The gas lift is a sealed, pressurised nitrogen spring. Please don’t try this at home.',
    parts: [
      { shape: 'roundbox', size: [0.5, 0.09, 0.5], radius: 0.035, pos: [0, 0.5, 0], color: '#2b2d42', material: 'fabric' },
      { shape: 'roundbox', size: [0.08, 0.6, 0.46], radius: 0.035, pos: [-0.26, 0.88, 0], rot: [0, 0, -8], color: '#2b2d42', material: 'fabric' },
      { shape: 'cylinder', size: [0.028, 0.028, 0.32], pos: [0, 0.3, 0], color: '#cfd3d8', material: 'chrome' },
      { shape: 'box', size: [0.28, 0.035, 0.06], pos: [0, 0.71, 0.26], color: '#1f1f1f', material: 'plastic' },
      { shape: 'box', size: [0.28, 0.035, 0.06], pos: [0, 0.71, -0.26], color: '#1f1f1f', material: 'plastic' },
      { shape: 'box', size: [0.035, 0.17, 0.035], pos: [-0.04, 0.6, 0.26], color: '#1f1f1f', material: 'plastic' },
      { shape: 'box', size: [0.035, 0.17, 0.035], pos: [-0.04, 0.6, -0.26], color: '#1f1f1f', material: 'plastic' },
      ...chairBase,
    ] },

  { id: 'couch', name: 'Couch', icon: '🛋️', mass: 55, toughness: 5000, spray: 'foam', sound: 'thunk', inner: '#ffe8b0',
    blend: 'IT BLENDS. Found $3.71 and the remote.', survive: 'The couch wins. Couches always win.',
    fact: 'Two metres of hardwood frame, springs and polyurethane foam. Its big flat sides catch the wind like a sail.',
    parts: [
      { shape: 'roundbox', size: [1.9, 0.26, 0.86], radius: 0.06, pos: [0, 0.25, 0], color: '#c1440e', material: 'fabric' },
      { shape: 'roundbox', size: [1.9, 0.52, 0.22], radius: 0.08, pos: [0, 0.62, -0.32], color: '#c1440e', material: 'fabric' },
      { shape: 'roundbox', size: [0.2, 0.36, 0.86], radius: 0.08, pos: [0.95, 0.5, 0], color: '#b23c0b', material: 'fabric' },
      { shape: 'roundbox', size: [0.2, 0.36, 0.86], radius: 0.08, pos: [-0.95, 0.5, 0], color: '#b23c0b', material: 'fabric' },
      { shape: 'roundbox', size: [0.56, 0.14, 0.62], radius: 0.05, pos: [-0.57, 0.45, 0.08], color: '#d9541a', material: 'fabric' },
      { shape: 'roundbox', size: [0.56, 0.14, 0.62], radius: 0.05, pos: [0, 0.45, 0.08], color: '#d9541a', material: 'fabric' },
      { shape: 'roundbox', size: [0.56, 0.14, 0.62], radius: 0.05, pos: [0.57, 0.45, 0.08], color: '#d9541a', material: 'fabric' },
      { shape: 'roundbox', size: [0.34, 0.34, 0.12], radius: 0.05, pos: [0.55, 0.66, -0.15], rot: [-15, 0, 10], color: '#ffd166', material: 'fabric' },
      { shape: 'box', size: [0.05, 0.022, 0.16], pos: [-0.2, 0.531, 0.2], rot: [0, 20, 0], color: '#1a1a1a', material: 'plastic' },
      { shape: 'cylinder', size: [0.03, 0.02, 0.12], pos: [0.85, 0.06, 0.35], color: '#6b4423', material: 'wood' },
      { shape: 'cylinder', size: [0.03, 0.02, 0.12], pos: [-0.85, 0.06, 0.35], color: '#6b4423', material: 'wood' },
      { shape: 'cylinder', size: [0.03, 0.02, 0.12], pos: [0.85, 0.06, -0.35], color: '#6b4423', material: 'wood' },
      { shape: 'cylinder', size: [0.03, 0.02, 0.12], pos: [-0.85, 0.06, -0.35], color: '#6b4423', material: 'wood' },
    ] },

  { id: 'clock', name: 'Grandfather clock', icon: '🕰️', mass: 70, toughness: 3500, spray: 'shards', sound: 'crunch', inner: '#c08552',
    blend: 'IT BLENDS. Time is a flat circle now.', survive: 'Still ticking. Still judging you.',
    fact: 'A pendulum about 1 m long swings from side to side once a second (T = 2π√(L/g)), which is why these clocks are so tall.',
    parts: [
      { shape: 'box', size: [0.46, 1.5, 0.3], color: '#5c3317', material: 'wood' },
      { shape: 'roundbox', size: [0.58, 0.46, 0.36], radius: 0.03, pos: [0, 0.96, 0], color: '#4a2812', material: 'wood' },
      { shape: 'box', size: [0.64, 0.07, 0.4], pos: [0, 1.22, 0], color: '#3d200e', material: 'wood' },
      { shape: 'box', size: [0.58, 0.18, 0.36], pos: [0, -0.84, 0], color: '#3d200e', material: 'wood' },
      { shape: 'cylinder', size: [0.17, 0.17, 0.02], pos: [0.185, 0.96, 0], rot: [0, 0, 90], color: '#f4ecd8', material: 'ceramic' },
      { shape: 'box', size: [0.006, 0.13, 0.014], pos: [0.2, 1.01, 0.0], color: '#111111', material: 'metal' },
      { shape: 'box', size: [0.006, 0.014, 0.1], pos: [0.2, 0.96, 0.045], color: '#111111', material: 'metal' },
      { shape: 'box', size: [0.004, 0.86, 0.24], pos: [0.233, -0.05, 0], color: '#cfe8ff', material: 'glass' },
      { shape: 'cylinder', size: [0.006, 0.006, 0.62], pos: [0.19, 0.12, 0], color: '#d4a017', material: 'chrome' },
      { shape: 'cylinder', size: [0.085, 0.085, 0.016], pos: [0.19, -0.24, 0], rot: [0, 0, 90], color: '#d4a017', material: 'chrome' },
    ] },

  { id: 'piano', name: 'Upright piano', icon: '🎹', mass: 220, toughness: 30000, spray: 'shards', sound: 'clang', inner: '#b07a4f',
    blend: 'IT BLENDS. That was a B-flat. Then a lot of B-flats.', survive: 'IT DID NOT BLEND. Slightly out of tune now.',
    fact: 'About 220 strings pulling roughly 18 tonnes in total on a cast-iron frame. Expect the fan to stall.',
    parts: [
      { shape: 'box', size: [1.5, 1.2, 0.35], pos: [0, 0, -0.12], color: '#1b1b1b', material: 'ceramic' },
      { shape: 'box', size: [1.52, 0.03, 0.37], pos: [0, 0.615, -0.12], color: '#141414', material: 'ceramic' },
      { shape: 'box', size: [1.5, 0.08, 0.3], pos: [0, -0.12, 0.2], color: '#1b1b1b', material: 'ceramic' },
      { shape: 'box', size: [1.3, 0.03, 0.16], pos: [0, -0.067, 0.24], color: '#f8f6f0', material: 'plastic' },
      ...pianoKeys,
      { shape: 'box', size: [0.32, 0.23, 0.004], pos: [0, 0.2, 0.07], rot: [-12, 0, 0], color: '#fffdf4', material: 'paper' },
      { shape: 'box', size: [0.06, 0.45, 0.06], pos: [0.7, -0.38, 0.3], color: '#1b1b1b', material: 'wood' },
      { shape: 'box', size: [0.06, 0.45, 0.06], pos: [-0.7, -0.38, 0.3], color: '#1b1b1b', material: 'wood' },
      { shape: 'box', size: [0.03, 0.016, 0.08], pos: [-0.08, -0.58, 0.1], color: '#d4a017', material: 'chrome' },
      { shape: 'box', size: [0.03, 0.016, 0.08], pos: [0.08, -0.58, 0.1], color: '#d4a017', material: 'chrome' },
    ] },

  { id: 'flamingo', name: 'Pool flamingo', icon: '🦩', mass: 1.6, toughness: 3, pop: true, spray: 'plastic', sound: 'pop', inner: '#ff8fab',
    blend: 'POP. Pool party cancelled.', survive: 'Bobbing in the vortex. Fabulous.',
    fact: 'About 0.35 m³ of air in a 0.25 mm vinyl skin. Huge drag for very little mass, so it gets thrown around.',
    parts: [
      { shape: 'torus', size: [0.45, 0.2], rot: [90, 0, 0], color: '#ff6fa3', material: 'rubber' },
      { shape: 'tube', points: [[-0.42, 0.1, 0], [-0.58, 0.45, 0], [-0.5, 0.82, 0], [-0.32, 0.92, 0]], radius: 0.08, color: '#ff6fa3', material: 'rubber' },
      { shape: 'sphere', size: [0.12, 0.1, 0.1], pos: [-0.27, 0.93, 0], color: '#ff6fa3', material: 'rubber' },
      { shape: 'cone', size: [0.045, 0.16], pos: [-0.13, 0.86, 0], rot: [0, 0, -115], color: '#2b2b2b', material: 'rubber' },
      { shape: 'sphere', size: [0.025, 0.025, 0.02], pos: [-0.24, 0.97, 0.085], color: '#111111', material: 'plastic' },
      { shape: 'sphere', size: [0.025, 0.025, 0.02], pos: [-0.24, 0.97, -0.085], color: '#111111', material: 'plastic' },
      { shape: 'cone', size: [0.14, 0.3], pos: [0.55, 0.2, 0], rot: [0, 0, -60], color: '#ff4f8b', material: 'rubber' },
    ] },

  { id: 'vending', name: 'Vending machine', icon: '🥤', mass: 300, toughness: 40000, spray: 'cash', sound: 'clang', inner: '#333333',
    blend: 'IT BLENDS. Exact change not required.', survive: 'IT DID NOT BLEND. Your snack is still stuck.',
    fact: '300 kg of steel, glass and snacks. One blade strike on something this heavy can nearly stall the fan.',
    parts: [
      { shape: 'roundbox', size: [0.82, 1.8, 0.86], radius: 0.03, color: '#c1121f', material: 'metal' },
      { shape: 'box', size: [0.006, 1.1, 0.56], pos: [0.413, 0.18, -0.1], color: '#cfe8ff', material: 'glass' },
      ...snacks,
      { shape: 'box', size: [0.01, 0.32, 0.17], pos: [0.414, 0.38, 0.3], color: '#222222', material: 'plastic' },
      { shape: 'box', size: [0.006, 0.06, 0.13], pos: [0.42, 0.58, 0.3], color: '#39ff14', material: 'glow' },
      { shape: 'box', size: [0.012, 0.06, 0.02], pos: [0.42, 0.28, 0.3], color: '#e0e0e0', material: 'chrome' },
      { shape: 'box', size: [0.012, 0.2, 0.6], pos: [0.415, -0.66, -0.05], color: '#111111', material: 'plastic' },
      { shape: 'box', size: [0.006, 0.16, 0.74], pos: [0.416, 0.82, 0], color: '#ffe66d', material: 'glow' },
    ] },

  { id: 'bathtub', name: 'Clawfoot tub', icon: '🛁', mass: 120, toughness: 25000, spray: 'foam', sound: 'clang', inner: '#5a5a5a',
    blend: 'IT BLENDS. Bath time is over.', survive: 'IT DID NOT BLEND. Cast iron, 1912. They built them differently.',
    fact: 'Enamelled cast iron is strong when squeezed but brittle when bent. One sharp blade hit and it cracks like a dinner plate.',
    parts: [
      { shape: 'roundbox', size: [1.5, 0.55, 0.75], radius: 0.25, color: '#f7f7f5', material: 'ceramic' },
      { shape: 'roundbox', size: [1.58, 0.06, 0.82], radius: 0.029, pos: [0, 0.27, 0], color: '#ffffff', material: 'ceramic' },
      { shape: 'box', size: [1.34, 0.006, 0.6], pos: [0, 0.302, 0], color: '#8fd0f5', material: 'glass' },
      { shape: 'sphere', size: [0.1, 0.04, 0.09], pos: [-0.3, 0.31, -0.12], color: '#ffffff', material: 'fabric' },
      { shape: 'sphere', size: [0.08, 0.035, 0.07], pos: [-0.45, 0.31, 0.1], color: '#ffffff', material: 'fabric' },
      { shape: 'sphere', size: [0.06, 0.045, 0.05], pos: [0.3, 0.33, 0.1], color: '#ffd21f', material: 'plastic' },
      { shape: 'sphere', size: [0.035, 0.035, 0.035], pos: [0.34, 0.385, 0.1], color: '#ffd21f', material: 'plastic' },
      { shape: 'tube', points: [[-0.72, 0.3, 0], [-0.8, 0.5, 0], [-0.7, 0.6, 0], [-0.62, 0.52, 0]], radius: 0.02, color: '#e6e6e6', material: 'chrome' },
      { shape: 'sphere', size: [0.06, 0.09, 0.06], pos: [0.58, -0.32, 0.24], color: '#d4a017', material: 'chrome' },
      { shape: 'sphere', size: [0.06, 0.09, 0.06], pos: [0.58, -0.32, -0.24], color: '#d4a017', material: 'chrome' },
      { shape: 'sphere', size: [0.06, 0.09, 0.06], pos: [-0.58, -0.32, 0.24], color: '#d4a017', material: 'chrome' },
      { shape: 'sphere', size: [0.06, 0.09, 0.06], pos: [-0.58, -0.32, -0.24], color: '#d4a017', material: 'chrome' },
    ] },

  { id: 'teddy', name: 'Giant teddy', icon: '🧸', mass: 6, toughness: 400, spray: 'foam', sound: 'squish', inner: '#fff8e7',
    blend: 'IT BLENDS. Stuffing everywhere. Somewhere, a child weeps.', survive: 'Hugged by the vortex. Unharmed.',
    fact: '1.5 m of plush and polyester fibre. Soft things soak up the strike energy, so they take a lot of chopping.',
    parts: [
      { shape: 'sphere', size: [0.33, 0.45, 0.38], color: '#a0522d', material: 'fabric' },
      { shape: 'sphere', size: [0.1, 0.32, 0.26], pos: [0.25, -0.03, 0], color: '#deb887', material: 'fabric' },
      { shape: 'sphere', size: [0.27, 0.27, 0.3], pos: [0, 0.62, 0], color: '#a0522d', material: 'fabric' },
      { shape: 'sphere', size: [0.12, 0.09, 0.13], pos: [0.24, 0.56, 0], color: '#deb887', material: 'fabric' },
      { shape: 'sphere', size: [0.04, 0.03, 0.05], pos: [0.36, 0.6, 0], color: '#1a1a1a', material: 'plastic' },
      { shape: 'sphere', size: [0.03, 0.03, 0.03], pos: [0.22, 0.7, 0.1], color: '#1a1a1a', material: 'plastic' },
      { shape: 'sphere', size: [0.03, 0.03, 0.03], pos: [0.22, 0.7, -0.1], color: '#1a1a1a', material: 'plastic' },
      { shape: 'sphere', size: [0.05, 0.1, 0.1], pos: [0, 0.86, 0.2], color: '#a0522d', material: 'fabric' },
      { shape: 'sphere', size: [0.05, 0.1, 0.1], pos: [0, 0.86, -0.2], color: '#a0522d', material: 'fabric' },
      { shape: 'capsule', size: [0.1, 0.3], pos: [0.05, 0.12, 0.4], rot: [-40, 0, 0], color: '#a0522d', material: 'fabric' },
      { shape: 'capsule', size: [0.1, 0.3], pos: [0.05, 0.12, -0.4], rot: [40, 0, 0], color: '#a0522d', material: 'fabric' },
      { shape: 'capsule', size: [0.13, 0.25], pos: [0.2, -0.42, 0.2], rot: [0, 0, -70], color: '#a0522d', material: 'fabric' },
      { shape: 'capsule', size: [0.13, 0.25], pos: [0.2, -0.42, -0.2], rot: [0, 0, -70], color: '#a0522d', material: 'fabric' },
      { shape: 'box', size: [0.05, 0.08, 0.22], pos: [0.27, 0.36, 0], color: '#d62828', material: 'fabric' },
    ] },

  { id: 'disco', name: 'Disco ball', icon: '🪩', mass: 8, toughness: 60, impact: 900, spray: 'glass', sound: 'glass', inner: '#e0e0e0',
    blend: 'IT BLENDS. Saturday night is over.', survive: 'Still spinning. Still fabulous.',
    fact: 'Hundreds of little glass mirrors glued onto a foam ball. The mirrors let go long before the foam does.',
    parts: [
      { shape: 'sphere', size: [0.4, 0.4, 0.4], color: '#e8e8ee', material: 'chrome', round: true, pattern: { type: 'segments', colors: ['#f4f4f8', '#b9bcc6', '#e3e5ec', '#9a9eaa'] } },
      { shape: 'cylinder', size: [0.012, 0.012, 0.3], pos: [0, 0.55, 0], color: '#bbbbbb', material: 'metal' },
      { shape: 'torus', size: [0.04, 0.01], pos: [0, 0.72, 0], color: '#bbbbbb', material: 'metal' },
    ] },

  { id: 'tubeman', name: 'Inflatable tube man', icon: '🕺', mass: 1.4, toughness: 2, spray: 'fabric', sound: 'tear', inner: '#ff6b6b',
    blend: 'IT BLENDS. Wacky. Waving. Gone.', survive: 'Flailing harder than ever. Living his best life.',
    fact: 'Normally one small blower keeps him upright. The tunnel brings considerably more wind than that.',
    parts: [
      { shape: 'tube', points: [[0, -0.95, 0], [0.08, -0.4, 0], [-0.07, 0.1, 0], [0.07, 0.55, 0], [0, 0.92, 0]], radius: 0.13, color: '#e63946', material: 'fabric' },
      { shape: 'tube', points: [[0, 0.55, -0.1], [0.02, 0.72, -0.45], [0.08, 0.48, -0.78]], radius: 0.06, color: '#e63946', material: 'fabric' },
      { shape: 'tube', points: [[0, 0.55, 0.1], [-0.03, 0.85, 0.42], [0.04, 1.08, 0.66]], radius: 0.06, color: '#e63946', material: 'fabric' },
      { shape: 'sphere', size: [0.04, 0.045, 0.035], pos: [0.11, 0.82, 0.05], color: '#ffffff', material: 'fabric' },
      { shape: 'sphere', size: [0.04, 0.045, 0.035], pos: [0.11, 0.82, -0.05], color: '#ffffff', material: 'fabric' },
      { shape: 'sphere', size: [0.015, 0.018, 0.015], pos: [0.15, 0.82, 0.05], color: '#111111', material: 'plastic' },
      { shape: 'sphere', size: [0.015, 0.018, 0.015], pos: [0.15, 0.82, -0.05], color: '#111111', material: 'plastic' },
      { shape: 'sphere', size: [0.012, 0.03, 0.045], pos: [0.125, 0.71, 0], color: '#3a0a0a', material: 'fabric' },
      { shape: 'cone', size: [0.05, 0.16], pos: [0, 1.0, 0], rot: [0, 0, 10], color: '#ffd60a', material: 'fabric' },
      { shape: 'cone', size: [0.04, 0.13], pos: [0, 0.98, 0.07], rot: [30, 0, 0], color: '#ffd60a', material: 'fabric' },
      { shape: 'cone', size: [0.04, 0.13], pos: [0, 0.98, -0.07], rot: [-30, 0, 0], color: '#ffd60a', material: 'fabric' },
    ] },
];
