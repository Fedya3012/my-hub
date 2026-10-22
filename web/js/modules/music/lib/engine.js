// Audio engine: two "decks" (A/B <audio> elements) so the next track can start on time
// (gapless) or overlap (crossfade). With Web Audio each deck runs through
//   source -> ReplayGain -> fade -> preamp -> EQ bands -> balance -> volume -> timer duck -> analyser -> Router -> output(s)
// Bit-perfect mode: preamp/EQ/balance are removed from the graph, ReplayGain/crossfade are off
// (player), the router is a plain wire and the context runs at the track's sample rate
// (recreated when the rate changes) so the media element doesn't resample.
// "Direct" mode (no Web Audio) is used where Web Audio stops in the background (iOS); there
// ReplayGain can only attenuate and the EQ is off.
//
// The engine knows nothing about queues: the player gives it a track + URL to play and,
// ahead of time, the next one (preload). Events: 'time', 'state', 'transition', 'ended', 'error'.
import { applyBand, activeBands } from './eq.js';
import { Router } from './outputs.js';

const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const dbToLin = (db) => Math.pow(10, db / 20);
const now = () => performance.now() / 1000;

import { Exclusive, xsSupported } from './exclusive.js';

export class Engine extends EventTarget {
  constructor() {
    super();
    this.mode = null;            // 'webaudio' | 'direct'
    this.ctx = null;
    this.decks = [];
    this.active = 0;
    this.next = null;            // { deck, track, url, gainDb, plan }
    this.volume = 0.85; this.muted = false; this.rate = 1; this.balance = 0;
    this.eq = { enabled: 0, preamp: 0, bands: [] };
    this.opts = { engine: 'auto', outputRate: 0, sinkId: '' };
    this.silence = { on: false, quietSince: 0 };
    this.bitPerfect = false;
    this.duck = 1;               // sleep / interval timers ramp this (independent of the volume)
    this.outCfg = null;          // prefs.audio.out
    this.ctxRate = 0;            // bit-perfect: the rate the context was opened at on request
    this._timer = null;
    this.xs = null;              // WASAPI Exclusive backend (Windows app), see ./exclusive.js
    this.xsOn = false;           // the current song plays through it
  }

  get xsWanted() { return this.opts.engine === 'exclusive' && xsSupported(); }
  _xs() {
    if (this.xs) return this.xs;
    const x = this.xs = new Exclusive();
    const mine = (f) => (e) => { if (this.xsOn) f(e); };
    x.addEventListener('time', mine(() => this._emit('time')));
    x.addEventListener('state', mine(() => this._emit('state')));
    x.addEventListener('format', mine(() => this._emit('state')));
    x.addEventListener('transition', mine((e) => { this._emit('transition', { track: e.detail.track, crossfade: 0 }); this._emit('state'); }));
    x.addEventListener('ended', mine((e) => this._emit('ended', { track: e.detail.track })));
    x.addEventListener('error', mine((e) => this._emit('error', { track: x.track, message: e.detail.message })));
    return x;
  }
  _xsVolume() { this.xs?.setVolume(this.muted ? 0 : this.volume * this.volume * this.duck); }

