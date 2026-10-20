// Sleep, interval (workout) and focus (Pomodoro) timers.
// Sleep: stops after N minutes or at the end of N tracks; during the last `fadeSec` the music
// (and the ambient mix) fade out smoothly and, optionally, the tempo slows to 85 %.
// Workout: work/rest rounds with a chime at each change; work can speed the tempo up a little,
// rest ducks the music. Focus: 25/5 Pomodoro cycles with a long break; breaks can pause the music.
// Levels go through engine.setDuck / ambient.setDuck, tempo through engine.setRate (never saved).
import { toast } from '../../../core/ui.js';
import { player } from './player.js';
import { ambient } from './ambient.js';
import { prefs } from './prefs.js';

const SLOWEST = 0.85;

class Timers extends EventTarget {
  constructor() {
    super();
    this.sleep = null;      // { kind: 'minutes'|'tracks', end, tracksLeft, fadeSec, slow, ambient }
    this.interval = null;   // { kind: 'workout'|'focus', phases: [{type, secs, label}], i, phaseEnd, startedAt }
    this._t = null;
    this._sleepDuck = 1; this._ivDuck = 1; this._slow = 1; this._boost = 1;
    player.addEventListener('track', () => this._onTrack());
  }

  get active() { return !!(this.sleep || this.interval); }
  _emit() { this.dispatchEvent(new Event('change')); player.dispatchEvent(new CustomEvent('sleep', { detail: this.sleep })); }

  // ── Sleep ─────────────────────────────────────────────────────
  startSleep({ minutes, tracks } = {}) {
    const o = prefs().audio?.sleep || {};
    this._restoreSleep();
    this.sleep = {
      kind: tracks ? 'tracks' : 'minutes', end: tracks ? 0 : Date.now() + minutes * 60e3, tracksLeft: tracks || 0,
      fadeSec: Math.max(0, +o.fadeSec || 0), slow: !!o.slow, ambient: !!o.ambient,
      stopAtEnd: () => this._sleepDone(),   // player calls it when the final track ends
    };
    player.sleep = this.sleep;
    this._seenTrack = player.track?.id;
    if (tracks === 1) player.engine.clearNext();
    this._run();
    toast(tracks ? (tracks === 1 ? 'Sẽ dừng khi hết bài này' : `Sẽ dừng sau ${tracks} bài`) : `Sẽ dừng sau ${minutes} phút`);
    this._emit();
  }
  stopSleep() { if (!this.sleep) return; this._restoreSleep(); this.sleep = null; player.sleep = null; this._emit(); }
  extendSleep(min) { if (this.sleep?.kind === 'minutes') { this.sleep.end += min * 60e3; this._emit(); this._tick(); } }

  // Seconds until the sleep timer stops the music (Infinity while more than one track remains).
  sleepLeft() {
    const s = this.sleep;
    if (!s) return null;
    if (s.kind === 'minutes') return Math.max(0, (s.end - Date.now()) / 1000);
    if (s.tracksLeft > 1) return Infinity;
    return Math.max(0, (player.duration - player.time) / (player.engine.rate || 1));
  }

  _onTrack() {
    const s = this.sleep, id = player.track?.id;
    if (!s || s.kind !== 'tracks' || id === this._seenTrack) return;
    this._seenTrack = id;
    s.tracksLeft--;
    if (s.tracksLeft <= 0) this._sleepDone(); else { if (s.tracksLeft === 1) player.engine.clearNext(); this._emit(); }
  }

  _sleepDone() {
    if (!this.sleep) return;
    const amb = this.sleep.ambient;
    this.sleep = null; player.sleep = null;
    player.engine.pause({ fade: 0.6 });
    if (amb) ambient.setDuck(0, 0.6);
    setTimeout(() => { this._restoreSleep(); if (amb) { ambient.stopAll(); ambient.setDuck(1); } }, 800);
    toast('Hẹn giờ ngủ: đã dừng phát');
    this._emit();
  }
  _restoreSleep() { this._sleepDuck = 1; this._slow = 1; this._apply(); }

