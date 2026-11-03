// The Shred Hole's little helper on Cloudflare.
//
//  POST /                 {"object": "<short name>"} → a recipe. From the Warehouse shelf if anyone has
//                         made it before (free), otherwise Claude designs it (the key and the prompt
//                         stay here, so this can't be used as a general-purpose Claude proxy)
//  GET  /warehouse        the shelf: everything fabricated so far [{k, name, icon, at}]
//  GET  /warehouse/item?k=<key>  → { recipe }
//  GET  /quota            the Fabricator's status board (tickets, shop hours, portal fuel, last jam)
//  POST /jam              someone jammed the fan (for "DAYS SINCE THE FAN JAMMED")
//  POST /drops            a debris drop or payload from the portal → kept for World Builder
//  GET  /drops?since=<ms> → { now, drops } (any origin may read)
//
// Budget, in fun clothes:
//  • Each new design costs ONE KV write: the shop's counters and the shelf live together in one
//    record ('fab'). Personal tickets are counted in the visitor's browser; the shared pool is
//    what really caps it.
//  • The Fabricator keeps shop hours: a shared hourly pool, plus a daily cap. When it's spent,
//    it's CLOSED until 9 AM Eastern, with an excuse.
//  • The portal runs on fuel: a daily budget of drop writes. Out of fuel, drops are refused
//    politely and the page holds them in Lost & Found until it refuels (00:00 UTC, when
//    Cloudflare's own daily limits reset).
//  • Readers (quota, warehouse, the pile) share short-lived copies in the edge cache.
import { recipePrompt, objectKey } from '../js/prompt.js';

const DEFAULT_ORIGINS = ['https://samuelling.github.io'];
const CACHE = 'https://tunnel-cache.invalid/';
const SHELF_MAX = 300;
const EXCUSES = ['Claude went home.', 'Out to lunch.', 'Stocktake.', 'Gone fishing (for objects).', 'Union meeting.', 'The 3D printer jammed. Again.', 'Inventory of left socks.', 'Staff training: “What is a chair?”'];

function corsHeaders(origin, ok) {
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Expose-Headers': 'x-pool-left, x-day-left, x-cache, x-shop',
    'Vary': 'Origin',
  };
}
const cfg = (env) => ({
  pool: +env.GEN_POOL_PER_HOUR || 40,
  dayCap: +env.GEN_PER_DAY || 150,
  perPerson: +env.GEN_PER_HOUR || 20,
  fuel: +env.FUEL_PER_DAY || 600,
});

// ---- clocks: the shop day turns over at 9 AM Eastern; the fuel day at 00:00 UTC
function etParts(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour, m: +p.minute, s: +p.second };
}
const shopDay = (t) => etParts(t - 9 * 3.6e6).date;
function opensIn(t) {
  const { h, m, s } = etParts(t);
  const secs = ((9 - h + 24) % 24) * 3600 - m * 60 - s;
  return (secs <= 0 ? secs + 86400 : secs) * 1000;
}
const hourOf = (t) => Math.floor(t / 3.6e6);
const fuelDay = (t) => new Date(t).toISOString().slice(0, 10);
const refuelIn = (t) => 86400000 - (t % 86400000);
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---- the 'fab' record: shop counters + the Warehouse shelf + the last jam
async function readFab(env) {
  try { return { day: '', dayUsed: 0, hour: 0, hourUsed: 0, lastJam: 0, shelf: [], ...JSON.parse((await env.DROPS.get('fab')) || '{}') }; }
  catch (e) { return { day: '', dayUsed: 0, hour: 0, hourUsed: 0, lastJam: 0, shelf: [] }; }
}
function roll(fab, now) {
  const d = shopDay(now), h = hourOf(now);
  if (fab.day !== d) { fab.day = d; fab.dayUsed = 0; }
  if (fab.hour !== h) { fab.hour = h; fab.hourUsed = 0; }
  return fab;
}
async function writeFab(env, ctx, fab) {
  const text = JSON.stringify(fab);
  await env.DROPS.put('fab', text);
  ctx.waitUntil(caches.default.put(new Request(CACHE + 'fab'), new Response(text, { headers: { 'cache-control': 'max-age=10' } })));
}
async function cachedFab(env, ctx) {
  const key = new Request(CACHE + 'fab');
  const hit = await caches.default.match(key);
  if (hit) { try { return { ...await readFabText(await hit.text()) }; } catch (e) { /* fall through */ } }
  const fab = await readFab(env);
  ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(fab), { headers: { 'cache-control': 'max-age=10' } })));
  return fab;
}
const readFabText = (t) => ({ day: '', dayUsed: 0, hour: 0, hourUsed: 0, lastJam: 0, shelf: [], ...JSON.parse(t) });
function status(fab, env, now) {
  const c = cfg(env); roll(fab, now);
  const dayLeft = Math.max(0, c.dayCap - fab.dayUsed), poolLeft = Math.max(0, Math.min(c.pool - fab.hourUsed, dayLeft));
  return { pool: c.pool, poolLeft, dayCap: c.dayCap, dayLeft, perPerson: c.perPerson, open: dayLeft > 0,
    excuse: EXCUSES[hashStr(fab.day) % EXCUSES.length], opensIn: opensIn(now), resetsIn: 3.6e6 - (now % 3.6e6),
    lastJam: fab.lastJam || 0, shelf: fab.shelf.length };
}

