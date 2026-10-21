// Now Playing: full-screen, ambient background from the artwork, artwork as a plain cover,
// a CD sliding out of its case, a vinyl record with tonearm or a cassette whose reels wind with
// the progress. Karaoke lyrics, queue and album beside it on desktop, swapped in on phones.
// A looping video can play behind the lyrics (per track, per album or a default), as in Noctis.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { player } from '../lib/player.js';
import * as store from '../lib/store.js';
import { fileUrl, artHtml, hydrate, hashHue } from '../lib/art.js';
import { badges, techLine, fmtTime } from '../lib/format.js';
import { parseLyrics, KaraokeView, mergeTranslation, lyricsView, LY_MODES } from '../lib/lyrics.js';
import { loadLyrics, SOURCE_LABEL } from '../lib/lyrics-sources.js';
import { prefs, setPref } from '../lib/prefs.js';
import { attachFx, preblur } from './np-fx.js';
import { applyScope } from '../../../core/theme.js';
import { menu, infoSheet, queuePanel, sleepSheet, speedSheet, trackMenu, starsHtml, linkPicker } from './sheets.js';

const ART = { cover: ['square', 'Bìa'], cd: ['disc', 'CD'], vinyl: ['vinyl', 'Vinyl'], cassette: ['cassette', 'Cassette'] };
let np = null;   // { el, panel, karaoke, raf, offs, stopQueue }

export function isOpen() { return !!np; }

export async function openNowPlaying(panel = null) {
  if (!player.track) { toast('Chưa có bài nào đang phát'); return; }
  if (np) { setPanel(panel); return; }
  const el = document.createElement('div');
  el.className = 'mnp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Đang phát');
  el.innerHTML = `
    <div class="mnp-bg" aria-hidden="true"><div class="mnp-bg-a"></div><div class="mnp-bg-b"></div><div class="mnp-bg-shade"></div></div>
    <div class="mnp-video" aria-hidden="true"><video muted loop playsinline disablepictureinpicture preload="auto"></video><i class="mnp-video-shade"></i></div>
    <canvas class="mnp-fx" aria-hidden="true"></canvas>
    <header class="mnp-top">
      <button class="icon-btn" data-act="close" aria-label="Thu nhỏ">${icon('chev-down')}</button>
      <div class="mnp-from"><small>Đang phát từ</small><b data-from></b></div>
      <button class="icon-btn" data-act="more" aria-label="Tuỳ chọn">${icon('more')}</button>
    </header>
    <div class="mnp-body">
      <section class="mnp-left">
        <div class="mnp-stage" data-stage></div>
        <canvas class="mnp-vis" aria-hidden="true"></canvas>
        <div class="mnp-info">
          <div class="mnp-titles">
            <div class="mnp-tt"><h2 data-title></h2><p><a data-artist></a><span class="sep"> · </span><a data-album></a></p></div>
            <button class="icon-btn mnp-fav" data-act="fav" aria-label="Yêu thích">${icon('heart')}</button>
          </div>
          <div class="mnp-meta"><button class="mnp-tech" data-act="info" aria-label="Thông tin tệp"><span class="mbadges" data-badges></span><span class="mnp-techline" data-tech></span></button><span data-stars></span></div>
          <div class="mnp-seek"><input type="range" min="0" max="1000" value="0" data-seek aria-label="Tua"><div class="mnp-times num"><span data-cur>0:00</span><span data-status class="mnp-status"></span><span data-dur>0:00</span></div></div>
          <div class="mnp-ctrls">
            <button class="icon-btn" data-act="shuffle" aria-label="Phát ngẫu nhiên">${icon('shuffle')}</button>
            <button class="icon-btn big" data-act="prev" aria-label="Bài trước">${icon('prev')}</button>
            <button class="mplay xl" data-act="play" aria-label="Phát/Tạm dừng"></button>
            <button class="icon-btn big" data-act="next" aria-label="Bài tiếp">${icon('next')}</button>
            <button class="icon-btn" data-act="repeat" aria-label="Lặp lại"></button>
          </div>
          <div class="mnp-tools">
            <button class="icon-btn" data-panel="lyrics" aria-label="Lời bài hát">${icon('lyrics')}</button>
            <button class="icon-btn" data-panel="queue" aria-label="Hàng chờ">${icon('queue')}</button>
            <button class="icon-btn" data-act="eq" aria-label="Bộ chỉnh âm">${icon('sliders')}</button>
            <button class="icon-btn" data-act="sleep" aria-label="Hẹn giờ tắt">${icon('timer')}</button>
            <button class="icon-btn" data-act="art" aria-label="Kiểu hiển thị bìa">${icon('vinyl')}</button>
            <span class="mnp-vol d-only">${icon('volume')}<input type="range" min="0" max="100" data-vol aria-label="Âm lượng" class="mvol"></span>
          </div>
        </div>
      </section>
      <aside class="mnp-panel">
        <div class="mnp-tabs" role="tablist">
          <button role="tab" data-tab="lyrics">Lời</button><button role="tab" data-tab="queue">Hàng chờ</button><button role="tab" data-tab="album">Album</button>
          <button class="icon-btn sm mnp-vbtn" data-act="video" aria-label="Video nền" title="Video nền">${icon('video')}</button>
          <button class="icon-btn sm m-only" data-act="panel-close" aria-label="Đóng">${icon('x')}</button>
        </div>
        <div class="mnp-pbody">
          <div class="mnp-lyrics ly" data-p="lyrics"></div>
          <div class="mnp-queue" data-p="queue"></div>
          <div class="mnp-album" data-p="album"></div>
        </div>
      </aside>
    </div>`;
  // Skin: a music override paints Now Playing too; its layout variant comes from the skin.
  if (!applyScope(el, 'music')) el.dataset.npLayout = document.documentElement.dataset.npLayout || 'classic';
  // Cover → Now Playing morph (View Transitions); without it the sheet slides up as before.
  const vt = document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const src = vt && document.querySelector('.mdock .mart');
  if (src) src.style.viewTransitionName = 'np-art';
  let done;
  const ready = new Promise(r => { done = r; });
  if (src) { el.classList.add('in', 'vt'); document.startViewTransition(async () => { src.style.viewTransitionName = ''; document.body.appendChild(el); await Promise.race([ready, new Promise(r => setTimeout(r, 600))]); })
    .finished.finally(() => { el.classList.remove('vt'); el.querySelector('[data-stage] > *')?.style.removeProperty('view-transition-name'); }); }
  else document.body.appendChild(el);
  document.body.classList.add('mnp-open');
  np = { el, offs: [], panel: null };
  np.fx = attachFx(el);
  np.fx.restore = () => { if (np?.baseColors) { el.style.setProperty('--np-acc', np.baseColors[0]); el.style.setProperty('--np-bg', np.baseColors[1]); } };
  np.karaoke = new KaraokeView(el.querySelector('.mnp-lyrics'), { onSeek: (t) => player.seek(t), onLong: lyricLineMenu, fake: !!prefs().np.fakeKaraoke });
  wire();
  await renderTrack();
  if (!np || np.el !== el) return;
  setPanel(panel || (matchMedia('(min-width: 1000px)').matches ? 'lyrics' : null));
  if (src) { const a = el.querySelector('[data-stage] > *'); if (a) a.style.viewTransitionName = 'np-art'; await el.querySelector('[data-stage] img')?.decode?.().catch(() => {}); done(); }
  else requestAnimationFrame(() => el.classList.add('in'));
  history.pushState({ mnp: 1 }, '');
  loop();
}