  get deck() { return this.decks[this.active]; }
  get el() { return this.deck?.el; }
  get currentTime() { return this.xsOn ? this.xs.time : this.el?.currentTime || 0; }
  // Smooth, latency-compensated playback position for lyrics: media time is sampled coarsely by
  // browsers, so extrapolate from the last sample with performance.now() × rate, and subtract the
  // audio output latency so text lines up with what is heard. Snaps on seeks / big drift.
  get preciseTime() {
    if (this.xsOn) return this.xs.time;
    const el = this.el;
    if (!el) return 0;
    const ct = el.currentTime, now = performance.now();
    let c = this._clk;
    if (!c || c.el !== el || el.paused || el.seeking || c.rate !== el.playbackRate) {
      c = this._clk = { el, base: ct, at: now, last: ct, rate: el.playbackRate, out: ct };
    } else if (ct !== c.last) {
      const est = c.base + (now - c.at) / 1000 * c.rate;
      const err = ct - est;
      if (Math.abs(err) > 0.25) { c.base = ct; c.at = now; } else { c.base = est + err * 0.3; c.at = now; }
      c.last = ct;
    }
    let t = el.paused ? ct : c.base + (now - c.at) / 1000 * c.rate;
    if (!el.paused && !el.seeking) { if (t < c.out && c.out - t < 0.05) t = c.out; c.out = t; }
    const lat = this.ctx && this.ctx.state === 'running' ? (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) : 0;
    return Math.max(0, t - (el.paused ? 0 : Math.min(lat, 0.5) * c.rate));
  }
  get duration() { if (this.xsOn) return this.xs.dur || this.xs.track?.duration || 0; const d = this.el?.duration; return isFinite(d) ? d : (this.deck?.track?.duration || 0); }
  get paused() { return this.xsOn ? this.xs.paused : !this.el || this.el.paused; }
  get outputRate() { return this.ctx?.sampleRate || null; }
  get baseLatency() { return this.ctx ? (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0) : null; }

  wantMode() { return this.opts.engine === 'direct' || (this.opts.engine === 'auto' && IOS) ? 'direct' : 'webaudio'; }

  // Build (or rebuild) the graph. Must be called before the first play; rebuild() keeps position.
  init() {
    if (this.decks.length) return;
    this.mode = this.wantMode();
    if (this.mode === 'webaudio') {
      try {
        const o = { latencyHint: 'playback' };
        const want = (this.bitPerfect && this.ctxRate) || this.opts.outputRate;
        if (want) o.sampleRate = want;
        try { this.ctx = new AudioContext(o); }
        catch (e) { if (!o.sampleRate) throw e; delete o.sampleRate; this.ctx = new AudioContext(o); }   // rate refused: device default
      } catch (e) { console.warn('[music] Web Audio unavailable, using direct mode', e); this.mode = 'direct'; }
    }
    if (this.ctx) {
      const c = this.ctx;
      this.preamp = c.createGain();
      this.filters = [];
      this.panner = c.createStereoPanner();
      this.master = c.createGain();
      this.ducker = c.createGain();
      this.ducker.gain.value = this.duck;
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      this.router = new Router(c);
      this.router.apply(this.outCfg, { bypass: this.bitPerfect });
      this.master.connect(this.ducker).connect(this.analyser).connect(this.router.input);
      this._wireChain();
      if (this.opts.sinkId && c.setSinkId) c.setSinkId(this.opts.sinkId).catch(() => {});
    }
    this.decks = [this._deck(), this._deck()];
    this.applyVolume();
    clearInterval(this._timer);
    this._timer = setInterval(() => this._tick(), 50);
  }

  _deck() {
    const el = new Audio();
    el.preload = 'auto';
    el.playbackRate = this.rate;
    el.preservesPitch = true;
    const d = { el, track: null, url: null, gainDb: 0, fade: 1 };
    if (this.ctx) {
      d.src = this.ctx.createMediaElementSource(el);
      d.rg = this.ctx.createGain();
      d.fader = this.ctx.createGain();
      d.src.connect(d.rg).connect(d.fader).connect(this.preamp);
    } else if (this.opts.sinkId && el.setSinkId) el.setSinkId(this.opts.sinkId).catch(() => {});
    const fire = (type) => () => { if (this.decks[this.active] === d) this._emit(type === 'time' ? 'time' : 'state'); };
    el.addEventListener('timeupdate', fire('time'));
    for (const t of ['play', 'pause', 'waiting', 'playing', 'loadedmetadata', 'durationchange']) el.addEventListener(t, fire('state'));
    el.addEventListener('ended', () => { if (this.decks[this.active] === d) this._onEnded(); });
    el.addEventListener('error', () => {
      if (this.decks[this.active] === d && d.url) this._emit('error', { track: d.track, code: el.error?.code, message: el.error?.message });
      else if (this.next?.deck === d) this.next = null;
    });
    return d;
  }

