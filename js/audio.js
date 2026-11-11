// All sound is synthesised: wind noise whose band follows the airspeed, the fan's blade-pass
// hum (blades × rev/s) and motor whine, plus procedural impact sounds per material.
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // pink-ish noise buffer
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + 0.029 * w; b1 = 0.985 * b1 + 0.032 * w; b2 = 0.95 * b2 + 0.048 * w; d[i] = (b0 + b1 + b2 + w * 0.05) * 0.5; }
    this.noiseBuf = buf;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.Q.value = 0.6;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    src.connect(this.windF).connect(this.windG).connect(this.master); src.start();
    const src2 = ctx.createBufferSource(); src2.buffer = buf; src2.loop = true; src2.playbackRate.value = 1.7;
    this.hissF = ctx.createBiquadFilter(); this.hissF.type = 'highpass'; this.hissF.frequency.value = 2500;
    this.hissG = ctx.createGain(); this.hissG.gain.value = 0;
    src2.connect(this.hissF).connect(this.hissG).connect(this.master); src2.start();
    // fan: blade-pass hum + harmonic, motor whine
    this.hum = ctx.createOscillator(); this.hum.type = 'sawtooth';
    this.hum2 = ctx.createOscillator(); this.hum2.type = 'triangle';
    this.humF = ctx.createBiquadFilter(); this.humF.type = 'lowpass'; this.humF.frequency.value = 500;
    this.humG = ctx.createGain(); this.humG.gain.value = 0;
    this.hum.connect(this.humF); this.hum2.connect(this.humF); this.humF.connect(this.humG).connect(this.master);
    this.whine = ctx.createOscillator(); this.whine.type = 'sine';
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
    this.whine.connect(this.whineG).connect(this.master);
    this.hum.start(); this.hum2.start(); this.whine.start();
    // a fan this big beats the air: the hum swells and fades at the blade-pass rate (whomp, whomp)
    this.beat = ctx.createOscillator(); this.beat.type = 'sine';
    this.beatG = ctx.createGain(); this.beatG.gain.value = 0;
    this.beat.connect(this.beatG).connect(this.humG.gain); this.beat.start();
    // the motor straining when something heavy drags the rotor down: a low, falling groan
    this.groan = ctx.createOscillator(); this.groan.type = 'sawtooth';
    this.groanF = ctx.createBiquadFilter(); this.groanF.type = 'lowpass'; this.groanF.frequency.value = 220; this.groanF.Q.value = 3;
    this.groanG = ctx.createGain(); this.groanG.gain.value = 0;
    this.groan.connect(this.groanF).connect(this.groanG).connect(this.master); this.groan.start();
  }

  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05); }

  // U: airspeed (m/s), omega: rotor rad/s, blades, load: motor load 0..1,
  // strain: how far heavy stuff has dragged the rotor below its set speed (0..1), wMax: full speed
  update(U, omega, blades, load, timeScale, strain = 0, wMax = 48) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = Math.min(1, U / 40);
    const ts = Math.max(0.15, timeScale);
    this.windF.frequency.setTargetAtTime((120 + 22 * U) * ts, t, 0.1);
    this.windG.gain.setTargetAtTime(0.55 * k * k, t, 0.1);
    this.hissG.gain.setTargetAtTime(0.12 * k * k * k, t, 0.1);
    // blade-pass f is subsonic on the big rotor (15 Hz flat out): the hum sits at its 4th and 6th
    // harmonics and is beaten at f itself
    const f = Math.abs(omega) / (2 * Math.PI) * blades * ts, sp = Math.min(1, Math.abs(omega) / wMax);
    this.hum.frequency.setTargetAtTime(Math.max(1, f * 4), t, 0.05);
    this.hum2.frequency.setTargetAtTime(Math.max(1, f * 6), t, 0.05);
    this.humG.gain.setTargetAtTime(0.16 * sp, t, 0.08);
    this.beat.frequency.setTargetAtTime(Math.max(0.5, f), t, 0.05);
    this.beatG.gain.setTargetAtTime(0.11 * sp, t, 0.08);
    this.groan.frequency.setTargetAtTime((24 + 46 * sp) * ts, t, 0.08);
    this.groanG.gain.setTargetAtTime(0.32 * strain * Math.min(1, Math.abs(omega) / 2), t, strain > 0.05 ? 0.06 : 0.4);
    this.whine.frequency.setTargetAtTime(Math.max(1, Math.abs(omega) / (2 * Math.PI) * 38 * ts), t, 0.05);
    this.whineG.gain.setTargetAtTime(0.012 * load * Math.min(1, Math.abs(omega) / 10), t, 0.1);
  }

  _noise(dur, type, f, q, gain, when = 0) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 1 + Math.random();
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.master); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }
  _tone(f0, f1, dur, gain, type = 'sine', when = 0) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  // kind: sound name; e: impact energy (J) for loudness
  hit(kind, e = 10) {
    if (!this.ctx || !this.enabled) return;
    const L = Math.min(1, 0.18 + Math.log10(1 + e) / 3.2);
    switch (kind) {
      case 'squeak': this._tone(1400, 650, 0.35, 0.25 * L, 'square'); this._tone(1100, 900, 0.2, 0.1 * L, 'sine', 0.05); break;
      case 'squawk': this._tone(900, 380, 0.5, 0.22 * L, 'sawtooth'); this._tone(700, 320, 0.45, 0.12 * L, 'square', 0.04); break;
      case 'squish': this._noise(0.25, 'lowpass', 700, 1, 0.5 * L); this._tone(220, 90, 0.2, 0.25 * L); break;
      case 'splat': this._noise(0.4, 'lowpass', 900, 0.8, 0.9 * L); this._tone(140, 50, 0.3, 0.5 * L); break;
      case 'crack': this._noise(0.12, 'highpass', 2500, 1, 0.7 * L); this._noise(0.25, 'bandpass', 1200, 4, 0.3 * L, 0.02); break;
      case 'shatter': for (let i = 0; i < 5; i++) this._noise(0.25 + Math.random() * 0.3, 'bandpass', 2500 + Math.random() * 4000, 6, 0.35 * L, i * 0.025); this._tone(3200, 2800, 0.4, 0.05 * L, 'sine', 0.02); break;
      case 'glass': for (let i = 0; i < 7; i++) this._tone(2500 + Math.random() * 4500, 2400 + Math.random() * 4000, 0.4 + Math.random() * 0.5, 0.06 * L, 'sine', i * 0.02); this._noise(0.3, 'highpass', 4000, 1, 0.5 * L); break;
      case 'clang': [523, 1410, 2380, 3460].forEach((f, i) => this._tone(f * (0.97 + Math.random() * 0.06), f * 0.99, 1.4 - i * 0.25, 0.14 * L / (i + 1), 'sine')); this._noise(0.08, 'highpass', 3000, 1, 0.5 * L); break;
      case 'thunk': this._tone(120, 45, 0.35, 0.8 * L); this._noise(0.1, 'lowpass', 500, 1, 0.5 * L); break;
      case 'pop': this._noise(0.09, 'highpass', 900, 0.7, 1.0); this._tone(180, 60, 0.12, 0.6); break;
      case 'tear': this._noise(0.35, 'bandpass', 2600, 1.5, 0.45 * L); this._noise(0.2, 'highpass', 5000, 1, 0.25 * L, 0.05); break;
      case 'zap': this._tone(1800, 120, 0.25, 0.25 * L, 'sawtooth'); this._noise(0.2, 'highpass', 3000, 1, 0.4 * L); break;
      default: this._noise(0.2, 'bandpass', 900, 1.2, 0.6 * L); this._tone(160, 70, 0.2, 0.4 * L); break;
    }
  }
  chop(e) { if (!this.ctx || !this.enabled) return; const L = Math.min(1, 0.3 + Math.log10(1 + e) / 3); this._tone(95, 38, 0.18, 0.7 * L); this._noise(0.12, 'bandpass', 1800, 1.2, 0.5 * L); }
  whoosh(m = 1) {
    if (!this.ctx || !this.enabled) return;
    const L = Math.min(1, 0.35 + Math.log10(1 + m * 10) / 3);
    this._tone(420, 55, 0.7, 0.18 * L, 'sine'); this._tone(640, 80, 0.6, 0.08 * L, 'triangle', 0.03);
    this._noise(0.6, 'bandpass', 900, 0.8, 0.35 * L);
  }
  sparks() { if (!this.ctx || !this.enabled) return; this._noise(0.35, 'highpass', 5000, 0.8, 0.35); }
  // something heavy landing or slamming into the fan: a long, deep rumble you feel more than hear
  rumble(e) {
    if (!this.ctx || !this.enabled) return;
    const L = Math.max(0.25, Math.min(1, (Math.log10(1 + e) - 3) / 3.5));
    this._tone(62, 27, 1.7, 0.95 * L); this._tone(94, 38, 0.9, 0.45 * L, 'triangle', 0.03);
    this._noise(2.0, 'lowpass', 160, 0.8, 1.1 * L); this._noise(0.5, 'bandpass', 420, 1, 0.45 * L, 0.02);
  }
}
