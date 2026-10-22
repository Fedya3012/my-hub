// Podcast player: one <audio> element per episode, speed 0.5–3× with the pitch kept, Smart Speed (plays the
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
    on('play', () => { this._emit('state'); this._mediaState(); bus.emit('media:play', { app: 'podcasts' }); this.ac?.resume?.(); });
    on('pause', () => { this._emit('state'); this._mediaState(); this._maybeMarkPlayed(); });
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
      const an = ac.createAnalyser(); an.fftSize = 1024;
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
    this._emit('state');
  }

  _teardown() {
    if (this.el) { const el = this.el; this.el = null; el.pause(); this._untrack?.(); el.removeAttribute('src'); el.load(); }
    this._untrack = null;
    try { this.fx?.src.disconnect(); this.fx?.gain.disconnect(); } catch { /* ignore */ }
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

  // ── Ticks: Smart Speed, outro, sleep timer, played mark ───────
  _tick() {
    const el = this.el; if (!el) return;
    this._emit('time');
    const outro = this.show?.settings?.skipOutro || 0;
    if (outro && this.duration && el.currentTime > this.duration - outro && !el.paused) { el.currentTime = this.duration; return; }
    if (this.sleep?.until && Date.now() >= this.sleep.until - 8000) this._sleepFade();
    if (this.sleep?.chapterEnd != null && el.currentTime >= this.sleep.chapterEnd) { this.cancelSleep(); this.pause(); toast('Hẹn giờ ngủ: đã dừng ở cuối chương'); }
    if (get('skipSilence') && this.fx && !el.paused) this._silence();
  }
  _silence() {
    const f = this.fx, now = performance.now();
    if (now - (this._sT || 0) < 90) return;
    const dt = this._sT ? (now - this._sT) / 1000 : 0; this._sT = now;
    f.an.getFloatTimeDomainData(f.buf);
    let sum = 0; for (let i = 0; i < f.buf.length; i++) sum += f.buf[i] * f.buf[i];
    const rms = Math.sqrt(sum / f.buf.length);
    const quiet = rms < 0.012;
    this._silent = quiet ? this._silent + dt : 0;
    const base = this.rate;
    if (this._silent > 0.25 && !this._boosted) { this._boosted = true; this.el.playbackRate = Math.min(4, base * 2.5); }
    else if (!quiet && this._boosted) { this._boosted = false; this.el.playbackRate = base; }
    if (this._boosted) this._saved = (this._saved || 0) + dt * (Math.min(4, base * 2.5) / base - 1);
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
  _mediaPos() { try { if (this.duration) navigator.mediaSession.setPositionState({ duration: this.duration, position: Math.min(this.time, this.duration), playbackRate: this.el.playbackRate }); } catch { /* ignore */ } }
}

export const player = new PodPlayer();