  _wireChain() {
    // preamp -> [filters] -> panner -> master
    this.preamp.disconnect();
    this.filters.forEach(f => f.disconnect());
    this.panner.disconnect();
    let node = this.preamp;
    const on = this.eq.enabled && !this.bitPerfect;
    const bands = on ? activeBands(this.eq.bands) : [];
    this._eqSig = on + ':' + bands.length;
    this.filters = bands.map(b => { const f = this.ctx.createBiquadFilter(); applyBand(f, b, this.ctx.currentTime); return f; });
    for (const f of this.filters) { node.connect(f); node = f; }
    if (this.bitPerfect) node.connect(this.master);          // no panner: a pan of 0 is identity for stereo, but not for mono
    else { node.connect(this.panner); this.panner.connect(this.master); }
    this.preamp.gain.cancelScheduledValues(this.ctx.currentTime);
    this.preamp.gain.setTargetAtTime(on ? dbToLin(this.eq.preampDb ?? this.eq.preamp) : 1, this.ctx.currentTime, 0.02);
    if (this.bitPerfect) this.preamp.gain.setValueAtTime(1, this.ctx.currentTime + 0.1);
  }

  async rebuild() {
    const d = this.deck;
    const keep = d?.track ? { track: d.track, url: d.url, gainDb: d.gainDb, t: d.el.currentTime, playing: !d.el.paused } : null;
    this.destroy();
    this.init();
    if (keep) await this.load(keep.track, keep.url, { gainDb: keep.gainDb, startAt: keep.t, autoplay: keep.playing });
  }

  destroy() {
    clearInterval(this._timer);
    for (const d of this.decks) { d.el.pause(); d.el.removeAttribute('src'); d.el.load(); }
    this.decks = []; this.next = null;
    this.router?.destroy(); this.router = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ── Loading & transport ───────────────────────────────────────
  async load(track, url, { gainDb = 0, startAt = 0, autoplay = true, rate = 0 } = {}) {
    // WASAPI Exclusive: lossless songs go to the native helper; anything it cannot open stays here.
    if (this.xsWanted) {
      for (const d of this.decks) this._stopDeck(d);
      this.next = null;
      const x = this._xs();
      this.xsOn = true;
      this._xsVolume();
      let ok = false;
      try { ok = await x.load(track, url, { startAt, autoplay }); } catch (e) { console.warn('[exclusive]', e); }
      if (ok) { this._emit('state'); return; }
      this.xsOn = false;
      x.stop();   // free the DAC for Web Audio
      this._emit('xs-fallback', { track, reason: this.xs.lastError });
    } else if (this.xsOn || this.xs?.track) { this.xsOn = false; this.xs.stop(); }
    // Bit-perfect: reopen the context at this track's rate (only between tracks; costs ~50 ms).
    if (this.bitPerfect && rate && !this.ctx && this.wantMode() === 'webaudio') this.ctxRate = rate;
    if (this.bitPerfect && rate && this.mode === 'webaudio' && this.ctx && this.ctx.sampleRate !== rate && this._triedRate !== rate + ':' + this.ctx.sampleRate) {
      for (const d of this.decks) this._stopDeck(d);
      this.ctxRate = rate; this.destroy();
      this.init();
      this._triedRate = rate + ':' + this.ctx?.sampleRate;   // refused rates aren't retried every track
    }
    this.init();
    // Anything playing (including a crossfade tail) stops.
    for (const d of this.decks) if (d !== this.deck) this._stopDeck(d);
    this.next = null;
    const d = this.deck;
    const wasPlaying = !d.el.paused;
    if (wasPlaying && this.ctx) { this._fadeTo(d, 0, 0.12); await sleep(120); }
    this._stopDeck(d);
    d.track = track; d.url = url; d.gainDb = gainDb;
    this._setGain(d, gainDb);
    this._setFade(d, 1, 0);
    d.el.crossOrigin = /^https?:/i.test(url) ? 'anonymous' : null;   // streamed from a drive: CORS for Web Audio
    d.el.src = url;
    d.el.playbackRate = this.rate;
    if (startAt > 0) {
      await once(d.el, 'loadedmetadata', 8000);
      if (isFinite(d.el.duration) && startAt < d.el.duration - 1) d.el.currentTime = startAt;
    }
    this._emit('state');
    if (autoplay) await this.play();
  }

  async play() {
    if (this.xsOn) return this.xs.play();
    this.init();
    if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => {});
    this.router?.resume();
    if (!this.el?.src) return;
    const d = this.deck;
    this._pauseTok = (this._pauseTok || 0) + 1;
    const fadeIn = d && d.el.paused && !d.el.ended;
    if (fadeIn) this._setFade(d, 0, 0);
    try { await this.el.play(); if (fadeIn || d.fade < 1) this._fadeTo(d, 1, 0.12); }
    catch (e) { if (e.name !== 'AbortError') this._emit('error', { track: this.deck.track, message: e.message, blocked: e.name === 'NotAllowedError' }); }
  }

