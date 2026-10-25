// Podcast background service (manifest.service): the player and its mini player, lock screen, periodic refresh and
// auto-download, the Library drawer block, the cover-screen card and the 'podcasts' service for other apps.
import './lib/icons.js';
import { getSetting } from '../../core/db.js';
import { icon } from '../../core/icons.js';
import { esc } from '../../core/ui.js';
import { extend } from '../../core/extensions.js';
import { draggableBubble } from '../../core/bubble-drag.js';
import { tasks } from '../../core/tasks.js';
import { params } from '../../core/params.js';
import { definePrefs, get, NAME } from './lib/prefs.js';
import { player } from './lib/player.js';
import * as store from './lib/store.js';

let offs = [], css = null, ctx = null, mini = null, timer = null, lastApp = 'podcasts', nativeOff = null, dragOff = null;

export async function start(context) {
  ctx = context;
  definePrefs();
  css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./podcasts.css', import.meta.url).href });
  document.head.appendChild(css);
  await player.init();
  mountMini();
  const B = ctx.bus, cover = () => B.emit('cover:refresh');
  offs.push(
    extend('library.drawer', drawerBlock),
    // Books reader "Nghe khi đọc" switch (books/reader/audio-switch.js).
    extend('audio.sources', () => ({
      id: 'podcast', name: NAME, icon: 'podcast',
      hasMedia: () => !!player.ep, playing: () => player.playing,
      title: () => player.ep ? `${player.ep.title} · ${player.show?.title || ''}` : '',
      play: () => player.play(), pause: () => player.pause(),
      onChange: (cb) => { player.addEventListener('state', cb); player.addEventListener('episode', cb); return () => { player.removeEventListener('state', cb); player.removeEventListener('episode', cb); }; },
    })),
    B.on('media:play', ({ app }) => { lastApp = app; paintMini(); }),
    // Other apps: bus.emit('podcasts:play', { episodeId }) / ('podcasts:toggle')
    B.on('podcasts:play', async ({ episodeId, at }) => { const e = await store.episode(episodeId); if (e) player.playEpisode(e, { at }); }),
    B.on('podcasts:toggle', () => player.toggle()),
  );
  offs.push(params.on('podcasts', (e) => { if (/\.(voiceBoost|skipSilence)$/.test(e.key)) player.fxChanged(); if (/\.speed$/.test(e.key)) player.applyRate(); }));
  for (const t of ['episode', 'state']) { player.addEventListener(t, paintMini); player.addEventListener(t, cover); }
  player.addEventListener('time', paintTime);
  ctx.services.provide('podcasts', {
    player, store,
    play: (id, at) => B.emit('podcasts:play', { episodeId: id, at }),
    search: async (q) => (await import('./lib/online.js')).search(q),
    nowPlaying: () => player.ep ? { episode: player.ep, show: player.show, time: player.time, playing: player.playing } : null,
  });
  // Check feeds now and then (Cài đặt → Tự kiểm tra tập mới), then auto-download.
  const every = () => +get('refreshEvery') || 0;
  const tick = async () => {
    const m = every(); if (!m || navigator.onLine === false) return;
    const last = await getSetting('podcasts.lastRefresh', 0);
    if (Date.now() - last < m * 60000) return;
    try { await tasks.run({ label: `${NAME}: kiểm tra tập mới`, quiet: true, cancellable: true }, (t) => store.refreshAll(t)); await store.autoDownload(tasks); }
    catch (e) { if (e?.name !== 'AbortError') console.warn('[podcasts] refresh', e); }
  };
  nativeOff = startNative();
  setTimeout(tick, 15000);
  timer = setInterval(tick, 10 * 60000);
}

export async function stop() {
  offs.forEach(f => f()); offs = [];
  clearInterval(timer); player.pause(); nativeOff?.();
  dragOff?.(); dragOff = null;
  mini?.remove(); mini = null; css?.remove();
  document.body.classList.remove('pc-mini-on');
}

