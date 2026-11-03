// The object-design prompt, shared by the page (Claude-hosted version) and the Cloudflare
// Worker (GitHub Pages version). No dependencies, so the Worker can import it directly.
export const SPRAYS = ['juice', 'yolk', 'pulp', 'seeds', 'confetti', 'paper', 'feathers', 'dust', 'shards', 'glass', 'sparks', 'foam', 'plastic', 'fabric', 'food', 'cash'];
export const SOUNDS = ['squeak', 'squish', 'splat', 'crack', 'shatter', 'glass', 'clang', 'thunk', 'pop', 'tear', 'squawk', 'crunch', 'zap'];
export const MATERIAL_NAMES = ['plastic', 'rubber', 'metal', 'chrome', 'steel', 'iron', 'glass', 'ceramic', 'wood', 'fruit', 'paper', 'fabric', 'stone', 'food', 'glow'];

// Prompt for Claude when a user types an object name.
export function recipePrompt(what) {
  return `You design objects for a silly-but-physically-grounded 3D wind tunnel game where objects get blown into a giant fan and shredded ("Will It Blend?" energy). Design: "${what}".

Return ONLY a JSON object (no prose, no code fence) with this schema:
{
 "name": short display name,
 "icon": one emoji,
 "mass": REAL total mass in kg. This matters: breakability is computed from the materials, the size and how solid the thing is (mass ÷ volume), so a hollow fridge and a solid safe of the same size must have very different masses,
 "impact": newtons of contact force that breaks it when it hits the floor/walls (0 = never; egg 45, vase 600, teapot 1400),
 "unbreakable": almost always false (strength is simulated); true only for something like a bowling ball that should never shatter,
 "pop": true for inflatables that pop,
 "spray": one of ${JSON.stringify(SPRAYS)} (what flies out when chopped),
 "sound": one of ${JSON.stringify(SOUNDS)},
 "inner": hex colour of its insides,
 "aero": "plate" if it is thin and flat (paper, cards, pizza), else "auto",
 "count": how many copies to throw at once (1 unless it is naturally a bunch, e.g. a deck of cards = 26),
 "blend": short irreverent verdict if it gets shredded (under 70 chars),
 "survive": short irreverent verdict if it survives (under 70 chars),
 "fact": one true, fun physics or material fact about it (under 160 chars),
 "parts": 1–24 primitives that together look like the object, each:
   {"shape": "sphere"|"box"|"plate"|"roundbox"|"cylinder"|"cone"|"capsule"|"torus"|"dome"|"lathe"|"tube"|"teapot",
    "size": sphere [rx,ry,rz] radii | box/plate/roundbox [x,y,z] full extents (plate = thin box) | cylinder [rTop,rBottom,height] | cone [radius,height] | capsule [radius,length] | torus [R, tube r, arc degrees] | dome [radius,height] | teapot [size],
    "radius": for roundbox corner radius or tube radius,
    "points": for lathe [[r,y],...] profile, for tube [[x,y,z],...] centreline,
    "pos": [x,y,z] metres, "rot": [x,y,z] degrees (Euler XYZ),
    "color": "#rrggbb",
    "material": one of ${JSON.stringify(MATERIAL_NAMES)} ("metal" = ordinary sheet/structural steel or aluminium, "steel" = hardened or armour-thick steel, "iron" = cast iron),
    "pattern" (optional): {"type":"stripes"|"bands"|"spots"|"segments","color":"#rrggbb","count":n,"colors":["#..",...]}}
Use real-world dimensions in metres, y is up, objects sit roughly centred on the origin. Keep the largest dimension under 3 m. Make it recognisable and a bit charming.`;
}
