// Built from worker/worker.js + js/prompt.js (esbuild --bundle --format=esm). Upload this file as-is if you deploy without wrangler.
// js/prompt.js
var SPRAYS = ["juice", "yolk", "pulp", "seeds", "confetti", "paper", "feathers", "dust", "shards", "glass", "sparks", "foam", "plastic", "fabric", "food", "cash"];
var SOUNDS = ["squeak", "squish", "splat", "crack", "shatter", "glass", "clang", "thunk", "pop", "tear", "squawk", "crunch", "zap"];
var MATERIAL_NAMES = ["plastic", "rubber", "metal", "chrome", "steel", "iron", "glass", "ceramic", "wood", "fruit", "paper", "fabric", "stone", "food", "glow"];
function recipePrompt(what) {
  return `You design objects for a silly-but-physically-grounded 3D wind tunnel game where objects get blown into a giant fan and shredded ("Will It Blend?" energy). Design: "${what}".

Return ONLY a JSON object (no prose, no code fence) with this schema:
{
 "name": short display name,
 "icon": one emoji,
 "mass": REAL total mass in kg. This matters: breakability is computed from the materials, the size and how solid the thing is (mass \xF7 volume), so a hollow fridge and a solid safe of the same size must have very different masses,
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
 "parts": 1\u201324 primitives that together look like the object, each:
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
var cfg = (env) => ({
  pool: +env.GEN_POOL_PER_HOUR || 40,
  dayCap: +env.GEN_PER_DAY || 150,
  perPerson: +env.GEN_PER_HOUR || 20,
  fuel: +env.FUEL_PER_DAY || 600
});
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
async function writeFab(env, ctx, fab) {
  const text = JSON.stringify(fab);
  await env.DROPS.put("fab", text);
  ctx.waitUntil(caches.default.put(new Request(CACHE + "fab"), new Response(text, { headers: { "cache-control": "max-age=10" } })));
}
async function cachedFab(env, ctx) {
  const key = new Request(CACHE + "fab");
  const hit = await caches.default.match(key);
  if (hit) {
    try {
      return { ...await readFabText(await hit.text()) };
    } catch (e) {
    }
  }
  const fab = await readFab(env);
  ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(fab), { headers: { "cache-control": "max-age=10" } })));
  return fab;
}
var readFabText = (t) => ({ day: "", dayUsed: 0, hour: 0, hourUsed: 0, lastJam: 0, shelf: [], ...JSON.parse(t) });
function status(fab, env, now) {
  const c = cfg(env);
  roll(fab, now);
  const dayLeft = Math.max(0, c.dayCap - fab.dayUsed), poolLeft = Math.max(0, Math.min(c.pool - fab.hourUsed, dayLeft));
  return {
    pool: c.pool,
    poolLeft,
    dayCap: c.dayCap,
    dayLeft,
    perPerson: c.perPerson,
    open: dayLeft > 0,
    excuse: EXCUSES[hashStr(fab.day) % EXCUSES.length],
    opensIn: opensIn(now),
    resetsIn: 36e5 - now % 36e5,
    lastJam: fab.lastJam || 0,
    shelf: fab.shelf.length
  };
}
var RECENT_TTL = 10;
function parseRecent(text) {
  const v = JSON.parse(text || "[]");
  return Array.isArray(v) ? { fuelDay: "", fuelUsed: 0, drops: v } : { fuelDay: "", fuelUsed: 0, drops: [], ...v };
}
async function cachedRecent(env, ctx) {
  const key = new Request(CACHE + "drops/recent");
  const hit = await caches.default.match(key);
  if (hit) return parseRecent(await hit.text());
  const text = await env.DROPS.get("recent") || "[]";
  ctx.waitUntil(caches.default.put(key, new Response(text, { headers: { "cache-control": `max-age=${RECENT_TTL}` } })));
  return parseRecent(text);
}
function fuelStatus(rec, env, now) {
  const cap = cfg(env).fuel, used = rec.fuelDay === fuelDay(now) ? rec.fuelUsed : 0;
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
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Private-Network": "true" } });
    const url = new URL(req.url), path = url.pathname.replace(/\/$/, "") || "/";
    if (!env.DROPS && path !== "/") return json({ error: "no KV namespace bound as DROPS" }, 501);
    const now = Date.now();
    if (path === "/drops") return drops(req, env, url, ok, origin, ctx);
    if (path === "/quota") {
      const [fab2, rec] = await Promise.all([cachedFab(env, ctx), cachedRecent(env, ctx)]);
      return json({ ...status(fab2, env, now), ...fuelStatus(rec, env, now), on: !!env.ANTHROPIC_API_KEY });
    }
    if (path === "/warehouse") {
      const fab2 = await cachedFab(env, ctx);
      return json({ items: fab2.shelf.slice().reverse().map(({ k: k2, name, icon, at }) => ({ k: k2, name, icon, at })) });
    }
    if (path === "/warehouse/item") {
      const k2 = objectKey(url.searchParams.get("k") || "");
      const it = (await cachedFab(env, ctx)).shelf.find((x) => x.k === k2) || (await readFab(env)).shelf.find((x) => x.k === k2);
      return it ? json({ recipe: it.recipe, name: it.name }) : json({ error: "not on the shelf" }, 404);
    }
    if (path === "/jam") {
      if (req.method !== "POST" || !ok) return json({ error: "nope" }, 405);
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
    let fab = await readFab(env);
    const onShelf = fab.shelf.find((x) => x.k === k);
    if (onShelf) return reply({ recipe: onShelf.recipe, shelf: true }, 200, { "x-cache": "shelf" });
    const old = await caches.default.match(new Request(CACHE + "v1/" + encodeURIComponent(what.toLowerCase())));
    if (old) {
      try {
        const { recipe: recipe2 } = await old.json();
        fab.shelf.push({ k, name: recipe2.name || what, icon: recipe2.icon || "\u2728", at: now, recipe: recipe2 });
        while (fab.shelf.length > SHELF_MAX) fab.shelf.shift();
        await writeFab(env, ctx, fab);
        return reply({ recipe: recipe2, shelf: true }, 200, { "x-cache": "shelf" });
      } catch (e) {
      }
    }
    if (!env.ANTHROPIC_API_KEY) return reply("\u201CType anything\u201D isn\u2019t switched on yet: the Worker has no Claude API key. The built-in objects all work.", 501);
    const st = status(fab, env, now);
    if (!st.open) {
      const hrs = Math.max(1, Math.round(st.opensIn / 36e5));
      return reply(`CLOSED. ${st.excuse} Back at 9 AM Eastern (in about ${hrs} h). Everything in the Warehouse is still free.`, 429, { "x-shop": "closed" });
    }
    if (st.poolLeft <= 0) {
      const mins = Math.max(1, Math.ceil(st.resetsIn / 6e4));
      return reply(`The Fabricator is out of tickets for this hour. A new batch of ${st.pool} arrives in about ${mins} min. Everything in the Warehouse is still free.`, 429, { "x-shop": "tickets" });
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.MODEL || "claude-sonnet-5-5", max_tokens: 3e3, messages: [{ role: "user", content: recipePrompt(what) }] })
    });
    if (!r.ok) return reply("Claude is busy: " + (await r.text()).slice(0, 200), 502);
    const j = await r.json();
    const text = (j.content || []).map((c) => c.text || "").join("");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    let recipe;
    try {
      recipe = JSON.parse(text.slice(a, b + 1));
    } catch (e) {
      return reply("Claude returned something unparseable", 502);
    }
    fab = roll(await readFab(env), now);
    fab.dayUsed++;
    fab.hourUsed++;
    if (!fab.shelf.some((x) => x.k === k)) fab.shelf.push({ k, name: recipe.name || what, icon: recipe.icon || "\u2728", at: now, recipe });
    while (fab.shelf.length > SHELF_MAX) fab.shelf.shift();
    await writeFab(env, ctx, fab);
    const after = status(fab, env, now);
    return reply({ recipe }, 200, { "x-cache": "miss", "x-pool-left": String(after.poolLeft), "x-day-left": String(after.dayLeft) });
  }
};
var KEEP = 300;
async function drops(req, env, url, ok, origin, ctx) {
  const headers = { "Access-Control-Allow-Origin": origin || "*", "Vary": "Origin", "content-type": "application/json", "cache-control": "no-store", "Access-Control-Expose-Headers": "x-portal" };
  const now = Date.now();
  if (req.method === "GET") {
    const since = +url.searchParams.get("since") || 0;
    const rec2 = await cachedRecent(env, ctx);
    return new Response(JSON.stringify({ now, drops: rec2.drops.filter((d2) => d2.at > since) }), { headers });
  }
  if (req.method !== "POST") return new Response("{}", { status: 405, headers });
  if (!ok) return new Response(JSON.stringify({ error: "origin not allowed" }), { status: 403, headers });
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: "d:" + (req.headers.get("CF-Connecting-IP") || "anon") });
    if (!success) return new Response(JSON.stringify({ error: "the portal needs a breather" }), { status: 429, headers });
  }
  const text = await req.text();
  if (text.length > 6e5) return new Response(JSON.stringify({ error: "too big" }), { status: 413, headers });
  let d;
  try {
    d = JSON.parse(text);
  } catch (e) {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers });
  }
  if (!d || !Array.isArray(d.pieces) || !d.pieces.length) return new Response(JSON.stringify({ error: "no pieces" }), { status: 400, headers });
  const rec = parseRecent(await env.DROPS.get("recent"));
  const today = fuelDay(now);
  if (rec.fuelDay !== today) {
    rec.fuelDay = today;
    rec.fuelUsed = 0;
  }
  if (rec.fuelUsed >= cfg(env).fuel) {
    return new Response(JSON.stringify({ error: "out of fuel", refuelIn: refuelIn(now) }), { status: 503, headers: { ...headers, "x-portal": "out-of-fuel" } });
  }
  d.pieces = d.pieces.slice(0, d.payload ? 400 : 120);
  if (Array.isArray(d.objects)) d.objects = d.objects.slice(0, 60);
  d.id = crypto.randomUUID();
  d.at = Math.max(now, (rec.drops[rec.drops.length - 1]?.at || 0) + 1);
  rec.drops.push(d);
  rec.fuelUsed++;
  while (rec.drops.length > KEEP || JSON.stringify(rec.drops).length > 2e7) rec.drops.shift();
  const out = JSON.stringify(rec);
  await env.DROPS.put("recent", out);
  ctx.waitUntil(caches.default.put(new Request(CACHE + "drops/recent"), new Response(out, { headers: { "cache-control": `max-age=${RECENT_TTL}` } })));
  return new Response(JSON.stringify({ id: d.id, at: d.at, fuelLeft: Math.max(0, cfg(env).fuel - rec.fuelUsed) }), { status: 201, headers });
}
export {
  worker_default as default
};