// ---- the 'recent' record: the pile's last drops + today's fuel use
const RECENT_TTL = 10;
function parseRecent(text) {
  const v = JSON.parse(text || '[]');
  return Array.isArray(v) ? { fuelDay: '', fuelUsed: 0, drops: v } : { fuelDay: '', fuelUsed: 0, drops: [], ...v };
}
async function cachedRecent(env, ctx) {
  const key = new Request(CACHE + 'drops/recent');
  const hit = await caches.default.match(key);
  if (hit) return parseRecent(await hit.text());
  const text = (await env.DROPS.get('recent')) || '[]';
  ctx.waitUntil(caches.default.put(key, new Response(text, { headers: { 'cache-control': `max-age=${RECENT_TTL}` } })));
  return parseRecent(text);
}
function fuelStatus(rec, env, now) {
  const cap = cfg(env).fuel, used = rec.fuelDay === fuelDay(now) ? rec.fuelUsed : 0;
  return { fuel: Math.max(0, 1 - used / cap), fuelLeft: Math.max(0, cap - used), fuelCap: cap, refuelIn: refuelIn(now) };
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : DEFAULT_ORIGINS).map(s => s.trim());
    const ok = allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    const cors = corsHeaders(origin, ok);
    const open = { 'Access-Control-Allow-Origin': origin || '*', 'Vary': 'Origin', 'content-type': 'application/json', 'cache-control': 'no-store' };
    const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { ...open, ...extra } });
    const reply = (body, status = 200, extra = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status, headers: { ...cors, 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', ...extra } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Private-Network': 'true' } });
    const url = new URL(req.url), path = url.pathname.replace(/\/$/, '') || '/';
    if (!env.DROPS && path !== '/') return json({ error: 'no KV namespace bound as DROPS' }, 501);
    const now = Date.now();

    if (path === '/drops') return drops(req, env, url, ok, origin, ctx);
    if (path === '/quota') {
      const [fab, rec] = await Promise.all([cachedFab(env, ctx), cachedRecent(env, ctx)]);
      return json({ ...status(fab, env, now), ...fuelStatus(rec, env, now), on: !!env.ANTHROPIC_API_KEY });
    }
    if (path === '/warehouse') {
      const fab = await cachedFab(env, ctx);
      return json({ items: fab.shelf.slice().reverse().map(({ k, name, icon, at }) => ({ k, name, icon, at })) });
    }
    if (path === '/warehouse/item') {
      const k = objectKey(url.searchParams.get('k') || '');
      const it = (await cachedFab(env, ctx)).shelf.find(x => x.k === k) || (await readFab(env)).shelf.find(x => x.k === k);
      return it ? json({ recipe: it.recipe, name: it.name }) : json({ error: 'not on the shelf' }, 404);
    }
    if (path === '/jam') {
      if (req.method !== 'POST' || !ok) return json({ error: 'nope' }, 405);
      const fab = await readFab(env);
      if (now - (fab.lastJam || 0) > 10 * 60000) { fab.lastJam = now; await writeFab(env, ctx, fab); }
      return json({ lastJam: fab.lastJam });
    }
    if (path !== '/') return json({ error: 'not found' }, 404);

    // ---- POST /: fabricate
    if (req.method !== 'POST') return reply('POST only', 405);
    if (!ok) return reply('origin not allowed', 403);
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: req.headers.get('CF-Connecting-IP') || 'anon' });
      if (!success) return reply('Easy there — too many objects. Try again in a minute.', 429);
    }
    let what;
    try { what = String((await req.json()).object || '').replace(/\s+/g, ' ').trim().slice(0, 60); } catch (e) { return reply('bad request', 400); }
    const k = objectKey(what);
    if (!k) return reply('say what to shred', 400);

    let fab = await readFab(env);
    // 1. the Warehouse: anyone made it before? free
    const onShelf = fab.shelf.find(x => x.k === k);
    if (onShelf) return reply({ recipe: onShelf.recipe, shelf: true }, 200, { 'x-cache': 'shelf' });
    // 1b. the old per-name cache (from before the Warehouse): move it onto the shelf, still free
    const old = await caches.default.match(new Request(CACHE + 'v1/' + encodeURIComponent(what.toLowerCase())));
    if (old) {
      try {
        const { recipe } = await old.json();
        fab.shelf.push({ k, name: recipe.name || what, icon: recipe.icon || '✨', at: now, recipe });
        while (fab.shelf.length > SHELF_MAX) fab.shelf.shift();
        await writeFab(env, ctx, fab);
        return reply({ recipe, shelf: true }, 200, { 'x-cache': 'shelf' });
      } catch (e) { /* treat as new */ }
    }
    if (!env.ANTHROPIC_API_KEY) return reply('“Type anything” isn’t switched on yet: the Worker has no Claude API key. The built-in objects all work.', 501);
    // 2. shop hours and the hourly pool
    const st = status(fab, env, now);
    if (!st.open) {
      const hrs = Math.max(1, Math.round(st.opensIn / 3.6e6));
      return reply(`CLOSED. ${st.excuse} Back at 9 AM Eastern (in about ${hrs} h). Everything in the Warehouse is still free.`, 429, { 'x-shop': 'closed' });
    }
    if (st.poolLeft <= 0) {
      const mins = Math.max(1, Math.ceil(st.resetsIn / 6e4));
      return reply(`The Fabricator is out of tickets for this hour. A new batch of ${st.pool} arrives in about ${mins} min. Everything in the Warehouse is still free.`, 429, { 'x-shop': 'tickets' });
    }
    // 3. Claude designs it
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.MODEL || 'claude-sonnet-5-5', max_tokens: 3000, messages: [{ role: 'user', content: recipePrompt(what) }] }),
    });
    if (!r.ok) return reply('Claude is busy: ' + (await r.text()).slice(0, 200), 502);
    const j = await r.json();
    const text = (j.content || []).map(c => c.text || '').join('');
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    let recipe;
    try { recipe = JSON.parse(text.slice(a, b + 1)); } catch (e) { return reply('Claude returned something unparseable', 502); }
    // 4. one write: count it and shelve it (re-read first so a parallel shelving isn't lost)
    fab = roll(await readFab(env), now);
    fab.dayUsed++; fab.hourUsed++;
    if (!fab.shelf.some(x => x.k === k)) fab.shelf.push({ k, name: recipe.name || what, icon: recipe.icon || '✨', at: now, recipe });
    while (fab.shelf.length > SHELF_MAX) fab.shelf.shift();
    await writeFab(env, ctx, fab);
    const after = status(fab, env, now);
    return reply({ recipe }, 200, { 'x-cache': 'miss', 'x-pool-left': String(after.poolLeft), 'x-day-left': String(after.dayLeft) });
  },
};