  // ── Workout / focus ───────────────────────────────────────────
  startWorkout(o = prefs().audio?.workout || {}) {
    const phases = [];
    for (let r = 1; r <= (o.rounds || 8); r++) {
      phases.push({ type: 'work', secs: +o.work || 40, label: `Tập · hiệp ${r}/${o.rounds}` });
      if (r < o.rounds && +o.rest) phases.push({ type: 'rest', secs: +o.rest, label: `Nghỉ · hiệp ${r}/${o.rounds}` });
    }
    this._startInterval('workout', phases, o);
  }
  startFocus(o = prefs().audio?.focus || {}) {
    const phases = [];
    const n = o.cycles || 4;
    for (let r = 1; r <= n; r++) {
      phases.push({ type: 'work', secs: (+o.work || 25) * 60, label: `Tập trung ${r}/${n}` });
      phases.push(r < n ? { type: 'rest', secs: (+o.short || 5) * 60, label: 'Nghỉ ngắn' } : { type: 'rest', secs: (+o.long || 15) * 60, label: 'Nghỉ dài' });
    }
    this._startInterval('focus', phases, o);
  }
  _startInterval(kind, phases, o) {
    this.stopInterval(true);
    this.interval = { kind, phases, i: -1, o, startedAt: Date.now(), wasPlaying: player.playing };
    this._phase(0);
    this._run();
  }
  stopInterval(silent = false) {
    if (!this.interval) return;
    const iv = this.interval;
    this.interval = null;
    this._ivDuck = 1; this._boost = 1; this._apply();
    if (iv.kind === 'focus' && iv.o.pauseOnBreak && iv.paused) player.engine.play();
    if (!silent) this._emit();
  }
  skipPhase() { const iv = this.interval; if (iv) this._phase(iv.i + 1); }
  intervalLeft() { const iv = this.interval; return iv ? Math.max(0, (iv.phaseEnd - Date.now()) / 1000) : null; }

  _phase(i) {
    const iv = this.interval;
    if (i >= iv.phases.length) {
      if (iv.o.chime) ambient.chime('done');
      toast(iv.kind === 'workout' ? 'Hoàn thành bài tập' : 'Hoàn thành phiên tập trung');
      return this.stopInterval();
    }
    iv.i = i;
    const p = iv.phases[i];
    iv.phaseEnd = Date.now() + p.secs * 1000;
    if (iv.o.chime && i > 0) ambient.chime(p.type === 'work' ? 'work' : 'rest');
    if (iv.kind === 'workout') {
      this._boost = p.type === 'work' ? Math.max(1, Math.min(1.25, +iv.o.boost || 1)) : 1;
      this._ivDuck = p.type === 'rest' ? Math.max(0, Math.min(1, +iv.o.restDuck)) : 1;
    } else if (iv.o.pauseOnBreak) {
      if (p.type === 'rest' && player.playing) { iv.paused = true; player.engine.pause({ fade: 1.5 }); }
      else if (p.type === 'work' && iv.paused) { iv.paused = false; player.engine.play(); }
    }
    this._apply(1.2);
    this._emit();
  }

  // ── Loop ──────────────────────────────────────────────────────
  _run() { if (!this._t) this._t = setInterval(() => this._tick(), 250); this._tick(); }
  _tick() {
    if (!this.active) { clearInterval(this._t); this._t = null; return; }
    const s = this.sleep;
    if (s) {
      const left = this.sleepLeft();
      if (s.kind === 'minutes' && left <= 0) return this._sleepDone();
      if (s.fadeSec && left < s.fadeSec && player.playing) {
        const x = Math.max(0, left / s.fadeSec);          // 1 → 0
        this._sleepDuck = x * x * (3 - 2 * x);            // smoothstep: gentle start, soft landing
        this._slow = s.slow ? SLOWEST + (1 - SLOWEST) * x : 1;
        this._apply(0.3);
      } else if (this._sleepDuck !== 1 && left >= s.fadeSec) this._restoreSleep();
    }
    const iv = this.interval;
    if (iv && Date.now() >= iv.phaseEnd) this._phase(iv.i + 1);
    this.dispatchEvent(new Event('tick'));
  }

  _apply(secs = 0.4) {
    const E = player.engine, duck = this._sleepDuck * this._ivDuck;
    if (this._slow !== 1 || this._boost !== 1) this._baseRate ??= E.rate;
    if (Math.abs(E.duck - duck) > 0.001) E.setDuck(duck, secs);
    if (this.sleep?.ambient || this._sleepDuck === 1) ambient.setDuck(this._sleepDuck, secs);
    const base = this._baseRate ?? E.rate;
    const r = Math.round(base * this._slow * this._boost * 1000) / 1000;
    if (E.rate !== r) E.setRate(r);
    if (this._slow === 1 && this._boost === 1) this._baseRate = undefined;
  }
}

export const timers = new Timers();
export const fmtLeft = (s) => {
  if (s == null) return '';
  if (s === Infinity) return '';
  s = Math.ceil(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
