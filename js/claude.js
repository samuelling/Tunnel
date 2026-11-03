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

// Personal tickets are counted here in the browser (the Worker only counts the shared pool,
// so each new design costs it a single write). Cheatable, but the shared pool caps everyone.
export let designsLeft = null;
export let poolLeft = null;
export let lastFromShelf = false;
export let perPerson = 20;
function myTickets() {
  const hour = Math.floor(Date.now() / 3.6e6);
  try { const t = JSON.parse(localStorage.getItem('fabTickets') || '{}'); return t.hour === hour ? { hour, used: t.used | 0 } : { hour, used: 0 }; }
  catch (e) { return { hour, used: 0 }; }
}
export function myTicketsLeft() { return Math.max(0, perPerson - myTickets().used); }
function spendTicket() {
  const t = myTickets(); t.used++;
  try { localStorage.setItem('fabTickets', JSON.stringify(t)); } catch (e) { /* private mode */ }
}
const base = () => workerUrl().replace(/\/$/, '');

// the public status board (Worker only; inside Claude each viewer uses their own account)
export async function fetchQuota() {
  if (await sampleNs()) return null;
  if (!workerUrl()) return null;
  try {
    const r = await fetch(base() + '/quota', { cache: 'no-store' });
    if (!r.ok) return null;
    const q = await r.json();
    if (q.perPerson) perPerson = q.perPerson;
    return q;
  } catch (e) { return null; }
}

// the Warehouse: everything anyone has fabricated, free to throw
export async function fetchWarehouse() {
  if (!workerUrl()) return [];
  try { const r = await fetch(base() + '/warehouse', { cache: 'no-store' }); return r.ok ? (await r.json()).items || [] : []; }
  catch (e) { return []; }
}
export async function fetchShelfItem(k) {
  const r = await fetch(base() + '/warehouse/item?k=' + encodeURIComponent(k));
  if (!r.ok) throw new Error('that one has gone missing from the shelf');
  return (await r.json()).recipe;
}

export async function generateRecipe(what, prompt, { onShelf = false } = {}) {
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
  if (!onShelf && myTicketsLeft() <= 0) {
    const mins = Math.max(1, 60 - new Date().getMinutes());
    const e = new Error(`You've used all ${perPerson} of your tickets this hour. More in about ${mins} min. Everything in the Warehouse is free.`); e.limit = true; throw e;
  }
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: what }) });
  const body = await r.text();
  if (r.status === 429) { const e = new Error(body.slice(0, 220)); e.limit = true; e.closed = r.headers.get('x-shop') === 'closed'; throw e; }
  if (!r.ok) throw new Error(body.slice(0, 160) || r.statusText);
  lastFromShelf = r.headers.get('x-cache') === 'shelf';
  if (!lastFromShelf) spendTicket();
  designsLeft = myTicketsLeft();
  const pl = r.headers.get('x-pool-left');
  if (pl !== null && pl !== '') poolLeft = +pl;
  const j = JSON.parse(body);
  return j.recipe || j;
}
