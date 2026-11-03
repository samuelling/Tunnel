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
//  POST /hit              anonymous usage counts from the page (js/stats.js) → the Stats Durable Object
//  GET  /stats?days=N     the usage dashboard's numbers: daily visits, play, designs, drops, tokens
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
//  • Readers (quota, warehouse, the pile) share short-lived copies in the edge cache, and the
//    copies are shaped so a reader never has to parse the big records: the Warehouse is cached
//    without its recipes, and the pile is stored one drop per line behind a one-line header, so
//    "anything new since T?" is answered from the header alone.
//  • Drops are stored slim (Debris Drop v2, js/dropcodec.js), about 4× smaller than v1.
//  • Claude tokens: the design brief is a cached system prompt (repeat reads cost a small fraction
//    of normal input), the reply is asked for as minified JSON without default-valued fields and
//    with ≤16 parts, max_tokens is 2000, and names that differ only by size words ("a big donut")
//    come off the shelf free, and thinking is off (it was billed as output). Running totals are on
//    /quota as `tokens`.
//  • POSTs from the page are sent as text/plain, so browsers skip the CORS preflight (one
//    request per POST, not two); real preflights are cached for a day.
import { RECIPE_SYSTEM, recipeUser, objectKey, looseKey } from '../js/prompt.js';
import { slimDrop } from '../js/dropcodec.js';

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
// the Warehouse as readers see it: counters + names, no recipes (a fraction of the size)
const lite = (fab) => ({ ...fab, shelf: fab.shelf.map(({ k, name, icon, at }) => ({ k, name, icon, at })) });   // tokens ride along
const FAB_TTL = 30;
function cacheLite(ctx, fab) {
  ctx.waitUntil(caches.default.put(new Request(CACHE + 'fab-lite'), new Response(JSON.stringify(lite(fab)), { headers: { 'cache-control': `max-age=${FAB_TTL}` } })));
}
async function writeFab(env, ctx, fab) {
  await env.DROPS.put('fab', JSON.stringify(fab));
  cacheLite(ctx, fab);
}
async function cachedFab(env, ctx) {
  const hit = await caches.default.match(new Request(CACHE + 'fab-lite'));
  if (hit) { try { return readFabText(await hit.text()); } catch (e) { /* fall through */ } }
  const fab = await readFab(env);
  cacheLite(ctx, fab);
  return lite(fab);
}
// one shelf item's recipe; recipes never change, so its cached copy lives for a day
async function shelfItem(env, ctx, k) {
  const key = new Request(CACHE + 'item/' + encodeURIComponent(k));
  const hit = await caches.default.match(key);
  if (hit) { try { return await hit.json(); } catch (e) { /* fall through */ } }
  const it = (await readFab(env)).shelf.find(x => x.k === k);
  if (!it) return null;
  const out = { recipe: it.recipe, name: it.name };
  ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(out), { headers: { 'cache-control': 'max-age=86400' } })));
  return out;
}
const readFabText = (t) => ({ day: '', dayUsed: 0, hour: 0, hourUsed: 0, lastJam: 0, shelf: [], ...JSON.parse(t) });
function status(fab, env, now) {
  const c = cfg(env); roll(fab, now);
  const dayLeft = Math.max(0, c.dayCap - fab.dayUsed), poolLeft = Math.max(0, Math.min(c.pool - fab.hourUsed, dayLeft));
  return { pool: c.pool, poolLeft, dayCap: c.dayCap, dayLeft, perPerson: c.perPerson, open: dayLeft > 0,
    excuse: EXCUSES[hashStr(fab.day) % EXCUSES.length], opensIn: opensIn(now), resetsIn: 3.6e6 - (now % 3.6e6),
    lastJam: fab.lastJam || 0, shelf: fab.shelf.length };
}

const shelfList = (fab) => fab.shelf.slice().reverse().map(({ k, name, icon, at }) => ({ k, name, icon, at }));