  pause({ fade = 0.18 } = {}) {
    if (this.xsOn) return this.xs.pause();
    const d = this.deck;
    if (!d || d.el.paused) return;
    for (const x of this.decks) if (x !== d && !x.el.paused) this._stopDeck(x);
    if (fade) {
      const tok = this._pauseTok = (this._pauseTok || 0) + 1;
      this._fadeTo(d, 0, fade);
      // Pause only once the ramp has reached the speakers (output latency: Android buffers ~100+ ms), and
      // keep the fader at 0 while paused: resetting it to 1 let the buffered tail through at full level,
      // which was the click. play() already restarts from 0 and fades in.
      const lat = Math.min(0.5, (this.ctx?.outputLatency || 0) + (this.ctx?.baseLatency || 0));
      setTimeout(() => { if (this.deck === d && this._pauseTok === tok) d.el.pause(); }, (fade + lat) * 1000 + 40);
    } else d.el.pause();
  }

  toggle() { return this.paused ? this.play() : this.pause(); }

  seek(t) {
    if (this.xsOn) return this.xs.seek(t);
    const el = this.el;
    if (!el) return;
    const d = this.duration;
    el.currentTime = Math.max(0, Math.min(d ? d - 0.05 : t, t));
    if (this.next) { this.next.started = false; this.next.deck.el.pause(); this.next.deck.el.currentTime = 0; }
  }

  stop() { if (this.xsOn) { this.xs.stop(); this.xsOn = false; } for (const d of this.decks) this._stopDeck(d); this.next = null; this._emit('state'); }

  _stopDeck(d) {
    d.el.pause();
    if (d.url) { d.el.removeAttribute('src'); d.el.load(); }
    d.url = null;
  }

  // The player hands over the next track early. plan = { gapless, crossfade (s) }.
  preload(track, url, { gainDb = 0, plan = {} } = {}) {
    if (this.xsOn) { this.xs.preload(track, url).catch(() => {}); return; }
    this.init();
    const d = this.decks[1 - this.active];
    if (this.next?.url === url) { this.next.plan = plan; return; }
    this._stopDeck(d);
    d.track = track; d.url = url; d.gainDb = gainDb;
    this._setGain(d, gainDb);
    this._setFade(d, plan.crossfade ? 0 : 1, 0);
    d.el.crossOrigin = /^https?:/i.test(url) ? 'anonymous' : null;   // streamed from a drive: CORS for Web Audio
    d.el.src = url;
    d.el.playbackRate = this.rate;
    d.el.load();
    this.next = { deck: d, track, url, plan, started: false };
  }
  clearNext() { if (this.xsOn) this.xs.clearNext(); if (this.next) { this._stopDeck(this.next.deck); this.next = null; } }

