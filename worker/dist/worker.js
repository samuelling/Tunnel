// js/prompt.js
var SPRAYS = ["juice", "yolk", "pulp", "seeds", "confetti", "paper", "feathers", "dust", "shards", "glass", "sparks", "foam", "plastic", "fabric", "food", "cash"];
var SOUNDS = ["squeak", "squish", "splat", "crack", "shatter", "glass", "clang", "thunk", "pop", "tear", "squawk", "crunch", "zap"];
var MATERIAL_NAMES = ["plastic", "rubber", "metal", "chrome", "steel", "iron", "glass", "ceramic", "wood", "fruit", "paper", "fabric", "stone", "food", "glow"];
var RECIPE_SYSTEM = `You design objects for a silly-but-physically-grounded 3D wind tunnel game where objects get blown into a giant fan and shredded ("Will It Blend?" energy). The user names an object; you reply with its design.

Reply with ONLY one line of minified JSON (no spaces, no prose, no code fence). Round numbers to 2 decimals (3 only below 0.05). Leave out any field at its default.
{
 "name": short display name,
 "icon": one emoji,
 "mass": REAL total mass in kg. Breakability is computed from the materials, the size and how solid the thing is (mass \xF7 volume), so a hollow fridge and a solid safe of the same size need very different masses,
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
 "parts": 1\u201316 primitives that together look like the object (use the fewest that read clearly), each:
   {"shape": "sphere"|"box"|"plate"|"roundbox"|"cylinder"|"cone"|"capsule"|"torus"|"dome"|"lathe"|"tube"|"teapot",
    "size": sphere [rx,ry,rz] radii | box/plate/roundbox [x,y,z] full extents (plate = thin box) | cylinder [rTop,rBottom,height] | cone [radius,height] | capsule [radius,length] | torus [R, tube r, arc degrees] | dome [radius,height] | teapot [size],
    "radius": roundbox corner radius or tube radius (only for those),
    "points": lathe [[r,y],...] profile or tube [[x,y,z],...] centreline (only for those, \u226410 points),
    "pos": [x,y,z] metres, "rot": [x,y,z] degrees, Euler XYZ (default [0,0,0]),
    "color": "#rrggbb",
    "material": default "plastic"; one of ${JSON.stringify(MATERIAL_NAMES)} ("metal" = ordinary sheet/structural steel or aluminium, "steel" = hardened or armour-thick steel, "iron" = cast iron),
    "pattern" (optional): {"type":"stripes"|"bands"|"spots"|"segments","color":"#rrggbb","count":n,"colors":["#..",...]}}
Use real-world dimensions in metres, y is up, the object roughly centred on the origin, largest dimension under 3 m. Make it recognisable and a bit charming.`;
var recipeUser = (what) => `Design: "${String(what).replace(/"/g, "'")}"`;
function objectKey(name) {
  let s = String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(a|an|the|some|my|one|two|three|several|lots of|a bunch of|a pair of|a giant|giant)\s+/, "");
  const words = s.split(" ");
  let w = words[words.length - 1] || "";
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is|ous)$/.test(w)) w = w.slice(0, -1);
  words[words.length - 1] = w;
  return words.join(" ").slice(0, 60);
}
var SIZE_WORDS = /^(big|small|little|tiny|huge|large|mini|miniature|medium|massive|enormous|jumbo|regular|normal|standard|old|new|giant)\s+/;
function looseKey(name) {
  let k = objectKey(name), prev;
  do {
    prev = k;
    k = k.replace(SIZE_WORDS, "");
  } while (k !== prev);
  return k;
}

