// Getting Claude to design an object.
//  1. Inside the Claude-hosted version of the page, the page can ask Claude directly
//     (`sample` capability): each viewer is asked for consent and it runs on their account.
//  2. On GitHub Pages it calls a small Cloudflare Worker (see /worker) that holds the API key.
import { WORKER_URL } from './settings.js';

function workerUrl() {
  try {
    const q = new URLSearchParams(location.search).get('worker');
    if (q) localStorage.setItem('tunnelWorker', q);
    return localStorage.getItem('tunnelWorker') || WORKER_URL;
  } catch (e) { return WORKER_URL; }
}

let samplePromise = null;
function sampleNs() {
  if (!samplePromise) {
    samplePromise = (async () => {
      if (!window.claude || typeof window.claude.use !== 'function') return null;
      try {
        return await Promise.race([window.claude.use('sample'), new Promise(r => setTimeout(() => r(null), 6000))]);
      } catch (e) { return null; }
    })();
  }
  return samplePromise;
}

export async function generatorAvailable() {
  if (await sampleNs()) return true;
  return !!workerUrl();
}

export function parseJSON(text) {
  if (typeof text !== 'string') return text;
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(a, b + 1));
}

// how many new Claude designs this visitor has left this hour (from the Worker), or null
export let designsLeft = null;
export let poolLeft = null;

// the public ticket board (Worker only; inside Claude each viewer uses their own account)
export async function fetchQuota() {
  if (await sampleNs()) return null;
  const url = workerUrl();
  if (!url) return null;
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/quota', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

export async function generateRecipe(what, prompt) {
  const s = await sampleNs();
  if (s) {
    try {
      if (typeof s.json === 'function') return await s.json(prompt, { modelTier: 'default' });
    } catch (e) { if (e && (e.code === 'not_granted' || e.code === 'rate_limited')) throw new Error(e.message || e.code); }
    const res = await s(prompt, { modelTier: 'default' });
    return parseJSON(res.text);
  }
  const url = workerUrl();
  if (!url) throw new Error('no Claude connection is set up');
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: what }) });
  const body = await r.text();
  if (r.status === 429) { const e = new Error(body.slice(0, 200)); e.limit = true; throw e; }
  if (!r.ok) throw new Error(body.slice(0, 160) || r.statusText);
  const left = r.headers.get('x-gen-remaining');
  if (left !== null) designsLeft = +left;
  const pl = r.headers.get('x-pool-left');
  if (pl !== null && pl !== '') poolLeft = +pl;
  const j = JSON.parse(body);
  return j.recipe || j;
}
