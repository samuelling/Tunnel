// Tunnel ⇄ Claude: a tiny proxy so the public GitHub Pages site can have Claude design objects
// without exposing an API key. The browser sends only {"object": "<short name>"}; the prompt is
// built here, so the endpoint can't be used as a general-purpose Claude proxy.
import { recipePrompt } from '../js/prompt.js';

const DEFAULT_ORIGINS = ['https://samuelling.github.io'];

function corsHeaders(origin, ok) {
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
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