export function closeNowPlaying({ fromPop = false } = {}) {
  if (!np) return;
  const { el } = np;
  cancelAnimationFrame(np.raf);
  np.offs.forEach(f => f());
  np.stopQueue?.();
  np.fx?.destroy();
  const v = el.querySelector('.mnp-video video'); v.pause(); v.removeAttribute('src'); v.load();
  np = null;
  el.classList.remove('in');
  el.classList.add('out');
  document.body.classList.remove('mnp-open');
  setTimeout(() => el.remove(), 260);
  if (!fromPop && history.state?.mnp) history.back();
}
window.addEventListener('popstate', () => { if (np) closeNowPlaying({ fromPop: true }); });

// Press and hold (Android) or right-click (Windows) on shuffle / repeat opens its full list of modes.
function holdMenu(btn, open, tap) {
  if (!btn) return;
  let timer = null, fired = false;
  btn.addEventListener('pointerdown', () => { fired = false; clearTimeout(timer); timer = setTimeout(() => { fired = true; navigator.vibrate?.(15); open(btn); }, 500); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, () => clearTimeout(timer)));
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(timer); open(btn); });
  btn.onclick = () => { if (fired) { fired = false; return; } tap(); };
}
function repeatMenu(anchor) {
  const r = player.repeat;
  menu(anchor, [
    { icon: 'repeat-one', label: 'Phát một bài hát', hint: 'Phát bài hiện tại rồi dừng', on: r === 'stop1', act: () => player.setRepeat('stop1') },
    { icon: 'queue', label: 'Phát danh mục', hint: 'Phát danh mục hiện tại rồi dừng', on: r === 'off', act: () => player.setRepeat('off') },
    { icon: 'list', label: 'Phát tất cả danh mục', hint: 'Phát lần lượt tất cả danh mục rồi dừng', on: r === 'allcats', act: () => player.setRepeat('allcats') },
    { icon: 'repeat-one', label: 'Lặp lại bài hát', hint: 'Phát bài hiện tại và lặp lại', on: r === 'one', act: () => player.setRepeat('one') },
    { icon: 'repeat', label: 'Lặp lại danh mục', hint: 'Phát danh mục hiện tại và lặp lại', on: r === 'all', act: () => player.setRepeat('all') },
    { icon: 'list', label: 'Lặp lại tất cả danh mục', hint: 'Phát lần lượt tất cả danh mục và lặp lại', on: r === 'repeatcats', act: () => player.setRepeat('repeatcats') },
  ], { title: 'Lặp lại' });
}
function shuffleMenu(anchor) {
  const sg = player.shuffle, cg = player.catShuffle;
  const set = (songs, cats) => async () => { if (player.shuffle !== songs) player.setShuffle(songs); await player.setCatShuffle(cats); };
  menu(anchor, [
    { icon: 'shuffle', label: 'Tắt ngẫu nhiên', on: !sg && !cg, act: set(false, false) },
    { icon: 'shuffle', label: 'Xáo trộn tất cả', hint: 'Trộn tất cả các bài hát có sẵn', act: () => player.shuffleAll() },
    { icon: 'shuffle', label: 'Trộn bài hát', hint: 'Danh mục vẫn theo thứ tự', on: sg && !cg, act: set(true, false) },
    { icon: 'shuffle', label: 'Danh mục ngẫu nhiên', hint: 'Bài hát vẫn theo thứ tự', on: !sg && cg, act: set(false, true) },
    { icon: 'shuffle', label: 'Ngẫu nhiên bài hát/danh mục', on: sg && cg, act: set(true, true) },
    '-',
    { icon: 'settings', label: 'Cài đặt', act: () => import('./customize.js').then(m => m.customizeSheet(() => {})) },
  ], { title: 'Trộn bài' });
}

