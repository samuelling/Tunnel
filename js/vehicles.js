// Vehicle-sized things for the 3× plant (a 14 m tube). Same recipe format as the rest of the
// catalogue: sizes in metres, y up, x = "front". Masses are the real kerb weights.

const wheel = (x, z, r, w, color = '#1b1b1d') => [
  { shape: 'cylinder', size: [r, r, w], pos: [x, r - 0.02, z], rot: [90, 0, 0], color, material: 'rubber' },
  { shape: 'cylinder', size: [r * 0.55, r * 0.55, w + 0.02], pos: [x, r - 0.02, z], rot: [90, 0, 0], color: '#b9bec4', material: 'chrome' },
];

// a school bus's windows: a row of dark panes down each side
const busWindows = [1, -1].flatMap(side => Array.from({ length: 9 }, (_, i) => (
  { shape: 'box', size: [0.82, 0.62, 0.03], pos: [2.9 - i * 1.05, 2.05, side * 1.21], color: '#1c2a33', material: 'glass' }
)));

export const VEHICLES = [
  { id: 'car', name: 'Hatchback', icon: '🚗', mass: 1350, spray: 'shards', sound: 'clang', inner: '#3d4148',
    blend: 'IT BLENDS. Now available in 4,000 easy pieces.', survive: 'Totalled, but in one piece. Insurance will want photos.',
    fact: '1.35 tonnes: a steel safety cage under thin pressed panels. The panels shred; the cage and engine block make the blades work for it.',
    parts: [
      { shape: 'roundbox', size: [4.2, 0.78, 1.78], radius: 0.18, pos: [0, 0.62, 0], color: '#c8102e', material: 'metal' },
      { shape: 'roundbox', size: [2.3, 0.66, 1.6], radius: 0.2, pos: [-0.35, 1.3, 0], color: '#c8102e', material: 'metal' },
      { shape: 'box', size: [0.03, 0.5, 1.4], pos: [0.81, 1.3, 0], rot: [0, 0, -32], color: '#20303a', material: 'glass' },
      { shape: 'box', size: [1.9, 0.44, 0.03], pos: [-0.35, 1.34, 0.8], color: '#20303a', material: 'glass' },
      { shape: 'box', size: [1.9, 0.44, 0.03], pos: [-0.35, 1.34, -0.8], color: '#20303a', material: 'glass' },
      { shape: 'box', size: [0.03, 0.42, 1.4], pos: [-1.5, 1.32, 0], color: '#20303a', material: 'glass' },
      { shape: 'roundbox', size: [0.7, 0.55, 1.5], radius: 0.1, pos: [1.4, 0.65, 0], color: '#5a5f66', material: 'steel' },   // engine block
      { shape: 'roundbox', size: [0.2, 0.22, 1.8], radius: 0.06, pos: [2.12, 0.42, 0], color: '#2b2b2e', material: 'plastic' },
      { shape: 'roundbox', size: [0.2, 0.22, 1.8], radius: 0.06, pos: [-2.12, 0.42, 0], color: '#2b2b2e', material: 'plastic' },
      { shape: 'sphere', size: [0.05, 0.1, 0.18], pos: [2.1, 0.78, 0.62], color: '#fff6d8', material: 'glass' },
      { shape: 'sphere', size: [0.05, 0.1, 0.18], pos: [2.1, 0.78, -0.62], color: '#fff6d8', material: 'glass' },
      { shape: 'box', size: [0.04, 0.1, 0.3], pos: [-2.11, 0.86, 0.6], color: '#ff2d2d', material: 'plastic' },
      { shape: 'box', size: [0.04, 0.1, 0.3], pos: [-2.11, 0.86, -0.6], color: '#ff2d2d', material: 'plastic' },
      ...wheel(1.35, 0.8, 0.32, 0.22), ...wheel(1.35, -0.8, 0.32, 0.22), ...wheel(-1.35, 0.8, 0.32, 0.22), ...wheel(-1.35, -0.8, 0.32, 0.22),
    ] },

  { id: 'container', name: 'Shipping container', icon: '📦', mass: 2300, spray: 'sparks', sound: 'clang', inner: '#5b2a1c', aero: 'box',
    blend: 'IT BLENDS. Contents: unknown. Contents: everywhere.', survive: 'Corten steel 1, fan 0. It will outlive us all.',
    fact: 'A 20-foot box of 2 mm corrugated Corten steel on a heavy frame: 2.3 tonnes, mostly air. The corrugations make it stiff.',
    parts: [
      { shape: 'box', size: [6.06, 2.59, 2.44], color: '#b5462b', material: 'metal', pattern: { type: 'stripes', color: '#8c3420', count: 40 } },
      { shape: 'box', size: [0.04, 2.4, 1.1], pos: [-3.05, 0, 0.58], color: '#a13f27', material: 'metal' },
      { shape: 'box', size: [0.04, 2.4, 1.1], pos: [-3.05, 0, -0.58], color: '#a13f27', material: 'metal' },
      ...[0.35, 0.8, -0.35, -0.8].map(z => ({ shape: 'cylinder', size: [0.03, 0.03, 2.3], pos: [-3.1, 0, z], color: '#9aa0a6', material: 'steel' })),
      ...[[3.0, 1.27, 1.19], [3.0, 1.27, -1.19], [-3.0, 1.27, 1.19], [-3.0, 1.27, -1.19], [3.0, -1.27, 1.19], [3.0, -1.27, -1.19], [-3.0, -1.27, 1.19], [-3.0, -1.27, -1.19]]
        .map(p => ({ shape: 'box', size: [0.18, 0.12, 0.16], pos: p, color: '#3a3a3a', material: 'steel' })),
      { shape: 'box', size: [0.02, 0.5, 1.6], pos: [3.04, 0.6, 0], color: '#f4f4f4', material: 'paper' },
    ] },

  { id: 'boat', name: 'Fishing boat', icon: '🚤', mass: 1900, spray: 'plastic', sound: 'crunch', inner: '#f2efe4',
    blend: 'IT BLENDS. Fibreglass confetti and one very confused anchor.', survive: 'Still seaworthy. Just not here.',
    fact: 'A 7 m fibreglass hull, 6 mm thick, with an outboard motor hanging off the back. Light for its size, which the air notices.',
    parts: [
      { shape: 'roundbox', size: [5.2, 1.2, 2.4], radius: 0.4, pos: [-0.4, 0.6, 0], color: '#f4f2ec', material: 'plastic' },
      { shape: 'cone', size: [1.18, 2.0], pos: [3.2, 0.6, 0], rot: [0, 0, -90], color: '#f4f2ec', material: 'plastic' },
      { shape: 'box', size: [7.0, 0.16, 0.04], pos: [0.2, 0.96, 1.2], color: '#1e5aa8', material: 'plastic' },
      { shape: 'box', size: [7.0, 0.16, 0.04], pos: [0.2, 0.96, -1.2], color: '#1e5aa8', material: 'plastic' },
      { shape: 'roundbox', size: [1.6, 1.2, 1.7], radius: 0.12, pos: [0.4, 1.75, 0], color: '#e9e5da', material: 'plastic' },
      { shape: 'box', size: [0.03, 0.6, 1.4], pos: [1.21, 1.95, 0], rot: [0, 0, -20], color: '#20303a', material: 'glass' },
      { shape: 'cylinder', size: [0.05, 0.05, 2.4], pos: [0.1, 3.4, 0], color: '#c9ced4', material: 'metal' },
      { shape: 'roundbox', size: [0.45, 1.1, 0.42], radius: 0.08, pos: [-3.25, 0.9, 0], color: '#222428', material: 'metal' },   // outboard
      { shape: 'torus', size: [0.3, 0.06], pos: [-1.6, 1.4, 1.22], color: '#ff6a00', material: 'rubber' },
    ] },

  { id: 'bus', name: 'School bus', icon: '🚌', mass: 11000, spray: 'paper', sound: 'clang', inner: '#3a3a3a',
    blend: 'IT BLENDS. Field trip cancelled. Permission slips everywhere.', survive: 'The bus wins. The wheels on the bus go round and round.',
    fact: '11 tonnes on a steel ladder frame: the longest thing that fits, nose to tail barely 11 m in a 14 m tube. It hits the fan like a freight train.',
    parts: [
      { shape: 'roundbox', size: [8.6, 2.5, 2.4], radius: 0.25, pos: [-0.7, 1.75, 0], color: '#ffb400', material: 'metal' },
      { shape: 'roundbox', size: [1.6, 1.2, 2.3], radius: 0.18, pos: [4.2, 1.1, 0], color: '#ffb400', material: 'metal' },
      { shape: 'box', size: [8.62, 0.12, 2.42], pos: [-0.7, 1.4, 0], color: '#141414', material: 'plastic' },
      { shape: 'box', size: [8.62, 0.12, 2.42], pos: [-0.7, 1.0, 0], color: '#141414', material: 'plastic' },
      { shape: 'box', size: [0.03, 0.9, 2.1], pos: [3.42, 2.2, 0], rot: [0, 0, -8], color: '#1c2a33', material: 'glass' },
      ...busWindows,
      { shape: 'box', size: [9.6, 0.35, 1.0], pos: [-0.2, 0.6, 0], color: '#2a2a2a', material: 'steel' },   // ladder frame
      { shape: 'roundbox', size: [1.1, 0.8, 1.2], radius: 0.1, pos: [4.1, 0.9, 0], color: '#4a4f55', material: 'steel' },   // diesel
      { shape: 'cylinder', size: [0.32, 0.32, 0.03], pos: [2.6, 2.0, 1.32], rot: [90, 0, 0], color: '#d62828', material: 'metal' },   // STOP arm
      { shape: 'box', size: [0.2, 0.08, 2.4], pos: [5.05, 0.6, 0], color: '#141414', material: 'steel' },
      ...wheel(3.6, 1.05, 0.5, 0.3), ...wheel(3.6, -1.05, 0.5, 0.3), ...wheel(-3.2, 1.05, 0.5, 0.4), ...wheel(-3.2, -1.05, 0.5, 0.4),
    ] },
];
