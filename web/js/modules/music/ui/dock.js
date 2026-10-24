// Mini player in the app-wide dock: a floating card above the tab bar on phones, a full
// transport bar along the bottom on desktop (seek, volume, lyrics/queue/EQ). Tapping it (or
// swiping up) opens Now Playing; swiping sideways skips.
import { icon } from '../../../core/icons.js';
import { repeatMode, shuffleMode } from '../lib/modes.js';
import { esc } from '../../../core/ui.js';
import { player } from '../lib/player.js';
import { library } from '../lib/store.js';
import { artHtml, hydrate } from '../lib/art.js';
import { badges, fmtTime } from '../lib/format.js';
import { prefs } from '../lib/prefs.js';
import { timers, fmtLeft } from '../lib/timers.js';
import './audio-icons.js';

let host = null, el = null, offs = [];

export function mountDock() {
  host = document.getElementById('dock');
  if (!host) return;
  el = document.createElement('div');
  el.className = 'mdock';
  el.hidden = true;
  host.appendChild(el);
  const on = (t, f) => { player.addEventListener(t, f); offs.push(() => player.removeEventListener(t, f)); };
  on('track', render); on('state', state); on('time', time); on('status', status); on('volume', vol); on('queue', state); on('audio', state);
  const tm = () => timerBadge();
  timers.addEventListener('tick', tm); timers.addEventListener('change', tm);
  offs.push(() => { timers.removeEventListener('tick', tm); timers.removeEventListener('change', tm); });
  new ResizeObserver(sizeVar).observe(el);
  render();
}

// Folded = a small round control. Same key as the podcast mini player: one choice for both bars on this device.
const FOLD_KEY = 'hub.miniFolded';
export function miniFolded() { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } }
export function setMiniFolded(v) {
  try { localStorage.setItem(FOLD_KEY, v ? '1' : '0'); } catch { /* storage unavailable: folds for this session only */ }
  document.dispatchEvent(new CustomEvent('hub:mini-fold', { detail: { folded: v } }));
}
// The other bar changed the choice (podcast mini player): follow it.
document.addEventListener('hub:mini-fold', () => { if (el) { el.classList.toggle('is-folded', miniFolded()); el.querySelector('[data-fold]')?.setAttribute('aria-expanded', String(!miniFolded())); sizeVar(); } });

export function unmountDock() { offs.forEach(f => f()); offs = []; el?.remove(); document.body.classList.remove('has-dock'); }

function sizeVar() {
  const shown = !el.hidden;
  document.body.classList.toggle('has-dock', shown);
  document.documentElement.style.setProperty('--dock-h', shown ? el.offsetHeight + 'px' : '0px');
}

const open = (tab) => import('./nowplaying.js').then(m => m.openNowPlaying(tab));

async function render() {
  const t = player.track;
  if (!t) {
    const s = await player.checkRemote?.();
    if (s) return renderRemote(s);
    el.hidden = true; sizeVar(); return;
  }
  const L = await library();
  const colors = L.albums.get(t.albumId)?.colors;
  el.hidden = false;
  el.style.setProperty('--m-acc', prefs().np.albumTheme && colors ? colors.accent : 'var(--accent)');
  el.innerHTML = `
    <div class="mdock-line" aria-hidden="true"><i></i></div>
    <button class="icon-btn mdock-fold" data-fold aria-label="Thu nhỏ thanh phát" aria-expanded="${!miniFolded()}">${icon('minimize')}</button>
    <button class="mdock-now" data-open aria-label="Mở Đang phát">
      ${artHtml(L.coverOf(t), t.album || t.title, { cls: 'sm' })}
      <span class="mdock-meta"><span class="mdock-t">${esc(t.title)}</span>
        <span class="mdock-s"><span class="mdock-a">${esc(t.artist || '')}</span>${prefs().showBadges ? `<span class="mbadges">${badges(t.tech, { hiRes: prefs().showHiRes && t.hiResNow, size: 'sm' })}</span>` : ''}</span>
        <span class="mdock-status" hidden></span></span>
    </button>
    <button class="mdock-timer" data-act="timerbadge" hidden aria-label="Hẹn giờ đang chạy">${icon('timer')}<span class="num"></span></button>
    <div class="mdock-ctrls">
      <button class="icon-btn d-only" data-act="shuffle" aria-label="Phát ngẫu nhiên">${icon('shuffle')}</button>
      <button class="icon-btn d-only" data-act="prev" aria-label="Bài trước">${icon('prev')}</button>
      <button class="mplay" data-act="play" aria-label="Phát/Tạm dừng"></button>
      <button class="icon-btn" data-act="next" aria-label="Bài tiếp">${icon('next')}</button>
      <button class="icon-btn d-only" data-act="repeat" aria-label="Lặp lại"></button>
    </div>
    <div class="mdock-seek d-only"><span class="num" data-cur>0:00</span><input type="range" min="0" max="1000" value="0" data-seek aria-label="Tua"><span class="num" data-dur>0:00</span></div>
    <div class="mdock-side d-only">
      <button class="icon-btn" data-act="lyrics" aria-label="Lời bài hát">${icon('lyrics')}</button>
      <button class="icon-btn" data-act="queue" aria-label="Hàng chờ">${icon('queue')}</button>
      <button class="icon-btn" data-act="eq" aria-label="Bộ chỉnh âm">${icon('sliders')}</button>
      <button class="icon-btn" data-act="hires" aria-label="Hi-Res, đường tín hiệu & đầu ra">${icon('hires')}</button>
      <button class="icon-btn" data-act="timers" aria-label="Hẹn giờ & âm nền">${icon('timer')}</button>
      <button class="icon-btn" data-act="mute" aria-label="Tắt tiếng"></button>
      <input type="range" min="0" max="100" data-vol aria-label="Âm lượng" class="mvol">
    </div>`;
  hydrate(el);
  el.querySelector('[data-open]').onclick = () => open();
  el.querySelector('[data-fold]').onclick = () => setMiniFolded(!miniFolded());
  el.classList.toggle('is-folded', miniFolded());
  const A = (k, f) => el.querySelector(`[data-act="${k}"]`).onclick = f;
  A('play', () => player.toggle()); A('next', () => player.next()); A('prev', () => player.prev());
  A('shuffle', () => player.setShuffle(!player.shuffle)); A('repeat', () => player.cycleRepeat());
  A('lyrics', () => open('lyrics')); A('queue', () => open('queue')); A('eq', () => import('./eq-panel.js').then(m => m.eqSheet()));
  A('hires', () => import('./audio-panel.js').then(m => m.audioSheet()));
  A('timers', () => import('./timers.js').then(m => m.timersSheet()));
  A('timerbadge', () => import('./timers.js').then(m => m.timersSheet(timers.interval ? timers.interval.kind : 'sleep')));
  A('mute', () => { player.engine.setMuted(!player.engine.muted); vol(); });
  const seek = el.querySelector('[data-seek]');
  seek.oninput = () => { seeking = true; el.querySelector('[data-cur]').textContent = fmtTime(seek.value / 1000 * player.duration); };
  seek.onchange = () => { player.seek(seek.value / 1000 * player.duration); seeking = false; };
  el.querySelector('[data-vol]').oninput = (e) => player.setVolume(e.target.value / 100);
  swipe(el.querySelector('[data-open]'));
  state(); time(); vol(); timerBadge(); sizeVar();
}