async function toggleFavNow() { const t = player.track; await store.setFavorite(t.id, !t.favorite); t.favorite = t.favorite ? 0 : 1; renderFav(); }
function playMenu(anchor) {
  menu(anchor, [
    { icon: 'play', label: 'Phát / Tạm dừng', act: () => player.toggle() },
    { icon: 'pause-fill', label: 'Tạm dừng', act: () => player.pause() },
    { icon: 'prev', label: 'Phát lại từ đầu bài', act: () => player.seek(0) },
  ]);
}
function prevMenu(anchor) {
  menu(anchor, [
    { icon: 'prev', label: 'Bài trước', act: () => player.prev() },
    { icon: 'prev', label: 'Về đầu bài hiện tại', act: () => player.seek(0) },
  ]);
}
function nextMenu(anchor) {
  menu(anchor, [
    { icon: 'next', label: 'Bài tiếp theo', act: () => player.next() },
    { icon: 'queue', label: 'Xóa các bài sau khỏi hàng chờ', danger: true, act: () => player.clearUpcoming() },
  ]);
}
function favMenu(anchor) {
  const t = player.track;
  menu(anchor, [
    { icon: 'heart', label: t.favorite ? 'Bỏ yêu thích' : 'Yêu thích', act: () => toggleFavNow() },
    { icon: 'list', label: 'Thêm vào danh sách phát…', act: () => import('./sheets.js').then(m => m.pickPlaylist([t.id])) },
  ]);
}
function infoMenu(anchor) {
  const t = player.track;
  menu(anchor, [
    { icon: 'info', label: 'Thông tin tệp & đường tín hiệu', act: () => infoSheet(t) },
    { icon: 'edit', label: 'Sửa thẻ (tag editor)…', act: () => import('./editor.js').then(m => m.editTracks([t])) },
    { icon: 'lyrics', label: 'Lời bài hát…', act: () => import('./editor.js').then(m => m.editLyrics(t)) },
  ]);
}
function panelMenu(anchor) {
  menu(anchor, [
    { icon: 'queue', label: 'Mở hàng chờ', act: () => setPanel('queue') },
    { icon: 'lyrics', label: 'Mở lời bài hát', act: () => setPanel('lyrics') },
  ]);
}

function wire() {
  const el = np.el;
  const on = (t, f) => { player.addEventListener(t, f); np.offs.push(() => player.removeEventListener(t, f)); };
  on('track', renderTrack); on('state', renderState); on('queue', renderState); on('status', renderStatus); on('volume', renderVol);
  const key = (e) => { if (e.key === 'Escape' && !document.querySelector('.msheet-wrap,.mpop')) closeNowPlaying(); };
  document.addEventListener('keydown', key); np.offs.push(() => document.removeEventListener('keydown', key));
  const vis = () => syncVideo();
  document.addEventListener('visibilitychange', vis); np.offs.push(() => document.removeEventListener('visibilitychange', vis));
  const A = (k, f) => el.querySelectorAll(`[data-act="${k}"]`).forEach(b => b.onclick = f);
  A('close', () => closeNowPlaying());
  holdMenu(el.querySelector('[data-act="play"]'), playMenu, () => player.toggle());
  holdMenu(el.querySelector('[data-act="next"]'), nextMenu, () => player.next());
  holdMenu(el.querySelector('[data-act="prev"]'), prevMenu, () => player.prev());
  el.querySelectorAll('[data-panel]').forEach(b => holdMenu(b, (x) => panelMenu(x), () => {}));
  holdMenu(el.querySelector('[data-act="shuffle"]'), shuffleMenu, () => player.setShuffle(!player.shuffle));
  holdMenu(el.querySelector('[data-act="repeat"]'), repeatMenu, () => player.cycleRepeat());
  const toggleFav = toggleFavNow;
  holdMenu(el.querySelector('[data-act="fav"]'), favMenu, toggleFav);
  holdMenu(el.querySelector('[data-act="info"]'), infoMenu, () => infoSheet(player.track));
  holdMenu(el.querySelector('[data-act="eq"]'), (b) => menu(b, [{ icon: 'sliders', label: 'Mở bộ chỉnh âm', act: () => import('./eq-panel.js').then(m => m.eqSheet()) }]), () => import('./eq-panel.js').then(m => m.eqSheet()));
  holdMenu(el.querySelector('[data-act="sleep"]'), (b) => menu(b, [{ icon: 'timer', label: 'Mở hẹn giờ tắt', act: () => sleepSheet() }]), () => sleepSheet());
  A('panel-close', () => setPanel(null));
  A('video', (e) => videoMenu(e.currentTarget));
  A('art', (e) => menu(e.currentTarget, Object.entries(ART).map(([k, [ic, label]]) => ({ icon: ic, label: label + (prefs().np.art === k ? ' ✓' : ''), act: async () => { await setPref('np.art', k); renderStage(); } })), { title: 'Kiểu hiển thị bìa' }));
  A('more', (e) => {
    const t = player.track;
    menu(e.currentTarget, [
      { icon: 'speed', label: 'Tốc độ phát', hint: player.engine.rate + '×', act: speedSheet },
      { icon: 'wave', label: prefs().np.visualizer ? 'Ẩn phổ âm thanh' : 'Hiện phổ âm thanh', act: async () => { await setPref('np.visualizer', prefs().np.visualizer ? 0 : 1); } },
      { icon: 'palette', label: prefs().np.ambient ? 'Tắt nền ambient' : 'Bật nền ambient', act: async () => { await setPref('np.ambient', prefs().np.ambient ? 0 : 1); renderTrack(); } },
      { icon: 'link', label: 'Gắn vào sách / fanfic / podcast…', act: () => linkPicker({ sourceId: t.id, source: 'track', name: t.title }) },
      '-',
      { icon: 'more', label: 'Thêm thao tác cho bài này…', act: () => trackMenu(null, t, { onChange: renderTrack }) },
    ], { title: 'Tuỳ chọn' });
  });
  el.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => setPanel(np.panel === b.dataset.panel && !wide() ? null : b.dataset.panel));
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => setPanel(b.dataset.tab));
  const seek = el.querySelector('[data-seek]');
  seek.oninput = () => { np.seeking = true; el.querySelector('[data-cur]').textContent = fmtTime(seek.value / 1000 * player.duration); paintRange(seek); };
  seek.onchange = () => { player.seek(seek.value / 1000 * player.duration); np.seeking = false; };
  el.querySelector('[data-vol]').oninput = (e) => { player.setVolume(e.target.value / 100); paintRange(e.target); };
  el.querySelector('[data-artist]').onclick = () => { closeNowPlaying(); location.hash = 'music/artist/' + player.track.artistId; };
  el.querySelector('[data-album]').onclick = () => { closeNowPlaying(); location.hash = 'music/album/' + player.track.albumId; };
  // Swipe the artwork sideways to skip, down to close (phones).
  const stage = el.querySelector('[data-stage]');
  let x0, y0;
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) dx < 0 ? player.next() : player.prev();
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) closeNowPlaying();
  });
  const bus = (p) => { const path = String(p?.path || ''); if (np && (path.startsWith('np.') || path === '*') && path !== 'np.lyricsSize') renderTrack(); if (np && path.startsWith('lyrics.')) applyLyPrefs(); };
  import('../../../core/bus.js').then(({ bus: b }) => np?.offs.push(b.on('music:prefs', bus)));
}

