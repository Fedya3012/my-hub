// Podcast player: one <audio> element per episode, speed 0.5–3× with the pitch kept, Skip silence (plays the
// silent parts fast), Voice Boost (speech EQ + compressor), custom skip, sleep timer, skip intro / outro per show,
// the queue, the lock screen (Media Session) and cross-device position (core/progress.js).
// Effects need Web Audio, which hears a remote file only when its host allows CORS: an episode whose host does not
// is played without effects (a fresh element, never routed through Web Audio, so it is never silent).
import { db, getSetting, setSetting } from '../../../core/db.js';
import { bus } from '../../../core/bus.js';
import { progress } from '../../../core/progress.js';
import { toast } from '../../../core/ui.js';
import * as store from './store.js';
import { get, set } from './prefs.js';

const SESSION = 'podcasts:session';

class PodPlayer extends EventTarget {
  constructor() {
    super();
    this.el = null; this.ep = null; this.show = null;
    this.ac = null; this.fx = null; this.fxOn = false; this.fxBlocked = false;
    this.sleep = null; this._untrack = null; this._url = null; this._silent = 0; this._boosted = false;
  }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get playing() { return !!this.el && !this.el.paused; }
  get time() { return this.el?.currentTime || 0; }
  get duration() { const d = this.el?.duration; return isFinite(d) && d > 0 ? d : this.ep?.duration || 0; }
  get rate() { return this.show?.settings?.speed || get('speed') || 1; }

  async init() {
    bus.on('media:play', ({ app }) => { if (app !== 'podcasts' && this.playing) this.pause(); });
    // Resume where this account last listened (any device), paused.
    const s = await db.progress.get(SESSION);
    if (s?.episodeId) { const e = await store.episode(s.episodeId); if (e) await this.load(e, { autoplay: false }); }
  }

  // ── Loading ───────────────────────────────────────────────────
  async load(e, { autoplay = true, at = null } = {}) {
    this._teardown();
    this.ep = e; this.show = await store.show(e.showId);
    const blob = await store.downloadedBlob(e.id);
    const remote = !blob;
    const wantFx = !!(get('voiceBoost') || get('skipSilence'));
    this.fxOn = wantFx && !(remote && this.fxBlocked === e.url);
    const el = this.el = new Audio();
    el.preload = 'auto';
    el.preservesPitch = el.mozPreservesPitch = el.webkitPreservesPitch = true;
    if (this.fxOn && remote) el.crossOrigin = 'anonymous';
    this._url = blob ? URL.createObjectURL(blob) : null;
    el.src = this._url || e.url;
    el.playbackRate = this.rate;
    el.defaultPlaybackRate = this.rate;
    this._wire(el);
    if (this.fxOn) this._connect(el);
    this._untrack = await progress.track(store.progressItem(e), el);
    if (at != null) { const go = () => { el.currentTime = at; }; el.readyState >= 1 ? go() : el.addEventListener('loadedmetadata', go, { once: true }); }
    // Skip the intro of this show.
    const intro = this.show?.settings?.skipIntro || 0;
    if (intro && at == null) el.addEventListener('loadedmetadata', () => { if (el.currentTime < intro) el.currentTime = intro; }, { once: true });
    await progress.save({ id: SESSION, moduleId: 'podcasts' }, { position: 0, total: 0, extra: { virtual: true, episodeId: e.id } });
    this._media();
    this._emit('episode', e);
    if (autoplay) await this.play();
  }

  _wire(el) {
    const on = (t, f) => el.addEventListener(t, f);
    on('play', () => { this._silenceStart(); this._emit('state'); this._mediaState(); bus.emit('media:play', { app: 'podcasts' }); this.ac?.resume?.(); });
    on('pause', () => { this._silenceStop(); this._emit('state'); this._mediaState(); this._maybeMarkPlayed(); });
    on('timeupdate', () => this._tick());
    on('ended', () => this._ended());
    on('ratechange', () => this._mediaPos());
    on('error', () => {
      if (el !== this.el) return;
      // Host without CORS: play again without effects.
      if (el.crossOrigin && this.ep) { this.fxBlocked = this.ep.url; toast('Máy chủ của tập này không cho áp hiệu ứng (Voice Boost / bỏ khoảng lặng), đang phát bình thường.', 'warn'); this.load(this.ep, { autoplay: true }); return; }
      toast('Không phát được tập này. Kiểm tra mạng hoặc tải về trước.', 'error');
      this._emit('state');
    });
  }