// js/dropcodec.js
var WIRE_POINTS = 16;
var toB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
var sig = (v, n = 3) => v ? +(+v).toPrecision(n) : 0;
var fix = (a, d) => Array.isArray(a) ? a.map((x) => +(+x || 0).toFixed(d)) : a;
function thinPoints(flat, max = WIRE_POINTS) {
  const seen = /* @__PURE__ */ new Set(), pts = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const key = `${flat[i]},${flat[i + 1]},${flat[i + 2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pts.push([flat[i], flat[i + 1], flat[i + 2]]);
  }
  const keep = pts.length <= max ? pts : pts.map((p, i) => [p[0] * p[0] + p[1] * p[1] + p[2] * p[2], i]).sort((a, b) => b[0] - a[0]).slice(0, max).sort((a, b) => a[1] - b[1]).map(([, i]) => pts[i]);
  return keep.flat();
}
function encodePoints(flat) {
  let m = 0;
  for (const v of flat) m = Math.max(m, Math.abs(v));
  const s = +((m || 1e-4) * 1.0005).toPrecision(4);
  const bytes = new Int8Array(flat.length);
  for (let i = 0; i < flat.length; i++) bytes[i] = Math.max(-127, Math.min(127, Math.round(flat[i] / s * 127)));
  return { s, b: toB64(new Uint8Array(bytes.buffer)) };
}
function slimPiece(pc, maxPoints = WIRE_POINTS) {
  if (!pc || typeof pc.b === "string") return pc;
  const { p, ...rest } = pc;
  const enc = encodePoints(thinPoints(Array.isArray(p) ? p : [], maxPoints));
  return { ...rest, m: sig(pc.m), ...enc, q: fix(pc.q, 3), o: fix(pc.o, 3), v: fix(pc.v, 1) };
}
function slimDrop(d, maxPoints = WIRE_POINTS) {
  if (!d || !Array.isArray(d.pieces)) return d;
  return { ...d, v: 2, pieces: d.pieces.map((pc) => slimPiece(pc, maxPoints)) };
}

// worker/worker.js
var DEFAULT_ORIGINS = ["https://samuelling.github.io"];
var CACHE = "https://tunnel-cache.invalid/";
var SHELF_MAX = 300;
var EXCUSES = ["Claude went home.", "Out to lunch.", "Stocktake.", "Gone fishing (for objects).", "Union meeting.", "The 3D printer jammed. Again.", "Inventory of left socks.", "Staff training: \u201CWhat is a chair?\u201D"];
function corsHeaders(origin, ok) {
  return {
    "Access-Control-Allow-Origin": ok ? origin : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Expose-Headers": "x-pool-left, x-day-left, x-cache, x-shop",
    "Vary": "Origin"
  };
}
var boosted = (env, now = Date.now()) => !!env.BOOST_UNTIL && now < Date.parse(env.BOOST_UNTIL);
var cfg = (env, now = Date.now()) => {
  const b = boosted(env, now);
  const pick = (boost, reg, dflt) => +(b && env[boost]) || +env[reg] || dflt;
  return {
    pool: pick("BOOST_POOL_PER_HOUR", "GEN_POOL_PER_HOUR", 40),
    dayCap: pick("BOOST_PER_DAY", "GEN_PER_DAY", 150),
    perPerson: pick("BOOST_PER_HOUR", "GEN_PER_HOUR", 20),
    fuel: pick("BOOST_FUEL_PER_DAY", "FUEL_PER_DAY", 600),
    boostUntil: b ? env.BOOST_UNTIL : null
  };
};
function etParts(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour, m: +p.minute, s: +p.second };
}
var shopDay = (t) => etParts(t - 9 * 36e5).date;
function opensIn(t) {
  const { h, m, s } = etParts(t);
  const secs = (9 - h + 24) % 24 * 3600 - m * 60 - s;
  return (secs <= 0 ? secs + 86400 : secs) * 1e3;
}
var hourOf = (t) => Math.floor(t / 36e5);
var fuelDay = (t) => new Date(t).toISOString().slice(0, 10);
var refuelIn = (t) => 864e5 - t % 864e5;
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
async function readFab(env) {
  try {
    return { day: "", dayUsed: 0, hour: 0, hourUsed: 0, lastJam: 0, shelf: [], ...JSON.parse(await env.DROPS.get("fab") || "{}") };
  } catch (e) {
    return { day: "", dayUsed: 0, hour: 0, hourUsed: 0, lastJam: 0, shelf: [] };
  }
}
function roll(fab, now) {
  const d = shopDay(now), h = hourOf(now);
  if (fab.day !== d) {
    fab.day = d;
    fab.dayUsed = 0;
  }
  if (fab.hour !== h) {
    fab.hour = h;
    fab.hourUsed = 0;
  }
  return fab;
}
var lite = (fab) => ({ ...fab, shelf: fab.shelf.map(({ k, name, icon, at }) => ({ k, name, icon, at })) });
var FAB_TTL = 30;
function cacheLite(ctx, fab) {
  ctx.waitUntil(caches.default.put(new Request(CACHE + "fab-lite"), new Response(JSON.stringify(lite(fab)), { headers: { "cache-control": `max-age=${FAB_TTL}` } })));
}
async function writeFab(env, ctx, fab) {
  await env.DROPS.put("fab", JSON.stringify(fab));
  cacheLite(ctx, fab);
}
async function cachedFab(env, ctx) {
  const hit2 = await caches.default.match(new Request(CACHE + "fab-lite"));
  if (hit2) {
    try {
      return readFabText(await hit2.text());
    } catch (e) {
    }
  }
  const fab = await readFab(env);
  cacheLite(ctx, fab);
  return lite(fab);
}
async function shelfItem(env, ctx, k) {
  const key = new Request(CACHE + "item/" + encodeURIComponent(k));
  const hit2 = await caches.default.match(key);
  if (hit2) {
    try {
      return await hit2.json();
    } catch (e) {
    }
  }
  const it = (await readFab(env)).shelf.find((x) => x.k === k);
  if (!it) return null;
  const out = { recipe: it.recipe, name: it.name };
  ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(out), { headers: { "cache-control": "max-age=86400" } })));
  return out;
}
var readFabText = (t) => ({ day: "", dayUsed: 0, hour: 0, hourUsed: 0, lastJam: 0, shelf: [], ...JSON.parse(t) });
function status(fab, env, now) {
  const c = cfg(env, now);
  roll(fab, now);
  const dayLeft = Math.max(0, c.dayCap - fab.dayUsed), poolLeft = Math.max(0, Math.min(c.pool - fab.hourUsed, dayLeft));
  return {
    pool: c.pool,
    poolLeft,
    dayCap: c.dayCap,
    dayLeft,
    perPerson: c.perPerson,
    open: dayLeft > 0,
    boostUntil: c.boostUntil,
    excuse: EXCUSES[hashStr(fab.day) % EXCUSES.length],
    opensIn: opensIn(now),
    resetsIn: 36e5 - now % 36e5,
    lastJam: fab.lastJam || 0,
    shelf: fab.shelf.length
  };
}
var shelfList = (fab) => fab.shelf.slice().reverse().map(({ k, name, icon, at }) => ({ k, name, icon, at }));
var RECENT_TTL = 15;
var PILE_KEY = CACHE + "drops/v2";
var emptyHead = () => ({ v: 2, fuelDay: "", fuelUsed: 0, last: 0 });
function parseRecent(text) {
  const v = JSON.parse(text || "[]");
  return Array.isArray(v) ? { fuelDay: "", fuelUsed: 0, drops: v } : { fuelDay: "", fuelUsed: 0, drops: [], ...v };
}
var headOf = (text) => {
  const nl = text.indexOf("\n");
  return { ...emptyHead(), ...JSON.parse(nl < 0 ? text : text.slice(0, nl)) };
};
var isV2 = (text) => text.startsWith('{"v":2');
function v1ToV2(text) {
  const old = parseRecent(text);
  const lines = old.drops.map((d) => `${d.at}	${JSON.stringify(slimDrop(d))}`);
  return JSON.stringify({ v: 2, fuelDay: old.fuelDay, fuelUsed: old.fuelUsed, last: old.drops[old.drops.length - 1]?.at || 0 }) + (lines.length ? "\n" + lines.join("\n") : "");
}
var HEAD_KEY = CACHE + "drops/v2-head";
function cachePile(ctx, text) {
  const nl = text.indexOf("\n");
  const h = { headers: { "cache-control": `max-age=${RECENT_TTL}` } };
  ctx.waitUntil(Promise.all([
    caches.default.put(new Request(PILE_KEY), new Response(text, h)),
    caches.default.put(new Request(HEAD_KEY), new Response(nl < 0 ? text : text.slice(0, nl), h))
    // ~100 bytes
  ]));
}
async function pileHead(env, ctx) {
  const hit2 = await caches.default.match(new Request(HEAD_KEY));
  if (hit2) {
    try {
      return headOf(await hit2.text());
    } catch (e) {
    }
  }
  return headOf(await cachedPile(env, ctx));
}
async function storedPile(env, ctx) {
  let text = await env.DROPS.get("recent") || "";
  if (!text) return JSON.stringify(emptyHead());
  if (!isV2(text)) {
    text = v1ToV2(text);
    await env.DROPS.put("recent", text);
  }
  return text;
}
async function cachedPile(env, ctx) {
  const hit2 = await caches.default.match(new Request(PILE_KEY));
  if (hit2) return hit2.text();
  const text = await storedPile(env, ctx);
  cachePile(ctx, text);
  return text;
}
function linesSince(text, since) {
  const out = [], top = text.indexOf("\n");
  if (top < 0) return out;
  let end = text.length;
  while (end > top) {
    const start = text.lastIndexOf("\n", end - 1);
    const line = text.slice(start + 1, end);
    end = start;
    if (!line) continue;
    const tab = line.indexOf("	");
    if (+line.slice(0, tab) <= since) break;
    out.push(line.slice(tab + 1));
  }
  return out.reverse();
}
function fuelStatus(head, env, now) {
  const cap = cfg(env, now).fuel, used = head.fuelDay === fuelDay(now) ? head.fuelUsed : 0;
  return { fuel: Math.max(0, 1 - used / cap), fuelLeft: Math.max(0, cap - used), fuelCap: cap, refuelIn: refuelIn(now) };
}
var worker_default = {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",") : DEFAULT_ORIGINS).map((s) => s.trim());
    const ok = allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    const cors = corsHeaders(origin, ok);
    const open = { "Access-Control-Allow-Origin": origin || "*", "Vary": "Origin", "content-type": "application/json", "cache-control": "no-store" };
    const json = (o, status2 = 200, extra = {}) => new Response(JSON.stringify(o), { status: status2, headers: { ...open, ...extra } });
    const reply = (body, status2 = 200, extra = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: status2,
      headers: { ...cors, "content-type": typeof body === "string" ? "text/plain" : "application/json", ...extra }
    });
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "86400" } });
    const url = new URL(req.url), path = url.pathname.replace(/\/$/, "") || "/";
    if (!env.DROPS && path !== "/") return json({ error: "no KV namespace bound as DROPS" }, 501);
    const now = Date.now();
    if (path === "/drops") return drops(req, env, url, ok, origin, ctx);
    if (path === "/hit") return hit(req, env, ok, now);
    if (path === "/stats") return stats(req, env, ctx, url, now);
    const brief = { "cache-control": "public, max-age=10" };
    if (path === "/quota") {
      const [fab2, head] = await Promise.all([cachedFab(env, ctx), pileHead(env, ctx)]);
      const out = { ...status(fab2, env, now), ...fuelStatus(head, env, now), on: !!env.ANTHROPIC_API_KEY, wire: 2 };
      if (url.searchParams.has("shelf")) out.items = shelfList(fab2);
      if (fab2.tokens) out.tokens = fab2.tokens;
      return json(out, 200, brief);
    }
    if (path === "/warehouse") return json({ items: shelfList(await cachedFab(env, ctx)) }, 200, brief);
    if (path === "/warehouse/item") {
      const it = await shelfItem(env, ctx, objectKey(url.searchParams.get("k") || ""));
      return it ? json(it, 200, { "cache-control": "public, max-age=86400" }) : json({ error: "not on the shelf" }, 404);
    }
    if (path === "/jam") {
      if (req.method !== "POST" || !ok) return json({ error: "nope" }, 405);
      const seen2 = await cachedFab(env, ctx);
      if (now - (seen2.lastJam || 0) <= 10 * 6e4) return json({ lastJam: seen2.lastJam });
      const fab2 = await readFab(env);
      if (now - (fab2.lastJam || 0) > 10 * 6e4) {
        fab2.lastJam = now;
        await writeFab(env, ctx, fab2);
      }
      return json({ lastJam: fab2.lastJam });
    }
    if (path !== "/") return json({ error: "not found" }, 404);
    if (req.method !== "POST") return reply("POST only", 405);
    if (!ok) return reply("origin not allowed", 403);
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: req.headers.get("CF-Connecting-IP") || "anon" });
      if (!success) return reply("Easy there \u2014 too many objects. Try again in a minute.", 429);
    }
    let what;
    try {
      what = String((await req.json()).object || "").replace(/\s+/g, " ").trim().slice(0, 60);
    } catch (e) {
      return reply("bad request", 400);
    }
    const k = objectKey(what);
    if (!k) return reply("say what to shred", 400);
    const seen = await cachedFab(env, ctx);
    const lk = looseKey(what);
    const match = seen.shelf.find((x) => x.k === k) || seen.shelf.find((x) => looseKey(x.k) === lk);
    if (match) {
      const it = await shelfItem(env, ctx, match.k);
      if (it) return reply({ recipe: it.recipe, shelf: true }, 200, { "x-cache": "shelf" });
    }
    if (!env.ANTHROPIC_API_KEY) return reply("\u201CType anything\u201D isn\u2019t switched on yet: the Worker has no Claude API key. The built-in objects all work.", 501);
    const st = status(seen, env, now);
    if (!st.open) {
      const hrs = Math.max(1, Math.round(st.opensIn / 36e5));
      return reply(`CLOSED. ${st.excuse} Back at 9 AM Eastern (in about ${hrs} h). Everything in the Warehouse is still free.`, 429, { "x-shop": "closed" });
    }
    if (st.poolLeft <= 0) {
      const mins = Math.max(1, Math.ceil(st.resetsIn / 6e4));
      return reply(`The Fabricator is out of tickets for this hour. A new batch of ${st.pool} arrives in about ${mins} min. Everything in the Warehouse is still free.`, 429, { "x-shop": "tickets" });
    }
    const ask = (lean) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: env.MODEL || "claude-sonnet-5-5",
        max_tokens: +env.MAX_TOKENS || 2e3,
        system: [{ type: "text", text: RECIPE_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: recipeUser(what) }],
        ...lean ? { thinking: { type: env.THINKING || "between_tools" }, output_config: { effort: env.EFFORT || "medium" } } : {}
      })
    });
    let r = await ask(true);
    if (r.status === 400) r = await ask(false);
    if (!r.ok) return reply("Claude is busy: " + (await r.text()).slice(0, 200), 502);
    const j = await r.json();
    const text = (j.content || []).map((c) => c.text || "").join("");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    let recipe;
    try {
      recipe = JSON.parse(text.slice(a, b + 1));
    } catch (e) {
      return reply(j.stop_reason === "max_tokens" ? "That design got too elaborate. Try something simpler." : "Claude returned something unparseable", 502);
    }
    const fab = roll(await readFab(env), now);
    fab.dayUsed++;
    fab.hourUsed++;
    if (!fab.shelf.some((x) => x.k === k)) fab.shelf.push({ k, name: recipe.name || what, icon: recipe.icon || "\u2728", at: now, recipe });
    while (fab.shelf.length > SHELF_MAX) fab.shelf.shift();
    const u = j.usage || {}, t = fab.tokens || (fab.tokens = { n: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
    t.n++;
    t.in += u.input_tokens || 0;
    t.out += u.output_tokens || 0;
    t.cacheRead += u.cache_read_input_tokens || 0;
    t.cacheWrite += u.cache_creation_input_tokens || 0;
    t.thinking = (t.thinking || 0) + (u.output_tokens_details?.thinking_tokens || 0);
    await writeFab(env, ctx, fab);
    const after = status(fab, env, now);
    return reply({ recipe }, 200, { "x-cache": "miss", "x-pool-left": String(after.poolLeft), "x-day-left": String(after.dayLeft) });
  }
};
var KEEP = 300;
var KEEP_CHARS = 12e6;
async function drops(req, env, url, ok, origin, ctx) {
  const headers = { "Access-Control-Allow-Origin": origin || "*", "Vary": "Origin", "content-type": "application/json", "cache-control": "no-store", "Access-Control-Expose-Headers": "x-portal" };
  const now = Date.now();
  if (req.method === "GET") {
    const since = +url.searchParams.get("since") || 0;
    let text2 = null, head2 = null, fresh = [];
    const hh = await caches.default.match(new Request(HEAD_KEY));
    if (hh) {
      try {
        head2 = headOf(await hh.text());
      } catch (e) {
      }
    }
    if (!head2) {
      text2 = await cachedPile(env, ctx);
      head2 = headOf(text2);
    }
    if (since < head2.last) {
      text2 = text2 ?? await cachedPile(env, ctx);
      head2 = headOf(text2);
      fresh = linesSince(text2, since);
    }
    return new Response(`{"now":${now},"last":${head2.last},"drops":[${fresh.join(",")}]}`, { headers });
  }
  if (req.method !== "POST") return new Response("{}", { status: 405, headers });
  if (!ok) return new Response(JSON.stringify({ error: "origin not allowed" }), { status: 403, headers });
  const today = fuelDay(now), cap = cfg(env, now).fuel;
  const noFuel = () => new Response(JSON.stringify({ error: "out of fuel", refuelIn: refuelIn(now) }), { status: 503, headers: { ...headers, "x-portal": "out-of-fuel" } });
  const seen = await caches.default.match(new Request(HEAD_KEY));
  if (seen) {
    try {
      const h = headOf(await seen.text());
      if (h.fuelDay === today && h.fuelUsed >= cap) return noFuel();
    } catch (e) {
    }
  }
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: "d:" + (req.headers.get("CF-Connecting-IP") || "anon") });
    if (!success) return new Response(JSON.stringify({ error: "the portal needs a breather" }), { status: 429, headers });
  }
  const body = await req.text();
  if (body.length > 6e5) return new Response(JSON.stringify({ error: "too big" }), { status: 413, headers });
  let d;
  try {
    d = JSON.parse(body);
  } catch (e) {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers });
  }
  if (!d || !Array.isArray(d.pieces) || !d.pieces.length) return new Response(JSON.stringify({ error: "no pieces" }), { status: 400, headers });
  const text = await storedPile(env, ctx);
  const nl = text.indexOf("\n");
  const head = headOf(text);
  if (head.fuelDay !== today) {
    head.fuelDay = today;
    head.fuelUsed = 0;
  }
  if (head.fuelUsed >= cap) return noFuel();
  d.pieces = d.pieces.slice(0, d.payload ? 400 : 120);
  if (Array.isArray(d.objects)) d.objects = d.objects.slice(0, 60);
  d = slimDrop(d);
  d.id = crypto.randomUUID();
  d.at = Math.max(now, head.last + 1);
  const lines = nl < 0 ? [] : text.slice(nl + 1).split("\n").filter(Boolean);
  lines.push(`${d.at}	${JSON.stringify(d)}`);
  let chars = lines.reduce((n, l) => n + l.length + 1, 0);
  while (lines.length > KEEP || chars > KEEP_CHARS && lines.length > 1) chars -= lines.shift().length + 1;
  head.fuelUsed++;
  head.last = d.at;
  const out = JSON.stringify({ v: 2, fuelDay: head.fuelDay, fuelUsed: head.fuelUsed, last: head.last }) + "\n" + lines.join("\n");
  await env.DROPS.put("recent", out);
  cachePile(ctx, out);
  return new Response(JSON.stringify({ id: d.id, at: d.at, fuelLeft: Math.max(0, cap - head.fuelUsed) }), { status: 201, headers });
}
var COUNTS = ["started", "thrown", "shredded", "partial", "survived", "jams", "repairs", "flushes", "designs", "grabs", "shares", "splits", "warps"];
var KEEP_DAYS = 400;
var hdrs = (extra = {}) => ({ "Access-Control-Allow-Origin": "*", "content-type": "application/json", "cache-control": "no-store", ...extra });
async function hit(req, env, ok, now) {
  if (req.method !== "POST") return new Response("{}", { status: 405, headers: hdrs() });
  if (!ok || !env.STATS) return new Response(null, { status: 204, headers: hdrs() });
  let b;
  try {
    const t = await req.text();
    if (t.length > 8e3) throw 0;
    b = JSON.parse(t);
  } catch (e) {
    return new Response(null, { status: 400, headers: hdrs() });
  }
  const id = /^[A-Za-z0-9-]{8,64}$/;
  if (!b || !id.test(b.sid || "") || !id.test(b.vid || "")) return new Response(null, { status: 400, headers: hdrs() });
  const n = (v, max) => Math.max(0, Math.min(max, Math.round(+v || 0)));
  const c = {};
  for (const k of COUNTS) c[k] = n(b.c?.[k], 5e3);
  const objs = Object.entries(b.objs || {}).slice(0, 40).map(([k, v]) => [String(k).slice(0, 40), n(v, 5e3)]).filter(([, v]) => v > 0);
  const row = {
    sid: b.sid,
    vid: b.vid,
    isNew: !!b.isNew,
    day: etParts(now).date,
    now,
    device: ["phone", "tablet", "desktop"].includes(b.device) ? b.device : "other",
    country: String(req.cf?.country || "").slice(0, 2),
    ref: String(b.ref || "").replace(/[^a-z0-9.-]/gi, "").slice(0, 60),
    where: String(b.where || "").replace(/[^a-z0-9.-]/gi, "").slice(0, 40),
    secs: n(b.secs, 86400),
    c,
    objs
  };
  const stub = env.STATS.get(env.STATS.idFromName("shred-hole"));
  await stub.fetch("https://stats/hit", { method: "POST", body: JSON.stringify(row) });
  return new Response(null, { status: 204, headers: hdrs() });
}
async function stats(req, env, ctx, url, now) {
  const days = Math.max(1, Math.min(KEEP_DAYS, +url.searchParams.get("days") || 60));
  const key = new Request(CACHE + "stats/" + days);
  const hit0 = await caches.default.match(key);
  if (hit0) return new Response(hit0.body, { headers: hdrs({ "cache-control": "public, max-age=60", "x-cache": "hit" }) });
  const since = new Date(now - days * 864e5);
  const fromDay = etParts(+since).date;
  let play = { daily: [], devices: [], countries: [], refs: [], objects: [], where: [], totals: {} };
  if (env.STATS) {
    const r = await env.STATS.get(env.STATS.idFromName("shred-hole")).fetch("https://stats/report?from=" + fromDay);
    if (r.ok) play = await r.json();
  }
  const fab = await cachedFab(env, ctx);
  const designsByDay = {};
  for (const it of fab.shelf) {
    if (!it.at || it.at < +since) continue;
    const d = etParts(it.at).date;
    designsByDay[d] = (designsByDay[d] || 0) + 1;
  }
  const pile = await cachedPile(env, ctx), head = headOf(pile);
  const dropsByDay = {};
  for (const line of pile.split("\n").slice(1)) {
    const at = +line.slice(0, line.indexOf("	"));
    if (!at || at < +since) continue;
    const d = etParts(at).date;
    dropsByDay[d] = (dropsByDay[d] || 0) + 1;
  }
  const out = {
    generated: now,
    days,
    from: fromDay,
    tz: "America/New_York",
    play,
    designs: Object.entries(designsByDay).map(([day, n]) => ({ day, n })).sort((a, b) => a.day < b.day ? -1 : 1),
    deliveries: Object.entries(dropsByDay).map(([day, n]) => ({ day, n })).sort((a, b) => a.day < b.day ? -1 : 1),
    shop: { ...status(fab, env, now), shelfItems: fab.shelf.length, tokens: fab.tokens || null, model: env.MODEL || "claude-sonnet-5-5" },
    portal: { ...fuelStatus(head, env, now), mailboxDrops: Math.max(0, pile.split("\n").length - 1), mailboxBytes: pile.length }
  };
  const text = JSON.stringify(out);
  ctx.waitUntil(caches.default.put(key, new Response(text, { headers: { "cache-control": "max-age=60" } })));
  return new Response(text, { headers: hdrs({ "cache-control": "public, max-age=60" }) });
}
var Stats = class {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS visits (
      sid TEXT PRIMARY KEY, vid TEXT, is_new INTEGER, day TEXT, first INTEGER, last INTEGER,
      device TEXT, country TEXT, ref TEXT, place TEXT, secs INTEGER,
      ${COUNTS.map((k) => k + " INTEGER DEFAULT 0").join(", ")})`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS visits_day ON visits(day)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS thrown (sid TEXT, day TEXT, name TEXT, n INTEGER, PRIMARY KEY (sid, name))");
    this.sql.exec("CREATE INDEX IF NOT EXISTS thrown_day ON thrown(day)");
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/hit") {
      const r = await req.json();
      this.sql.exec(
        `INSERT INTO visits (sid, vid, is_new, day, first, last, device, country, ref, place, secs, ${COUNTS.join(", ")})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${COUNTS.map(() => "?").join(", ")})
        ON CONFLICT(sid) DO UPDATE SET last = excluded.last, secs = MAX(visits.secs, excluded.secs),
        ${COUNTS.map((k) => `${k} = MAX(visits.${k}, excluded.${k})`).join(", ")}`,
        r.sid,
        r.vid,
        r.isNew ? 1 : 0,
        r.day,
        r.now,
        r.now,
        r.device,
        r.country,
        r.ref,
        r.where,
        r.secs,
        ...COUNTS.map((k) => r.c[k])
      );
      for (const [name, n] of r.objs) {
        this.sql.exec("INSERT INTO thrown (sid, day, name, n) VALUES (?, ?, ?, ?) ON CONFLICT(sid, name) DO UPDATE SET n = MAX(thrown.n, excluded.n)", r.sid, r.day, name, n);
      }
      if (Math.random() < 0.01) {
        const cut = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
        this.sql.exec("DELETE FROM visits WHERE day < ?", cut);
        this.sql.exec("DELETE FROM thrown WHERE day < ?", cut);
      }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/report") {
      const from = url.searchParams.get("from") || "0000";
      const all = (q, ...a) => [...this.sql.exec(q, ...a)];
      const sums = COUNTS.map((k) => `SUM(${k}) AS ${k}`).join(", ");
      const daily = all(`SELECT day, COUNT(*) AS visits, COUNT(DISTINCT vid) AS visitors, SUM(is_new) AS newVisitors,
          SUM(CASE WHEN started > 0 THEN 1 ELSE 0 END) AS played, ROUND(AVG(secs)) AS avgSecs, SUM(secs) AS secs, ${sums}
        FROM visits WHERE day >= ? GROUP BY day ORDER BY day`, from);
      const totals = all(`SELECT COUNT(*) AS visits, COUNT(DISTINCT vid) AS visitors, SUM(is_new) AS newVisitors,
          SUM(CASE WHEN started > 0 THEN 1 ELSE 0 END) AS played, ROUND(AVG(secs)) AS avgSecs, SUM(secs) AS secs, ${sums}
        FROM visits WHERE day >= ?`, from)[0] || {};
      const returning = all(`SELECT COUNT(*) AS n FROM (SELECT vid FROM visits WHERE day >= ? GROUP BY vid HAVING COUNT(DISTINCT day) > 1)`, from)[0]?.n || 0;
      const by = (col) => all(`SELECT ${col} AS k, COUNT(*) AS visits, COUNT(DISTINCT vid) AS visitors FROM visits WHERE day >= ? GROUP BY ${col} ORDER BY visits DESC LIMIT 15`, from);
      return Response.json({
        daily,
        totals: { ...totals, returningVisitors: returning },
        devices: by("device"),
        countries: by("country"),
        refs: by("ref"),
        where: by("place"),
        objects: all("SELECT name, SUM(n) AS n, COUNT(DISTINCT sid) AS visits FROM thrown WHERE day >= ? GROUP BY name ORDER BY n DESC LIMIT 25", from),
        hours: all(`SELECT CAST(strftime('%H', first / 1000, 'unixepoch') AS INTEGER) AS hourUTC, COUNT(*) AS visits FROM visits WHERE day >= ? GROUP BY hourUTC ORDER BY hourUTC`, from)
      });
    }
    return new Response("not found", { status: 404 });
  }
};
export {
  Stats,
  worker_default as default
};
