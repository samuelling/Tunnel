// Minimal WebGL2 helpers.
import { FULLSCREEN_VS } from './shaders.js';

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  if (!gl.getExtension('EXT_color_buffer_float'))
    throw new Error('This GPU/browser cannot render to float textures (EXT_color_buffer_float).');
  gl.getExtension('OES_texture_float_linear');
  return gl;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    console.error(lines);
    throw new Error('Shader compile error: ' + log);
  }
  return s;
}

export function program(gl, fs, vs = FULLSCREEN_VS) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name.endsWith('[0]') ? name : info.name);
  }
  return { p, u };
}

export function texture(gl, w, h, internal, format, type, filter, data = null) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  return t;
}

export const tex32 = (gl, w, h, data = null) => texture(gl, w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, data);
export const tex16 = (gl, w, h, data = null) => texture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, data);

export function framebuffer(gl, texs) {
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: 0x' + st.toString(16));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return f;
}

export function bindTex(gl, unit, tex, loc, target) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(target || gl.TEXTURE_2D, tex);
  if (loc) gl.uniform1i(loc, unit);
}

// Asynchronous float readback through a pixel-pack buffer + fence.
export class AsyncReader {
  constructor(gl) { this.gl = gl; this.pending = []; }
  request(fbo, x, y, w, h, tag) {
    const gl = this.gl;
    if (this.pending.length > 12) return false;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 16, gl.STREAM_READ);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    this.pending.push({ buf, sync, n: w * h * 4, tag });
    return true;
  }
  poll() {
    const gl = this.gl, out = [];
    while (this.pending.length) {
      const p = this.pending[0];
      const st = gl.clientWaitSync(p.sync, 0, 0);
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) break;
      const arr = new Float32Array(p.n);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.buf);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, arr);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteSync(p.sync);
      gl.deleteBuffer(p.buf);
      this.pending.shift();
      out.push({ data: arr, tag: p.tag });
    }
    return out;
  }
}
