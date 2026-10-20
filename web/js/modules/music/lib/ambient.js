// Ambient mixer: rain, white / pink / brown noise, ocean, fire, wind, birds — all synthesized
// with Web Audio (no files). Runs in its own AudioContext so it is independent of the music EQ,
// bit-perfect context rebuilds and track changes; it follows the music's output device.
// Each sound is a looped generated buffer (built once, ~0.1 s of CPU) plus at most a filter and
// a slow LFO, so a full mix costs very little. Also plays the timer chimes.
import { tasks } from '../../../core/tasks.js';

export const SOUNDS = {
  rain: { label: 'Mưa' },
  white: { label: 'Nhiễu trắng' },
  pink: { label: 'Nhiễu hồng' },
  brown: { label: 'Nhiễu nâu' },
  ocean: { label: 'Sóng biển' },
  fire: { label: 'Lửa trại' },
  wind: { label: 'Gió' },
  birds: { label: 'Chim hót' },
};

const SECS = 12;   // loop length; random content so the seam is inaudible

class Ambient extends EventTarget {
  constructor() { super(); this.ctx = null; this.master = null; this.voices = new Map(); this.buffers = new Map(); this.masterLevel = 0.6; this.duck = 1; this.sinkId = ''; }

  _ctx() {
    if (this.ctx) return this.ctx;
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterLevel * this.duck;
    this.master.connect(this.ctx.destination);
    if (this.sinkId && this.ctx.setSinkId) this.ctx.setSinkId(this.sinkId).catch(() => {});
    return this.ctx;
  }

  get active() { return [...this.voices.keys()]; }
  level(id) { return this.voices.get(id)?.level ?? 0; }

  // level 0–1; 0 stops the sound.
  set(id, level) {
    if (!SOUNDS[id]) return;
    level = Math.max(0, Math.min(1, +level || 0));
    const v = this.voices.get(id);
    if (!level) { if (v) this._stop(id); return this._emit(); }
    const c = this._ctx();
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (v) { v.level = level; v.gain.gain.setTargetAtTime(level * level, c.currentTime, 0.08); return this._emit(); }
    this._start(id, level);
    this._emit();
  }

  setMaster(v) { this.masterLevel = Math.max(0, Math.min(1, v)); this._applyMaster(); this._emit(); }
  setDuck(v, secs = 0.5) { this.duck = Math.max(0, Math.min(1, v)); this._applyMaster(secs); }
  _applyMaster(secs = 0.08) {
    if (!this.master) return;
    const g = this.master.gain, t = this.ctx.currentTime, x = this.masterLevel * this.masterLevel * this.duck;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(x, t + Math.max(0.02, secs));
  }
  setSink(id) { this.sinkId = id || ''; if (this.ctx?.setSinkId) this.ctx.setSinkId(this.sinkId).catch(() => {}); }
  stopAll() { for (const id of [...this.voices.keys()]) this._stop(id); this._emit(); }
  resume() { if (this.ctx?.state === 'suspended' && this.voices.size) this.ctx.resume().catch(() => {}); }

  _emit() { this.dispatchEvent(new Event('change')); }

  _start(id, level) {
    const c = this.ctx;
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(level * level, c.currentTime, 0.4);   // fade in
    gain.connect(this.master);
    const nodes = [];
    const src = c.createBufferSource();
    src.buffer = this._buffer(id);
    src.loop = true;
    nodes.push(src);
    let head = src;
    const chain = (n) => { head.connect(n); head = n; nodes.push(n); return n; };
    const lfo = (rate, depth, param, offset) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = rate; g.gain.value = depth; param.value = offset;
      o.connect(g).connect(param); o.start(); nodes.push(o, g);
    };
    if (id === 'ocean') { const g = chain(c.createGain()); lfo(0.085, 0.42, g.gain, 0.55); const f = chain(c.createBiquadFilter()); f.type = 'lowpass'; lfo(0.085, 500, f.frequency, 900); }
    else if (id === 'wind') { const f = chain(c.createBiquadFilter()); f.type = 'bandpass'; f.Q.value = 1.2; lfo(0.06, 260, f.frequency, 480); const g = chain(c.createGain()); lfo(0.11, 0.3, g.gain, 0.7); }
    head.connect(gain);
    src.start(0, Math.random() * SECS);
    this.voices.set(id, { level, gain, nodes });
  }

  _stop(id) {
    const v = this.voices.get(id);
    if (!v) return;
    this.voices.delete(id);
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => { for (const n of v.nodes) { try { n.stop?.(); } catch { /* ignore */ } n.disconnect(); } v.gain.disconnect(); }, 900);
  }

  // ── Generators ──────────────────────────────────────────────
  _buffer(id) {
    if (this.buffers.has(id)) return this.buffers.get(id);
    const c = this.ctx, sr = c.sampleRate, n = sr * SECS;
    const t0 = performance.now();
    const task = tasks.start({ label: 'Đang tạo âm nền', detail: SOUNDS[id].label, delay: 400, quiet: false });
    const buf = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) GEN[id](buf.getChannelData(ch), sr, ch);
    // Crossfade the loop seam (50 ms) so the wrap is click-free.
    const fade = Math.floor(sr * 0.05);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < fade; i++) { const x = i / fade; d[i] = d[i] * x + d[n - fade + i] * (1 - x); } }
    task.finish(`${SOUNDS[id].label} · ${Math.round(performance.now() - t0)} ms`);
    this.buffers.set(id, buf);
    return buf;
  }

  // Short synthesized bell: kind 'work' (high, two notes), 'rest' (low), 'done' (three notes).
  chime(kind = 'work') {
    const c = this._ctx();
    if (c.state === 'suspended') c.resume().catch(() => {});
    const notes = { work: [880, 1318.5], rest: [659.3, 440], done: [523.3, 659.3, 784], tick: [1760] }[kind] || [880];
    const t = c.currentTime + 0.05;
    notes.forEach((f, i) => {
      for (const [mul, amp] of [[1, 0.28], [2.76, 0.08], [5.4, 0.03]]) {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.value = f * mul;
        const at = t + i * 0.22;
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(amp, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + 1.6 / mul + 0.2);
        o.connect(g).connect(c.destination);   // straight out: not affected by the ambient level
        o.start(at); o.stop(at + 2);
      }
    });
  }
}