const wide = () => matchMedia('(min-width: 1000px)').matches;

function setPanel(p) {
  if (!np) return;
  if (!p && wide()) p = np.panel || 'lyrics';
  np.panel = p;
  np.el.dataset.panel = p || '';
  np.el.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === p));
  np.el.querySelectorAll('[data-panel]').forEach(b => b.setAttribute('aria-pressed', b.dataset.panel === p));
  np.el.querySelectorAll('[data-p]').forEach(d => d.hidden = d.dataset.p !== p);
  if (p === 'queue' && !np.stopQueue) np.stopQueue = queuePanel(np.el.querySelector('.mnp-queue'));
  if (p === 'album') renderAlbumPanel();
  if (p === 'lyrics') { np.karaoke.cur = -1; np.karaoke.update(player.time + (np.lyOffset || 0)); }
  np.fx?.update(p);
  applyVideo();
}

// ── Background video ────────────────────────────────────────────
async function applyVideo() {
  if (!np) return;
  const cur = np, P = prefs().np, t = player.track;
  const fileId = P.video ? await store.bgVideoFor(t) : null;
  const url = fileId ? await fileUrl(fileId) : null;
  if (np !== cur) return;
  const box = np.el.querySelector('.mnp-video'), v = box.querySelector('video');
  if (url && v.dataset.src !== url) { v.dataset.src = url; v.src = url; }
  if (!url && v.dataset.src) { v.pause(); delete v.dataset.src; v.removeAttribute('src'); v.load(); }
  // Where: 'bg' = the Đang phát view, 'lyrics' = behind the lyrics, 'both' (legacy 'always').
  const where = P.videoWhere === 'always' ? 'both' : P.videoWhere || 'lyrics', lyr = np.panel === 'lyrics';
  const show = !!url && (where === 'both' || (where === 'lyrics' ? lyr : (!lyr || wide())));
  np.el.dataset.video = show ? '1' : '0';
  np.el.dataset.vwhere = where;
  np.fx?.video(show);
  box.style.setProperty('--vdim', P.videoDim);
  box.style.setProperty('--vblur', P.videoBlur + 'px');
  np.el.querySelector('[data-act="video"]')?.setAttribute('aria-pressed', !!url);
  syncVideo();
}

// Follow the music: the clip runs while the song plays (or always, if the user prefers).
function syncVideo() {
  const v = np?.el.querySelector('.mnp-video video');
  if (!v?.dataset.src) return;
  const run = np.el.dataset.video === '1' && (player.playing || !prefs().np.videoFollow) && !document.hidden;
  if (run && v.paused) v.play().catch(() => {});
  else if (!run && !v.paused) v.pause();
}

