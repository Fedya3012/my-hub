// Player: queue, shuffle/repeat, ReplayGain, gapless/crossfade decisions, decoding fallback,
// cross-device session (resume on another device), play history, Media Session (lock screen,
// headset buttons), sleep timer and music linked to books/fanfic/podcasts.
// One instance for the whole app (imported by service.js and index.js).
import { db, getSetting, setSetting } from '../../../core/db.js';
import { bus } from '../../../core/bus.js';
import { progress } from '../../../core/progress.js';
import { storage } from '../../../core/storage/index.js';
import { thisDevice, deviceName } from '../../../core/device.js';
import { toast } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import { Engine } from './engine.js';
import { decoderFor, decodeToWav, UNSUPPORTED } from './decode.js';
import { library, logPlay, mainFile, musicFor, shuffle as shuffled, playlistTracks } from './store.js';
import { loadPrefs, prefs } from './prefs.js';
import { loadEq, saveEq, effectivePreamp } from './eq.js';
import { fileUrl } from './art.js';
import { fmtTime } from './format.js';

const SESSION = 'music:session';
const canPlay = (mime) => { const a = document.createElement('audio'); return a.canPlayType(mime) !== ''; };

class Player extends EventTarget {
  constructor() {
    super();
    this.engine = new Engine();
    this.queue = [];          // track ids in play order
    this.order = null;        // original order while shuffled
    this.index = -1;
    this.repeat = 'off';      // off | all | one
    this.shuffle = false;
    this.source = null;       // { kind, id, name, forItem }
    this.listened = 0;        // seconds of the current track actually heard
    this.sleep = null;        // { at, endOfTrack, timer }
    this.status = '';         // decoding message etc.
    this.urls = new Map();    // trackId -> { url, decoded }
    this.eq = null;
    this.resolveInfo = null;  // how the current track is being decoded
    const E = this.engine;
    E.addEventListener('time', () => this._onTime());
    E.addEventListener('state', () => { this._emit('state'); this._mediaState(); });
    E.addEventListener('transition', (e) => this._onTransition(e.detail));
    E.addEventListener('ended', () => this._onEnded());
    E.addEventListener('error', (e) => this._onError(e.detail));
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); bus.emit('music:' + type, detail); }

  async init() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      const p = await loadPrefs();
      this.eq = await loadEq();
      this.engine.opts = { engine: p.playback.engine, outputRate: p.playback.outputRate, sinkId: p.playback.sinkId };
      this.engine.volume = p.playback.volume;
      this.engine.rate = p.playback.rate;
      this.engine.silence.on = !!p.playback.skipSilence;
      this.engine.bitPerfect = !!p.audio?.bitPerfect;
      this.engine.outCfg = p.audio?.out || null;
      this.repeat = (await getSetting('music.repeat', 'off'));
      this._mediaSession();
      await this._restore();
    })();
    return this._ready;
  }

  get track() { return this._lib?.tracks.get(this.queue[this.index]) || null; }
  get nextTrack() { const i = this._nextIndex(); return i == null ? null : this._lib?.tracks.get(this.queue[i]); }
  get playing() { return !this.engine.paused; }
  get time() { return this.engine.currentTime; }
  get duration() { return this.engine.duration || this.track?.duration || 0; }

  async lib() { this._lib = await library(); return this._lib; }

  // ── Starting playback ─────────────────────────────────────────
  // tracks: array of track objects or ids. opts: { start, source, shuffle, startAt, autoplay }
  async play(tracks, { start = 0, source = null, shuffle = null, startAt = 0, autoplay = true } = {}) {
    await this.init();
    const L = await this.lib();
    let ids = tracks.map(t => typeof t === 'string' ? t : t.id).filter(id => L.tracks.has(id));
    if (!ids.length) { toast('Không có bài nào để phát', 'warn'); return; }
    const first = ids[Math.min(start, ids.length - 1)];
    this.shuffle = shuffle ?? this.shuffle;
    this.order = null;
    if (this.shuffle) { this.order = ids; ids = [first, ...shuffled(ids.filter(x => x !== first))]; }
    this.queue = ids;
    this.index = ids.indexOf(first);
    this.source = source;
    await this._load({ startAt, autoplay });
    this._emit('queue');
  }

  async playIds(ids, opts) { return this.play(ids, opts); }

  async jump(i) { if (i < 0 || i >= this.queue.length) return; await this._commitPlay(); this.index = i; await this._load({}); this._emit('queue'); }

  async toggle() {
    await this.init();
    if (!this.track) { const L = await this.lib(); return this.play([...L.tracks.values()], { source: { kind: 'all', name: 'Tất cả bài hát' } }); }
    if (!this.engine.el?.src) return this._load({ startAt: this._resumeAt || 0 });
    return this.engine.toggle();
  }
  pause() { this.engine.pause(); }
  seek(t) { this.engine.seek(t); this._saveSoon(true); this._emit('time'); }
  seekBy(d) { this.seek(this.time + d); }

  async next({ user = true } = {}) {
    const i = this._nextIndex(user);
    if (i == null) { this.engine.pause(); this.engine.seek(0); return; }
    await this._commitPlay();
    this.index = i;
    await this._load({ quick: user });
    this._emit('queue');
  }

  async prev() {
    if (this.time > 3 || this.index <= 0) { this.seek(0); return; }
    await this._commitPlay();
    this.index--;
    await this._load({ quick: true });
    this._emit('queue');
  }

  _nextIndex(user = false) {
    if (!this.queue.length) return null;
    if (this.repeat === 'one' && !user) return this.index;
    if (this.index + 1 < this.queue.length) return this.index + 1;
    return this.repeat === 'all' || (this.repeat === 'one' && user) ? 0 : null;
  }

  // ── Queue editing ─────────────────────────────────────────────
  async playNext(ids) {
    await this.init();
    if (!this.track) return this.play(ids);
    ids = ids.map(t => t.id || t);
    this.queue.splice(this.index + 1, 0, ...ids);
    this._afterQueueEdit(); toast(ids.length > 1 ? `Sẽ phát tiếp ${ids.length} bài` : 'Sẽ phát tiếp theo');
  }
  async addToQueue(ids) {
    await this.init();
    if (!this.track) return this.play(ids);
    ids = ids.map(t => t.id || t);
    this.queue.push(...ids);
    this._afterQueueEdit(); toast(`Đã thêm ${ids.length} bài vào hàng chờ`);
  }
  removeAt(i) {
    if (i === this.index) return;
    this.queue.splice(i, 1);
    if (i < this.index) this.index--;
    this._afterQueueEdit();
  }
  move(from, to) {
    const [id] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, id);
    if (from === this.index) this.index = to;
    else if (from < this.index && to >= this.index) this.index--;
    else if (from > this.index && to <= this.index) this.index++;
    this._afterQueueEdit();
  }
  clearUpcoming() { this.queue.length = this.index + 1; this._afterQueueEdit(); }
  _afterQueueEdit() { this.engine.clearNext(); this._preloadSoon(); this._emit('queue'); this._saveSoon(); }

  setShuffle(on) {
    this.shuffle = on;
    const cur = this.queue[this.index];
    if (on) { this.order = [...this.queue]; this.queue = [cur, ...shuffled(this.queue.filter((x, i) => i !== this.index))]; this.index = 0; }
    else if (this.order) { this.queue = this.order; this.index = Math.max(0, this.queue.indexOf(cur)); this.order = null; }
    this._afterQueueEdit();
  }
  async setRepeat(r) { this.repeat = r; await setSetting('music.repeat', r); this.engine.clearNext(); this._preloadSoon(); this._emit('state'); }
  cycleRepeat() { return this.setRepeat({ off: 'all', all: 'one', one: 'off' }[this.repeat]); }

  // ── Resolving audio ───────────────────────────────────────────
  // One resolve per track at a time: playing a track that is still being preloaded joins that
  // work (and makes its progress task visible) instead of decoding it twice.
  // background: preloading the next track — its task stays hidden (quiet) unless someone waits on it.
  async _urlFor(track, { onProgress, background = false } = {}) {
    if (this.urls.has(track.id)) return this.urls.get(track.id);
    const pending = (this._resolving ||= new Map());
    const busy = pending.get(track.id);
    if (busy) {
      if (!background) { busy.background = false; busy.task?.update({ quiet: false }); }
      return busy.promise;
    }
    const job = { background, task: null };
    job.promise = this._resolve(track, job, onProgress).finally(() => pending.delete(track.id));
    pending.set(track.id, job);
    return job.promise;
  }

  // Progress (task tray, unit %): decoding DSD / ALAC / AIFF to WAV.
  async _resolve(track, job, onProgress) {
    const file = await mainFile(track.id);
    if (!file) throw Object.assign(new Error('Bài này chưa có tệp âm thanh (chỉ có thông tin).'), { nofile: true });
    const kind = decoderFor(track.tech, canPlay);
    const unsupported = track.tech && UNSUPPORTED[track.tech.codec];
    if (unsupported && !kind) throw Object.assign(new Error(unsupported), { unsupported: true });
    // A file still on the drive it was picked from plays straight from there (no copy into memory).
    if (!kind && file.linked) {
      const direct = await storage.streamUrl(file).catch(() => null);
      if (direct) {
        const r = { url: direct, decoded: null, file, rate: track.tech?.sampleRate || 0, bytes: file.size || 0 };
        this.urls.set(track.id, r);
        return r;
      }
    }
    let blob = kind ? await cachedDecode(file.id) : null;
    const decoded = kind || null;
    const needDecode = !!kind && !blob;
    const codec = track.tech?.codecLabel || kind?.toUpperCase() || '';
    const task = needDecode ? (job.task = tasks.start({
      label: `Đang giải mã ${codec}`.trim(),
      // Decoding is what stands between the tap and the music: show it at once.
      detail: track.title || file.name || '', unit: 'percent', quiet: job.background, delay: 0,
    })) : null;
    const dlSpan = 0;
    try {
      if (!blob) {
        const src = await storage.open(file);
        if (needDecode) {
          this.status = 'Đang giải mã ' + codec + '…';
          this._emit('status');
          task.update({ done: dlSpan, detail: track.title || file.name || '' });
          blob = await decodeToWav(src, kind, { onProgress: (v) => {
            this.status = `Đang giải mã ${codec} ${Math.round(v * 100)}%`; this._emit('status');
            task.update({ done: dlSpan + v * (100 - dlSpan) });
            onProgress?.(v);
          } });
          task.update({ detail: 'Lưu bộ đệm giải mã…' });
          await cacheDecode(file.id, blob);
        } else blob = src;
      }
      task?.finish(track.title);
    } catch (e) {
      // A failed preload is reported when the track is reached; a failure someone waits on shows in the tray.
      if (task) job.background ? tasks.dismiss(task.id) : task.fail(e);
      throw e;
    } finally {
      if (needDecode) { this.status = ''; this._emit('status'); }
    }
    // Sample rate the element will output: the decoder's WAV header, else the parsed tags.
    const rate = (decoded ? await wavRate(blob) : 0) || track.tech?.sampleRate || 0;
    const r = { url: URL.createObjectURL(blob), decoded, file, rate, bytes: blob.size };
    this.urls.set(track.id, r);
    // Keep a few URLs (current, next, previous); free the rest.
    if (this.urls.size > 4) {
      const keep = new Set([this.queue[this.index - 1], this.queue[this.index], this.queue[this.index + 1], track.id]);
      for (const [id, v] of this.urls) if (!keep.has(id)) { URL.revokeObjectURL(v.url); this.urls.delete(id); }
    }
    return r;
  }

  // ReplayGain for a track, given what plays around it. Returns dB.
  gainFor(track, { neighbour } = {}) {
    const pb = prefs().playback;
    if (track && prefs().audio?.bitPerfect) return { db: 0, used: 'bitperfect' };
    if (!track || pb.rgMode === 'off') return { db: 0, used: 'off' };
    const rg = track.rg, album = this._lib?.albums.get(track.albumId)?.rg;
    let mode = pb.rgMode;
    if (mode === 'auto') {
      // Album gain when the queue plays an album in order (keeps the album's dynamics), track gain otherwise.
      const sameAlbum = neighbour ? neighbour.albumId === track.albumId : (this.source?.kind === 'album' && !this.shuffle);
      mode = sameAlbum ? 'album' : 'track';
    }
    let gain = mode === 'album' ? (rg?.albumGain ?? album?.gain ?? rg?.trackGain) : (rg?.trackGain ?? rg?.albumGain);
    let peak = mode === 'album' ? (rg?.albumPeak ?? album?.peak ?? rg?.trackPeak) : (rg?.trackPeak ?? rg?.albumPeak);
    let used = mode;
    if (gain == null) { gain = pb.rgUntagged; used = 'untagged'; peak = null; }
    gain += pb.rgPreamp;
    let clipped = false;
    if (pb.rgClip && peak) { const max = -20 * Math.log10(peak); if (gain > max) { gain = max; clipped = true; } }
    return { db: gain, used, clipped };
  }

  // Gapless or crossfade between a and b? (the "smart" part)
  planFor(a, b, { user = false } = {}) {
    const pb = prefs().playback;
    const cf = +pb.crossfade || 0;
    if (user) return { gapless: false, crossfade: 0 };
    if (prefs().audio?.bitPerfect) return { gapless: !!pb.gapless, crossfade: 0, why: 'bitperfect' };
    const sameAlbum = a && b && a.albumId === b.albumId && (b.trackNo || 0) === (a.trackNo || 0) + 1;
    if (pb.smartCrossfade && sameAlbum) return { gapless: !!pb.gapless, crossfade: 0, why: 'album' };   // live albums, DJ mixes
    if (cf > 0) {
      const short = Math.min(a?.duration || 999, b?.duration || 999);
      const c = pb.smartCrossfade ? Math.min(cf, short / 4) : cf;
      if (c >= 0.5 && !(pb.smartCrossfade && (a?.type === 'podcast' || b?.type === 'podcast'))) return { gapless: false, crossfade: c, why: 'crossfade' };
    }
    return { gapless: !!pb.gapless, crossfade: 0 };
  }

  async _load({ startAt = 0, autoplay = true, quick = false } = {}) {
    const t = this.track;
    if (!t) return;
    this.listened = 0; this._resumeAt = 0; this._loadStamp = performance.now();
    this._emit('track', t);
    this._media();
    try {
      const r = await this._urlFor(t);
      if (this.track !== t) return;         // user moved on while decoding
      this.resolveInfo = r;
      const g = this.gainFor(t, { neighbour: this._lib.tracks.get(this.queue[this.index - 1]) || this.nextTrack });
      this.gain = g;
      // Podcasts and long pieces resume where you stopped (on any device).
      if (!startAt && (t.type === 'podcast' || (t.duration || 0) > 600)) {
        const p = await progress.get(t.id);
        if (p && p.state !== 'finished' && p.position > 5) startAt = p.position;
      }
      this.engine.setEq(this._eqForEngine());
      await this.engine.load(t, r.url, { gainDb: g.db, startAt, autoplay, rate: r.rate });
      this._preloadSoon();
      this._saveSoon(true);
    } catch (e) {
      console.warn('[music]', e);
      this._emit('error', { track: t, message: e.message });
      toast(`${t.title}: ${e.message}`, 'warn');
      if (autoplay && this.queue.length > 1 && !e.blocked) setTimeout(() => { if (this.track === t) this.next({ user: false }); }, 1800);
    }
  }

  _preloadSoon() { clearTimeout(this._pt); this._pt = setTimeout(() => this._preload(), 1500); }
  async _preload() {
    const cur = this.track, n = this.nextTrack;
    if (!cur || !n || n === cur) return;
    if (this.sleep?.tracksLeft === 1) return;   // sleep timer stops after this track: don't start the next one
    try {
      const r = await this._urlFor(n, { background: true });
      if (this.nextTrack !== n) return;
      // Bit-perfect and the next track has another rate: the context must be reopened, so it
      // starts after the switch (a short gap) instead of being resampled.
      if (this.engine.bitPerfect && r.rate && this.engine.ctx && r.rate !== this.engine.ctx.sampleRate) return;
      const g = this.gainFor(n, { neighbour: cur });
      this.engine.preload(n, r.url, { gainDb: g.db, plan: this.planFor(cur, n) });
    } catch { /* will show the error when it is reached */ }
  }

  _onTransition({ track }) {
    this._commitPlay();
    this._loadStamp = performance.now();
    this.index = this._nextIndex();
    this.listened = 0;
    this.gain = this.gainFor(this.track, { neighbour: this._lib.tracks.get(this.queue[this.index - 1]) });
    this.resolveInfo = this.urls.get(track.id) || this.resolveInfo;
    this._emit('track', this.track);
    this._emit('queue');
    this._media();
    this._preloadSoon();
    this._saveSoon(true);
  }

  async _onEnded() {
    await this._commitPlay();
    if (this.sleep?.stopAtEnd) { this.sleep.stopAtEnd(); return; }
    const i = this._nextIndex();
    if (i == null) { this._emit('state'); this._saveSoon(true); return; }
    this.index = i;
    await this._load({});
    this._emit('queue');
  }

  _onError(d) {
    if (d.blocked) { toast('Nhấn Phát để bắt đầu (trình duyệt chặn tự phát).', 'warn'); return; }
    const t = d.track;
    toast(`Không phát được “${t?.title || 'bài này'}”${d.message ? ': ' + d.message : ''}`, 'error');
    if (this.queue.length > 1) setTimeout(() => this.next({ user: false }), 1500);
  }

  // Count a listen once half the track (or 4 minutes) has been heard.
  async _commitPlay() {
    const t = this.track;
    if (!t || this._committed === t.id + ':' + this._loadStamp) return;
    const need = Math.min(240, (t.duration || this.duration || 0) * 0.5);
    if (this.listened >= Math.max(20, need)) {
      this._committed = t.id + ':' + this._loadStamp;
      await logPlay(t, { ms: this.listened * 1000, completed: this.listened >= (t.duration || 0) * 0.9, source: this.source?.id });
    }
  }

  _onTime() {
    const now = performance.now();
    if (this._lastTick && this.playing) this.listened += Math.min(1, (now - this._lastTick) / 1000) * this.engine.rate;
    this._lastTick = now;
    this._emit('time');
    this._saveSoon();
    if ('mediaSession' in navigator && this.duration && now - (this._posT || 0) > 4000) { this._posT = now; this._mediaPos(); }
  }

  // ── Cross-device session ──────────────────────────────────────
  // A virtual progress row 'music:session' (synced on the fast live channel) holds the queue,
  // the track and the position, so another device can pick up exactly here.
  _saveSoon(flush = false) {
    if (flush) { clearTimeout(this._st); this._st = null; return this._save(true); }
    if (this._st) return;
    this._st = setTimeout(() => { this._st = null; this._save(false); }, 5000);
  }
  async _save(flush) {
    const t = this.track;
    if (!t) return;
    const pos = this.time, dur = this.duration;
    await progress.save({ id: SESSION, moduleId: 'music' }, {
      position: pos, total: dur, state: this.playing ? 'playing' : 'paused', flush,
      label: `${t.title} · ${fmtTime(pos)} / ${fmtTime(dur)}`,
      extra: { virtual: 1, trackId: t.id, queue: this.queue, index: this.index, shuffle: this.shuffle ? 1 : 0, source: this.source },
    });
    if (t.type === 'podcast' || (t.duration || 0) > 600) await progress.save(t.item, { position: pos, total: dur, state: this.playing ? 'playing' : 'paused', flush });
  }

  // Where the last session was (any device). Used on start and when another device pushes.
  async session() {
    const s = await progress.get(SESSION);
    if (!s?.trackId) return null;
    const me = await thisDevice();
    return { ...s, mine: s.deviceId === me.id, where: await deviceName(s.deviceId) };
  }

  async _restore() {
    const s = await this.session();
    if (!s) return;
    const L = await this.lib();
    const q = (s.queue || []).filter(id => L.tracks.has(id));
    if (!q.length) return;
    this.queue = q;
    this.index = Math.max(0, q.indexOf(s.trackId));
    this.shuffle = !!s.shuffle; this.source = s.source || null;
    this._resumeAt = s.position || 0;
    this._restoredFrom = s.mine ? null : s;
    this._emit('track', this.track); this._emit('queue');
    this._media();
  }

  // Another device saved a newer session while this one is idle: offer to continue it.
  async checkRemote() {
    const s = await this.session();
    if (!s || s.mine || this.playing) return null;
    if (this._seenRemote === s.updatedAt) return null;
    this._seenRemote = s.updatedAt;
    return s;
  }
  async takeOver(s) {
    await this.play(s.queue, { start: Math.max(0, s.queue.indexOf(s.trackId)), source: s.source, shuffle: false, startAt: s.position || 0 });
  }

  // ── Settings that affect sound ────────────────────────────────
  _eqForEngine() {
    const e = this.eq || {};
    return { enabled: !!e.enabled, bands: e.bands || [], preampDb: e.enabled ? effectivePreamp(e) : 0 };
  }
  async setEq(state, { save = true } = {}) {
    this.eq = state;
    this.engine.setEq(this._eqForEngine());
    if (save) { clearTimeout(this._eqT); this._eqT = setTimeout(() => saveEq(state), 400); }
    this._emit('eq', state);
  }
  applyPrefs() {
    const pb = prefs().playback;
    this.engine.silence.on = !!pb.skipSilence;
    if (this.track) { this.gain = this.gainFor(this.track); this.engine.setTrackGain(this.gain.db); }
    this.engine.clearNext(); this._preloadSoon();
    this._emit('state');
  }
  async setEngineOpts(o) {
    Object.assign(this.engine.opts, o);
    if (this.engine.decks.length) {
      // A different engine / output rate needs fresh audio elements; the URLs stay valid.
      await this.engine.rebuild();
      this.engine.setEq(this._eqForEngine());
    }
    this._emit('state');
  }
  setVolume(v) { this.engine.setVolume(v); clearTimeout(this._vt); this._vt = setTimeout(() => import('./prefs.js').then(m => m.setPref('playback.volume', v)), 500); this._emit('volume'); }
  setRate(r) { this.engine.setRate(r); import('./prefs.js').then(m => m.setPref('playback.rate', r)); this._emit('state'); }

  // ── Bit-perfect ───────────────────────────────────────────────
  async setBitPerfect(on) {
    const { setPref } = await import('./prefs.js');
    await setPref('audio.bitPerfect', on ? 1 : 0);
    const E = this.engine;
    if (on) { this._volBefore = E.volume; E.setVolume(1); }
    else if (this._volBefore != null) { E.setVolume(this._volBefore); this._volBefore = null; }
    this._emit('volume');
    const hadRate = E.ctxRate;
    E.setBitPerfect(on);
    this.gain = this.track ? this.gainFor(this.track) : this.gain;
    const r = this.resolveInfo, t = this.track;
    if (E.mode === 'webaudio' && E.decks.length && t && r?.url && ((on && r.rate && E.ctx?.sampleRate !== r.rate) || (!on && hadRate))) {
      // Reopen the context at the track's rate (or back at the default one), same position.
      const at = E.currentTime, playing = !E.paused;
      if (!on) { E.destroy(); E.init(); }
      await E.load(t, r.url, { gainDb: this.gain?.db || 0, startAt: at, autoplay: playing, rate: on ? r.rate : 0 });
      E.setEq(this._eqForEngine());
    } else if (this.gain) E.setTrackGain(this.gain.db);
    E.clearNext(); this._preloadSoon();
    this._emit('state'); this._emit('audio');
  }
  async setOutputs(cfg) {
    this.engine.setOutputs(cfg);
    if (prefs().audio) prefs().audio.out = cfg;   // the panel re-reads it at once; the save is debounced
    const { setPref } = await import('./prefs.js');
    clearTimeout(this._ot); this._ot = setTimeout(() => setPref('audio.out', cfg), 300);
    this._emit('audio');
  }

  // ── Sleep timer (lib/timers.js does the work; kept for older callers) ──
  setSleep(min) { return import('./timers.js').then(({ timers }) => min ? timers.startSleep(min === 'track' ? { tracks: 1 } : { minutes: +min }) : timers.stopSleep()); }

  // ── Media Session (lock screen, notification, headset keys) ───
  _mediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession, set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* unsupported */ } };
    set('play', () => this.engine.play());
    set('pause', () => this.engine.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekbackward', (d) => this.seekBy(-(d.seekOffset || 10)));
    set('seekforward', (d) => this.seekBy(d.seekOffset || 10));
    set('seekto', (d) => this.seek(d.seekTime));
    set('stop', () => this.engine.pause());
  }
  async _media() {
    const t = this.track;
    if (!('mediaSession' in navigator) || !t) return;
    const cover = await fileUrl(this._lib.fullCoverOf(t));
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist || '', album: t.album || '',
      artwork: cover ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }] : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }
  _mediaState() { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = this.track ? (this.playing ? 'playing' : 'paused') : 'none'; }
  _mediaPos() {
    try { if (this.duration) navigator.mediaSession.setPositionState({ duration: this.duration, position: Math.min(this.time, this.duration), playbackRate: this.engine.rate }); } catch { /* ignore */ }
  }

  // ── Music linked to books / fanfic / podcasts ─────────────────
  async onItemOpen(item) {
    const L = await this.lib();
    if (item.moduleId === 'music' && L.tracks.has(item.id)) {
      const t = L.tracks.get(item.id), al = L.albums.get(t.albumId);
      const list = al?.tracks.length > 1 ? al.tracks : [t];
      return this.play(list, { start: list.indexOf(t), source: al ? { kind: 'album', id: al.id, name: al.title } : null });
    }
    if (!prefs().links.autoplay) return;
    const linked = (await musicFor(item.id)).filter(m => m.link.autoplay);
    if (!linked.length) return;
    const m = linked[0];
    const tracks = await m.tracks();
    if (!tracks.length) return;
    await this.play(tracks, { shuffle: !!m.link.shuffle, source: { kind: m.kind, id: m.link.fromId, name: m.name, forItem: item.id, forTitle: item.title } });
    toast(`Đang phát nhạc nền cho “${item.title}”: ${m.name}`);
  }
  onItemClose(item) {
    if (prefs().links.stopOnClose && this.source?.forItem === item.id && this.playing) this.engine.pause({ fade: 1.5 });
  }
  async playSource(kind, id, { shuffle = false } = {}) {
    const L = await this.lib();
    let list = [], name = '';
    if (kind === 'album') { const a = L.albums.get(id); list = a?.tracks || []; name = a?.title; }
    else if (kind === 'artist') { const a = L.artists.get(id); list = a?.tracks || []; name = a?.name; }
    else if (kind === 'playlist') { const p = L.playlists.find(x => x.id === id); if (p) { list = await playlistTracks(p); name = p.name; } }
    else if (kind === 'track') { const t = L.tracks.get(id); list = t ? [t] : []; name = t?.title; }
    return this.play(list, { shuffle, source: { kind, id, name } });
  }
}