// Noise colours (Paul Kellet's pink filter, leaky-integrated brown).
const white = (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; };
function pink(d, gain = 0.11) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * gain; b6 = w * 0.115926;
  }
}
function brown(d, gain = 3.5) { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * gain; } }
// One-pole filters in place.
const lp = (d, sr, fc) => { const a = 1 - Math.exp(-2 * Math.PI * fc / sr); let y = 0; for (let i = 0; i < d.length; i++) { y += a * (d[i] - y); d[i] = y; } };
const hp = (d, sr, fc) => { const a = Math.exp(-2 * Math.PI * fc / sr); let x1 = 0, y = 0; for (let i = 0; i < d.length; i++) { y = a * (y + d[i] - x1); x1 = d[i]; d[i] = y; } };

const GEN = {
  white: (d) => { white(d); for (let i = 0; i < d.length; i++) d[i] *= 0.3; },
  pink: (d) => pink(d, 0.09),
  brown: (d) => brown(d),
  ocean: (d) => { pink(d, 0.16); },
  wind: (d) => { pink(d, 0.35); },
  rain(d, sr) {
    // Steady hiss (high-passed pink) + thousands of tiny decaying droplets.
    pink(d, 0.07); hp(d, sr, 900);
    const drops = Math.floor(d.length / sr * 220);
    for (let k = 0; k < drops; k++) {
      const at = Math.floor(Math.random() * d.length), amp = Math.random() ** 3 * 0.5, len = Math.floor(sr * (0.002 + Math.random() * 0.01));
      const tau = len / 3;
      for (let i = 0; i < len && at + i < d.length; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / tau);
    }
    lp(d, sr, 7000);
  },
  fire(d, sr) {
    // Low rumble (brown) + crackles: sharp bursts with random spacing.
    brown(d, 1.6); lp(d, sr, 500);
    const cr = Math.floor(d.length / sr * 28);
    for (let k = 0; k < cr; k++) {
      const at = Math.floor(Math.random() * d.length), amp = 0.15 + Math.random() ** 2 * 0.6, len = Math.floor(sr * (0.001 + Math.random() * 0.004));
      for (let i = 0; i < len && at + i < d.length; i++) d[at + i] += (Math.random() * 2 - 1) * amp * (1 - i / len);
      if (Math.random() < 0.3) { const p = at + Math.floor(sr * 0.02); for (let i = 0; i < len && p + i < d.length; i++) d[p + i] += (Math.random() * 2 - 1) * amp * 0.5; }
    }
  },
  birds(d, sr, ch) {
    // Chirps: short sine sweeps with vibrato, grouped in phrases, panned by channel.
    d.fill(0);
    let t = Math.random() * 0.8;
    const dur = d.length / sr;
    while (t < dur - 1) {
      const base = 2200 + Math.random() * 2600, notes = 2 + Math.floor(Math.random() * 5), pan = ch ? Math.random() : 1 - Math.random();
      let at = t;
      for (let k = 0; k < notes; k++) {
        const len = 0.05 + Math.random() * 0.12, sweep = (Math.random() - 0.3) * 1800, amp = (0.05 + Math.random() * 0.1) * pan;
        const s0 = Math.floor(at * sr), n = Math.floor(len * sr);
        let ph = 0;
        for (let i = 0; i < n && s0 + i < d.length; i++) {
          const x = i / n, f = base + sweep * x + Math.sin(i / sr * 2 * Math.PI * 38) * 160;
          ph += 2 * Math.PI * f / sr;
          d[s0 + i] += Math.sin(ph) * amp * Math.sin(Math.PI * x) ** 2;
        }
        at += len + 0.03 + Math.random() * 0.08;
      }
      t = at + 0.6 + Math.random() * 2.5;
    }
  },
};

export const ambient = new Ambient();
