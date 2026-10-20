// Output routing at the very end of the engine graph:
//   music + ambient bus -> Router.input -> [channel matrix -> delay -> trim] -> output A (context sink)
//                                       -> [channel matrix -> delay -> trim] -> MediaStream -> <audio sinkId=B>
// Both outputs are fed from one AudioContext, so they share one clock; the only offset is each
// device's own latency (Bluetooth ≈ 150–300 ms), which the per-output delay trim compensates.
// With the identity config (or bit-perfect) the router is a plain wire to ctx.destination.
const dbToLin = (db) => Math.pow(10, db / 20);

// Channel matrices: rows = output L/R, columns = input L/R.
export const CH_MODES = {
  stereo: { label: 'Stereo', m: [[1, 0], [0, 1]] },
  mono: { label: 'Mono (L+R)', m: [[0.5, 0.5], [0.5, 0.5]] },
  left: { label: 'Chỉ kênh trái', m: [[1, 0], [1, 0]] },
  right: { label: 'Chỉ kênh phải', m: [[0, 1], [0, 1]] },
  swap: { label: 'Đảo L↔R', m: [[0, 1], [1, 0]] },
};

export const canDual = () => !!(window.AudioContext && AudioContext.prototype.createMediaStreamDestination && HTMLMediaElement.prototype.setSinkId);
export const canPickSink = () => !!((window.AudioContext && AudioContext.prototype.setSinkId) || HTMLMediaElement.prototype.setSinkId);

export function isIdentity(cfg) {
  if (!cfg || cfg.mode === 'dual') return !cfg;
  const a = cfg.a || {};
  return (a.ch || 'stereo') === 'stereo' && !+a.trimL && !+a.trimR && !+a.gainDb && !+a.delayMs;
}

export class Router {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.paths = [];
    this.el = null;            // <audio> playing output B
    this.key = '';
    this.cfg = null;
    this.bypass = true;
    this.input.connect(ctx.destination);
  }

  // cfg = prefs.audio.out; bypass = bit-perfect (wire straight through).
  apply(cfg, { bypass = false } = {}) {
    this.cfg = cfg;
    const dual = cfg?.mode === 'dual' && canDual();
    const wire = bypass || (!dual && isIdentity(cfg));
    const key = wire ? 'wire' : JSON.stringify([dual, cfg.a?.ch, dual && cfg.b?.ch, dual && cfg.b?.sinkId]);
    if (key === this.key) { this._levels(cfg, dual); return; }
    this._teardown();
    this.key = key; this.bypass = wire;
    if (wire) { this.input.connect(this.ctx.destination); return; }
    this.paths.push(this._path(cfg.a?.ch, this.ctx.destination));
    if (dual) {
      const dest = this.ctx.createMediaStreamDestination();
      this.paths.push(this._path(cfg.b?.ch, dest));
      const el = this.el = new Audio();
      el.srcObject = dest.stream;
      const go = () => el.play().catch(() => { /* resumes with the next user gesture via resume() */ });
      if (cfg.b?.sinkId && el.setSinkId) el.setSinkId(cfg.b.sinkId).then(go, (e) => { console.warn('[music] output B', e); go(); });
      else go();
    }
    this._levels(cfg, dual);
  }

  resume() { if (this.el?.paused) this.el.play().catch(() => {}); }

  _path(ch, dest) {
    const c = this.ctx, m = (CH_MODES[ch] || CH_MODES.stereo).m;
    const split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
    const outL = c.createGain(), outR = c.createGain(), delay = c.createDelay(1), trim = c.createGain();
    this.input.connect(split);
    for (let o = 0; o < 2; o++) for (let i = 0; i < 2; i++) {
      if (!m[o][i]) continue;
      const g = c.createGain(); g.gain.value = m[o][i];
      split.connect(g, i); g.connect(o ? outR : outL);
    }
    outL.connect(merge, 0, 0); outR.connect(merge, 0, 1);
    merge.connect(delay).connect(trim).connect(dest);
    return { split, merge, outL, outR, delay, trim, dest };
  }

  _levels(cfg, dual) {
    if (this.bypass) return;
    const t = this.ctx.currentTime, set = (p, v) => p.setTargetAtTime(v, t, 0.03);
    const [A, B] = this.paths, a = cfg.a || {}, b = cfg.b || {};
    set(A.outL.gain, dbToLin(+a.trimL || 0)); set(A.outR.gain, dbToLin(+a.trimR || 0));
    set(A.trim.gain, dbToLin(+a.gainDb || 0)); set(A.delay.delayTime, Math.min(1, (+a.delayMs || 0) / 1000));
    if (dual && B) { set(B.trim.gain, dbToLin(+b.gainDb || 0)); set(B.delay.delayTime, Math.min(1, (+b.delayMs || 0) / 1000)); }
  }

  _teardown() {
    try { this.input.disconnect(); } catch { /* not connected */ }
    for (const p of this.paths) for (const n of [p.split, p.merge, p.outL, p.outR, p.delay, p.trim]) try { n.disconnect(); } catch { /* ignore */ }
    this.paths = [];
    if (this.el) { this.el.pause(); this.el.srcObject = null; this.el = null; }
    this.key = '';
  }

  destroy() { this._teardown(); }
}

// The rate the browser's default output runs at (a fresh AudioContext without sampleRate
// opens at the device's preferred rate). Cached; null where Web Audio is missing.
let probed = null;
export function deviceRate() {
  if (probed !== null) return probed;
  try { const c = new AudioContext(); probed = c.sampleRate; c.close().catch(() => {}); } catch { probed = 0; }
  return probed;
}

export async function listOutputs() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'audiooutput').map((d, i) => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.label || (d.deviceId === 'default' ? 'Mặc định của hệ thống' : `Thiết bị ra ${i + 1}`) }));
  } catch { return []; }
}

// Ask for device labels (Chrome only reveals them after a media permission or selectAudioOutput).
export async function requestOutput() {
  if (navigator.mediaDevices?.selectAudioOutput) {
    const d = await navigator.mediaDevices.selectAudioOutput();
    return { id: d.deviceId, label: d.label };
  }
  return null;
}