  // Runs every 50 ms (and faster near the end): starts the next deck on time.
  _tick() {
    const d = this.deck, n = this.next;
    if (!d || d.el.paused || !n || n.started) { this._checkSilence(); return; }
    const remaining = (d.el.duration - d.el.currentTime) / (this.rate || 1);
    if (!isFinite(remaining)) return;
    const cf = n.plan.crossfade || 0;
    const startAt = cf > 0 ? cf : (n.plan.gapless ? 0.045 : 0);   // gapless: compensate start latency
    if (remaining <= startAt + 0.06 && remaining > startAt && !this._fast) {
      // Close to the switch: poll at ~4 ms for precision.
      this._fast = setInterval(() => this._tick(), 4);
    }
    if (remaining <= startAt && startAt > 0) this._startNext(cf);
    this._checkSilence();
  }

  // "Smart" end-of-track: if the tail is silent (< -55 dBFS for 1.5 s) skip ahead to the next track.
  _checkSilence() {
    if (!this.silence.on || !this.analyser || this.paused) return;
    const d = this.deck, remaining = this.duration - this.currentTime;
    if (remaining > 12 || remaining < 1.2) { this.silence.quietSince = 0; return; }
    const buf = this._td ||= new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const level = 10 * Math.log10(s / buf.length + 1e-12);
    if (level < -55) {
      if (!this.silence.quietSince) this.silence.quietSince = now();
      else if (now() - this.silence.quietSince > 1.5) {
        this.silence.quietSince = 0;
        if (this.next) this._startNext(Math.min(1, this.next.plan.crossfade || 0)); else d.el.currentTime = d.el.duration;
      }
    } else this.silence.quietSince = 0;
  }

  _startNext(cf) {
    clearInterval(this._fast); this._fast = null;
    const n = this.next, old = this.deck;
    if (!n || n.started) return;
    n.started = true;
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    n.deck.el.play().catch(() => {});
    if (cf > 0) {
      this._setFade(n.deck, 0, 0);
      this._fadeTo(n.deck, 1, cf, true);
      this._fadeTo(old, 0, cf, true);
      setTimeout(() => { if (this.deck !== old) this._stopDeck(old); }, cf * 1000 + 80);
    } else {
      this._setFade(n.deck, 1, 0);
      setTimeout(() => { if (this.deck !== old) this._stopDeck(old); }, 120);
    }
    this.active = this.decks.indexOf(n.deck);
    this.next = null;
    this._emit('transition', { track: n.track, crossfade: cf });
    this._emit('state');
  }

  _onEnded() {
    clearInterval(this._fast); this._fast = null;
    if (this.next && !this.next.started) { this._startNext(0); return; }   // late: still start right away
    this._emit('ended', { track: this.deck.track });
  }