// ---- the pile's mailbox, record 'recent'. v2 layout, one drop per line:
//   {"v":2,"fuelDay":"2026-11-03","fuelUsed":12,"last":1793...}      ← header
//   1793...\t{…drop…}                                               ← "at", a tab, the drop
// so readers can answer "anything since T?" from the header, and pull out new drops without
// parsing any of them. (v1 was one big JSON object; it's converted the first time it's read.)
const RECENT_TTL = 15;
const PILE_KEY = CACHE + 'drops/v2';
const emptyHead = () => ({ v: 2, fuelDay: '', fuelUsed: 0, last: 0 });
function parseRecent(text) {   // v1
  const v = JSON.parse(text || '[]');
  return Array.isArray(v) ? { fuelDay: '', fuelUsed: 0, drops: v } : { fuelDay: '', fuelUsed: 0, drops: [], ...v };
}
const headOf = (text) => { const nl = text.indexOf('\n'); return { ...emptyHead(), ...JSON.parse(nl < 0 ? text : text.slice(0, nl)) }; };
const isV2 = (text) => text.startsWith('{"v":2');
function v1ToV2(text) {
  const old = parseRecent(text);
  const lines = old.drops.map(d => `${d.at}\t${JSON.stringify(slimDrop(d))}`);
  return JSON.stringify({ v: 2, fuelDay: old.fuelDay, fuelUsed: old.fuelUsed, last: old.drops[old.drops.length - 1]?.at || 0 }) + (lines.length ? '\n' + lines.join('\n') : '');
}
const HEAD_KEY = CACHE + 'drops/v2-head';
function cachePile(ctx, text) {
  const nl = text.indexOf('\n');
  const h = { headers: { 'cache-control': `max-age=${RECENT_TTL}` } };
  ctx.waitUntil(Promise.all([
    caches.default.put(new Request(PILE_KEY), new Response(text, h)),
    caches.default.put(new Request(HEAD_KEY), new Response(nl < 0 ? text : text.slice(0, nl), h)),   // ~100 bytes
  ]));
}
// just the header line: what idle pollers and the status board need
async function pileHead(env, ctx) {
  const hit = await caches.default.match(new Request(HEAD_KEY));
  if (hit) { try { return headOf(await hit.text()); } catch (e) { /* fall through */ } }
  return headOf(await cachedPile(env, ctx));
}
// the stored text, from KV (converting a v1 record once, for good)
async function storedPile(env, ctx) {
  let text = (await env.DROPS.get('recent')) || '';
  if (!text) return JSON.stringify(emptyHead());
  if (!isV2(text)) { text = v1ToV2(text); await env.DROPS.put('recent', text); }
  return text;
}
async function cachedPile(env, ctx) {
  const hit = await caches.default.match(new Request(PILE_KEY));
  if (hit) return hit.text();
  const text = await storedPile(env, ctx);
  cachePile(ctx, text);
  return text;
}
// the drops after `since`, as raw JSON strings, oldest first (scans back from the end)
function linesSince(text, since) {
  const out = [], top = text.indexOf('\n');
  if (top < 0) return out;
  let end = text.length;
  while (end > top) {
    const start = text.lastIndexOf('\n', end - 1);
    const line = text.slice(start + 1, end); end = start;
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (+line.slice(0, tab) <= since) break;
    out.push(line.slice(tab + 1));
  }
  return out.reverse();
}
function fuelStatus(head, env, now) {
  const cap = cfg(env).fuel, used = head.fuelDay === fuelDay(now) ? head.fuelUsed : 0;
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

    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '86400' } });
    const url = new URL(req.url), path = url.pathname.replace(/\/$/, '') || '/';
    if (!env.DROPS && path !== '/') return json({ error: 'no KV namespace bound as DROPS' }, 501);
    const now = Date.now();

    if (path === '/drops') return drops(req, env, url, ok, origin, ctx);
    if (path === '/hit') return hit(req, env, ok, now);
    if (path === '/stats') return stats(req, env, ctx, url, now);
    const brief = { 'cache-control': 'public, max-age=10' };
    if (path === '/quota') {
      const [fab, head] = await Promise.all([cachedFab(env, ctx), pileHead(env, ctx)]);
      const out = { ...status(fab, env, now), ...fuelStatus(head, env, now), on: !!env.ANTHROPIC_API_KEY, wire: 2 };
      if (url.searchParams.has('shelf')) out.items = shelfList(fab);   // the Fabricator dialog asks for both at once
      if (fab.tokens) out.tokens = fab.tokens;   // running total of Claude tokens spent on designs
      return json(out, 200, brief);
    }
    if (path === '/warehouse') return json({ items: shelfList(await cachedFab(env, ctx)) }, 200, brief);
    if (path === '/warehouse/item') {
      const it = await shelfItem(env, ctx, objectKey(url.searchParams.get('k') || ''));
      return it ? json(it, 200, { 'cache-control': 'public, max-age=86400' }) : json({ error: 'not on the shelf' }, 404);
    }
    if (path === '/jam') {
      if (req.method !== 'POST' || !ok) return json({ error: 'nope' }, 405);
      const seen = await cachedFab(env, ctx);   // a jam in the last 10 minutes already counts: no read, no write
      if (now - (seen.lastJam || 0) <= 10 * 60000) return json({ lastJam: seen.lastJam });
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

    const seen = await cachedFab(env, ctx);
    // 1. the Warehouse: anyone made it before? free
    const lk = looseKey(what);
    const match = seen.shelf.find(x => x.k === k) || seen.shelf.find(x => looseKey(x.k) === lk);   // "a big donut" = "donut"
    if (match) {
      const it = await shelfItem(env, ctx, match.k);
      if (it) return reply({ recipe: it.recipe, shelf: true }, 200, { 'x-cache': 'shelf' });
    }
    if (!env.ANTHROPIC_API_KEY) return reply('“Type anything” isn’t switched on yet: the Worker has no Claude API key. The built-in objects all work.', 501);
    // 2. shop hours and the hourly pool (from the shared copy; the real count is redone at write time)
    const st = status(seen, env, now);
    if (!st.open) {
      const hrs = Math.max(1, Math.round(st.opensIn / 3.6e6));
      return reply(`CLOSED. ${st.excuse} Back at 9 AM Eastern (in about ${hrs} h). Everything in the Warehouse is still free.`, 429, { 'x-shop': 'closed' });
    }
    if (st.poolLeft <= 0) {
      const mins = Math.max(1, Math.ceil(st.resetsIn / 6e4));
      return reply(`The Fabricator is out of tickets for this hour. A new batch of ${st.pool} arrives in about ${mins} min. Everything in the Warehouse is still free.`, 429, { 'x-shop': 'tickets' });
    }
    // 3. Claude designs it. The brief is the system prompt, marked for caching (it's identical every
    //    time); only the object's name is new. max_tokens leaves room for a 16-part design (~1k).
    // Sonnet 5.5 thinks before answering by default (high effort, adaptive thinking), and thinking is
    // billed as output. A design is a one-shot fill-in-the-schema job, so thinking is turned off
    // (between_tools: with no tools, that means none) and effort set to medium. THINKING=adaptive
    // and EFFORT=high in the Worker's variables bring the old behaviour back.
    const ask = (lean) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.MODEL || 'claude-sonnet-5-5', max_tokens: +env.MAX_TOKENS || 2000,
        system: [{ type: 'text', text: RECIPE_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: recipeUser(what) }],
        ...(lean ? { thinking: { type: env.THINKING || 'between_tools' }, output_config: { effort: env.EFFORT || 'medium' } } : {}),
      }),
    });
    let r = await ask(true);
    if (r.status === 400) r = await ask(false);   // a model that doesn't take those settings: ask plainly
    if (!r.ok) return reply('Claude is busy: ' + (await r.text()).slice(0, 200), 502);
    const j = await r.json();
    const text = (j.content || []).map(c => c.text || '').join('');
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    let recipe;
    try { recipe = JSON.parse(text.slice(a, b + 1)); } catch (e) { return reply(j.stop_reason === 'max_tokens' ? 'That design got too elaborate. Try something simpler.' : 'Claude returned something unparseable', 502); }
    // 4. one write: count it, shelve it and add up the tokens (re-read first so a parallel shelving isn't lost)
    const fab = roll(await readFab(env), now);
    fab.dayUsed++; fab.hourUsed++;
    if (!fab.shelf.some(x => x.k === k)) fab.shelf.push({ k, name: recipe.name || what, icon: recipe.icon || '✨', at: now, recipe });
    while (fab.shelf.length > SHELF_MAX) fab.shelf.shift();
    const u = j.usage || {}, t = fab.tokens || (fab.tokens = { n: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
    t.n++; t.in += u.input_tokens || 0; t.out += u.output_tokens || 0;
    t.cacheRead += u.cache_read_input_tokens || 0; t.cacheWrite += u.cache_creation_input_tokens || 0;
    t.thinking = (t.thinking || 0) + (u.output_tokens_details?.thinking_tokens || 0);
    await writeFab(env, ctx, fab);
    const after = status(fab, env, now);
    return reply({ recipe }, 200, { 'x-cache': 'miss', 'x-pool-left': String(after.poolLeft), 'x-day-left': String(after.dayLeft) });
  },
};