// ── Mini player (bottom, above the tab bar) ─────────────────────
function mountMini() {
  mini = document.createElement('div');
  mini.className = 'pc-mini'; mini.hidden = true;
  mini.setAttribute('role', 'region'); mini.setAttribute('aria-label', `${NAME} đang phát`);
  mini.innerHTML = `<a class="pc-mini-open" href="#podcasts/play"><span class="pc-mini-art"></span><span class="pc-mini-txt"><b></b><small></small></span></a>
    <button class="icon-btn" data-k="back" aria-label="Lùi">${icon('pc-back')}</button>
    <button class="pc-mini-play" data-k="toggle" aria-label="Phát">${icon('pc-play')}</button>
    <button class="icon-btn" data-k="fwd" aria-label="Tới">${icon('pc-fwd')}</button>
    <button class="icon-btn pc-mini-fold" data-k="fold" aria-label="Thu nhỏ thanh phát" aria-expanded="true">${icon('pc-fold')}</button>
    <button class="icon-btn pc-mini-close" data-k="close" aria-label="Đóng trình phát">${icon('x')}</button>
    <i class="pc-mini-bar"><i></i></i>`;
  mini.classList.toggle('is-folded', miniFolded());
  mini.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    e.preventDefault();
    if (k === 'fold') { setMiniFolded(!mini.classList.contains('is-folded')); return; }
    player[k]();   // back / toggle / fwd / close
  });
  document.body.appendChild(mini);
  dragOff = draggableBubble(mini);   // the folded bubble can be moved
  paintMini();
}
function paintMini() {
  if (!mini) return;
  const e = player.ep, show = !!e && (player.playing || lastApp === 'podcasts');
  mini.hidden = !show;
  document.body.classList.toggle('pc-mini-on', show);
  if (!e) return;
  const artEl = mini.querySelector('.pc-mini-art');
  const src = e.image || player.show?.image || '';
  if (artEl.dataset.src !== src) { artEl.dataset.src = src; artEl.innerHTML = src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" data-drop-on-error>` : icon('podcast'); }
  mini.querySelector('b').textContent = e.title;
  mini.querySelector('small').textContent = player.show?.title || '';
  const p = mini.querySelector('.pc-mini-play');
  p.innerHTML = icon(player.playing ? 'pc-pause' : 'pc-play');
  p.setAttribute('aria-label', player.playing ? 'Tạm dừng' : 'Phát');
  paintTime();
}
// Folded = a small round control; the choice is kept on this device (shared with the music dock).
const FOLD_KEY = 'hub.miniFolded';
export function miniFolded() { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } }
export function setMiniFolded(v) {
  try { localStorage.setItem(FOLD_KEY, v ? '1' : '0'); } catch { /* storage unavailable: folds for this session only */ }
  mini?.classList.toggle('is-folded', v);
  mini?.querySelector('.pc-mini-fold')?.setAttribute('aria-expanded', String(!v));
  document.dispatchEvent(new CustomEvent('hub:mini-fold', { detail: { folded: v } }));
}

function paintTime() {
  const b = mini?.querySelector('.pc-mini-bar i');
  if (!player.duration) return;
  const pct = player.time / player.duration * 100;
  if (b) b.style.width = pct + '%';
  mini?.style.setProperty('--p', pct.toFixed(1));   // the progress ring of the folded bubble
}

// ── Library drawer: a show's latest episodes and "Mở trong Podcast" ──
async function drawerBlock({ item, el, from }) {
  if (from === 'podcasts' || item.type !== 'podcast' || item.moduleId !== 'podcasts') return;
  const s = await store.show(item.id);
  if (!s) return;
  const eps = (await store.episodesOf(item.id)).slice(0, 4);
  const box = document.createElement('div');
  box.className = 'block pc-ext';
  box.innerHTML = `<h3>${esc(NAME)}</h3>
    <p class="muted">${esc(s.author || '')}${s.categories?.length ? ' · ' + esc(s.categories.slice(0, 3).join(', ')) : ''} · ${(await store.episodesOf(item.id)).length} tập</p>
    <ul class="pc-mini-list">${eps.map(e => `<li><button class="btn ghost" data-ep="${esc(e.id)}">${icon('pc-play')}${esc(e.title)}</button></li>`).join('')}</ul>
    <div class="row-actions"><a class="btn" href="#podcasts/show/${encodeURIComponent(item.id)}">${icon('podcast')}Mở trong ${esc(NAME)}</a></div>`;
  box.addEventListener('click', async (ev) => { const b = ev.target.closest('[data-ep]'); if (b) { const e = await store.episode(b.dataset.ep); if (e) player.playEpisode(e); } });
  el.appendChild(box);
}

// ── Android: notification, lock screen, Bluetooth / watch / Android Auto transport (NativeMedia plugin) ──
// The plugin is shared with the Music Player; while Podcast is the app that last started playing, its track and state
// go to the notification and its commands come here (music/lib/native.js ignores them then).
function startNative() {
  const N = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.NativeMedia : null;
  if (!N) return null;
  const mine = () => lastApp === 'podcasts' && player.ep;
  const sendTrack = async () => {
    if (!mine()) return;
    const e = player.ep;
    await N.setTrack({ id: e.id, title: e.title, artist: player.show?.author || '', album: player.show?.title || '', duration: player.duration || e.duration || 0, art: '' }).catch(() => {});
  };
  const sendState = () => { if (mine()) N.setState({ playing: player.playing, position: player.time || 0, rate: player.el?.playbackRate || 1 }).catch(() => {}); };
  let lastT = 0;
  const onTime = () => { const t = Date.now(); if (t - lastT > 5000) { lastT = t; sendState(); } };
  const onEpisode = () => { sendTrack(); sendState(); };
  player.addEventListener('episode', onEpisode); player.addEventListener('state', sendState); player.addEventListener('time', onTime);
  const h = N.addListener('command', (c) => {
    if (!mine()) return;
    if (c.action === 'play') player.play();
    else if (c.action === 'pause') player.pause();
    else if (c.action === 'next') player.fwd();
    else if (c.action === 'prev') player.back();
    else if (c.action === 'seek') player.seek(+c.position || 0);
  });
  const offBus = ctx.bus.on('media:play', ({ app }) => { if (app === 'podcasts') { sendTrack(); sendState(); } });
  return () => { player.removeEventListener('episode', onEpisode); player.removeEventListener('state', sendState); player.removeEventListener('time', onTime); offBus(); Promise.resolve(h).then(x => x?.remove?.()).catch(() => {}); };
}
