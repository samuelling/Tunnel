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
    if (req.method !== 'POST') return reply('POST only', 405);
    if (!ok) return reply('origin not allowed', 403);

    // per-visitor rate limit (Workers Rate Limiting binding; optional)
    if (env.LIMITER) {
      const ip = req.headers.get('CF-Connecting-IP') || 'anon';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return reply('Easy there — too many objects. Try again in a minute.', 429);
    }

    let what;
    try { what = String((await req.json()).object || '').replace(/\s+/g, ' ').trim().slice(0, 60); } catch (e) { return reply('bad request', 400); }
    if (!what) return reply('say what to shred', 400);

    // the same object name gets the same recipe for a week (and costs nothing after the first)
    const cacheKey = new Request('https://tunnel-cache.invalid/v1/' + encodeURIComponent(what.toLowerCase()));
    const cached = await caches.default.match(cacheKey);
    if (cached) return new Response(cached.body, { headers: { ...cors, 'content-type': 'application/json', 'x-cache': 'hit' } });

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
    return new Response(body, { headers: { ...cors, 'content-type': 'application/json', 'x-cache': 'miss' } });
  },
};

// ---------------------------------------------------------------- the portal's mailbox
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