// ---------------------------------------------------------------- the portal's mailbox
const KEEP = 300, KEEP_CHARS = 12e6;
async function drops(req, env, url, ok, origin, ctx) {
  const headers = { 'Access-Control-Allow-Origin': origin || '*', 'Vary': 'Origin', 'content-type': 'application/json', 'cache-control': 'no-store', 'Access-Control-Expose-Headers': 'x-portal' };
  const now = Date.now();
  if (req.method === 'GET') {
    const since = +url.searchParams.get('since') || 0;
    // nothing new: answered from the cached header line; the drops themselves are never touched
    let text = null, head = null, fresh = [];
    const hh = await caches.default.match(new Request(HEAD_KEY));
    if (hh) { try { head = headOf(await hh.text()); } catch (e) { /* read the whole thing */ } }
    if (!head) { text = await cachedPile(env, ctx); head = headOf(text); }
    if (since < head.last) { text = text ?? await cachedPile(env, ctx); head = headOf(text); fresh = linesSince(text, since); }
    return new Response(`{"now":${now},"last":${head.last},"drops":[${fresh.join(',')}]}`, { headers });
  }
  if (req.method !== 'POST') return new Response('{}', { status: 405, headers });
  if (!ok) return new Response(JSON.stringify({ error: 'origin not allowed' }), { status: 403, headers });
  const today = fuelDay(now), cap = cfg(env).fuel;
  const noFuel = () => new Response(JSON.stringify({ error: 'out of fuel', refuelIn: refuelIn(now) }), { status: 503, headers: { ...headers, 'x-portal': 'out-of-fuel' } });
  // out of fuel, by the shared copy? say so without reading the mailbox
  const seen = await caches.default.match(new Request(HEAD_KEY));
  if (seen) { try { const h = headOf(await seen.text()); if (h.fuelDay === today && h.fuelUsed >= cap) return noFuel(); } catch (e) { /* read it properly */ } }
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: 'd:' + (req.headers.get('CF-Connecting-IP') || 'anon') });
    if (!success) return new Response(JSON.stringify({ error: 'the portal needs a breather' }), { status: 429, headers });
  }
  const body = await req.text();
  if (body.length > 600000) return new Response(JSON.stringify({ error: 'too big' }), { status: 413, headers });
  let d;
  try { d = JSON.parse(body); } catch (e) { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers }); }
  if (!d || !Array.isArray(d.pieces) || !d.pieces.length) return new Response(JSON.stringify({ error: 'no pieces' }), { status: 400, headers });
  const text = await storedPile(env, ctx);
  const nl = text.indexOf('\n');
  const head = headOf(text);
  if (head.fuelDay !== today) { head.fuelDay = today; head.fuelUsed = 0; }
  if (head.fuelUsed >= cap) return noFuel();
  d.pieces = d.pieces.slice(0, d.payload ? 400 : 120);
  if (Array.isArray(d.objects)) d.objects = d.objects.slice(0, 60);
  d = slimDrop(d);   // pages from before v2 still send fat drops; store them slim
  d.id = crypto.randomUUID();
  d.at = Math.max(now, head.last + 1);
  const lines = nl < 0 ? [] : text.slice(nl + 1).split('\n').filter(Boolean);
  lines.push(`${d.at}\t${JSON.stringify(d)}`);
  let chars = lines.reduce((n, l) => n + l.length + 1, 0);
  while (lines.length > KEEP || (chars > KEEP_CHARS && lines.length > 1)) chars -= lines.shift().length + 1;
  head.fuelUsed++; head.last = d.at;
  const out = JSON.stringify({ v: 2, fuelDay: head.fuelDay, fuelUsed: head.fuelUsed, last: head.last }) + '\n' + lines.join('\n');
  await env.DROPS.put('recent', out);
  cachePile(ctx, out);
  return new Response(JSON.stringify({ id: d.id, at: d.at, fuelLeft: Math.max(0, cap - head.fuelUsed) }), { status: 201, headers });
}

