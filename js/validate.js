// Cylinder benchmarks for the solver. Results are written to the page and to window.RESULTS.
import { createGL } from './gl.js';
import { Solver } from './lbm.js';
import { buildShape, SHAPES } from './shapes.js';

// Reference values (2D unconfined cylinder):
//  Re 20:  Cd ≈ 2.05–2.09 (Tritton 1959; Dennis & Chang 1970)
//  Re 40:  Cd ≈ 1.52–1.62
//  Re 100: Cd ≈ 1.33–1.40, St ≈ 0.164–0.167 (Williamson 1996; Henderson 1995)
// Our tunnel has 5% blockage and slip walls, which raises Cd by a few percent.
const CASES = {
  re20: { Re: 20, D: 20, W: 600, H: 400, steps: 24000, avg: 4000, ref: '2.05–2.09', st: '—' },
  re40: { Re: 40, D: 20, W: 600, H: 400, steps: 24000, avg: 4000, ref: '1.52–1.62', st: '—' },
  re100: { Re: 100, D: 20, W: 600, H: 400, steps: 36000, avg: 16000, ref: '1.33–1.40', st: '0.164–0.167' },
  highre: { Re: 100000, D: 32, W: 640, H: 320, steps: 16000, avg: 6000, ref: '(stability)', st: '~0.2', les: true },
};

const log = (s) => { document.getElementById('log').insertAdjacentHTML('beforeend', `<div>${s}</div>`); console.log(s); };

async function run(name, cfg, gl, shape) {
  const { W, H, D, Re } = cfg;
  const U = cfg.U || 0.05;
  const nu = U * D / Re;
  const sv = new Solver(gl, W, H, { particleRows: 1 });
  sv.p.tau0 = 3 * nu + 0.5;
  sv.p.cs2 = cfg.les ? 0.14 * 0.14 : 0.0;
  sv.p.slip = 1; sv.p.uin = U; sv.p.ti = 0; sv.p.sponge = Math.round(W * 0.12);
  sv.setSDF(0, shape.sdf);
  const ext = Math.max(shape.bbox.x1 - shape.bbox.x0, shape.bbox.y1 - shape.bbox.y0);
  const S = D / ext;
  const cx = W * 0.25, cy = H / 2 + 0.31;
  sv.setBodies([{ cx, cy, c: 1, s: 0, S, omega: 0, vx: 0, vy: 0, px: cx, py: cy, dil: 0 }]);
  sv.rasterize();
  sv.init(U);
  const t0 = performance.now();
  const cd = [], cl = [];
  const chunk = 50;
  const q = 0.5 * U * U * D;
  for (let s = 0; s < cfg.steps; s += chunk) {
    sv.beginForces();
    for (let k = 0; k < chunk; k++) sv.step(true);
    const f = sv.readForcesSync();
    const n = f[3] || 1;
    if (!isFinite(f[0])) { log(`${name}: diverged at step ${s}`); break; }
    if (s >= cfg.steps - cfg.avg) { cd.push(f[0] / n / q); cl.push(f[1] / n / q); }
    if (s % (+new URLSearchParams(location.search).get('every') || 4000) === 0) { log(`${name}: step ${s} Cd=${(f[0] / n / q).toFixed(3)} Cl=${(f[1] / n / q).toFixed(3)}`); await new Promise(r => setTimeout(r, 0)); }
  }
  const dt = (performance.now() - t0) / 1000;
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const cdm = mean(cd), clm = mean(cl);
  const clr = Math.sqrt(mean(cl.map(v => (v - clm) ** 2)));
  // Strouhal from zero crossings of the lift
  let cross = [];
  for (let i = 1; i < cl.length; i++) if ((cl[i - 1] - clm) < 0 && (cl[i] - clm) >= 0) cross.push(i);
  let st = NaN;
  if (cross.length >= 3) {
    const period = (cross[cross.length - 1] - cross[0]) / (cross.length - 1) * chunk;
    st = D / (period * U);
  }
  const res = { name, Re, cd: cdm, clrms: clr, st, steps: cfg.steps, mlups: W * H * cfg.steps / dt / 1e6 };
  document.getElementById('tbl').insertAdjacentHTML('beforeend',
    `<tr><td>${name} (Re ${Re})</td><td>${W}×${H}</td><td>${D}</td><td>${cdm.toFixed(3)}</td><td>${cfg.ref}</td><td>${clr.toFixed(3)}</td><td>${isNaN(st) ? '—' : st.toFixed(3)}</td><td>${cfg.st}</td><td>${cfg.steps}</td><td>${res.mlups.toFixed(1)}</td></tr>`);
  sv.dispose();
  return res;
}

(async () => {
  const gl = createGL(document.getElementById('c'));
  const shape = buildShape(SHAPES.find(s => s.id === 'cylinder').draw);
  const want = new URLSearchParams(location.search).get('case');
  const names = want ? want.split(',') : ['re20', 're40', 're100', 'highre'];
  window.RESULTS = [];
  const qs = new URLSearchParams(location.search);
  for (const n of names) {
    const cfg = { ...CASES[n] };
    for (const k of ['W', 'H', 'D', 'steps', 'avg', 'Re', 'U']) if (qs.get(k)) cfg[k] = +qs.get(k);
    window.RESULTS.push(await run(n, cfg, gl, shape));
  }
  window.DONE = true;
  log('done');
})().catch(e => { log('ERROR ' + e.message); window.DONE = true; window.ERR = e.message; });