function pickVideo() {
  return new Promise((resolve) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov' });
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

async function videoMenu(anchor) {
  const t = player.track, L = await store.library(), al = L.albums.get(t.albumId);
  const scope = await store.bgVideoScopeOf(t), P = prefs().np;
  const choose = (sc, id, what) => async () => {
    const f = await pickVideo();
    if (!f) return;
    toast('Đang lưu video…');
    try { await store.setBgVideo(sc, id, f); toast(`Đã đặt video nền cho ${what}`); if (!P.video) await setPref('np.video', 1); applyVideo(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const clear = (sc, id) => async () => { await store.clearBgVideo(sc, id); applyVideo(); };
  const named = { track: 'bài này', album: 'album này', default: 'mặc định' };
  menu(anchor, [
    { icon: 'video', label: 'Chọn video cho bài này…', act: choose('track', t.id, 'bài này') },
    al && { icon: 'album', label: 'Chọn video cho cả album…', hint: al.title, act: choose('album', al.id, 'album “' + al.title + '”') },
    { icon: 'sparkle', label: 'Chọn video mặc định…', hint: 'Cho mọi bài chưa có video', act: choose('default', null, 'mọi bài') },
    scope && '-',
    scope && { icon: 'trash', label: `Gỡ video ${named[scope]}`, danger: true, act: clear(scope, scope === 'track' ? t.id : scope === 'album' ? al?.id : null) },
    '-',
    { icon: 'eye', label: P.video ? 'Ẩn video nền' : 'Hiện video nền', act: async () => { await setPref('np.video', P.video ? 0 : 1); applyVideo(); } },
    ...[['bg', 'Hiện ở nền Đang phát'], ['lyrics', 'Hiện ở lời bài hát'], ['both', 'Hiện ở cả hai']].map(([k, label]) => ({ icon: 'sliders', label: label + ((P.videoWhere === 'always' ? 'both' : P.videoWhere) === k ? ' ✓' : ''), act: async () => { await setPref('np.videoWhere', k); applyVideo(); } })),
    { icon: 'palette', label: P.videoColors ? 'Không đồng bộ màu theo video' : 'Đồng bộ màu theo video', act: async () => { await setPref('np.videoColors', P.videoColors ? 0 : 1); applyVideo(); } },
  ], { title: 'Video nền' });
}

async function renderTrack() {
  if (!np) return;
  const cur = np, t = player.track;
  if (!t) return closeNowPlaying();
  const L = await store.library();
  if (np !== cur) return; // closed (or reopened) while loading
  const el = np.el, al = L.albums.get(t.albumId);
  const P = prefs().np;
  el.querySelector('[data-title]').textContent = t.title;
  el.querySelector('[data-artist]').textContent = t.artist || '';
  el.querySelector('[data-album]').textContent = t.album || '';
  el.querySelector('[data-from]').textContent = player.source?.forTitle ? `Nhạc nền · ${player.source.forTitle}` : player.source?.name || t.album || 'Thư viện';
  el.querySelector('[data-badges]').innerHTML = badges(t.tech, { hiRes: prefs().showHiRes && t.hiResNow, size: 'lg' });
  el.querySelector('[data-tech]').textContent = techLine(t.tech);
  el.querySelector('[data-stars]').innerHTML = starsHtml(t.rating || 0, t.id);
  el.querySelectorAll('[data-rate] [data-r]').forEach(b => b.onclick = async () => { const r = +b.dataset.r === t.rating ? 0 : +b.dataset.r; await store.setRating(t.id, r); t.rating = r; el.querySelector('[data-stars]').innerHTML = starsHtml(r, t.id); renderTrack(); });
  renderFav();
  // Colours from the artwork.
  const c = al?.colors;
  const useTheme = P.albumTheme && c;
  np.baseColors = [useTheme ? c.light : 'var(--accent)', useTheme ? c.bg : `hsl(${hashHue(t.album || t.title)} 30% 14%)`];
  if (!el.dataset.vcolors) np.fx.restore();
  np.fx.setBase(useTheme ? c : null);
  np.fx.update(np.panel);
  el.dataset.ambient = P.ambient ? '1' : '0';
  el.dataset.vis = P.visualizer ? '1' : '0';
  const cover = await fileUrl(L.fullCoverOf(t));
  if (np !== cur) return;
  np.cover = cover;
  const amb = await preblur(cover);   // tiny pre-blurred copy: no live 70 px CSS blur
  if (np !== cur) return;
  el.dataset.preblur = amb ? '1' : '';
  for (const b of el.querySelectorAll('.mnp-bg-a, .mnp-bg-b')) b.style.backgroundImage = amb || cover ? `url("${amb || cover}")` : 'none';
  renderStage();
  applyVideo();
  await renderLyrics(t, cur);
  if (np.panel === 'album') renderAlbumPanel();
  renderState(); renderStatus(); renderVol();
}

function renderFav() {
  const b = np?.el.querySelector('[data-act="fav"]');
  if (!b) return;
  b.setAttribute('aria-pressed', !!player.track?.favorite);
  b.classList.toggle('on', !!player.track?.favorite);
}

function renderStage() {
  if (!np) return;
  const t = player.track, style = prefs().np.art, cover = np.cover;
  const img = cover ? `<img src="${cover}" alt="">` : `<span class="mnp-ph" style="--h:${hashHue(t.album || t.title)}">${esc((t.album || t.title).charAt(0))}</span>`;
  const st = np.el.querySelector('[data-stage]');
  st.dataset.style = style;
  st.innerHTML = {
    cover: `<div class="art-cover">${img}</div>`,
    cd: `<div class="art-cd"><div class="cd-case">${img}<i class="cd-hinge"></i></div><div class="cd-disc spin">${cover ? `<img src="${cover}" alt="">` : ''}<i class="cd-sheen"></i><i class="cd-hole"></i></div></div>`,
    vinyl: `<div class="art-vinyl"><div class="vn-sleeve">${img}</div><div class="vn-record spin"><i class="vn-grooves"></i><span class="vn-label">${cover ? `<img src="${cover}" alt="">` : ''}</span><i class="vn-spindle"></i></div><div class="vn-arm"><i></i></div></div>`,
    cassette: `<div class="art-cassette"><div class="cs-body"><div class="cs-label">${cover ? `<img src="${cover}" alt="">` : ''}<span class="cs-title">${esc(t.title)}</span><span class="cs-side">A</span></div>
      <div class="cs-window"><span class="cs-reel l"><i class="spin"></i></span><span class="cs-tape"></span><span class="cs-reel r"><i class="spin"></i></span></div><div class="cs-bottom"><i></i><i></i><i></i><i></i></div></div></div>`,
  }[style] || '';
  renderState();
}

function renderState() {
  if (!np) return;
  const el = np.el;
  syncVideo();
  el.classList.toggle('playing', player.playing);
  const p = el.querySelector('[data-act="play"]');
  p.innerHTML = icon(player.playing ? 'pause-fill' : 'play-fill');
  p.setAttribute('aria-label', player.playing ? 'Tạm dừng' : 'Phát');
  el.querySelector('[data-act="shuffle"]').setAttribute('aria-pressed', player.shuffle);
  const r = el.querySelector('[data-act="repeat"]');
  r.innerHTML = icon(player.repeat === 'one' ? 'repeat-one' : 'repeat');
  r.setAttribute('aria-pressed', player.repeat !== 'off');
  el.querySelector('[data-act="sleep"]').setAttribute('aria-pressed', !!player.sleep);
}

function renderStatus() { const s = np?.el.querySelector('[data-status]'); if (s) s.textContent = player.status || ''; }
function renderVol() {
  const v = np?.el.querySelector('[data-vol]');
  if (!v) return;
  v.value = Math.round(player.engine.volume * 100); paintRange(v);
}
const paintRange = (r) => r.style.setProperty('--v', ((r.value - r.min) / (r.max - r.min) * 100) + '%');

async function renderAlbumPanel() {
  const box = np?.el.querySelector('.mnp-album');
  if (!box) return;
  const L = await store.library(), t = player.track, al = L.albums.get(t.albumId);
  const targets = await store.targetsOf(t.id).then(a => a.concat()).then(async a => a.concat(al ? await store.targetsOf(al.id) : []));
  box.innerHTML = al ? `<div class="mnp-alhead">${artHtml(al.cover, al.title, { cls: 'md' })}<div><b>${esc(al.title)}</b><span class="muted">${esc(al.artist)}${al.year ? ' · ' + al.year : ''} · ${al.tracks.length} bài</span></div></div>
    ${targets.length ? `<p class="mnp-linked">${icon('link')} Phát cùng: ${targets.map(x => `<span class="tag"><i class="dot t-${x.item.type}"></i>${esc(x.item.title)}</span>`).join(' ')}</p>` : ''}
    <ol class="mq">${al.tracks.map((x, i) => `<li class="mq-row${x.id === t.id ? ' cur' : ''}"><span class="mq-n num">${x.trackNo || i + 1}</span><button class="mq-main" data-tid="${x.id}"><span class="mq-t">${esc(x.title)}</span><span class="mq-s">${esc(x.artist)}</span></button><span class="mq-d num">${fmtTime(x.duration)}</span></li>`).join('')}</ol>` : '';
  hydrate(box);
  box.querySelectorAll('[data-tid]').forEach(b => b.onclick = () => player.play(al.tracks, { start: al.tracks.findIndex(x => x.id === b.dataset.tid), source: { kind: 'album', id: al.id, name: al.title } }));
}

// ── Lyrics panel: sources, translation, view settings, full-screen, line actions ──
const LY_EMPTY = () => `<div class="ly-empty">${icon('lyrics')}<p>Chưa có lời cho bài này.</p><button class="btn small" data-ly-edit>${icon('edit')}Thêm hoặc đồng bộ lời</button>
  ${prefs().lyrics?.online ? '' : `<button class="btn small" data-ly-online>${icon('globe')}Bật tìm lời trực tuyến (LRCLIB)</button>`}</div>`;
const editLy = (t) => import('./lyrics-editor.js').then(m => m.editLyrics(t, renderTrack));

function applyLyPrefs() {
  const box = np?.el.querySelector('.mnp-lyrics');
  if (!box) return;
  const Y = prefs().lyrics || {};
  box.dataset.size = prefs().np.lyricsSize;
  box.dataset.tr = Y.tr ? '1' : '0';
  box.dataset.roman = Y.roman ? '1' : '0';
  box.dataset.align = Y.align || 'left';
  box.dataset.blur = Y.blur ? '1' : '0';
  box.style.setProperty('--ly-w', Y.weight || 800);
  np.karaoke.autoScroll = !!Y.autoScroll;
  np.el.classList.toggle('mnp-lyfull', !!np.lyFull);
}

async function renderLyrics(t, cur) {
  const ly = await loadLyrics(t, { allowOnline: false });
  if (np !== cur) return;
  showLyrics(t, ly);
  // Online lookup (LRCLIB) in the background when the toggle is on and nothing is stored.
  if (prefs().lyrics?.online && (!ly || ly.source !== 'user')) {
    loadLyrics(t).then(row => { if (np === cur && player.track?.id === t.id && row && row.text !== ly?.text) showLyrics(t, row); }).catch(() => {});
  }
}

const MODE_LABEL = { word: 'Đồng bộ từng chữ', line: 'Đồng bộ theo dòng', plain: 'Lời thường' };

function showLyrics(t, ly) {
  const P = prefs().np;
  const parsed = ly ? mergeTranslation(parseLyrics(ly.text, t.duration), ly.trText) : null;
  np.lyOffset = +ly?.offset || 0;
  const mode = LY_MODES.includes(prefs().lyrics?.mode) ? prefs().lyrics.mode : 'word';
  np.karaoke.fake = !!P.fakeKaraoke && mode === 'word';
  np.karaoke.duration = player.duration || t.duration || 0;
  np.karaoke.set(lyricsView(parsed, mode), LY_EMPTY());
  const box = np.el.querySelector('.mnp-lyrics');
  applyLyPrefs();
  box.querySelector('[data-ly-edit]')?.addEventListener('click', () => editLy(t));
  box.querySelector('[data-ly-online]')?.addEventListener('click', async () => { await setPref('lyrics.online', 1); toast('Đang tìm lời trên LRCLIB…'); renderLyrics(t, np); });
  if (!parsed) return;
  const hasTr = parsed.lines.some(l => l.tr || l.roman);
  const kind = parsed.words ? 'Karaoke từng chữ' : parsed.synced ? 'Đồng bộ theo dòng' : 'Lời tĩnh';
  const tools = document.createElement('div');
  tools.className = 'ly-tools';
  tools.innerHTML = `<span class="ly-fullhead"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span>
    <span class="pill" title="${esc(SOURCE_LABEL[ly.source] || '')}">${kind}${parsed.lines.some(l => l.agent === 'v2') ? ' · song ca' : ''}</span>
    ${parsed.synced ? `<span class="ly-off" role="group" aria-label="Lệch thời gian lời"><button class="icon-btn sm" data-ly-off="-0.1" aria-label="Lời chậm lại 0,1 giây">−0,1s</button><span class="ly-off-v num" title="Dương: lời hiện sớm hơn · Âm: lời hiện muộn hơn"></span><button class="icon-btn sm" data-ly-off="0.1" aria-label="Lời sớm lên 0,1 giây">+0,1s</button></span>` : '<span class="ly-off"></span>'}
    ${parsed.synced ? `<button class="btn small ly-mode" data-ly-mode aria-label="Chế độ lời" title="Chế độ lời">${esc(MODE_LABEL[mode])}</button>` : ''}
    ${hasTr ? `<button class="icon-btn sm" data-ly-tr aria-pressed="${!!prefs().lyrics?.tr}" aria-label="Hiện bản dịch / phiên âm" title="Bản dịch">${icon('translate')}</button>` : ''}
    <button class="icon-btn sm" data-ly-set aria-label="Kiểu chữ lời" title="Kiểu chữ">${icon('text-size')}</button>
    <button class="icon-btn sm" data-ly-full aria-pressed="${!!np.lyFull}" aria-label="Lời toàn màn hình" title="Toàn màn hình">${icon('fullscreen')}</button>
    <button class="icon-btn sm" data-ly-e aria-label="Sửa / đồng bộ lời" title="Sửa lời">${icon('edit')}</button>`;
  box.prepend(tools);
  const B = (k) => tools.querySelector(`[data-ly-${k}]`);
  B('e').onclick = () => editLy(t);
  const showOff = () => { const v = tools.querySelector('.ly-off-v'); if (v) v.textContent = (np.lyOffset > 0 ? '+' : np.lyOffset < 0 ? '−' : '') + Math.abs(np.lyOffset).toFixed(1).replace('.', ',') + 's'; };
  showOff();
  tools.querySelectorAll('[data-ly-off]').forEach(b => b.onclick = async () => {
    np.lyOffset = Math.round(((np.lyOffset || 0) + +b.dataset.lyOff) * 10) / 10;
    showOff();
    const { db } = await import('../../../core/db.js');
    await db.lyrics.update(t.id, { offset: np.lyOffset });
  });
  if (B('tr')) B('tr').onclick = async (e) => { const v = prefs().lyrics?.tr ? 0 : 1; await setPref('lyrics.tr', v); e.currentTarget.setAttribute('aria-pressed', !!v); applyLyPrefs(); np.karaoke.recenter(); };
  B('full').onclick = (e) => { np.lyFull = !np.lyFull; e.currentTarget.setAttribute('aria-pressed', np.lyFull); if (np.lyFull && np.panel !== 'lyrics') setPanel('lyrics'); applyLyPrefs(); setTimeout(() => np?.karaoke.recenter(), 50); };
  B('set').onclick = (e) => lyricsStyleMenu(e.currentTarget);
  if (B('mode')) B('mode').onclick = (e) => menu(e.currentTarget, LY_MODES.map(k => ({ icon: 'lyrics', label: MODE_LABEL[k] + (k === mode ? ' ✓' : ''),
    act: async () => { await setPref('lyrics.mode', k); renderLyrics(t, np); } })), { title: 'Chế độ lời' });
}

function lyricsStyleMenu(anchor) {
  const Y = prefs().lyrics || {}, S = prefs().np.lyricsSize;
  const set = async (k, v) => { await setPref(k, v); applyLyPrefs(); np?.karaoke.recenter(); };
  const ck = (on) => on ? ' ✓' : '';
  menu(anchor, [
    { icon: 'text-size', label: 'Cỡ chữ: nhỏ' + ck(S === 's'), act: () => set('np.lyricsSize', 's') },
    { icon: 'text-size', label: 'Cỡ chữ: vừa' + ck(S === 'm'), act: () => set('np.lyricsSize', 'm') },
    { icon: 'text-size', label: 'Cỡ chữ: lớn' + ck(S === 'l'), act: () => set('np.lyricsSize', 'l') },
    { icon: 'text-size', label: 'Cỡ chữ: rất lớn' + ck(S === 'xl'), act: () => set('np.lyricsSize', 'xl') },
    '-',
    { icon: 'quill', label: (Y.weight || 800) >= 700 ? 'Chữ mảnh hơn' : 'Chữ đậm hơn', act: () => set('lyrics.weight', (Y.weight || 800) >= 700 ? 500 : 800) },
    { icon: 'list', label: 'Căn trái' + ck((Y.align || 'left') === 'left'), act: () => set('lyrics.align', 'left') },
    { icon: 'list', label: 'Căn giữa' + ck(Y.align === 'center'), act: () => set('lyrics.align', 'center') },
    { icon: 'eye', label: Y.blur ? 'Tắt làm mờ dòng xa' : 'Làm mờ dòng xa', act: () => set('lyrics.blur', Y.blur ? 0 : 1) },
    { icon: 'translate', label: Y.tr ? 'Ẩn bản dịch' : 'Hiện bản dịch', act: () => set('lyrics.tr', Y.tr ? 0 : 1) },
    { icon: 'translate', label: Y.roman ? 'Ẩn phiên âm' : 'Hiện phiên âm', act: () => set('lyrics.roman', Y.roman ? 0 : 1) },
    { icon: 'arrow', label: Y.autoScroll ? 'Lời tĩnh: tắt tự cuộn' : 'Lời tĩnh: tự cuộn theo bài', act: () => set('lyrics.autoScroll', Y.autoScroll ? 0 : 1) },
    { icon: 'lyrics', label: Y.mini ? 'Ẩn lời trên thanh phát nhỏ' : 'Hiện lời trên thanh phát nhỏ', act: () => set('lyrics.mini', Y.mini ? 0 : 1) },
    '-',
    { icon: 'globe', label: Y.online ? 'Tắt tìm lời trực tuyến (LRCLIB)' : 'Bật tìm lời trực tuyến (LRCLIB)', act: async () => { await set('lyrics.online', Y.online ? 0 : 1); if (!Y.online && np) renderLyrics(player.track, np); } },
  ], { title: 'Kiểu chữ lời' });
}

function lyricLineMenu(L, i, lineEl) {
  const text = [L.text, L.bg?.text && `(${L.bg.text})`, L.tr].filter(Boolean).join('\n');
  const t = player.track;
  const copy = (s) => navigator.clipboard?.writeText(s).then(() => toast('Đã sao chép'), () => toast('Không sao chép được', 'warn'));
  menu(lineEl, [
    L.t != null && { icon: 'play', label: 'Phát từ dòng này', act: () => player.seek(L.t) },
    { icon: 'copy', label: 'Sao chép dòng', act: () => copy(text) },
    navigator.share && { icon: 'share', label: 'Chia sẻ dòng…', act: () => navigator.share({ text: `“${L.text}”\n— ${t?.title || ''}${t?.artist ? ' · ' + t.artist : ''}` }).catch(() => {}) },
    { icon: 'copy', label: 'Sao chép toàn bộ lời', act: () => copy(np.karaoke.data.lines.map(x => x.text).join('\n')) },
    { icon: 'edit', label: 'Sửa / đồng bộ lời', act: () => editLy(t) },
  ], { title: 'Dòng lời' });
}

// Animation loop: progress, lyrics, cassette reels, visualizer.
function loop() {
  if (!np) return;
  const el = np.el, d = player.duration, t = player.time;
  const N = np.nodes ||= { seek: el.querySelector('[data-seek]'), cur: el.querySelector('[data-cur]'), dur: el.querySelector('[data-dur]') };
  if (!np.seeking) {
    // Only touch the DOM when something visible changed (no per-frame style writes).
    const v = d ? Math.round(t / d * 1000) : 0, sec = Math.floor(t);
    if (v !== np.lastV) { np.lastV = v; N.seek.value = v; paintRange(N.seek); }
    if (sec !== np.lastSec || d !== np.lastD) { np.lastSec = sec; np.lastD = d; N.cur.textContent = fmtTime(t); N.dur.textContent = '−' + fmtTime(Math.max(0, d - t)); }
  }
  if (np.panel === 'lyrics') { np.karaoke.duration = d; np.karaoke.update((player.engine.preciseTime ?? t) + (np.lyOffset || 0)); }
  if (prefs().np.art === 'cassette' && d) {
    const p = t / d;
    el.querySelector('.cs-reel.l')?.style.setProperty('--tape', (1 - p).toFixed(3));
    el.querySelector('.cs-reel.r')?.style.setProperty('--tape', p.toFixed(3));
  }
  np.raf = requestAnimationFrame(loop);
}

// The spectrum strip and the background themes run in ./visualizer.js (via ./np-fx.js).

// Re-read the background video and lyrics of the current track (after a drop / an edit elsewhere).
export async function refreshNowPlaying() {
  if (!np) return;
  await applyVideo();
  if (player.track) renderLyrics(player.track, np);
}