// ---------------------------------------------------------------- usage stats
// Visits and play counts live in a Durable Object with its own SQLite database: thousands of small
// writes a day cost nothing against KV's 1,000-write budget. Nothing personal is kept: a random
// visitor id from the visitor's browser, a random visit id, device kind, country (from Cloudflare),
// the referring site and counts.
const COUNTS = ['started', 'thrown', 'shredded', 'partial', 'survived', 'jams', 'repairs', 'flushes', 'designs', 'grabs', 'shares', 'splits', 'warps'];
const KEEP_DAYS = 400;
const hdrs = (extra = {}) => ({ 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });

async function hit(req, env, ok, now) {
  if (req.method !== 'POST') return new Response('{}', { status: 405, headers: hdrs() });
  if (!ok || !env.STATS) return new Response(null, { status: 204, headers: hdrs() });
  let b;
  try { const t = await req.text(); if (t.length > 8000) throw 0; b = JSON.parse(t); } catch (e) { return new Response(null, { status: 400, headers: hdrs() }); }
  const id = /^[A-Za-z0-9-]{8,64}$/;
  if (!b || !id.test(b.sid || '') || !id.test(b.vid || '')) return new Response(null, { status: 400, headers: hdrs() });
  const n = (v, max) => Math.max(0, Math.min(max, Math.round(+v || 0)));
  const c = {}; for (const k of COUNTS) c[k] = n(b.c?.[k], 5000);
  const objs = Object.entries(b.objs || {}).slice(0, 40).map(([k, v]) => [String(k).slice(0, 40), n(v, 5000)]).filter(([, v]) => v > 0);
  const row = {
    sid: b.sid, vid: b.vid, isNew: !!b.isNew, day: etParts(now).date, now,
    device: ['phone', 'tablet', 'desktop'].includes(b.device) ? b.device : 'other',
    country: String(req.cf?.country || '').slice(0, 2), ref: String(b.ref || '').replace(/[^a-z0-9.-]/gi, '').slice(0, 60),
    where: String(b.where || '').replace(/[^a-z0-9.-]/gi, '').slice(0, 40),
    secs: n(b.secs, 86400), c, objs,
  };
  const stub = env.STATS.get(env.STATS.idFromName('shred-hole'));
  await stub.fetch('https://stats/hit', { method: 'POST', body: JSON.stringify(row) });
  return new Response(null, { status: 204, headers: hdrs() });
}