// Sample rate from a WAV header (the decoders always write a canonical 'fmt ' chunk at 12).
async function wavRate(blob) {
  try { const v = new DataView(await blob.slice(0, 64).arrayBuffer()); return v.getUint32(0) === 0x52494646 ? v.getUint32(24, true) : 0; } catch { return 0; }
}

// ── Decoded-audio cache (device-local, Cache Storage) ───────────
const CACHE = 'hub-music-decoded';
const key = (fileId) => new Request(new URL(`__music-decoded/${fileId}.wav`, location.href));
async function cachedDecode(fileId) {
  try { const r = await (await caches.open(CACHE)).match(key(fileId)); return r ? await r.blob() : null; } catch { return null; }
}
async function cacheDecode(fileId, blob) {
  try {
    const c = await caches.open(CACHE);
    await c.put(key(fileId), new Response(blob, { headers: { 'content-type': 'audio/wav' } }));
    // No fixed count: oldest decodes are dropped only when the browser's quota is nearly used up.
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (est?.quota && est.usage / est.quota > 0.9) {
      const keys = await c.keys();
      for (const k of keys.slice(0, Math.max(0, keys.length - 4))) await c.delete(k);
    }
  } catch { /* storage full or unavailable: decode again next time */ }
}
export async function clearDecodeCache() { try { await caches.delete(CACHE); } catch { /* ignore */ } }

export const player = new Player();