  _connect(el) {
    try {
      this.ac ||= new (window.AudioContext || window.webkitAudioContext)();
      const ac = this.ac;
      const src = ac.createMediaElementSource(el);
      const hp = Object.assign(ac.createBiquadFilter(), { type: 'highpass' }); hp.frequency.value = 85;
      const pk = Object.assign(ac.createBiquadFilter(), { type: 'peaking' }); pk.frequency.value = 2800; pk.Q.value = 0.9;
      const comp = ac.createDynamicsCompressor();
      const gain = ac.createGain();
      const an = ac.createAnalyser(); an.fftSize = 512;
      src.connect(hp); hp.connect(pk); pk.connect(comp); comp.connect(gain); gain.connect(ac.destination);
      src.connect(an);
      this.fx = { src, hp, pk, comp, gain, an, buf: new Float32Array(an.fftSize) };
      this.applyFx();
    } catch (e) { console.warn('[podcasts] fx', e); this.fx = null; }
  }
  applyFx() {
    const f = this.fx; if (!f) return;
    const vb = !!get('voiceBoost');
    f.pk.gain.value = vb ? 5 : 0;
    f.hp.frequency.value = vb ? 85 : 10;
    f.comp.threshold.value = vb ? -26 : 0; f.comp.ratio.value = vb ? 4 : 1; f.comp.knee.value = vb ? 12 : 0;
    f.gain.gain.value = vb ? 1.45 : 1;
  }
  // Turning an effect on needs the graph: reload at the same spot.
  // The service calls fxChanged() on any change of these params (here, Cài đặt, or another device).
  setFx(key, on) { return set(key, on ? 1 : 0); }
  async fxChanged() {
    if (!this.ep) return;
    const want = !!(get('voiceBoost') || get('skipSilence'));
    if (want && !this.fx) { const at = this.time, was = this.playing; await this.load(this.ep, { autoplay: was, at }); }
    else this.applyFx();
    this._silenceStart();
    this._emit('state');
  }

  _teardown() {
    this._silenceStop(); this._lv = null;
    if (this.el) { const el = this.el; this.el = null; el.pause(); this._untrack?.(); el.removeAttribute('src'); el.load(); }
    this._untrack = null;
    try { this.fx?.src.disconnect(); this.fx?.gain.disconnect(); if (this.fx?.meter) this.fx.meter.port.onmessage = null; } catch { /* ignore */ }
    this.fx = null;
    if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
  }

