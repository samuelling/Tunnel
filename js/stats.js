// Anonymous usage counts for the dashboard. One small "hello" when the page opens, and the
// session's running totals whenever the tab is hidden or closed (sendBeacon, text/plain: no CORS
// preflight). No names, no IP addresses, nothing typed: a random visitor id kept in this browser,
// a random id for this visit, the kind of device, the referring site, and counts. Browsers that
// send Do Not Track or Global Privacy Control send nothing.
import { WORKER_URL } from './settings.js';

const off = (() => { try { return navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true || !WORKER_URL || location.protocol === 'file:'; } catch (e) { return true; } })();
const url = WORKER_URL ? WORKER_URL.replace(/\/$/, '') + '/hit' : '';
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now().toString(36));

let vid = '', isNew = false;
try { vid = localStorage.getItem('shredVisitor') || ''; if (!vid) { vid = rid(); isNew = true; localStorage.setItem('shredVisitor', vid); } } catch (e) { vid = rid(); isNew = true; }
const sid = rid();
const t0 = Date.now();
let active = 0, shownAt = document.hidden ? 0 : Date.now();   // seconds the tab was actually visible
const c = { started: 0, thrown: 0, shredded: 0, partial: 0, survived: 0, jams: 0, repairs: 0, flushes: 0, designs: 0, grabs: 0, shares: 0, splits: 0, warps: 0 };
const objs = new Map();
let dirty = false;

const device = (() => {
  const w = Math.min(screen.width, screen.height), touch = matchMedia('(pointer: coarse)').matches;
  return touch ? (w >= 700 ? 'tablet' : 'phone') : 'desktop';
})();
const ref = (() => { try { const r = document.referrer ? new URL(document.referrer).hostname : ''; return r && r !== location.hostname ? r.replace(/^www\./, '').slice(0, 60) : ''; } catch (e) { return ''; } })();
const where = location.hostname.endsWith('github.io') ? 'site' : location.hostname.includes('claude') ? 'claude' : location.hostname.slice(0, 40);

function send(kind) {
  if (off) return;
  if (!document.hidden && shownAt) { active += (Date.now() - shownAt) / 1000; shownAt = Date.now(); }
  const body = JSON.stringify({ kind, sid, vid, isNew, device, ref, where, secs: Math.round(active), wall: Math.round((Date.now() - t0) / 1000), c, objs: Object.fromEntries([...objs].slice(0, 40)) });
  try {
    const blob = new Blob([body], { type: 'text/plain' });
    if (!navigator.sendBeacon || !navigator.sendBeacon(url, blob)) fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
  } catch (e) { /* offline */ }
  dirty = false;
}

export const stats = {
  count(k, n = 1) { if (k in c) { c[k] += n; dirty = true; } },
  threw(name) { c.thrown++; dirty = true; const k = String(name || '?').slice(0, 40); objs.set(k, (objs.get(k) || 0) + 1); },
  start() { if (!c.started) { c.started = 1; dirty = true; } },
};

if (!off) {
  setTimeout(() => send('hello'), 1500);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (shownAt) active += (Date.now() - shownAt) / 1000; shownAt = 0; if (dirty || active > 5) send('tick'); }
    else shownAt = Date.now();
  });
  addEventListener('pagehide', () => { if (dirty) send('tick'); });
  // a long visit with the tab open the whole time still reports now and then
  setInterval(() => { if (dirty && !document.hidden) send('tick'); }, 10 * 60000);
}