async function stats(req, env, ctx, url, now) {
  const days = Math.max(1, Math.min(KEEP_DAYS, +url.searchParams.get('days') || 60));
  const key = new Request(CACHE + 'stats/' + days);
  const hit0 = await caches.default.match(key);
  if (hit0) return new Response(hit0.body, { headers: hdrs({ 'cache-control': 'public, max-age=60', 'x-cache': 'hit' }) });
  const since = new Date(now - days * 864e5);
  const fromDay = etParts(+since).date;
  // visits and play, from the Stats object
  let play = { daily: [], devices: [], countries: [], refs: [], objects: [], where: [], totals: {} };
  if (env.STATS) {
    const r = await env.STATS.get(env.STATS.idFromName('shred-hole')).fetch('https://stats/report?from=' + fromDay);
    if (r.ok) play = await r.json();
  }
  // designs and the Warehouse, from the shop record (cached copy, no recipes)
  const fab = await cachedFab(env, ctx);
  const designsByDay = {};
  for (const it of fab.shelf) { if (!it.at || it.at < +since) continue; const d = etParts(it.at).date; designsByDay[d] = (designsByDay[d] || 0) + 1; }
  // deliveries to World Builder, from the mailbox's line stamps (no drop is parsed)
  const pile = await cachedPile(env, ctx), head = headOf(pile);
  const dropsByDay = {};
  for (const line of pile.split('\n').slice(1)) {
    const at = +line.slice(0, line.indexOf('\t'));
    if (!at || at < +since) continue;
    const d = etParts(at).date; dropsByDay[d] = (dropsByDay[d] || 0) + 1;
  }
  const out = {
    generated: now, days, from: fromDay, tz: 'America/New_York',
    play,
    designs: Object.entries(designsByDay).map(([day, n]) => ({ day, n })).sort((a, b) => a.day < b.day ? -1 : 1),
    deliveries: Object.entries(dropsByDay).map(([day, n]) => ({ day, n })).sort((a, b) => a.day < b.day ? -1 : 1),
    shop: { ...status(fab, env, now), shelfItems: fab.shelf.length, tokens: fab.tokens || null, model: env.MODEL || 'claude-sonnet-5-5' },
    portal: { ...fuelStatus(head, env, now), mailboxDrops: Math.max(0, pile.split('\n').length - 1), mailboxBytes: pile.length },
  };
  const text = JSON.stringify(out);
  ctx.waitUntil(caches.default.put(key, new Response(text, { headers: { 'cache-control': 'max-age=60' } })));
  return new Response(text, { headers: hdrs({ 'cache-control': 'public, max-age=60' }) });
}

