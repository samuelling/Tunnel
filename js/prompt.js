// The object-design prompt, shared by the page (Claude-hosted version) and the Cloudflare
// Worker (GitHub Pages version). No dependencies, so the Worker can import it directly.
export const SPRAYS = ['juice', 'yolk', 'pulp', 'seeds', 'confetti', 'paper', 'feathers', 'dust', 'shards', 'glass', 'sparks', 'foam', 'plastic', 'fabric', 'food', 'cash'];
export const SOUNDS = ['squeak', 'squish', 'splat', 'crack', 'shatter', 'glass', 'clang', 'thunk', 'pop', 'tear', 'squawk', 'crunch', 'zap'];
export const MATERIAL_NAMES = ['plastic', 'rubber', 'metal', 'chrome', 'steel', 'iron', 'glass', 'ceramic', 'wood', 'fruit', 'paper', 'fabric', 'stone', 'food', 'glow'];

// The design brief. It never changes, so it goes first as the system prompt and the Worker marks
// it for prompt caching: after the first design, repeats within 5 minutes read it at a fraction of
// the price. The object name comes after it, in the user turn (recipeUser).
// Output is what costs most (each output token costs several input tokens), so the brief asks for
// minified JSON, rounded numbers, no default-valued fields and as few parts as read clearly.
export const RECIPE_SYSTEM = `You design objects for a silly-but-physically-grounded 3D wind tunnel game where objects get blown into a giant fan and shredded ("Will It Blend?" energy). The user names an object; you reply with its design.

Reply with ONLY one line of minified JSON (no spaces, no prose, no code fence). Round numbers to 2 decimals (3 only below 0.05). Leave out any field at its default.
{
 "name": short display name,
 "icon": one emoji,
 "mass": REAL total mass in kg. Breakability is computed from the materials, the size and how solid the thing is (mass ÷ volume), so a hollow fridge and a solid safe of the same size need very different masses,
 "impact": newtons of contact force that breaks it hitting the floor/walls (0 = never; egg 45, vase 600, teapot 1400),
 "unbreakable": default false; true only for something like a bowling ball that should never shatter,
 "pop": default false; true for inflatables that pop,
 "spray": one of ${JSON.stringify(SPRAYS)} (what flies out when chopped),
 "sound": one of ${JSON.stringify(SOUNDS)},
 "inner": hex colour of its insides,
 "aero": default "auto"; "plate" if thin and flat (paper, cards, pizza),
 "count": default 1; more only if it is naturally a bunch (a deck of cards = 26),
 "blend": short irreverent verdict if it gets shredded (under 70 chars),
 "survive": short irreverent verdict if it survives (under 70 chars),
 "fact": one true, fun physics or material fact about it (under 140 chars),
 "parts": 1–16 primitives that together look like the object (use the fewest that read clearly), each:
   {"shape": "sphere"|"box"|"plate"|"roundbox"|"cylinder"|"cone"|"capsule"|"torus"|"dome"|"lathe"|"tube"|"teapot",
    "size": sphere [rx,ry,rz] radii | box/plate/roundbox [x,y,z] full extents (plate = thin box) | cylinder [rTop,rBottom,height] | cone [radius,height] | capsule [radius,length] | torus [R, tube r, arc degrees] | dome [radius,height] | teapot [size],
    "radius": roundbox corner radius or tube radius (only for those),
    "points": lathe [[r,y],...] profile or tube [[x,y,z],...] centreline (only for those, ≤10 points),
    "pos": [x,y,z] metres, "rot": [x,y,z] degrees, Euler XYZ (default [0,0,0]),
    "color": "#rrggbb",
    "material": default "plastic"; one of ${JSON.stringify(MATERIAL_NAMES)} ("metal" = ordinary sheet/structural steel or aluminium, "steel" = hardened or armour-thick steel, "iron" = cast iron),
    "pattern" (optional): {"type":"stripes"|"bands"|"spots"|"segments","color":"#rrggbb","count":n,"colors":["#..",...]}}
Use real-world dimensions in metres, y is up, the object roughly centred on the origin, largest dimension under 12 m (it can be as big as a bus). Make it recognisable and a bit charming.`;

export const recipeUser = (what) => `Design: "${String(what).replace(/"/g, "'")}"`;

// The whole thing as one prompt (for the Claude-hosted page, which sends a single message).
export function recipePrompt(what) {
  return `${RECIPE_SYSTEM}\n\n${recipeUser(what)}`;
}

// One key per object, so "a lava lamp", "Lava lamps" and "the LAVA LAMP" all find the same
// Warehouse shelf. Shared by the page and the Worker.
export function objectKey(name) {
  let s = String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(a|an|the|some|my|one|two|three|several|lots of|a bunch of|a pair of|a giant|giant)\s+/, '');
  const words = s.split(' ');
  let w = words[words.length - 1] || '';
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is|ous)$/.test(w)) w = w.slice(0, -1);
  words[words.length - 1] = w;
  return words.join(' ').slice(0, 60);
}

// Looser still, for matching against the Warehouse only: size words don't make a new object, so
// "a big donut", "a giant donut" and "a donut" all find the same shelf item.
const SIZE_WORDS = /^(big|small|little|tiny|huge|large|mini|miniature|medium|massive|enormous|jumbo|regular|normal|standard|old|new|giant)\s+/;
export function looseKey(name) {
  let k = objectKey(name), prev;
  do { prev = k; k = k.replace(SIZE_WORDS, ''); } while (k !== prev);
  return k;
}
