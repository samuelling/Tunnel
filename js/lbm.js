// GPU lattice-Boltzmann wind tunnel solver (WebGL2).
import * as S from './shaders.js';
import { program, tex32, tex16, framebuffer, bindTex, AsyncReader } from './gl.js';

export const MAX_OBJ = 8;
export const SDF_RES = 384;

export class Solver {
  constructor(gl, W, H, opts = {}) {
    this.gl = gl; this.W = W; this.H = H;
    this.vao = gl.createVertexArray();
    const P = (fs, vs) => program(gl, fs, vs);
    this.pr = {
      init: P(S.INIT_FS), lbm: P(S.LBM_FS), obs: P(S.OBSTACLE_FS),
      red1: P(S.REDUCE1_FS), red2: P(S.REDUCE2_FS), vis: P(S.VISPREP_FS),
      dyeP: P(S.DYE_PRED_FS), dyeC: P(S.DYE_CORR_FS), part: P(S.PART_FS),
      partDraw: P(S.PART_DRAW_FS, S.PART_VS), render: P(S.RENDER_FS),
    };
    const t = () => tex32(gl, W, H);
    this.A = [t(), t()]; this.B = [t(), t()]; this.C = [t(), t()];
    this.F = t();
    this.fboW = [0, 1].map(i => framebuffer(gl, [this.A[i], this.B[i], this.C[i], this.F]));
    this.fboC = [0, 1].map(i => framebuffer(gl, [this.C[i]]));
    this.cur = 0;

    this.obsTex = t();
    this.obsFbo = framebuffer(gl, [this.obsTex]);

    // signed-distance textures for up to MAX_OBJ bodies
    this.sdf = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.sdf);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R16F, SDF_RES, SDF_RES, MAX_OBJ, 0, gl.RED, gl.FLOAT, null);

    // force reduction
    this.bw = Math.ceil(W / 16); this.bh = Math.ceil(H / 16);
    this.partial = tex32(gl, this.bw * MAX_OBJ, this.bh);
    this.partialFbo = framebuffer(gl, [this.partial]);
    this.acc = [tex32(gl, MAX_OBJ, 1), tex32(gl, MAX_OBJ, 1)];
    this.accFbo = this.acc.map(a => framebuffer(gl, [a]));
    this.accCur = 0;

    // visualisation
    this.vis0 = tex16(gl, W, H); this.vis1 = tex16(gl, W, H);
    this.visFbo = framebuffer(gl, [this.vis0, this.vis1]);
    this.dye = [tex16(gl, W, H), tex16(gl, W, H)];
    this.dyeFbo = this.dye.map(d => framebuffer(gl, [d]));
    this.dyePred = tex16(gl, W, H);
    this.dyePredFbo = framebuffer(gl, [this.dyePred]);
    this.dyeCur = 0;

    // tracer particles
    this.PW = 256; this.PH = opts.particleRows || 128;
    const pdata = new Float32Array(this.PW * this.PH * 4);
    for (let i = 0; i < this.PW * this.PH; i++) {
      pdata[i * 4] = Math.random() * (W - 1);
      pdata[i * 4 + 1] = Math.random() * (H - 1);
      pdata[i * 4 + 2] = Math.random() * 3000;
      pdata[i * 4 + 3] = 400 + 4000 * Math.random();
    }
    this.part = [tex32(gl, this.PW, this.PH, pdata), tex32(gl, this.PW, this.PH, pdata)];
    this.partFbo = this.part.map(p => framebuffer(gl, [p]));
    this.partCur = 0;

    this.reader = new AsyncReader(gl);

    // parameters (set by the app)
    this.p = {
      tau0: 0.52, cs2: 0.12 * 0.12, slip: 1, uin: 0.1, ti: 0.0, time: 0,
      modes: new Float32Array(32), sponge: Math.round(W * 0.1),
      rates: [0.8, 1.0, 1.2],   // s_e (bulk; <1 damps lattice acoustics), s_eps, s_q
      sigma: 0.98,
    };
    this.nObj = 0;
    this.xf = new Float32Array(MAX_OBJ * 4);
    this.kin = new Float32Array(MAX_OBJ * 4);
    this.piv = new Float32Array(MAX_OBJ * 2);
    this.dil = new Float32Array(MAX_OBJ);
    for (let i = 0; i < MAX_OBJ; i++) { this.kin[i * 4] = 1; this.xf[i * 4 + 2] = 1; }
    this.steps = 0;
  }

  _draw(fbo, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  setSDF(layer, data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.sdf);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, SDF_RES, SDF_RES, 1, gl.RED, gl.FLOAT, data);
  }

  // bodies: [{cx, cy, c, s, S, omega, vx, vy, px, py}] (lattice units)
  setBodies(list) {
    this.nObj = Math.min(list.length, MAX_OBJ);
    for (let i = 0; i < this.nObj; i++) {
      const b = list[i];
      this.xf.set([b.cx, b.cy, b.c, b.s], i * 4);
      this.kin.set([b.S, b.omega, b.vx, b.vy], i * 4);
      this.piv.set([b.px, b.py], i * 2);
      this.dil[i] = b.dil || 0;
    }
  }

  rasterize() {
    const gl = this.gl, pr = this.pr.obs;
    gl.useProgram(pr.p);
    bindTex(gl, 0, this.sdf, pr.u.uSDF, gl.TEXTURE_2D_ARRAY);
    gl.uniform1i(pr.u.uN, this.nObj);
    gl.uniform4fv(pr.u.uXf, this.xf);
    gl.uniform4fv(pr.u.uKin, this.kin);
    gl.uniform2fv(pr.u.uPiv, this.piv);
    gl.uniform1fv(pr.u.uDil, this.dil);
    this._draw(this.obsFbo, this.W, this.H);
  }

  init(ux) {
    const gl = this.gl, pr = this.pr.init;
    gl.useProgram(pr.p);
    gl.uniform2f(pr.u.uU, ux, 0);
    gl.uniform2i(pr.u.uSize, this.W, this.H);
    bindTex(gl, 0, this.obsTex, pr.u.uObs);
    this._draw(this.fboW[this.cur], this.W, this.H);
    this.p.time = 0; this.steps = 0;
    this.clearDye();
  }

  clearDye() {
    const gl = this.gl;
    for (const f of this.dyeFbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    }
  }

  beginForces() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accFbo[this.accCur]);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
  }

  step(measure = true) {
    const gl = this.gl, pr = this.pr.lbm, p = this.p, c = this.cur, n = 1 - c;
    gl.useProgram(pr.p);
    bindTex(gl, 0, this.A[c], pr.u.uA);
    bindTex(gl, 1, this.B[c], pr.u.uB);
    bindTex(gl, 2, this.C[c], pr.u.uC);
    bindTex(gl, 3, this.obsTex, pr.u.uObs);
    gl.uniform2i(pr.u.uSize, this.W, this.H);
    gl.uniform1f(pr.u.uTau0, p.tau0);
    gl.uniform1f(pr.u.uCs2, p.cs2);
    gl.uniform1i(pr.u.uSlip, p.slip);
    gl.uniform1f(pr.u.uUin, p.uin);
    gl.uniform1f(pr.u.uTI, p.ti);
    gl.uniform1f(pr.u.uTime, p.time);
    gl.uniform4fv(pr.u.uModes, p.modes);
    gl.uniform1i(pr.u.uSponge, p.sponge);
    gl.uniform2fv(pr.u.uPivot, this.piv);
    gl.uniform3fv(pr.u.uRates, p.rates);
    gl.uniform1f(pr.u.uSigma, p.sigma);
    this._draw(this.fboW[n], this.W, this.H);
    this.cur = n;
    p.time += 1; this.steps++;
    if (measure && this.nObj > 0) this._reduce();
  }

  _reduce() {
    const gl = this.gl, n = this.nObj;
    let pr = this.pr.red1;
    gl.useProgram(pr.p);
    bindTex(gl, 0, this.F, pr.u.uF);
    gl.uniform1i(pr.u.uBW, this.bw);
    gl.uniform2i(pr.u.uSize, this.W, this.H);
    this._draw(this.partialFbo, this.bw * n, this.bh);
    pr = this.pr.red2;
    gl.useProgram(pr.p);
    bindTex(gl, 0, this.partial, pr.u.uP);
    bindTex(gl, 1, this.acc[this.accCur], pr.u.uAcc);
    gl.uniform1i(pr.u.uBW, this.bw);
    gl.uniform1i(pr.u.uBH, this.bh);
    const dst = 1 - this.accCur;
    // copy columns beyond n stay stale; only first n are read
    this._draw(this.accFbo[dst], n, 1);
    this.accCur = dst;
  }

  requestForces(tag) {
    if (this.nObj === 0) return false;
    return this.reader.request(this.accFbo[this.accCur], 0, 0, this.nObj, 1, { kind: 'force', n: this.nObj, ...tag });
  }

  requestProbe(gx, gy, tag) {
    const x = Math.max(0, Math.min(this.W - 1, Math.round(gx)));
    const y = Math.max(0, Math.min(this.H - 1, Math.round(gy)));
    return this.reader.request(this.fboC[this.cur], x, y, 1, 1, { kind: 'probe', ...tag });
  }

  // synchronous force read (validation only)
  readForcesSync() {
    const gl = this.gl, out = new Float32Array(MAX_OBJ * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.accFbo[this.accCur]);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, Math.max(1, this.nObj), 1, gl.RGBA, gl.FLOAT, out);
    return out;
  }

  updateDye(dt, rake, wand, decay = 0.9995) {
    const gl = this.gl;
    let pr = this.pr.dyeP;
    gl.useProgram(pr.p);
    bindTex(gl, 0, this.C[this.cur], pr.u.uC);
    bindTex(gl, 1, this.dye[this.dyeCur], pr.u.uDye);
    gl.uniform2i(pr.u.uSize, this.W, this.H);
    gl.uniform1f(pr.u.uDt, dt);
    this._draw(this.dyePredFbo, this.W, this.H);
    pr = this.pr.dyeC;
    gl.useProgram(pr.p);
    bindTex(gl, 0, this.C[this.cur], pr.u.uC);
    bindTex(gl, 1, this.dye[this.dyeCur], pr.u.uDye);
    bindTex(gl, 2, this.dyePred, pr.u.uPred);
    bindTex(gl, 3, this.obsTex, pr.u.uObs);
    gl.uniform2i(pr.u.uSize, this.W, this.H);
    gl.uniform1f(pr.u.uDt, dt);
    gl.uniform4fv(pr.u.uRake, rake);
    gl.uniform4fv(pr.u.uWand, wand.v);
    gl.uniform3fv(pr.u.uWandCol, wand.col);
    gl.uniform1f(pr.u.uDecay, decay);
    const dst = 1 - this.dyeCur;
    this._draw(this.dyeFbo[dst], this.W, this.H);
    this.dyeCur = dst;
  }

  updateParticles(dt, frame) {
    const gl = this.gl, pr = this.pr.part;
    gl.useProgram(pr.p);
    bindTex(gl, 0, this.part[this.partCur], pr.u.uP);
    bindTex(gl, 1, this.C[this.cur], pr.u.uC);
    bindTex(gl, 2, this.obsTex, pr.u.uObs);
    gl.uniform2i(pr.u.uSize, this.W, this.H);
    gl.uniform1f(pr.u.uDt, dt);
    gl.uniform1f(pr.u.uFrame, frame % 4096);
    const dst = 1 - this.partCur;
    this._draw(this.partFbo[dst], this.PW, this.PH);
    this.partCur = dst;
  }

  prepVis(U, L) {
    const gl = this.gl, pr = this.pr.vis;
    gl.useProgram(pr.p);
    bindTex(gl, 0, this.C[this.cur], pr.u.uC);
    bindTex(gl, 1, this.obsTex, pr.u.uObs);
    gl.uniform2i(pr.u.uSize, this.W, this.H);
    gl.uniform1f(pr.u.uU, U);
    gl.uniform1f(pr.u.uL, L);
    this._draw(this.visFbo, this.W, this.H);
  }

  render(view, o) {
    const gl = this.gl, pr = this.pr.render;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(view.x, view.y, view.w, view.h);
    gl.useProgram(pr.p);
    bindTex(gl, 0, this.vis0, pr.u.uVis);
    bindTex(gl, 1, this.vis1, pr.u.uSolid);
    bindTex(gl, 2, this.dye[this.dyeCur], pr.u.uDye);
    gl.uniform2i(pr.u.uSize, this.W, this.H);
    gl.uniform4f(pr.u.uView, view.x, view.y, view.w, view.h);
    gl.uniform1i(pr.u.uMode, o.mode);
    gl.uniform1f(pr.u.uRange, o.range);
    gl.uniform3fv(pr.u.uObjCol, o.colors);
    gl.uniform1i(pr.u.uSel, o.sel);
    gl.uniform1f(pr.u.uPxPerCell, view.w / this.W);
    gl.uniform1f(pr.u.uSmokeGain, o.smokeGain);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (o.particles) {
      const pp = this.pr.partDraw;
      gl.useProgram(pp.p);
      bindTex(gl, 0, this.part[this.partCur], pp.u.uP);
      bindTex(gl, 1, this.C[this.cur], pp.u.uC);
      gl.uniform2i(pp.u.uPSize, this.PW, this.PH);
      gl.uniform2i(pp.u.uSize, this.W, this.H);
      gl.uniform1f(pp.u.uStreak, o.streak);
      gl.uniform1i(pp.u.uLines, o.streak > 0 ? 1 : 0);
      gl.uniform1f(pp.u.uU, o.U);
      gl.uniform1f(pp.u.uPointSize, Math.max(1, view.w / this.W * 0.9));
      gl.uniform1f(pp.u.uAlpha, o.partAlpha);
      gl.uniform1i(pp.u.uColorMode, o.mode === 5 ? 1 : 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(o.streak > 0 ? gl.LINES : gl.POINTS, 0, this.PW * this.PH * (o.streak > 0 ? 2 : 1));
      gl.disable(gl.BLEND);
    }
  }

  dispose() {
    const gl = this.gl;
    const texs = [...this.A, ...this.B, ...this.C, this.F, this.obsTex, this.partial, ...this.acc,
      this.vis0, this.vis1, ...this.dye, this.dyePred, ...this.part];
    texs.forEach(t => gl.deleteTexture(t));
    gl.deleteTexture(this.sdf);
    [...this.fboW, ...this.fboC, this.obsFbo, this.partialFbo, ...this.accFbo, this.visFbo,
      ...this.dyeFbo, this.dyePredFbo, ...this.partFbo].forEach(f => gl.deleteFramebuffer(f));
    Object.values(this.pr).forEach(p => gl.deleteProgram(p.p));
  }
}