export class Stats {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS visits (
      sid TEXT PRIMARY KEY, vid TEXT, is_new INTEGER, day TEXT, first INTEGER, last INTEGER,
      device TEXT, country TEXT, ref TEXT, place TEXT, secs INTEGER,
      ${COUNTS.map(k => k + ' INTEGER DEFAULT 0').join(', ')})`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS visits_day ON visits(day)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS thrown (sid TEXT, day TEXT, name TEXT, n INTEGER, PRIMARY KEY (sid, name))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS thrown_day ON thrown(day)');
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/hit') {
      const r = await req.json();
      // a visit reports its running totals, so each report replaces the last
      this.sql.exec(`INSERT INTO visits (sid, vid, is_new, day, first, last, device, country, ref, place, secs, ${COUNTS.join(', ')})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${COUNTS.map(() => '?').join(', ')})
        ON CONFLICT(sid) DO UPDATE SET last = excluded.last, secs = MAX(visits.secs, excluded.secs),
        ${COUNTS.map(k => `${k} = MAX(visits.${k}, excluded.${k})`).join(', ')}`,
        r.sid, r.vid, r.isNew ? 1 : 0, r.day, r.now, r.now, r.device, r.country, r.ref, r.where, r.secs, ...COUNTS.map(k => r.c[k]));
      for (const [name, n] of r.objs) {
        this.sql.exec('INSERT INTO thrown (sid, day, name, n) VALUES (?, ?, ?, ?) ON CONFLICT(sid, name) DO UPDATE SET n = MAX(thrown.n, excluded.n)', r.sid, r.day, name, n);
      }
      // now and then, let the oldest days go
      if (Math.random() < 0.01) {
        const cut = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
        this.sql.exec('DELETE FROM visits WHERE day < ?', cut);
        this.sql.exec('DELETE FROM thrown WHERE day < ?', cut);
      }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/report') {
      const from = url.searchParams.get('from') || '0000';
      const all = (q, ...a) => [...this.sql.exec(q, ...a)];
      const sums = COUNTS.map(k => `SUM(${k}) AS ${k}`).join(', ');
      const daily = all(`SELECT day, COUNT(*) AS visits, COUNT(DISTINCT vid) AS visitors, SUM(is_new) AS newVisitors,
          SUM(CASE WHEN started > 0 THEN 1 ELSE 0 END) AS played, ROUND(AVG(secs)) AS avgSecs, SUM(secs) AS secs, ${sums}
        FROM visits WHERE day >= ? GROUP BY day ORDER BY day`, from);
      const totals = all(`SELECT COUNT(*) AS visits, COUNT(DISTINCT vid) AS visitors, SUM(is_new) AS newVisitors,
          SUM(CASE WHEN started > 0 THEN 1 ELSE 0 END) AS played, ROUND(AVG(secs)) AS avgSecs, SUM(secs) AS secs, ${sums}
        FROM visits WHERE day >= ?`, from)[0] || {};
      const returning = all(`SELECT COUNT(*) AS n FROM (SELECT vid FROM visits WHERE day >= ? GROUP BY vid HAVING COUNT(DISTINCT day) > 1)`, from)[0]?.n || 0;
      const by = (col) => all(`SELECT ${col} AS k, COUNT(*) AS visits, COUNT(DISTINCT vid) AS visitors FROM visits WHERE day >= ? GROUP BY ${col} ORDER BY visits DESC LIMIT 15`, from);
      return Response.json({
        daily, totals: { ...totals, returningVisitors: returning },
        devices: by('device'), countries: by('country'), refs: by('ref'), where: by('place'),
        objects: all('SELECT name, SUM(n) AS n, COUNT(DISTINCT sid) AS visits FROM thrown WHERE day >= ? GROUP BY name ORDER BY n DESC LIMIT 25', from),
        hours: all(`SELECT CAST(strftime('%H', first / 1000, 'unixepoch') AS INTEGER) AS hourUTC, COUNT(*) AS visits FROM visits WHERE day >= ? GROUP BY hourUTC ORDER BY hourUTC`, from),
      });
    }
    return new Response('not found', { status: 404 });
  }
}
