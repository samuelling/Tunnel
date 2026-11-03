// The Shred Hole's little helper on Cloudflare:
//  POST /          {"object": "<short name>"} → Claude designs it (the key stays here; the prompt
//                  is built here too, so this can't be used as a general-purpose Claude proxy)
//  POST /drops     a debris drop from the portal → kept in KV for World Builder
//  GET  /drops?since=<ms>  → { now, drops } for World Builder to collect (any origin may read)
import { recipePrompt } from '../js/prompt.js';

const DEFAULT_ORIGINS = ['https://samuelling.github.io'];

function corsHeaders(origin, ok) {
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Expose-Headers': 'x-gen-remaining, x-pool-left, x-cache',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : DEFAULT_ORIGINS).map(s => s.trim());
    const ok = allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    const cors = corsHeaders(origin, ok);
    const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status, headers: { ...cors, 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Private-Network': 'true' } });
    const url = new URL(req.url);
    if (url.pathname.replace(/\/$/, '') === '/drops') return drops(req, env, url, ok, origin);
    if (url.pathname.replace(/\/$/, '') === '/quota') return quota(req, env, origin);
    if (req.method !== 'POST') return reply('POST only', 405);
    if (!ok) return reply('origin not allowed', 403);

    // per-visitor rate limit (Workers Rate Limiting binding; optional)
    if (env.LIMITER) {
      const ip = req.headers.get('CF-Connecting-IP') || 'anon';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return reply('Easy there — too many objects. Try again in a minute.', 429);
    }

    if (!env.ANTHROPIC_API_KEY) return reply('“Type anything” isn’t switched on yet: the Worker has no Claude API key. The built-in objects all work.', 501);
    let what;
    try { what = String((await req.json()).object || '').replace(/\s+/g, ' ').trim().slice(0, 60); } catch (e) { return reply('bad request', 400); }
    if (!what) return reply('say what to shred', 400);

    // the same object name gets the same recipe for a week (and costs nothing after the first)
    const cacheKey = new Request('https://tunnel-cache.invalid/v1/' + encodeURIComponent(what.toLowerCase()));
    const cached = await caches.default.match(cacheKey);
    if (cached) return new Response(cached.body, { headers: { ...cors, 'content-type': 'application/json', 'x-cache': 'hit' } });

    // Shred tickets: new designs come out of one shared hourly pool for everyone, with a cap per
    // person (connecting IP) so one visitor can't empty it. Cache hits above are free and don't
    // count. Counted per clock hour in KV. KV is eventually consistent, so a burst from several
    // places at once can slip a few past the cap. The 6-per-minute limiter and the Console spend
    // limit stay as the hard ceilings.
    const q = await readQuota(req, env);
    if (q && q.poolLeft <= 0) return reply(`The shred generator is out of tickets for this hour. A new batch of ${q.pool} arrives in about ${q.mins} min. Already-designed things and the built-in objects still work.`, 429);
    if (q && q.youLeft <= 0) return reply(`You've used all ${q.perPerson} of your tickets this hour. More in about ${q.mins} min. The built-in objects are unlimited.`, 429);
    if (q) {
      ctx.waitUntil(Promise.all([
        env.DROPS.put(q.poolKey, String(q.poolUsed + 1), { expirationTtl: 7200 }),
        env.DROPS.put(q.youKey, String(q.youUsed + 1), { expirationTtl: 7200 }),
      ]));
    }
    const poolLeftAfter = q ? String(Math.max(0, q.poolLeft - 1)) : '';
    const left = q ? String(Math.max(0, q.youLeft - 1)) : '';

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
    const body = JSON.stringify({ recipe });
    ctx.waitUntil(caches.default.put(cacheKey, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=604800' } })));
    return new Response(body, { headers: { ...cors, 'content-type': 'application/json', 'x-cache': 'miss', 'x-gen-remaining': left, 'x-pool-left': poolLeftAfter } });
  },
};

// ---------------------------------------------------------------- the portal's mailbox
async function readQuota(req, env) {
  if (!env.DROPS) return null;
  const pool = +env.GEN_POOL_PER_HOUR || 40, perPerson = +env.GEN_PER_HOUR || 20;
  const hour = Math.floor(Date.now() / 3.6e6);
  const poolKey = 'pool:' + hour, youKey = 'gen:' + (req.headers.get('CF-Connecting-IP') || 'anon') + ':' + hour;
  const [p, y] = await Promise.all([env.DROPS.get(poolKey), env.DROPS.get(youKey)]);
  const poolUsed = +p || 0, youUsed = +y || 0;
  const resetsIn = 3.6e6 - (Date.now() % 3.6e6);
  return { pool, perPerson, poolUsed, youUsed, poolKey, youKey, resetsIn, mins: Math.max(1, Math.ceil(resetsIn / 6e4)),
    poolLeft: Math.max(0, pool - poolUsed), youLeft: Math.max(0, Math.min(perPerson - youUsed, pool - poolUsed)) };
}

// public ticket board: how many new designs are left this hour, for everyone and for you
async function quota(req, env, origin) {
  const headers = { 'Access-Control-Allow-Origin': origin || '*', 'Vary': 'Origin', 'content-type': 'application/json', 'cache-control': 'no-store' };
  const q = await readQuota(req, env);
  if (!q) return new Response(JSON.stringify({ error: 'no quota store' }), { status: 501, headers });
  const { pool, perPerson, poolLeft, youLeft, resetsIn } = q;
  return new Response(JSON.stringify({ pool, perPerson, poolLeft, youLeft, resetsIn, on: !!env.ANTHROPIC_API_KEY }), { headers });
}

const KEEP = 300;
async function drops(req, env, url, ok, origin) {
  const headers = { 'Access-Control-Allow-Origin': origin || '*', 'Vary': 'Origin', 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (!env.DROPS) return new Response(JSON.stringify({ error: 'mailbox not configured (bind a KV namespace as DROPS)' }), { status: 501, headers });
  const list = JSON.parse((await env.DROPS.get('recent')) || '[]');
  if (req.method === 'GET') {
    const since = +url.searchParams.get('since') || 0;
    return new Response(JSON.stringify({ now: Date.now(), drops: list.filter(d => d.at > since) }), { headers });
  }
  if (req.method !== 'POST') return new Response('{}', { status: 405, headers });
  if (!ok) return new Response(JSON.stringify({ error: 'origin not allowed' }), { status: 403, headers });
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: 'd:' + (req.headers.get('CF-Connecting-IP') || 'anon') });
    if (!success) return new Response(JSON.stringify({ error: 'the portal needs a breather' }), { status: 429, headers });
  }
  const text = await req.text();
  if (text.length > 300000) return new Response(JSON.stringify({ error: 'too big' }), { status: 413, headers });
  let d;
  try { d = JSON.parse(text); } catch (e) { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers }); }
  if (!d || !Array.isArray(d.pieces) || !d.pieces.length) return new Response(JSON.stringify({ error: 'no pieces' }), { status: 400, headers });
  d.pieces = d.pieces.slice(0, 120);
  d.id = crypto.randomUUID();
  d.at = Math.max(Date.now(), (list[list.length - 1]?.at || 0) + 1);
  list.push(d);
  while (list.length > KEEP || JSON.stringify(list).length > 20e6) list.shift();
  await env.DROPS.put('recent', JSON.stringify(list));
  return new Response(JSON.stringify({ id: d.id, at: d.at }), { status: 201, headers });
}