// Running timer: a small countdown chip (on phones too, where the side buttons are hidden).
function timerBadge() {
  const b = el?.querySelector('[data-act="timerbadge"]');
  if (!b) return;
  const on = timers.active;
  b.hidden = !on;
  el.querySelector('[data-act="timers"]')?.setAttribute('aria-pressed', on);
  if (!on) return;
  const l = timers.interval ? timers.intervalLeft() : timers.sleepLeft();
  b.querySelector('span').textContent = l === Infinity ? `${timers.sleep.tracksLeft} bài` : fmtLeft(l);
}

export function showRemote(s) { if (el) renderRemote(s); }

function renderRemote(s) {
  el.hidden = false;
  el.innerHTML = `<div class="mdock-remote">${icon('device')}<span>Đang nghe dở: <b>${esc(s.label || '')}</b></span>
    <button class="btn small primary" data-go>${icon('play')}Nghe tiếp ở đây</button><button class="icon-btn" data-x aria-label="Ẩn">${icon('x')}</button></div>`;
  el.querySelector('[data-go]').onclick = () => player.takeOver(s);
  el.querySelector('[data-x]').onclick = () => { if (player.track) render(); else { el.hidden = true; sizeVar(); } };
  sizeVar();
}

let seeking = false;
function state() {
  if (!el || el.hidden || !player.track) return;
  const p = el.querySelector('[data-act="play"]');
  if (!p) return;
  p.innerHTML = icon(player.playing ? 'pause-fill' : 'play-fill');
  p.setAttribute('aria-label', player.playing ? 'Tạm dừng' : 'Phát');
  el.classList.toggle('playing', player.playing);
  el.querySelector('[data-act="hires"]')?.setAttribute('aria-pressed', !!prefs().audio?.bitPerfect);
  const sm = shuffleMode(player.shuffle, player.catShuffle), rm = repeatMode(player.repeat);
  const sb = el.querySelector('[data-act="shuffle"]'), rb = el.querySelector('[data-act="repeat"]');
  if (sb) { sb.innerHTML = icon(sm.icon); sb.setAttribute('aria-pressed', sm.id !== 'off'); sb.title = 'Trộn bài: ' + sm.label; }
  if (rb) { rb.innerHTML = icon(rm.icon); rb.setAttribute('aria-pressed', rm.id !== 'off'); rb.title = 'Lặp lại: ' + rm.label; }
}

function time() {
  if (!el || el.hidden) return;
  const d = player.duration, t = player.time, p = d ? t / d : 0;
  el.querySelector('.mdock-line i')?.style.setProperty('transform', `scaleX(${p.toFixed(4)})`);   // no layout per tick
  if (seeking) return;
  const s = el.querySelector('[data-seek]');
  if (s) { s.value = Math.round(p * 1000); s.style.setProperty('--v', (p * 100) + '%'); }
  const c = el.querySelector('[data-cur]'); if (c) c.textContent = fmtTime(t);
  const dd = el.querySelector('[data-dur]'); if (dd) dd.textContent = fmtTime(d);
}

function vol() {
  const v = el?.querySelector('[data-vol]');
  if (!v) return;
  v.value = Math.round(player.engine.volume * 100);
  v.style.setProperty('--v', v.value + '%');
  el.querySelector('[data-act="mute"]').innerHTML = icon(player.engine.muted || !player.engine.volume ? 'mute' : 'volume');
}

function status() {
  const s = el?.querySelector('.mdock-status');
  if (!s) return;
  s.hidden = !player.status;
  s.textContent = player.status;
}

// Horizontal swipe = skip, upward swipe = open Now Playing.
function swipe(target) {
  let x0 = 0, y0 = 0, active = false;
  target.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; active = true; }, { passive: true });
  target.addEventListener('touchend', (e) => {
    if (!active) return; active = false;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.preventDefault(); dx < 0 ? player.next() : player.prev(); }
    else if (dy < -50 && Math.abs(dy) > Math.abs(dx)) { e.preventDefault(); open(); }
  });
}