// ---------------------------------------------------------------- the portal's mailbox
const KEEP = 300;
async function drops(req, env, url, ok, origin, ctx) {
  const headers = { 'Access-Control-Allow-Origin': origin || '*', 'Vary': 'Origin', 'content-type': 'application/json', 'cache-control': 'no-store', 'Access-Control-Expose-Headers': 'x-portal' };
  const now = Date.now();
  if (req.method === 'GET') {
    const since = +url.searchParams.get('since') || 0;
    const rec = await cachedRecent(env, ctx);
    return new Response(JSON.stringify({ now, drops: rec.drops.filter(d => d.at > since) }), { headers });
  }
  if (req.method !== 'POST') return new Response('{}', { status: 405, headers });
  if (!ok) return new Response(JSON.stringify({ error: 'origin not allowed' }), { status: 403, headers });
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: 'd:' + (req.headers.get('CF-Connecting-IP') || 'anon') });
    if (!success) return new Response(JSON.stringify({ error: 'the portal needs a breather' }), { status: 429, headers });
  }
  const text = await req.text();
  if (text.length > 600000) return new Response(JSON.stringify({ error: 'too big' }), { status: 413, headers });
  let d;
  try { d = JSON.parse(text); } catch (e) { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers }); }
  if (!d || !Array.isArray(d.pieces) || !d.pieces.length) return new Response(JSON.stringify({ error: 'no pieces' }), { status: 400, headers });
  const rec = parseRecent(await env.DROPS.get('recent'));
  const today = fuelDay(now);
  if (rec.fuelDay !== today) { rec.fuelDay = today; rec.fuelUsed = 0; }
  if (rec.fuelUsed >= cfg(env).fuel) {
    return new Response(JSON.stringify({ error: 'out of fuel', refuelIn: refuelIn(now) }), { status: 503, headers: { ...headers, 'x-portal': 'out-of-fuel' } });
  }
  d.pieces = d.pieces.slice(0, d.payload ? 400 : 120);
  if (Array.isArray(d.objects)) d.objects = d.objects.slice(0, 60);
  d.id = crypto.randomUUID();
  d.at = Math.max(now, (rec.drops[rec.drops.length - 1]?.at || 0) + 1);
  rec.drops.push(d);
  rec.fuelUsed++;
  while (rec.drops.length > KEEP || JSON.stringify(rec.drops).length > 20e6) rec.drops.shift();
  const out = JSON.stringify(rec);
  await env.DROPS.put('recent', out);
  ctx.waitUntil(caches.default.put(new Request(CACHE + 'drops/recent'), new Response(out, { headers: { 'cache-control': `max-age=${RECENT_TTL}` } })));
  return new Response(JSON.stringify({ id: d.id, at: d.at, fuelLeft: Math.max(0, cfg(env).fuel - rec.fuelUsed) }), { status: 201, headers });
}