  // ── Gains ─────────────────────────────────────────────────────
  _setGain(d, gainDb) {
    d.gainDb = gainDb;
    if (d.rg) d.rg.gain.setValueAtTime(dbToLin(gainDb), this.ctx.currentTime);
    else this._directVolume(d);
  }
  _setFade(d, v, t) {
    d.fade = v;
    if (d.fader) { d.fader.gain.cancelScheduledValues(this.ctx.currentTime); d.fader.gain.setValueAtTime(v, this.ctx.currentTime); }
    else this._directVolume(d);
  }
  _fadeTo(d, v, secs, equalPower = false) {
    if (d.fader) {
      const g = d.fader.gain, t = this.ctx.currentTime, from = g.value;
      g.cancelScheduledValues(t);
      if (equalPower) {
        const n = 64, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = i / (n - 1);
          curve[i] = v > from ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2) * from;
        }
        g.setValueCurveAtTime(curve, t, secs);
      } else { g.setValueAtTime(from, t); g.linearRampToValueAtTime(v, t + secs); }
      d.fade = v;
      return;
    }
    // Direct mode: ramp element volume.
    const start = performance.now(), from = d.fade;
    const step = () => {
      const x = Math.min(1, (performance.now() - start) / (secs * 1000));
      d.fade = from + (v - from) * (equalPower ? Math.sin(x * Math.PI / 2) : x);
      this._directVolume(d);
      if (x < 1) requestAnimationFrame(step);
    };
    step();
  }
  _directVolume(d) {
    if (this.ctx) return;
    const v = (this.muted ? 0 : this.volume * this.volume) * Math.min(1, dbToLin(d.gainDb)) * d.fade * this.duck;
    d.el.volume = Math.max(0, Math.min(1, v));
  }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.applyVolume(); this._xsVolume(); }
  setMuted(m) { this.muted = m; this.applyVolume(); this._xsVolume(); }
  applyVolume() {
    // Perceptual curve: slider^2.
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * this.volume, this.ctx.currentTime, 0.015);
    else this.decks.forEach(d => this._directVolume(d));
  }
  // Timers: smooth level ramp on top of the volume (0–1).
  setDuck(v, secs = 0.4) {
    this.duck = Math.max(0, Math.min(1, v));
    if (this.ducker) { const g = this.ducker.gain, t = this.ctx.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(this.duck, t + Math.max(0.02, secs)); }
    else this.decks.forEach(d => this._directVolume(d));
  }
  setOutputs(cfg) { this.outCfg = cfg; this.router?.apply(cfg, { bypass: this.bitPerfect }); }
  setBitPerfect(on) {
    this.bitPerfect = !!on;
    if (!on) this.ctxRate = 0;
    if (!this.ctx) return;
    this._wireChain();
    this.router?.apply(this.outCfg, { bypass: this.bitPerfect });
  }
  // What the graph does to the signal right now (for the signal-path panel).
  pathInfo() {
    const c = this.ctx;
    return {
      xs: this.xsOn ? this.xs.format : null,
      mode: this.mode, ctxRate: c?.sampleRate || 0, state: c?.state,
      baseLatency: c?.baseLatency || 0, outputLatency: c?.outputLatency || 0,
      filters: this.filters?.length || 0, preampDb: this.eq.enabled && !this.bitPerfect ? (this.eq.preampDb || 0) : 0,
      balance: this.bitPerfect ? 0 : this.balance, volume: this.muted ? 0 : this.volume, rate: this.rate, duck: this.duck,
      rgDb: this.deck?.gainDb || 0, routerWire: this.router ? this.router.bypass : true, sinkId: this.opts.sinkId || '',
    };
  }
  setRate(r) { this.rate = r; this.decks.forEach(d => { d.el.playbackRate = r; }); }
  setBalance(b) { this.balance = b; if (this.panner) this.panner.pan.setTargetAtTime(b, this.ctx.currentTime, 0.02); }
  setTrackGain(gainDb) { if (this.deck) this._setGain(this.deck, gainDb); }

  // EQ: { enabled, preampDb, bands }. Rebuilds the chain when the number of bands changes.
  setEq(eq) {
    const prev = this.eq;
    this.eq = eq;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = eq.enabled && !this.bitPerfect, bands = on ? activeBands(eq.bands) : [];
    if (prev.enabled === eq.enabled && this._eqSig === on + ':' + bands.length) {
      // Same number of active filters: retune in place (no reconnect, no click while dragging).
      bands.forEach((b, i) => { if (this.filters[i]) applyBand(this.filters[i], b, t); });
      this.preamp.gain.setTargetAtTime(on ? dbToLin(eq.preampDb) : 1, t, 0.02);
    } else this._wireChain();
  }

  async setOutput(sinkId) {
    this.opts.sinkId = sinkId;
    if (this.ctx?.setSinkId) return this.ctx.setSinkId(sinkId || '');
    for (const d of this.decks) if (d.el.setSinkId) await d.el.setSinkId(sinkId || '');
  }

  // Level for the visualizer: fills `out` (Uint8Array, frequencyBinCount) or returns false.
  spectrum(out) { if (!this.analyser) return false; this.analyser.getByteFrequencyData(out); return true; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const once = (el, ev, timeout) => new Promise(res => {
  const t = setTimeout(res, timeout);
  el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
});

export const canSetSink = () => !!(window.AudioContext && AudioContext.prototype.setSinkId) || !!HTMLMediaElement.prototype.setSinkId;
export const isIOS = IOS;