  // ── Transport ─────────────────────────────────────────────────
  async play() { if (!this.el) return; try { await this.el.play(); } catch (e) { if (e?.name !== 'AbortError') console.warn(e); } }
  pause() { this.el?.pause(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t) { if (this.el) this.el.currentTime = Math.max(0, Math.min(t, this.duration || t)); this._emit('time'); }
  seekBy(d) { this.seek(this.time + d); }
  back() { this.seekBy(-(get('skipBack') || 15)); }
  fwd() { this.seekBy(get('skipFwd') || 30); }
  async setRate(r, { forShow = false } = {}) {
    r = Math.max(0.5, Math.min(3, Math.round(r * 100) / 100));
    if (forShow && this.show) await store.setShowSettings(this.show.itemId, { speed: r }), this.show = await store.show(this.show.itemId);
    else await set('speed', r);
    if (this.el) this.el.defaultPlaybackRate = r;
    if (this.el && !this._boosted) { this.el.playbackRate = r; this.el.defaultPlaybackRate = r; }
    this._emit('state');
  }

  async playEpisode(e, opts = {}) {
    if (this.ep?.id === e.id && this.el) { if (opts.at != null) this.seek(opts.at); return this.play(); }
    await store.dequeue(e.id);
    await this.load(e, opts);
    store.clearInbox([e.id]).catch(() => {});
  }
  async next() {
    const q = await store.queue();
    const id = q.find(x => x !== this.ep?.id);
    if (!id) { this.pause(); return false; }
    const e = await store.episode(id);
    if (!e) { await store.dequeue(id); return this.next(); }
    await this.playEpisode(e);
    return true;
  }

  // ── Ticks: Skip silence, outro, sleep timer, played mark ───────
  _tick() {
    const el = this.el; if (!el) return;
    this._emit('time');
    const outro = this.show?.settings?.skipOutro || 0;
    if (outro && this.duration && el.currentTime > this.duration - outro && !el.paused) { el.currentTime = this.duration; return; }
    if (this.sleep?.until && Date.now() >= this.sleep.until - 8000) this._sleepFade();
    if (this.sleep?.chapterEnd != null && el.currentTime >= this.sleep.chapterEnd) { this.cancelSleep(); this.pause(); toast('Hẹn giờ ngủ: đã dừng ở cuối chương'); }
  }
  // Skip silence: an analyser on the raw signal, polled every 30 ms while playing (timeupdate is only ~4 Hz, too slow).
  // The threshold follows the recording (noise floor and speech level), so quiet or noisy shows both work. A silence
  // longer than the level's minimum plays fast; when speech returns the player steps back a little so the first
  // syllable is not swallowed.
  async _silenceStart() {
    clearInterval(this._sTimer); this._sTimer = null;
    if (!get('skipSilence') || !this.fx || !this.el || this.el.paused) return;
    this._silent = 0; this._sT = 0;
    // Preferred: an AudioWorklet measures loudness on the audio thread every 10 ms and keeps working when the app is
    // in the background (timers there are slowed to once a second). Fallback: poll the analyser every 30 ms.
    if (await this._meter()) return;
    this._sTimer = setInterval(() => {
      const f = this.fx; if (!f) return;
      const now = performance.now(), dt = this._sT ? Math.min(0.2, (now - this._sT) / 1000) : 0; this._sT = now;
      f.an.getFloatTimeDomainData(f.buf);
      let sum = 0; for (let i = 0; i < f.buf.length; i++) sum += f.buf[i] * f.buf[i];
      this._silence(Math.sqrt(sum / f.buf.length), dt);
    }, 30);
  }
  async _meter() {
    const f = this.fx, ac = this.ac;
    if (f.meter) return true;
    if (!ac?.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
    try {
      if (!PodPlayer._meterLoaded) {
        const code = `registerProcessor('pc-meter', class extends AudioWorkletProcessor {
          constructor() { super(); this.n = 0; this.sum = 0; this.block = Math.round(sampleRate / 100); }
          process(inputs) {
            const ch = inputs[0]; if (!ch || !ch.length) return true;
            const len = ch[0].length;
            for (let i = 0; i < len; i++) { let v = 0; for (let c = 0; c < ch.length; c++) v += ch[c][i]; v /= ch.length; this.sum += v * v; }
            this.n += len;
            if (this.n >= this.block) { this.port.postMessage([Math.sqrt(this.sum / this.n), this.n / sampleRate]); this.n = 0; this.sum = 0; }
            return true;
          }
        });`;
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        await ac.audioWorklet.addModule(url); URL.revokeObjectURL(url);
        PodPlayer._meterLoaded = true;
      }
      if (this.fx !== f) return true;
      const node = new AudioWorkletNode(ac, 'pc-meter', { numberOfOutputs: 0 });
      node.port.onmessage = ({ data }) => { if (this.fx === f) this._silence(data[0], data[1]); };
      f.src.connect(node); f.meter = node;
      return true;
    } catch (e) { console.warn('[podcasts] meter', e); return false; }
  }
  _silenceStop() {
    clearInterval(this._sTimer); this._sTimer = null;
    if (this._boosted && this.el) { this._boosted = false; this.el.playbackRate = this.rate; }
    this._silent = 0;
  }
  // rms: loudness of the last slice; dt: its length in real seconds.
  _silence(rms, dt) {
    const el = this.el;
    if (!this.fx || !el || el.paused || !get('skipSilence')) { if (this._boosted || this._sTimer) this._silenceStop(); return; }
    // Adaptive levels: the floor drops at once and creeps up; speech is a slow average of the loud frames.
    const lv = this._lv ||= { floor: 0.004, speech: 0.08 };
    lv.floor = rms < lv.floor ? rms : Math.min(lv.floor * 1.003 + 1e-6, 0.05);
    const thr = Math.min(0.05, Math.max(0.0025, lv.floor * 2.5, lv.speech * 0.1));
    if (rms > thr * 1.4) lv.speech += (rms - lv.speech) * 0.02;
    const level = +get('silenceLevel') || 2;
    const minQuiet = [0, 0.45, 0.3, 0.18][level];
    const fast = Math.min(4, this.rate * [0, 2, 3, 4][level]);
    const quiet = rms < thr, loud = rms > thr * 1.3;
    this._silent = quiet ? this._silent + dt * el.playbackRate : 0;
    if (!this._boosted && this._silent >= minQuiet) { this._boosted = true; el.playbackRate = fast; }
    else if (this._boosted && loud) {
      this._boosted = false; el.playbackRate = this.rate;
      // Speech was detected up to ~one poll late, played at the fast rate: step back over it.
      const back = Math.min(0.25, (this._sTimer ? 0.045 : 0.02) * fast);
      const t = el.currentTime - back, b = el.buffered;
      for (let i = 0; i < b.length; i++) if (t >= b.start(i) && t <= b.end(i)) { el.currentTime = t; this._saved = (this._saved || 0) - back / this.rate; break; }
    }
    if (this._boosted) this._saved = (this._saved || 0) + dt * (el.playbackRate / this.rate - 1);
    if ((this._saved || 0) > 5) { const s = this._saved; this._saved = 0; getSetting('podcasts.timeSaved', 0).then(v => setSetting('podcasts.timeSaved', v + s)); }
  }
  async _maybeMarkPlayed() {
    const e = this.ep; if (!e || !this.duration) return;
    if (this.time / this.duration * 100 >= (get('markPlayedAt') || 95) && !e.played) { await db.pcEpisodes.update(e.id, { played: 1, inbox: 0 }); e.played = 1; }
  }
  async _ended() {
    const e = this.ep;
    if (this.sleep?.endOfEpisode) { this.cancelSleep(); if (e) await store.setPlayed(e.id, true); this._emit('state'); return; }
    if (e) await store.setPlayed(e.id, true);
    if (get('autoplayNext')) await this.next();
    this._emit('state');
  }

  // ── Sleep timer ───────────────────────────────────────────────
  // { minutes } | { endOfEpisode: true } | { endOfChapter: seconds }
  setSleep(opt) {
    this.cancelSleep(false);
    if (opt?.minutes) this.sleep = { until: Date.now() + opt.minutes * 60000, minutes: opt.minutes };
    else if (opt?.endOfEpisode) this.sleep = { endOfEpisode: true };
    else if (opt?.endOfChapter != null) this.sleep = { chapterEnd: opt.endOfChapter };
    if (this.sleep?.until) set('sleepMin', opt.minutes);
    this._emit('state');
  }
  extendSleep(min = 5) { if (this.sleep?.until) { this.sleep.until += min * 60000; this._restoreVol(); this._emit('state'); } }
  cancelSleep(emit = true) { this.sleep = null; this._restoreVol(); if (emit) this._emit('state'); }
  _restoreVol() { if (this.el) this.el.volume = 1; }
  _sleepFade() {
    const left = this.sleep.until - Date.now();
    if (left <= 0) { this.pause(); this.sleep = null; this._restoreVol(); toast('Hẹn giờ ngủ: đã dừng phát'); this._emit('state'); return; }
    this.el.volume = Math.max(0.05, left / 8000);
  }
  get sleepLeft() { return this.sleep?.until ? Math.max(0, this.sleep.until - Date.now()) / 1000 : null; }

  // ── Lock screen / notification / headset ──────────────────────
  _media() {
    if (!('mediaSession' in navigator) || !this.ep) return;
    const ms = navigator.mediaSession, s = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* unsupported */ } };
    const art = this.ep.image || this.show?.image;
    ms.metadata = new MediaMetadata({ title: this.ep.title, artist: this.show?.author || '', album: this.show?.title || 'Podcast', artwork: art ? [{ src: art, sizes: '512x512' }] : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
    s('play', () => this.play()); s('pause', () => this.pause()); s('stop', () => this.pause());
    s('seekbackward', (d) => this.seekBy(-(d.seekOffset || get('skipBack') || 15)));
    s('seekforward', (d) => this.seekBy(d.seekOffset || get('skipFwd') || 30));
    s('seekto', (d) => this.seek(d.seekTime));
    s('previoustrack', () => this.back());
    s('nexttrack', () => this.next());
  }
  _mediaState() { if ('mediaSession' in navigator) { navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused'; if (this.playing) this._media(); } }
  _mediaPos() { try { if (this.duration) navigator.mediaSession.setPositionState({ duration: this.duration, position: Math.min(this.time, this.duration), playbackRate: this.rate }); } catch { /* ignore */ } }
}

export const player = new PodPlayer();
