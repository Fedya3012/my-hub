// Music library view (#music/...). Tabs: Trang chủ, Bài hát, Album, Nghệ sĩ, Thể loại, Thư mục,
// Danh sách phát — order, visibility, view, sort and filters are customisable per device.
// Detail pages: #music/album/<id>, artist/<id>, genre/<name>, playlist/<id>, folder/<path>.
// The player itself (engine, mini player, Now Playing) runs in service.js across all modules.
import './lib/icons.js';
import './lib/libicons.js';
import { db } from '../../core/db.js';
import { icon } from '../../core/icons.js';
import { esc, h, toast, confirmBox } from '../../core/ui.js';
import { player } from './lib/player.js';
import * as store from './lib/store.js';
import { loadPrefs, prefs, setPref, TABS } from './lib/prefs.js';
import { artHtml, hydrate, fileUrl } from './lib/art.js';
import { badges, fmtTime, fmtTotal, techLine } from './lib/format.js';
import { sheet, menu, trackMenu, pickPlaylist, linkPicker, ask, dragSort } from './ui/sheets.js';
import { coverFlow } from './ui/coverflow.js';
import { tasks } from '../../core/tasks.js';
import { incremental, cmpVi, cmpViNum } from '../../core/perf.js';

let root, ctx, route = '', offs = [], cleanups = [];
let search = '';
const renderSoon = debounce(() => { if (root?.isConnected) render(); }, 120);

let libCss = null;
export async function mount(el, context, sub = '') {
  root = el; ctx = context;
  // Styles of the tag editor, artwork, folder browser and statistics (separate from music.css).
  if (!document.querySelector('link[data-music-library-css]')) {
    libCss = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./library.css', import.meta.url).href });
    libCss.dataset.musicLibraryCss = '1';
    document.head.appendChild(libCss);
  }
  await loadPrefs();
  await player.init();
  const on = (t, f) => { player.addEventListener(t, f); offs.push(() => player.removeEventListener(t, f)); };
  on('track', markPlaying); on('state', markPlaying);
  // Coalesce bursts (an import emits many changes; sliders emit many prefs) into one render.
  const soon = renderSoon;
  offs.push(ctx.bus.on('music:changed', soon));
  // Only prefs that change what the library pages show re-render them (not audio/lyrics/NP knobs).
  const LIB_PREFS = /^(\*|tabs|view|sort|desc|gridSize|filters|showBadges|showHiRes|hiResRule|homeCoverFlow|folderMode|art)(\.|$)/;
  offs.push(ctx.bus.on('music:prefs', (p) => { if (LIB_PREFS.test(String(p?.path))) soon(); }));
  // Drag & drop: files/folders to import, songs to playlists/queue, images onto covers (ui/dnd.js).
  import('./ui/dnd.js').then(m => { if (root === el && el.isConnected) offs.push(m.bindPageDnd(el, { onImport: runImport })); });
  await navigate(sub);
}

export function unmount() { offs.forEach(f => f()); offs = []; cleanups.forEach(f => f()); cleanups = []; }

export async function navigate(sub) {
  route = sub || '';
  await render();
  root.scrollIntoView?.({ block: 'start' });
  window.scrollTo({ top: 0 });
}

export async function migrate() { /* 0.1.0: nothing to migrate yet */ }

const go = (r) => { location.hash = 'music' + (r ? '/' + r : ''); };

// ── Shell ───────────────────────────────────────────────────────
async function render() {
  cleanups.forEach(f => f()); cleanups = [];
  const L = await store.library();
  const [head, ...rest] = route.split('/');
  const arg = rest.join('/');
  const folderMode = !!prefs().folderMode;
  const tabs = [...(folderMode ? ['browse'] : []), ...prefs().tabs.filter(t => t[1]).map(t => t[0])];
  const NAMES = { ...TABS, browse: 'Duyệt thư mục', stats: TABS.stats || 'Thống kê' };
  const remembered = sessionStorage.getItem('music.tab');
  const tab = (NAMES[head] && (head !== 'browse' || !rest.length)) ? head : !head ? (folderMode ? 'browse' : tabs.includes(remembered) ? remembered : tabs[0]) : null;
  if (tab) sessionStorage.setItem('music.tab', tab);
  root.innerHTML = `<div class="mlib page" data-grid="${prefs().gridSize}">
    <header class="mlib-head">
      <div class="mlib-title"><span class="eyebrow">Âm nhạc</span><h1>Nhạc</h1></div>
      <div class="mlib-actions">
        <label class="search mlib-search">${icon('search')}<input type="search" placeholder="Tìm bài, album, nghệ sĩ…" value="${esc(search)}" aria-label="Tìm trong nhạc"></label>
        <button class="btn primary" data-act="add">${icon('plus')}<span>Thêm nhạc</span></button>
        <button class="icon-btn" data-act="custom" aria-label="Tuỳ chỉnh">${icon('settings')}</button>
      </div>
    </header>
    ${tab || search || head === 'browse' ? `<nav class="mtabs" role="tablist">${tabs.map(t => `<a role="tab" href="#music/${t}" aria-selected="${!search && (t === tab || (t === 'browse' && head === 'browse'))}">${NAMES[t]}</a>`).join('')}</nav>` : ''}
    <div class="mcontent"></div></div>`;
  const c = root.querySelector('.mcontent');
  root.querySelector('[data-act="add"]').onclick = (e) => addMenu(e.currentTarget);
  root.querySelector('[data-act="custom"]').onclick = () => import('./ui/customize.js').then(m => m.customizeSheet(() => render()));
  const si = root.querySelector('.mlib-search input');
  si.oninput = debounce(() => { search = si.value.trim(); cleanups.forEach(f => f()); cleanups = []; renderBody(c, L, tab, head, arg); }, 180);
  si.onkeydown = (e) => { if (e.key === 'Escape') { si.value = ''; search = ''; render(); } };
  await renderBody(c, L, tab, head, arg);
  markPlaying();
}

async function renderBody(c, L, tab, head, arg) {
  if (head === 'browse' || tab === 'browse') return import('./ui/browse.js').then(m => m.browsePage(c, tab ? '' : arg, () => render()));
  if (tab === 'stats') return import('./ui/stats.js').then(m => m.statsPage(c, L));
  if (!L.tracks.size && !search) return renderEmpty(c);
  if (search) return renderSearch(c, L);
  if (tab) return VIEWS[tab](c, L);
  if (GROUPS[head]) return groupPage(c, L, head, arg);
  const page = { album: albumPage, artist: artistPage, playlist: playlistPage, folder: folderPage }[head];
  if (page) return page(c, L, arg);
  c.innerHTML = '<p class="muted">Không tìm thấy trang.</p>';
}

function renderEmpty(c) {
  c.innerHTML = `<div class="mempty">
    <div class="mempty-art" aria-hidden="true"><span class="mempty-disc"></span></div>
    <h2>Thư viện nhạc đang trống</h2>
    <p class="muted">Thêm tệp hoặc cả thư mục nhạc: FLAC, ALAC, WAV, AIFF, DSD (DSF/DFF), MP3, AAC, Opus, Vorbis… Ảnh bìa, lời (.lrc) và ReplayGain được đọc tự động. Tệp được lưu theo chế độ lưu trữ trong Cài đặt (máy này, Google Drive hoặc kết hợp).</p>
    <div class="row-actions"><button class="btn primary" data-a="files">${icon('plusfile')}Chọn tệp nhạc</button><button class="btn" data-a="folder">${icon('folder')}Chọn thư mục</button><a class="btn" href="#music/browse">${icon('folder')}Duyệt thư mục (không nhập)</a></div></div>`;
  c.querySelector('[data-a="files"]').onclick = () => pickFiles(false);
  c.querySelector('[data-a="folder"]').onclick = () => pickFiles(true);
}

// ── Building blocks ─────────────────────────────────────────────
function trackRows(list, { num = false, art = true, album = true, source, playlist, sortable = false } = {}) {
  const P = prefs();
  const html = list.map((t, i) => `<div class="mrow" role="row" data-id="${t.id}" data-i="${i}" tabindex="0" draggable="true">
      ${sortable ? `<span class="mrow-drag" data-drag aria-label="Kéo để sắp xếp">${icon('drag')}</span>` : ''}
      ${num ? `<span class="mrow-n num">${t.trackNo || i + 1}</span>` : ''}${art ? artHtml(t._cover, t.album || t.title, { cls: 'xs', label: t.album || t.title }) : ''}
      <span class="mrow-main"><span class="mrow-t">${esc(t.title)}${t.favorite ? `<i class="mrow-fav">${icon('heart')}</i>` : ''}</span>
        <span class="mrow-s">${esc(t.artist || '')}${album && t.album ? ' · ' + esc(t.album) : ''}</span></span>
      <span class="mrow-b">${P.showBadges ? badges(t.tech, { hiRes: P.showHiRes && t.hiResNow, size: 'sm' }) : ''}${!t.fileId ? '<span class="pill">Chưa có tệp</span>' : ''}</span>
      <span class="mrow-d num">${fmtTime(t.duration)}</span>
      <button class="icon-btn sm" data-more aria-label="Thao tác">${icon('more')}</button></div>`).join('');
  return { html, bind: (box, onChange) => bindRows(box, list, { source, playlist }, onChange) };
}

function bindRows(box, list, { source, playlist } = {}, onChange) {
    box.querySelectorAll('.mrow').forEach(r => {
      const t = list[+r.dataset.i];
      r.onclick = (e) => { if (e.target.closest('[data-more],[data-drag]')) return; player.play(list, { start: +r.dataset.i, source }); };
      r.onkeydown = (e) => { if (e.key === 'Enter') r.click(); };
      r.oncontextmenu = (e) => { e.preventDefault(); trackMenu(r.querySelector('[data-more]'), t, { playlist, linkId: t.linkId, onChange }); };
      r.querySelector('[data-more]').onclick = (e) => trackMenu(e.currentTarget, t, { playlist, linkId: t.linkId, onChange });
    });
    hydrate(box);
}

// Pre-compute the cover for each track (album thumb or own art).
const withCovers = (L, list) => { for (const t of list) t._cover = L.coverOf(t); return list; };

function chunked(box, list, opts) {
  // Render long lists in chunks as you scroll: a small first chunk paints fast; nothing is capped.
  let n = 0;
  const more = (size) => {
    const part = list.slice(n, n + size);
    const tmp = document.createElement('div');
    const r = trackRows(part, opts);
    tmp.innerHTML = r.html;
    tmp.querySelectorAll('.mrow').forEach(row => row.dataset.i = +row.dataset.i + n);
    bindRows(tmp, list, opts, () => render());
    box.append(...tmp.children);
    n += part.length;
    if (n < list.length) { const s = h('<div class="msentinel"></div>'); box.append(s); io(s, () => { s.remove(); more(250); }); }
  };
  box.innerHTML = '';
  more(80);
}
function io(el, fn) {
  const o = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { o.disconnect(); fn(); } }, { rootMargin: '600px' });
  o.observe(el); cleanups.push(() => o.disconnect());
}

// Grids/lists of cards with no cap: chunks of cells are added as the user scrolls.
function lazy(box, list, cell, chunk = 60) {
  if (!box) return;
  cleanups.push(incremental(box, list, cell, { chunk, onChunk: (b) => bindCards(b) }));
}

// Groups of tracks that have their own page: #music/<kind>/<id>, looked up in L[<map>].
const GROUPS = {
  genre: { map: 'genres', kicker: 'Thể loại', ic: 'tag' },
  year: { map: 'years', kicker: 'Năm phát hành', ic: 'calendar' },
  label: { map: 'labels', kicker: 'Hãng đĩa', ic: 'vinyl' },
  composer: { map: 'composers', kicker: 'Nhạc sĩ', ic: 'quill', round: true },
  albumartist: { map: 'albumArtists', kicker: 'Nghệ sĩ album', ic: 'user', round: true },
};

function card(kind, o, sub) {
  const round = kind === 'artist' || GROUPS[kind]?.round;
  const art = artHtml(o.cover, kind + ':' + (o.title || o.name), { cls: 'card' + (round ? ' round' : ''), label: o.title || o.name });
  return `<a class="mcard ${round ? 'round' : ''}" href="#music/${kind}/${encodeURIComponent(o.id)}" data-art-kind="${kind}" data-art-id="${esc(o.id)}">
    ${art}
    <span class="mcard-t">${esc(o.title || o.name)}</span><span class="mcard-s">${sub || ''}</span>
    ${kind === 'album' && o.kind && o.kind !== 'album' ? `<span class="mkind">${store.KIND_LABEL[o.kind]}</span>` : ''}
    ${kind === 'album' && o.hiRes && prefs().showHiRes ? '<span class="hires sm mcard-hr">Hi-Res</span>' : ''}
    <button class="mcard-play" data-play="${kind}:${esc(o.id)}" aria-label="Phát ${esc(o.title || o.name)}">${icon('play-fill')}</button></a>`;
}
function groupRow(kind, g, sub) {
  const round = kind === 'artist' || GROUPS[kind]?.round;
  return `<a class="mrow" href="#music/${kind}/${encodeURIComponent(g.id)}" data-art-kind="${kind}" data-art-id="${esc(g.id)}">${artHtml(g.cover, kind + ':' + g.name, { cls: 'xs' + (round ? ' round' : ''), label: g.name })}
    <span class="mrow-main"><span class="mrow-t">${esc(g.name || g.title)}</span><span class="mrow-s">${sub}</span></span><span class="mrow-d num">${fmtTotal(g.duration || 0)}</span></a>`;
}
const albumRow = (a) => `<a class="mrow" href="#music/album/${a.id}" data-art-kind="album" data-art-id="${a.id}">${artHtml(a.cover, a.title, { cls: 'xs' })}<span class="mrow-main"><span class="mrow-t">${esc(a.title)}${a.kind && a.kind !== 'album' ? ` <span class="mkind in">${store.KIND_LABEL[a.kind]}</span>` : ''}</span><span class="mrow-s">${esc(a.artist)}${a.year ? ' · ' + a.year : ''} · ${a.tracks.length} bài</span></span><span class="mrow-b">${a.formats.map(f => `<span class="mfmt sm"><b>${esc(f)}</b></span>`).join('')}${a.hiRes && prefs().showHiRes ? '<span class="hires sm">Hi-Res</span>' : ''}</span><span class="mrow-d num">${fmtTotal(a.duration)}</span></a>`;
const countSub = (g) => `${g.albumCount ?? g.albums?.length ?? 0} album · ${g.count ?? g.tracks.length} bài`;

function bindCards(box) {
  box.querySelectorAll('[data-play*=":"]').forEach(b => b.onclick = (e) => {   // not the coverflow's own bare data-play button
    e.preventDefault(); e.stopPropagation();
    const [kind, ...rest] = b.dataset.play.split(':');
    const id = rest.join(':');
    if (GROUPS[kind]) { store.library().then(L => { const g = L[GROUPS[kind].map].get(id); if (g) player.play(g.tracks, { source: { kind, id: g.id, name: g.name } }); }); return; }
    player.playSource(kind, id);
  });
  box.querySelectorAll('[data-art-kind]').forEach(a => a.oncontextmenu = (e) => {
    e.preventDefault();
    const kind = a.dataset.artKind, id = a.dataset.artId;
    menu(a, [{ icon: 'image', label: 'Đổi ảnh…', act: () => changeArt(kind, id) }, { icon: 'play', label: 'Phát', act: () => a.querySelector('[data-play]')?.click() }], { title: a.querySelector('.mcard-t, .mrow-t')?.textContent || '' });
  });
  hydrate(box);
}

// "Đổi ảnh…" for anything with a page: album, artist, playlist, genre, year, label, composer, folder.
async function changeArt(kind, id) {
  const L = await store.library();
  const map = { album: L.albums, artist: L.artists, albumartist: L.albumArtists, genre: L.genres, year: L.years, label: L.labels, composer: L.composers };
  let o, cover, tracks = [], name;
  if (kind === 'playlist') {
    const builtin = store.BUILTIN_SMART.find(s => s.id === id);
    o = builtin || L.playlists.find(p => p.id === id);
    name = o?.name; cover = builtin ? L.smartCover(builtin) : o?.cover;
    tracks = o ? await store.playlistTracks(builtin ? { ...builtin, kind: 'smart' } : o) : [];
  } else if (kind === 'folder') {
    name = id || 'Thư mục gốc'; cover = L.folderCover(id);
    tracks = [...L.tracks.values()].filter(t => !id || (t.folder || '') === id || (t.folder || '').startsWith(id + '/'));
  } else { o = map[kind]?.get(id); name = o?.name || o?.title; cover = o?.cover; tracks = o?.tracks || []; }
  const { artworkSheet } = await import('./ui/artpicker.js');
  artworkSheet({ kind, id, name, cover, tracks, onDone: () => render() });
}

// ── Sorting (any list: tabs and the lists inside pages) ─────────
const SONG_SORTS = { title: 'Tên', artist: 'Nghệ sĩ', album: 'Album', year: 'Năm', addedAt: 'Mới thêm', plays: 'Nghe nhiều', lastPlayed: 'Nghe gần đây', rating: 'Đánh giá', duration: 'Thời lượng', quality: 'Chất lượng' };
const ALBUM_SORTS = { year: 'Năm', title: 'Tên album', artist: 'Nghệ sĩ', addedAt: 'Mới thêm', plays: 'Nghe nhiều', lastPlayed: 'Nghe gần đây', count: 'Số bài', duration: 'Thời lượng' };
const GROUP_SORTS = { name: 'Tên', count: 'Số bài', albumCount: 'Số album', plays: 'Nghe nhiều', addedAt: 'Mới thêm', duration: 'Thời lượng' };

function toolbar(tab, { sorts, views, filters = true, count, def }) {
  const P = prefs(), F = P.filters;
  const cur = P.sort[tab] in (sorts || {}) ? P.sort[tab] : def || Object.keys(sorts || {})[0];
  return `<div class="mtool" data-key="${tab}">
    ${count != null ? `<span class="mtool-count muted">${count}</span>` : ''}
    ${filters ? `<div class="mtool-filters">
      <button class="chip" aria-pressed="${F.quality === 'lossless'}" data-q="lossless">Lossless</button>
      <button class="chip" aria-pressed="${F.quality === 'hires'}" data-q="hires">Hi-Res</button>
      <button class="chip" aria-pressed="${!!F.fav}" data-fav>${icon('heart')}Yêu thích</button>
      <select data-codec aria-label="Định dạng"><option value="">Mọi định dạng</option>${['FLAC', 'ALAC', 'PCM', 'DSD', 'WavPack', 'APE', 'MP3', 'AAC', 'Opus', 'Vorbis'].map(c => `<option ${F.codec === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <select data-rating aria-label="Đánh giá"><option value="0">Mọi đánh giá</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${+F.minRating === n ? 'selected' : ''}>≥ ${'★'.repeat(n)}</option>`).join('')}</select></div>` : ''}
    <div class="mtool-right">
      ${sorts ? `<label class="msort">${icon('sort')}<select data-sort aria-label="Sắp xếp theo">${Object.entries(sorts).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <button class="icon-btn sm mdir" data-dir aria-label="${P.desc[tab] ? 'Đang đảo chiều, bấm để về chiều thường' : 'Đảo chiều sắp xếp'}" aria-pressed="${!!P.desc[tab]}">${icon('chev-down')}</button>` : ''}
      ${views ? `<div class="seg small" role="group" aria-label="Kiểu xem">${views.map(v => `<button data-view="${v}" aria-pressed="${P.view[tab] === v}" aria-label="${VIEW_NAMES[v]}" title="${VIEW_NAMES[v]}">${icon(VIEW_ICONS[v])}</button>`).join('')}</div>` : ''}
    </div></div>`;
}
const VIEW_NAMES = { grid: 'Lưới', list: 'Danh sách', coverflow: 'Cover Flow', tree: 'Cây thư mục' };
const VIEW_ICONS = { grid: 'grid', list: 'list', coverflow: 'coverflow', tree: 'folder' };

// Binds every toolbar inside c (a page can have several, one per section).
function bindToolbar(c) {
  const re = () => {};   // the music:prefs event re-renders (debounced, once)
  const F = prefs().filters;
  c.querySelectorAll('[data-q]').forEach(b => b.onclick = async () => { await setPref('filters.quality', F.quality === b.dataset.q ? '' : b.dataset.q); re(); });
  c.querySelectorAll('[data-fav]').forEach(b => b.onclick = async () => { await setPref('filters.fav', F.fav ? 0 : 1); re(); });
  c.querySelectorAll('[data-codec]').forEach(s => s.onchange = async (e) => { await setPref('filters.codec', e.target.value); re(); });
  c.querySelectorAll('[data-rating]').forEach(s => s.onchange = async (e) => { await setPref('filters.minRating', +e.target.value); re(); });
  c.querySelectorAll('.mtool[data-key]').forEach(tb => {
    const key = tb.dataset.key;
    tb.querySelector('[data-sort]')?.addEventListener('change', async (e) => { await setPref('sort.' + key, e.target.value); re(); });
    tb.querySelector('[data-dir]')?.addEventListener('click', async () => { await setPref('desc.' + key, prefs().desc[key] ? 0 : 1); re(); });
    tb.querySelectorAll('[data-view]').forEach(b => b.onclick = async () => { await setPref('view.' + key, b.dataset.view); re(); });
  });
}

function applyFilters(list) {
  const F = prefs().filters;
  return list.filter(t => (!F.quality || (F.quality === 'hires' ? t.hiResNow : t.tech?.lossless))
    && (!F.codec || t.tech?.codec === F.codec) && (!F.fav || t.favorite) && (!F.minRating || (t.rating || 0) >= F.minRating));
}
const text = (o) => String(o.name ?? o.title ?? '');
const SPECIAL = {
  trackNo: (a, b) => (a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 999) - (b.trackNo || 999) || cmpVi(a.title, b.title),
  order: () => 0,
  fileName: (a, b) => cmpViNum(a.fileName || a.title, b.fileName || b.title),
  name: (a, b) => cmpViNum(text(a), text(b)),
  quality: (a, b) => quality(a) - quality(b),
};
// Keys whose natural order is "biggest / newest first".
const DESC_FIRST = ['plays', 'lastPlayed', 'addedAt', 'rating', 'year', 'quality', 'count', 'albumCount', 'updatedAt', 'createdAt'];
const cmp = (k) => SPECIAL[k] || ((a, b) => typeof a[k] === 'string' || typeof b[k] === 'string'
  ? cmpViNum(String(a[k] || ''), String(b[k] || '')) : (a[k] || 0) - (b[k] || 0));
function sortList(list, tab, key, def) {
  const k = key || prefs().sort[tab] || def;
  if (!k) return [...list];
  const out = [...list].sort(cmp(k));
  if (DESC_FIRST.includes(k)) out.reverse();
  return prefs().desc[tab] ? out.reverse() : out;
}
// Sort key in use for a list, limited to the options it offers.
const sortKey = (tab, sorts, def) => prefs().sort[tab] in sorts ? prefs().sort[tab] : def || Object.keys(sorts)[0];
const quality = (t) => !t.tech ? 0 : (t.tech.lossless ? 1e6 : 0) + (t.tech.codec === 'DSD' ? 5e5 : 0) + (t.tech.bitDepth || 0) * 1e4 + (t.tech.sampleRate || 0) / 100 + (t.tech.bitrate || 0) / 1e6;

// ── Collapsible sections + "Mở rộng tất cả / Thu gọn tất cả" ─────
// Open/closed state is kept per page for the session.
const closed = new Set((() => { try { return JSON.parse(sessionStorage.getItem('music.closed') || '[]'); } catch { return []; } })());
const saveClosed = () => { try { sessionStorage.setItem('music.closed', JSON.stringify([...closed].slice(-400))); } catch { /* private mode */ } };
function section(id, title, { count, body = '', tools = '', ic, cls = '', defaultOpen = true } = {}) {
  const key = (route || 'home') + '#' + id;
  const open = closed.has(key) ? false : closed.has(key + '!open') ? true : defaultOpen;
  return `<section class="msec ${cls}" data-sec="${esc(key)}" data-open="${open ? 1 : 0}">
    <div class="msec-h"><button class="msec-t" aria-expanded="${open}"><span class="msec-chev">${icon('chev-down')}</span>${ic ? icon(ic) : ''}<span class="msec-name">${title}</span>${count != null ? `<span class="msec-n num">${count}</span>` : ''}</button>${tools}</div>
    <div class="msec-b"${open ? '' : ' hidden'}>${body}</div></section>`;
}
const xallBtn = () => `<button class="btn small mxall" data-xall>${icon('collapse-all')}<span>Thu gọn tất cả</span></button>`;
function bindSections(c) {
  const all = () => [...c.querySelectorAll('.msec')];
  const head = (s) => s.querySelector(':scope > .msec-h .msec-t');
  const bodyOf = (s) => s.querySelector(':scope > .msec-b');
  const set = (s, open) => {
    s.dataset.open = open ? 1 : 0; head(s).setAttribute('aria-expanded', open); bodyOf(s).hidden = !open;
    const k = s.dataset.sec; closed.delete(k); closed.delete(k + '!open');
    closed.add(open ? k + '!open' : k);
    if (open) s.dispatchEvent(new CustomEvent('msec:open'));
  };
  const label = () => c.querySelectorAll('[data-xall]').forEach(b => {
    const anyOpen = all().some(s => s.dataset.open === '1');
    b.dataset.mode = anyOpen ? 'collapse' : 'expand';
    b.querySelector('span').textContent = anyOpen ? 'Thu gọn tất cả' : 'Mở rộng tất cả';
    b.querySelector('.ic').outerHTML = icon(anyOpen ? 'collapse-all' : 'expand-all');
  });
  all().forEach(s => head(s).onclick = () => { set(s, s.dataset.open !== '1'); saveClosed(); label(); });
  c.querySelectorAll('[data-xall]').forEach(b => b.onclick = () => { const open = b.dataset.mode === 'expand'; all().forEach(s => set(s, open)); saveClosed(); label(); });
  label();
}

// Grid or list of albums, sorted by a list key.
function albumsHtml(list, key, def = 'year') {
  const sorted = sortList(list, key, sortKey(key, ALBUM_SORTS, def));
  return { sorted, html: toolbar(key, { sorts: ALBUM_SORTS, filters: false, def }) + `<div class="mgrid">${sorted.map(a => card('album', a, `${a.year || ''}${a.year && a.artist ? ' · ' : ''}${esc(a.artist || '')}`)).join('')}</div>` };
}
// ── Tabs ────────────────────────────────────────────────────────
const VIEWS = {
  async home(c, L) {
    const tracks = [...L.tracks.values()];
    const albums = [...L.albums.values()].sort((a, b) => b.addedAt - a.addedAt);
    const recent = withCovers(L, await store.recentPlays(12));
    const fav = withCovers(L, tracks.filter(t => t.favorite).slice(0, 12));
    const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
    const hires = tracks.filter(t => t.hiResNow).length;
    const fmt = new Map();
    for (const t of tracks) { const k = t.tech?.codecLabel?.replace(/DSD\d+/, 'DSD') || 'Không tệp'; fmt.set(k, (fmt.get(k) || 0) + 1); }
    const fmts = [...fmt].sort((a, b) => b[1] - a[1]);
    const session = await player.session();
    const linkedTargets = (await db.links.where('relation').equals('soundtrack-of').toArray());
    const tItems = (await db.items.bulkGet([...new Set(linkedTargets.map(l => l.toId))])).filter(i => i && !i.deleted);
    c.innerHTML = `
      ${session && !session.mine && !player.playing ? `<button class="mresume" data-resume>${icon('device')}<span><b>Nghe tiếp từ ${esc(session.where || 'thiết bị khác')}</b><small>${esc(session.label || '')}</small></span>${icon('play-fill')}</button>` : ''}
      ${prefs().homeCoverFlow && albums.length > 2 ? '<section class="mhome-cf" data-cf></section>' : ''}
      <section class="mstats">
        <div><b class="num">${tracks.length}</b><span>bài</span></div><div><b class="num">${L.albums.size}</b><span>album</span></div>
        <div><b class="num">${L.artists.size}</b><span>nghệ sĩ</span></div><div><b class="num">${fmtTotal(dur)}</b><span>tổng thời lượng</span></div>
        <div class="mstats-hr"><b class="num">${hires}</b><span class="hires sm">Hi-Res</span></div>
        <div class="mstats-fmt"><div class="mfmt-bar">${fmts.map(([k, n], i) => `<i style="flex:${n};--i:${i}" title="${esc(k)}: ${n}"></i>`).join('')}</div>
          <div class="mfmt-legend">${fmts.slice(0, 6).map(([k, n], i) => `<span><i style="--i:${i}"></i>${esc(k)} <b class="num">${n}</b></span>`).join('')}</div></div>
      </section>
      <section class="mquick">${store.BUILTIN_SMART.map(s => `<a class="mquick-i" href="#music/playlist/${s.id}" data-art-kind="playlist" data-art-id="${s.id}">${artHtml(L.smartCover(s), 'smart:' + s.name, { cls: 'xs lq-art', label: s.name })}${icon(s.icon)}<span>${s.name}</span></a>`).join('')}</section>
      <div class="mtool2 end">${xallBtn()}</div>
      ${recent.length ? section('recent', 'Nghe gần đây', { ic: 'clock', count: recent.length, body: `<div class="mrail">${recent.map(t => `<button class="mtile" data-tid="${t.id}">${artHtml(t._cover, t.album || t.title, { cls: 'card' })}<span class="mcard-t">${esc(t.title)}</span><span class="mcard-s">${esc(t.artist)}</span></button>`).join('')}</div>` }) : ''}
      ${section('new', 'Album mới thêm', { ic: 'album', count: L.albums.size, tools: '<a class="see" href="#music/albums">Tất cả</a>', body: `<div class="mrail">${albums.slice(0, 14).map(a => card('album', a, esc(a.artist))).join('')}</div>` })}
      ${fav.length ? section('fav', 'Yêu thích', { ic: 'heart', count: fav.length, body: '<div class="mlist" data-fav></div>' }) : ''}
      ${tItems.length ? section('links', 'Nhạc nền cho sách & podcast', { ic: 'link', count: tItems.length, body: `<div class="mlinks">${tItems.map(i => `<span class="tag"><i class="dot t-${i.type}"></i>${esc(i.title)}</span>`).join('')}</div>
        <p class="hint">Mở các mục này trong Thư viện, nhạc đã gắn sẽ tự phát.</p>` }) : ''}
      ${L.playlists.length ? section('pls', 'Danh sách phát', { ic: 'list', count: L.playlists.length, tools: '<a class="see" href="#music/playlists">Tất cả</a>', body: `<div class="mrail">${L.playlists.slice(0, 12).map(p => plCard(L, p)).join('')}</div>` }) : ''}`;
    c.querySelector('[data-resume]')?.addEventListener('click', () => player.takeOver(session));
    const cf = c.querySelector('[data-cf]');
    if (cf) cleanups.push(coverFlow(cf, albums.slice(0, 40), { onOpen: (a) => go('album/' + a.id), onPlay: (a) => player.playSource('album', a.id) }));
    c.querySelectorAll('[data-tid]').forEach(b => b.onclick = () => player.play(recent, { start: recent.findIndex(t => t.id === b.dataset.tid), source: { kind: 'recent', name: 'Nghe gần đây' } }));
    const fb = c.querySelector('[data-fav]');
    if (fb) { const r = trackRows(fav, { source: { kind: 'smart', id: 'smart:fav', name: 'Yêu thích' } }); fb.innerHTML = r.html; r.bind(fb, () => render()); }
    bindSections(c); bindCards(c);
  },

  async songs(c, L) {
    const list = withCovers(L, sortList(applyFilters([...L.tracks.values()]), 'songs', sortKey('songs', SONG_SORTS)));
    c.innerHTML = toolbar('songs', { sorts: SONG_SORTS, count: `${list.length} bài` })
      + `<div class="mtool2"><button class="btn small" data-all>${icon('play')}Phát tất cả</button><button class="btn small" data-shuf>${icon('shuffle')}Ngẫu nhiên</button></div><div class="mlist" data-list role="grid"></div>`;
    bindToolbar(c);
    const src = { kind: 'songs', name: 'Bài hát' };
    c.querySelector('[data-all]').onclick = () => player.play(list, { source: src, shuffle: false });
    c.querySelector('[data-shuf]').onclick = () => player.play(list, { source: src, shuffle: true, start: Math.floor(Math.random() * list.length) });
    chunked(c.querySelector('[data-list]'), list, { source: src });
  },

  async albums(c, L) {
    let list = [...L.albums.values()];
    const F = prefs().filters;
    if (F.quality === 'hires') list = list.filter(a => a.hiRes);
    if (F.quality === 'lossless') list = list.filter(a => a.tracks.some(t => t.tech?.lossless));
    if (F.codec) list = list.filter(a => a.tracks.some(t => t.tech?.codec === F.codec));
    if (F.fav) list = list.filter(a => a.tracks.some(t => t.favorite));
    list = sortList(list, 'albums', sortKey('albums', ALBUM_SORTS, 'artist'));
    const view = prefs().view.albums;
    c.innerHTML = toolbar('albums', { sorts: ALBUM_SORTS, def: 'artist', views: ['grid', 'list', 'coverflow'], count: `${list.length} album` })
      + (view === 'coverflow' ? '<div class="mhome-cf big" data-cf></div>' : view === 'list'
        ? '<div class="mlist" data-lazy></div>' : '<div class="mgrid" data-lazy></div>');
    bindToolbar(c);
    if (view !== 'coverflow') lazy(c.querySelector('[data-lazy]'), list, view === 'list' ? albumRow : (a) => card('album', a, `${esc(a.artist)}${a.year ? ' · ' + a.year : ''}`));
    if (view === 'coverflow') cleanups.push(coverFlow(c.querySelector('[data-cf]'), list, { onOpen: (a) => go('album/' + a.id), onPlay: (a) => player.playSource('album', a.id) }));
    bindCards(c);
  },

  artists(c, L) { return groupTab(c, 'artists', 'artist', [...L.artists.values()], 'nghệ sĩ'); },
  albumArtists(c, L) { return groupTab(c, 'albumArtists', 'albumartist', [...L.albumArtists.values()], 'nghệ sĩ album'); },
  composers(c, L) { return groupTab(c, 'composers', 'composer', [...L.composers.values()], 'nhạc sĩ', 'Chưa có thông tin nhạc sĩ (thẻ Composer). Sửa thông tin bài hát để thêm.'); },
  labels(c, L) { return groupTab(c, 'labels', 'label', [...L.labels.values()], 'hãng đĩa', 'Chưa có thông tin hãng đĩa (thẻ Label / Publisher). Sửa thông tin bài hát để thêm.'); },
  genres(c, L) { return groupTab(c, 'genres', 'genre', [...L.genres.values()], 'thể loại'); },

  async years(c, L) {
    const YS = { year: 'Năm', count: 'Số bài', albumCount: 'Số album', plays: 'Nghe nhiều' };
    const key = sortKey('years', YS);
    const list = sortList([...L.years.values()], 'years', key);
    const view = prefs().view.years === 'list' ? 'list' : 'grid';
    const cell = (y) => view === 'list' ? groupRow('year', y, countSub(y)) : card('year', y, countSub(y));
    const wrap = (arr) => view === 'list' ? `<div class="mlist">${arr.map(cell).join('')}</div>` : `<div class="mgrid">${arr.map(cell).join('')}</div>`;
    let body;
    if (key === 'year') {
      // Grouped by decade, newest decade first (or oldest when reversed).
      const decades = [];
      for (const y of list) { const d = y.decade; let g = decades.find(x => x.d === d); if (!g) decades.push(g = { d, years: [] }); g.years.push(y); }
      body = `<div class="mtool2 end">${xallBtn()}</div>` + decades.map(g => section('d' + g.d, g.d ? `Thập niên ${g.d}` : 'Không rõ năm', { ic: 'calendar', count: `${g.years.reduce((s, y) => s + y.count, 0)} bài`, body: wrap(g.years) })).join('');
    } else body = wrap(list);
    c.innerHTML = toolbar('years', { sorts: YS, views: ['grid', 'list'], filters: false, count: `${list.length} năm` }) + body;
    bindToolbar(c); bindSections(c); bindCards(c);
  },

  async folders(c, L) {
    if (prefs().view.folders !== 'tree') return folderPage(c, L, '', true);
    const FS = { name: 'Tên', count: 'Số bài' };
    const key = sortKey('folders', FS);
    const rootNode = folderTree(L);
    // Only the folders that are open are rendered; the rest are filled in when first opened
    // (a library with thousands of folders used to render the whole tree up front: seconds of freeze).
    const pend = new Map();
    const kidsHtml = (n, depth) => sortList([...n.children.values()], 'folders', key).map(k => node(k, depth + 1)).join('')
      + (n.tracks.length ? `<div class="mtree-files muted">${icon('music')} ${n.tracks.length} bài trong thư mục này · <a href="#music/folder/${encodeURIComponent(n.path)}">Mở</a></div>` : '');
    const node = (n, depth) => {
      const sk = (route || 'home') + '#f:' + n.path;
      const open = closed.has(sk) ? false : closed.has(sk + '!open') ? true : depth < 1;
      const head = `${artHtml(L.folderCover(n.path), 'folder:' + n.name, { cls: 'xxs', label: n.name })}<a href="#music/folder/${encodeURIComponent(n.path)}">${esc(n.name)}</a>`;
      let inner = '';
      if (open || (!n.children.size && !n.tracks.length)) inner = kidsHtml(n, depth);
      else pend.set(n.path, { n, depth });
      return section('f:' + n.path, head, { cls: 'mtree-n', ic: 'folder', count: n.count, defaultOpen: depth < 1,
        tools: `<button class="icon-btn sm" data-fplay="${esc(n.path)}" aria-label="Phát thư mục ${esc(n.name)}">${icon('play')}</button><button class="icon-btn sm" data-fdel="${esc(n.path)}" aria-label="Gỡ thư mục ${esc(n.name)}">${icon('trash')}</button>`, body: inner });
    };
    const tops = sortList([...rootNode.children.values()], 'folders', key);
    c.innerHTML = toolbar('folders', { sorts: FS, views: ['tree', 'list'], filters: false, count: `${rootNode.count} bài` })
      + `<div class="mtool2">${xallBtn()}</div>
      ${rootNode.tracks.length ? `<p class="hint">${rootNode.tracks.length} bài nhập lẻ (không theo thư mục): <a href="#music/folder/">xem</a>. Dùng “Thêm nhạc → Chọn thư mục” để giữ cấu trúc thư mục.</p>` : ''}
      <div class="mtree">${tops.map(n => node(n, 0)).join('') || '<p class="muted">Chưa có thư mục nào.</p>'}</div>`;
    const pathOf = (sec) => sec.dataset.sec.split('#f:')[1];
    const watch = () => c.querySelectorAll('.mtree-n').forEach(sec => {
      if (sec._watched) return;
      sec._watched = true;
      if (!pend.has(pathOf(sec))) return;
      sec.addEventListener('msec:open', () => {
        const p = pend.get(pathOf(sec));
        if (!p) return;
        pend.delete(pathOf(sec));
        sec.querySelector(':scope > .msec-b').innerHTML = kidsHtml(p.n, p.depth);
        bindSections(c); hydrate(c); watch();
      }, { once: true });
    });
    bindToolbar(c); bindSections(c); hydrate(c); watch();
    c.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-fdel]');
      if (d) {   // remove a folder's songs from the library (the original files are never touched)
        e.stopPropagation();
        const p = d.dataset.fdel;
        const ids = [...L.tracks.values()].filter(t => (t.folder || '') === p || (t.folder || '').startsWith(p + '/')).map(t => t.id);
        if (!ids.length || !await confirmBox('Gỡ thư mục?', `“${p.split('/').at(-1)}”: ${ids.length} bài sẽ bị gỡ khỏi thư viện (và bản sao trong app). Tệp gốc trên máy không bị xoá.`, 'Gỡ')) return;
        const task = tasks.start({ label: 'Đang gỡ thư mục', total: ids.length, detail: p });
        try {
          for (let i = 0; i < ids.length; i += 25) { await store.deleteTracks(ids.slice(i, i + 25)); task.update({ done: Math.min(ids.length, i + 25), total: ids.length, detail: p }); }
          task.finish(`Đã gỡ ${ids.length} bài`);
        } catch (err) { task.fail(err); }
        return;
      }
      const b = e.target.closest('[data-fplay]');
      if (!b) return;
      e.stopPropagation();
      const p = b.dataset.fplay;
      const list = [...L.tracks.values()].filter(t => (t.folder || '') === p || (t.folder || '').startsWith(p + '/')).sort(SPECIAL.fileName);
      player.play(list, { source: { kind: 'folder', id: p, name: p } });
    });
  },

  async playlists(c, L) {
    const PS = { name: 'Tên', updatedAt: 'Mới sửa', createdAt: 'Mới tạo' };
    const view = prefs().view.playlists;
    const list = sortList(L.playlists, 'playlists', sortKey('playlists', PS));
    c.innerHTML = toolbar('playlists', { sorts: PS, views: ['grid', 'list'], filters: false, count: `${list.length} danh sách` })
      + `<div class="mtool2"><button class="btn small primary" data-new>${icon('plus')}Danh sách mới</button><button class="btn small" data-smart>${icon('sparkle')}Danh sách thông minh</button><span class="grow"></span>${xallBtn()}</div>
      ${section('auto', 'Tự động', { ic: 'sparkle', count: store.BUILTIN_SMART.length, body: `<div class="mgrid">${store.BUILTIN_SMART.map(s => plCard(L, { ...s, kind: 'smart', cover: L.smartCover(s) })).join('')}</div>` })}
      ${section('mine', 'Của bạn', { ic: 'list', count: list.length, body: list.length ? (view === 'list'
        ? `<div class="mlist">${list.map(p => `<a class="mrow" href="#music/playlist/${p.id}" data-art-kind="playlist" data-art-id="${p.id}">${artHtml(p.cover, 'playlist:' + p.name, { cls: 'xs', label: p.name })}<span class="mrow-main"><span class="mrow-t">${esc(p.name)}</span><span class="mrow-s">${p.kind === 'smart' ? 'Thông minh' : 'Danh sách phát'}</span></span></a>`).join('')}</div>`
        : `<div class="mgrid">${list.map(p => plCard(L, p)).join('')}</div>`) : '<p class="muted">Chưa có danh sách phát nào.</p>' })}`;
    bindToolbar(c); bindSections(c);
    c.querySelector('[data-new]').onclick = async () => { const n = await ask('Tên danh sách phát', 'Danh sách mới'); if (n) { const p = await store.createPlaylist(n); go('playlist/' + p.id); } };
    c.querySelector('[data-smart]').onclick = () => import('./ui/editor.js').then(m => m.editSmart(null, () => render()));
    bindCards(c);
  },
};

// A tab listing groups (artists, album artists, composers, labels, genres) as grid or list.
function groupTab(c, tab, kind, all, noun, empty) {
  const list = sortList(all, tab, sortKey(tab, GROUP_SORTS));
  const view = prefs().view[tab] === 'list' ? 'list' : 'grid';
  const sub = (g) => kind === 'artist' ? `${g.albums.length} album · ${g.tracks.length} bài` : countSub(g);
  c.innerHTML = toolbar(tab, { sorts: GROUP_SORTS, views: ['grid', 'list'], filters: false, count: `${list.length} ${noun}` })
    + (!list.length ? `<p class="muted">${empty || 'Chưa có gì ở đây.'}</p>`
      : `<div class="${view === 'list' ? 'mlist' : 'mgrid'}" data-lazy></div>`);
  bindToolbar(c);
  lazy(c.querySelector('[data-lazy]'), list, view === 'list' ? (g) => groupRow(kind, g, sub(g)) : (g) => card(kind, g, sub(g)));
}

function folderTree(L) {
  const root = { name: '', path: '', children: new Map(), tracks: [], count: 0 };
  for (const t of L.tracks.values()) {
    const parts = (t.folder || '').split('/').filter(Boolean);
    let n = root; n.count++;
    parts.forEach((p, i) => {
      if (!n.children.has(p)) n.children.set(p, { name: p, path: parts.slice(0, i + 1).join('/'), children: new Map(), tracks: [], count: 0 });
      n = n.children.get(p); n.count++;
    });
    n.tracks.push(t);
  }
  return root;
}

function plCard(L, p) {
  return `<a class="mcard" href="#music/playlist/${p.id}" data-art-kind="playlist" data-art-id="${p.id}">${artHtml(p.cover, 'playlist:' + p.name, { cls: 'card', label: p.name })}
    <span class="mcard-t">${esc(p.name)}</span><span class="mcard-s">${p.kind === 'smart' ? 'Thông minh' : 'Danh sách phát'}</span>
    <button class="mcard-play" data-play="playlist:${p.id}" aria-label="Phát ${esc(p.name)}">${icon('play-fill')}</button></a>`;
}

// ── Detail pages ────────────────────────────────────────────────
async function hero(c, { cover, fullCover, colors, kicker, title, sub, meta, round, actions }) {
  const bg = await fileUrl(fullCover || cover);
  c.innerHTML = `<section class="mhero" style="${colors ? `--h-bg:${colors.bg};--h-acc:${colors.light};` : ''}">
    <div class="mhero-bg" aria-hidden="true" style="${bg ? `background-image:url('${bg}')` : ''}"></div>
    <button class="icon-btn mhero-back" data-back aria-label="Quay lại">${icon('chev-left')}</button>
    ${artHtml(cover, title, { cls: 'hero' + (round ? ' round' : '') })}
    <div class="mhero-txt"><span class="eyebrow">${kicker}</span><h1>${esc(title)}</h1><p>${sub || ''}</p><p class="mhero-meta">${meta || ''}</p>
      <div class="mhero-act">${actions}</div></div></section><div data-body></div>`;
  c.querySelector('[data-back]').onclick = () => history.length > 1 ? history.back() : go('');
  hydrate(c);
  return c.querySelector('[data-body]');
}
const artItem = (kind, id) => ({ icon: 'image', label: 'Đổi ảnh…', act: () => changeArt(kind, id) });
const heroActs = (extra = '') => `<button class="btn primary" data-pl>${icon('play-fill')}Phát</button><button class="btn" data-sh>${icon('shuffle')}Ngẫu nhiên</button>${extra}<button class="icon-btn" data-mo aria-label="Thêm">${icon('more')}</button>`;
function bindHero(c, list, source, more) {
  c.querySelector('[data-pl]').onclick = () => player.play(list, { source, shuffle: false });
  c.querySelector('[data-sh]').onclick = () => player.play(list, { source, shuffle: true, start: Math.floor(Math.random() * list.length) });
  c.querySelector('[data-mo]').onclick = (e) => menu(e.currentTarget, [
    { icon: 'queue', label: 'Phát tiếp theo', act: () => player.playNext(list.map(t => t.id)) },
    { icon: 'plus', label: 'Thêm vào hàng chờ', act: () => player.addToQueue(list.map(t => t.id)) },
    { icon: 'list', label: 'Thêm vào danh sách phát…', act: () => pickPlaylist(list.map(t => t.id)) },
    ...(more || []),
    !more?.some(m => m.icon === 'edit' && /album/.test(m.label)) && list.length ? { icon: 'edit', label: `Sửa thẻ ${list.length} bài…`, act: () => import('./ui/editor.js').then(m => m.editTracks(list, () => render())) } : null,
  ]);
}
const linkedTo = (targets) => targets.length ? `<p class="mlinked-to">${icon('link')} Tự phát khi mở: ${targets.map(x => `<span class="tag"><i class="dot t-${x.item.type}"></i>${esc(x.item.title)}<button data-unlink="${x.link.id}" aria-label="Gỡ">${icon('x')}</button></span>`).join(' ')}</p>` : '';

async function albumPage(c, L, id) {
  const a = L.albums.get(id);
  if (!a) { c.innerHTML = '<p class="muted">Không tìm thấy album.</p>'; return; }
  withCovers(L, a.tracks);
  const formats = [...new Set(a.tracks.map(t => techLine(t.tech, { bitrate: false })))];
  const src = { kind: 'album', id: a.id, name: a.title };
  const credits = [a.label && `<a href="#music/label/${encodeURIComponent(L.labels.get(store.norm(a.label))?.id || '')}">${esc(a.label)}</a>`].filter(Boolean);
  const body = await hero(c, { cover: a.cover, fullCover: a.coverFileId, colors: prefs().np.albumTheme && a.colors, kicker: store.KIND_LABEL[a.kind] || 'Album', title: a.title,
    sub: `<a href="#music/albumartist/${a.artistId}">${esc(a.artist)}</a>${a.year ? ` · <a href="#music/year/${a.year}">${a.year}</a>` : ''}${credits.length ? ' · ' + credits.join(' · ') : ''}`,
    meta: `${a.tracks.length} bài · ${fmtTotal(a.duration)} · ${a.hiRes && prefs().showHiRes ? '<span class="hires sm">Hi-Res</span> ' : ''}${esc(formats.slice(0, 2).join(' / '))}${a.rg?.gain != null ? ` · ReplayGain album ${a.rg.gain > 0 ? '+' : ''}${a.rg.gain.toFixed(2)} dB` : ''}`,
    actions: heroActs(`<button class="btn" data-link>${icon('link')}Gắn vào…</button>`) });
  const targets = await store.targetsOf(a.id);
  const AS = { trackNo: 'Thứ tự trong album', title: 'Tên', duration: 'Thời lượng', plays: 'Nghe nhiều', rating: 'Đánh giá', quality: 'Chất lượng' };
  const key = sortKey('albumTracks', AS, 'trackNo');
  const sorted = sortList(a.tracks, 'albumTracks', key);
  const discs = key === 'trackNo' ? [...new Set(sorted.map(t => t.discNo || 1))] : [1];
  const multi = discs.length > 1;
  body.innerHTML = `${linkedTo(targets)}${toolbar('albumTracks', { sorts: AS, filters: false, def: 'trackNo', count: `${a.tracks.length} bài` })}
    ${multi ? `<div class="mtool2 end">${xallBtn()}</div>${discs.map(d => section('disc' + d, `Đĩa ${d}`, { ic: 'disc', count: `${sorted.filter(t => (t.discNo || 1) === d).length} bài`, body: `<div class="mlist" data-disc="${d}"></div>` })).join('')}`
      : '<div class="mlist" data-disc="1"></div>'}
    ${a.tracks.some(t => t.composer) ? `<p class="mcredits muted">${icon('quill')} Sáng tác: ${[...new Set(a.tracks.flatMap(t => store.splitArtists(t.composer || '')))].map(n => `<a href="#music/composer/${encodeURIComponent(store.norm(n))}">${esc(n)}</a>`).join(', ')}</p>` : ''}`;
  for (const d of discs) {
    const part = multi ? sorted.filter(t => (t.discNo || 1) === d) : sorted;
    const box = body.querySelector(`[data-disc="${d}"]`);
    const r = trackRows(part, { num: key === 'trackNo', art: false, album: false, source: src });
    box.innerHTML = r.html;
    r.bind(box, () => render());
    // Rows play the whole album (in the shown order) from the clicked track.
    box.querySelectorAll('.mrow').forEach(row => row.onclick = (e) => { if (!e.target.closest('[data-more]')) player.play(sorted, { start: sorted.indexOf(part[+row.dataset.i]), source: src }); });
  }
  bindToolbar(c); bindSections(c);
  bindHero(c, sorted, src, [
    { icon: 'edit', label: 'Sửa thông tin cả album', act: () => import('./ui/editor.js').then(m => m.editTracks(a.tracks, () => render())) },
    { icon: 'image', label: 'Đổi ảnh bìa…', act: () => changeArt('album', a.id) },
  ]);
  c.querySelector('[data-link]').onclick = () => linkPicker({ sourceId: a.id, source: 'album', name: a.title });
  body.querySelectorAll('[data-unlink]').forEach(b => b.onclick = async () => { await store.unlinkMusic(b.dataset.unlink); render(); });
}

async function artistPage(c, L, id) {
  const a = L.artists.get(id);
  if (!a) { c.innerHTML = '<p class="muted">Không tìm thấy nghệ sĩ.</p>'; return; }
  const src = { kind: 'artist', id: a.id, name: a.name };
  const songs = withCovers(L, sortList(a.tracks, 'artistSongs', sortKey('artistSongs', SONG_SORTS, 'plays')));
  const meta = [`${a.tracks.length} bài`, a.fullAlbums.length ? `${a.fullAlbums.length} album` : '', a.singles.length ? `${a.singles.length} single & EP` : '', a.appearsOn.length ? `xuất hiện trong ${a.appearsOn.length} album` : ''].filter(Boolean).join(' · ');
  const body = await hero(c, { cover: a.cover, round: true, kicker: 'Nghệ sĩ', title: a.name, sub: meta, meta: fmtTotal(a.duration), actions: heroActs() });
  const albums = albumsHtml(a.fullAlbums, 'artistAlbums');
  const singles = albumsHtml(a.singles, 'artistAlbums');
  const appears = albumsHtml(a.appearsOn, 'artistAlbums');
  body.innerHTML = `<div class="mtool2 end">${xallBtn()}</div>
    ${section('songs', 'Bài hát', { ic: 'music', count: a.tracks.length, body: toolbar('artistSongs', { sorts: SONG_SORTS, def: 'plays', filters: false }) + '<div class="mlist" data-songs></div>' })}
    ${a.fullAlbums.length ? section('albums', 'Album', { ic: 'album', count: a.fullAlbums.length, body: albums.html }) : ''}
    ${a.singles.length ? section('singles', 'Singles & EP', { ic: 'disc', count: a.singles.length, body: singles.html }) : ''}
    ${a.appearsOn.length ? section('appears', 'Xuất hiện trong', { ic: 'user', count: a.appearsOn.length, body: appears.html }) : ''}`;
  chunked(body.querySelector('[data-songs]'), songs, { source: src });
  bindToolbar(c); bindSections(c); bindCards(body);
  bindHero(c, songs, src, [artItem('artist', a.id)]);
}

// Album artist, composer, record label, year, genre: same page with albums, singles & EP and songs.
async function groupPage(c, L, kind, id) {
  const G = GROUPS[kind], g = L[G.map].get(id);
  if (!g) { c.innerHTML = '<p class="muted">Không tìm thấy trang này.</p>'; return; }
  const src = { kind, id: g.id, name: g.name };
  const songs = withCovers(L, sortList(g.tracks, 'groupSongs', sortKey('groupSongs', SONG_SORTS, kind === 'year' ? 'album' : 'title')));
  const full = g.albums.filter(al => !['single', 'ep'].includes(al.kind)), small = g.albums.filter(al => ['single', 'ep'].includes(al.kind));
  const body = await hero(c, { cover: g.cover, round: G.round, kicker: G.kicker, title: g.name,
    sub: [`${g.count} bài`, full.length ? `${full.length} album` : '', small.length ? `${small.length} single & EP` : ''].filter(Boolean).join(' · '),
    meta: fmtTotal(g.duration), actions: heroActs() });
  const A1 = albumsHtml(full, 'groupAlbums'), A2 = albumsHtml(small, 'groupAlbums');
  body.innerHTML = `<div class="mtool2 end">${xallBtn()}</div>
    ${full.length ? section('albums', 'Album', { ic: 'album', count: full.length, body: A1.html }) : ''}
    ${small.length ? section('singles', 'Singles & EP', { ic: 'disc', count: small.length, body: A2.html }) : ''}
    ${section('songs', 'Bài hát', { ic: 'music', count: g.count, body: toolbar('groupSongs', { sorts: SONG_SORTS, filters: false }) + '<div class="mlist" data-songs></div>' })}`;
  chunked(body.querySelector('[data-songs]'), songs, { source: src });
  bindToolbar(c); bindSections(c); bindCards(body);
  bindHero(c, songs, src, [artItem(kind, g.id)]);
}

async function playlistPage(c, L, id) {
  const builtin = store.BUILTIN_SMART.find(s => s.id === id);
  const pl = builtin ? { ...builtin, kind: 'smart' } : L.playlists.find(p => p.id === id);
  if (!pl) { c.innerHTML = '<p class="muted">Không tìm thấy danh sách phát.</p>'; return; }
  const raw = withCovers(L, await store.playlistTracks(pl));
  const PS = { order: pl.kind === 'smart' ? 'Theo điều kiện' : 'Thứ tự của bạn', ...SONG_SORTS };
  const key = sortKey('playlistTracks', PS, 'order');
  const list = sortList(raw, 'playlistTracks', key);
  const src = { kind: 'playlist', id: pl.id, name: pl.name };
  const dur = list.reduce((s, t) => s + (t.duration || 0), 0);
  const cover = builtin ? L.smartCover(builtin) : pl.cover;
  const body = await hero(c, { cover, kicker: pl.kind === 'smart' ? 'Danh sách thông minh' : 'Danh sách phát', title: pl.name,
    sub: esc(pl.description || (pl.kind === 'smart' ? describeRules(pl.rules) : '')), meta: `${list.length} bài · ${fmtTotal(dur)}`,
    actions: heroActs(builtin ? '' : `<button class="btn" data-link>${icon('link')}Gắn vào…</button>`) });
  const targets = builtin ? [] : await store.targetsOf(pl.id);
  const sortable = pl.kind === 'playlist' && key === 'order' && !prefs().desc.playlistTracks;
  body.innerHTML = `${linkedTo(targets)}
    ${list.length ? toolbar('playlistTracks', { sorts: PS, def: 'order', filters: false, count: sortable ? 'Kéo ⠿ để đổi thứ tự' : '' }) + '<div class="mlist" data-list></div>' : `<p class="muted">${pl.kind === 'smart' ? 'Chưa có bài nào khớp điều kiện.' : 'Danh sách trống. Thêm bài từ menu ⋯ của bài hát hoặc album.'}</p>`}`;
  const box = body.querySelector('[data-list]');
  if (box) {
    const r = trackRows(list, { source: src, playlist: pl, sortable });
    box.innerHTML = r.html; r.bind(box, () => render());
    if (sortable) dragSort(box, async (from, to) => { const ids = list.map(t => t.linkId); const [x] = ids.splice(from, 1); ids.splice(to, 0, x); await store.reorderPlaylist(pl.id, ids); });
  }
  bindToolbar(c);
  bindHero(c, list, src, builtin ? [artItem('playlist', pl.id)] : [artItem('playlist', pl.id),
    pl.kind === 'smart' ? { icon: 'edit', label: 'Sửa điều kiện', act: () => import('./ui/editor.js').then(m => m.editSmart(pl, () => render())) }
      : { icon: 'edit', label: 'Đổi tên', act: async () => { const n = await ask('Tên danh sách phát', pl.name); if (n) await store.updatePlaylist(pl.id, { name: n }); } },
    { icon: 'trash', label: 'Xoá danh sách', danger: true, act: async () => { if (await confirmBox('Xoá danh sách phát?', `“${pl.name}” sẽ bị xoá (bài hát vẫn giữ nguyên).`, 'Xoá')) { await store.deletePlaylist(pl.id); go('playlists'); } } },
  ]);
  c.querySelector('[data-link]')?.addEventListener('click', () => linkPicker({ sourceId: pl.id, source: 'playlist', name: pl.name }));
  body.querySelectorAll('[data-unlink]').forEach(b => b.onclick = async () => { await store.unlinkMusic(b.dataset.unlink); render(); });
}

function describeRules(r) {
  if (!r) return '';
  return r.rules.map(x => `${store.SMART_FIELDS[x.field]?.[0]} ${store.SMART_OPS[store.SMART_FIELDS[x.field]?.[1]]?.[x.op] || ''} ${x.value === 1 ? 'có' : x.value}`).join(r.match === 'any' ? ' hoặc ' : ', ');
}

async function folderPage(c, L, path, asTab = false) {
  const all = [...L.tracks.values()];
  const inDir = all.filter(t => (t.folder || '') === path);
  const subs = new Map();
  for (const t of all) {
    const f = t.folder || '';
    if (path && !f.startsWith(path + '/')) continue;
    const rest = path ? f.slice(path.length + 1) : f;
    if (!rest) continue;
    const name = rest.split('/')[0];
    const s = subs.get(name) || { name, count: 0, cover: L.coverOf(t) };
    s.count++; subs.set(name, s);
  }
  const FS = { name: 'Tên', count: 'Số bài' };
  const TS = { fileName: 'Tên tệp', trackNo: 'Thứ tự album', ...SONG_SORTS };
  const crumbs = path ? path.split('/') : [];
  const subList = sortList([...subs.values()], 'folders', sortKey('folders', FS));
  c.innerHTML = `${asTab ? toolbar('folders', { sorts: FS, views: ['tree', 'list'], filters: false }) : ''}
    <nav class="mcrumbs"><a href="#music/folder/">${icon('folder')}Thư mục</a>${crumbs.map((p, i) => ` / <a href="#music/folder/${encodeURIComponent(crumbs.slice(0, i + 1).join('/'))}">${esc(p)}</a>`).join('')}</nav>
    ${path ? `<div class="lfolder-head">${artHtml(L.folderCover(path), 'folder:' + crumbs.at(-1), { cls: 'md', label: crumbs.at(-1) })}<div><b>${esc(crumbs.at(-1))}</b><button class="btn small" data-fart>${icon('image')}Đổi ảnh…</button></div></div>` : ''}
    ${!path && !subs.size && inDir.length ? '<p class="hint">Bài nhập lẻ (không theo thư mục) nằm ở đây. Dùng “Thêm nhạc → Chọn thư mục” để giữ cấu trúc thư mục.</p>' : ''}
    ${subs.size && inDir.length ? `<div class="mtool2 end">${xallBtn()}</div>` : ''}
    ${subs.size ? section('subs', 'Thư mục con', { ic: 'folder', count: subs.size, body: `${asTab ? '' : toolbar('folders', { sorts: FS, filters: false })}<div class="mlist">${subList.map(s => `<a class="mrow" href="#music/folder/${encodeURIComponent((path ? path + '/' : '') + s.name)}" data-art-kind="folder" data-art-id="${esc((path ? path + '/' : '') + s.name)}">${artHtml(L.folderCover((path ? path + '/' : '') + s.name), 'folder:' + s.name, { cls: 'xs', label: s.name })}<span class="mrow-main"><span class="mrow-t">${esc(s.name)}</span><span class="mrow-s">${s.count} bài</span></span>${icon('chev-right')}</a>`).join('')}</div>` }) : ''}
    ${inDir.length ? section('files', 'Bài hát', { ic: 'music', count: inDir.length, body: `${toolbar('folderTracks', { sorts: TS, def: 'fileName', filters: false })}<div class="mtool2"><button class="btn small" data-all>${icon('play')}Phát thư mục này</button><button class="btn small" data-ftag>${icon('edit')}Sửa thẻ cả thư mục</button></div><div class="mlist" data-list></div>` }) : ''}`;
  if (inDir.length) {
    const list = withCovers(L, sortList(inDir, 'folderTracks', sortKey('folderTracks', TS, 'fileName')));
    const src = { kind: 'folder', id: path, name: path || 'Thư mục gốc' };
    c.querySelector('[data-all]').onclick = () => player.play(list, { source: src });
    c.querySelector('[data-ftag]').onclick = () => import('./ui/editor.js').then(m => m.editTracks(list, () => render()));
    chunked(c.querySelector('[data-list]'), list, { source: src });
  }
  c.querySelector('[data-fart]')?.addEventListener('click', () => changeArt('folder', path));
  bindToolbar(c); bindSections(c); bindCards(c);
  hydrate(c);
}

function renderSearch(c, L) {
  const q = search.toLowerCase();
  const m = (s) => String(s || '').toLowerCase().includes(q);
  const tracks = withCovers(L, sortList([...L.tracks.values()].filter(t => m(t.title) || m(t.artist) || m(t.album) || m(t.composer) || m(t.label) || (t.genres || []).some(m)), 'searchSongs', sortKey('searchSongs', SONG_SORTS, 'title')));
  const albums = [...L.albums.values()].filter(a => m(a.title) || m(a.artist));
  const artists = [...L.artists.values()].filter(a => m(a.name));
  const composers = [...L.composers.values()].filter(g => m(g.name));
  const labels = [...L.labels.values()].filter(g => m(g.name));
  const any = tracks.length || albums.length || artists.length || composers.length || labels.length;
  c.innerHTML = any ? `<div class="mtool2 end">${xallBtn()}</div>
    ${artists.length ? section('s-artists', 'Nghệ sĩ', { ic: 'user', count: artists.length, body: '<div class="mrail" data-s="artists"></div>' }) : ''}
    ${albums.length ? section('s-albums', 'Album', { ic: 'album', count: albums.length, body: '<div class="mrail" data-s="albums"></div>' }) : ''}
    ${composers.length ? section('s-comp', 'Nhạc sĩ', { ic: 'quill', count: composers.length, body: '<div class="mlist" data-s="composers"></div>' }) : ''}
    ${labels.length ? section('s-labels', 'Hãng đĩa', { ic: 'vinyl', count: labels.length, body: '<div class="mlist" data-s="labels"></div>' }) : ''}
    ${tracks.length ? section('s-songs', 'Bài hát', { ic: 'music', count: tracks.length, body: toolbar('searchSongs', { sorts: SONG_SORTS, filters: false }) + '<div class="mlist" data-list></div>' }) : ''}`
    : `<p class="muted">Không có kết quả cho “${esc(search)}”.</p>`;
  const box = c.querySelector('[data-list]');
  if (box) chunked(box, tracks, { source: { kind: 'search', name: 'Kết quả tìm “' + search + '”' } });
  const sq = (k) => c.querySelector(`[data-s="${k}"]`);
  lazy(sq('artists'), artists, (a) => card('artist', a, `${a.tracks.length} bài`), 30);
  lazy(sq('albums'), albums, (a) => card('album', a, esc(a.artist)), 30);
  lazy(sq('composers'), composers, (g) => groupRow('composer', g, countSub(g)));
  lazy(sq('labels'), labels, (g) => groupRow('label', g, countSub(g)));
  bindToolbar(c); bindSections(c);
}

// Highlight the playing track wherever it is listed.
function markPlaying() {
  if (!root) return;
  const id = player.track?.id;
  root.querySelectorAll('.mrow.now').forEach(r => r.classList.remove('now'));
  if (!id) return;
  root.querySelectorAll(`.mrow[data-id="${id}"]`).forEach(r => { r.classList.add('now'); r.classList.toggle('paused', !player.playing); });
}

// ── Adding music ────────────────────────────────────────────────
function addMenu(anchor) {
  menu(anchor, [
    { icon: 'plusfile', label: 'Chọn tệp nhạc…', act: () => pickFiles(false) },
    { icon: 'folder', label: 'Chọn thư mục (sao chép vào app)…', act: () => pickFiles(true) },
    window.showDirectoryPicker ? { icon: 'link', label: 'Liên kết thư mục (không sao chép)…', hint: 'Máy tính', act: linkFolder } : null,
    '-',
    { icon: 'list', label: 'Danh sách phát mới…', act: async () => { const n = await ask('Tên danh sách phát', 'Danh sách mới'); if (n) { const p = await store.createPlaylist(n); go('playlist/' + p.id); } } },
  ], { title: 'Thêm nhạc' });
}

const nativeFolder = () => window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.FolderPicker;

// Android: WebView cannot pick folders, so ask the native plugin, then feed the files over folder by folder.
async function pickNativeFolder(P) {
  let picked;
  try { picked = await P.pickFolder(); } catch (e) { toast(e.message || 'Không mở được thư mục', 'warn'); return; }
  if (!picked || picked.cancelled) return;
  const entries = picked.files || [];
  if (!entries.length) { toast('Thư mục này không có tệp nhạc', 'warn'); return; }
  const byDir = new Map();
  for (const e of entries) {
    const d = e.relPath.split('/').slice(0, -1).join('/');
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(e);
  }
  const run = async ({ signal, onProgress }) => {
    const total = { added: 0, skipped: 0, failed: [], cancelled: false };
    let done = 0;
    for (const group of byDir.values()) {
      if (signal?.aborted) { total.cancelled = true; break; }
      const files = [];
      for (const e of group) {
        if (signal?.aborted) break;
        onProgress(done + files.length, entries.length, e.name);
        try {
          const { path } = await P.copyToCache({ uri: e.uri, name: e.name });
          const blob = await (await fetch(window.Capacitor.convertFileSrc('file://' + path))).blob();
          const f = new File([blob], e.name, { type: blob.type });
          f.relPath = e.relPath;
          files.push(f);
        } catch { total.failed.push(e.name); }
      }
      if (files.length) {
        const r = await store.importFiles(files, { signal, onProgress: (i, n, name) => onProgress(done + i, entries.length, name) });
        total.added += r.added; total.skipped += r.skipped; total.failed.push(...r.failed);
        if (r.cancelled) total.cancelled = true;
      }
      done += group.length;
      await P.clearCache();
    }
    return total;
  };
  runImport(entries, { run });
}

function pickFiles(folder) {
  const P = folder && nativeFolder();
  if (P) return pickNativeFolder(P);
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true;
  if (folder) inp.webkitdirectory = true;
  else inp.accept = 'audio/*,.flac,.m4a,.alac,.wav,.aif,.aiff,.wv,.ape,.dsf,.dff,.opus,.ogg,.lrc,.jpg,.png,.mp4,.m4v,.webm,.mov';
  inp.onchange = () => runImport([...inp.files]);
  inp.click();
}

async function linkFolder() {
  try {
    const dir = await window.showDirectoryPicker({ mode: 'read' });
    const out = [];
    const walk = async (d, prefix) => {
      for await (const [name, hd] of d.entries()) {
        if (hd.kind === 'directory') await walk(hd, prefix + name + '/');
        else out.push({ handle: hd, relPath: prefix + name });
      }
    };
    await walk(dir, dir.name + '/');
    runImport(out);
  } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'error'); }
}

export async function runImport(files, { run } = {}) {
  if (!files.length) return;
  ctx?.storage?.persistOnce().then(r => { if (r.asked) toast(r.granted ? 'Đã bật lưu trữ bền vững: trình duyệt sẽ không tự xoá nhạc của bạn' : 'Trình duyệt chưa cho lưu trữ bền vững (có thể bật lại trong Cài đặt)', r.granted ? 'info' : 'warn'); }).catch(() => {});
  const s = sheet({ title: 'Đang thêm nhạc', body: `<div class="mimport"><div class="bar lg"><i style="width:0%"></i></div><p class="num" data-c>Đang đọc…</p><p class="muted mimport-f" data-f></p></div>` });
  const task = tasks.start({ label: 'Đang thêm nhạc', total: files.length, detail: 'Đang đọc…', cancellable: true });
  let res;
  try {
    res = await (run || ((o) => store.importFiles(files, o)))({ signal: task.signal, onProgress: (i, n, name) => {
      task.update({ done: i, total: n || 1, detail: name || '' });
      s.el.querySelector('.bar i').style.width = (n ? i / n * 100 : 100) + '%';
      s.el.querySelector('[data-c]').textContent = `${i} / ${n} tệp`;
      s.el.querySelector('[data-f]').textContent = name;
    } });
    task.finish(`Đã thêm ${res.added} bài${res.skipped ? ` · bỏ qua ${res.skipped}` : ''}`);
  } catch (e) { task.fail(e); s.body.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
  s.body.innerHTML = `<div class="stack"><p><b>${res.cancelled ? 'Đã dừng. ' : ''}Đã thêm ${res.added} bài.</b>${res.skipped ? ` Bỏ qua ${res.skipped} bài đã có.` : ''}</p>
    ${res.failed.length ? `<details><summary>${res.failed.length} tệp lỗi</summary><ul>${res.failed.map(f => `<li>${esc(f)}</li>`).join('')}</ul></details>` : ''}
    <div class="row-actions"><button class="btn primary" data-close>Xong</button></div></div>`;
  render();
}

function pickImage(fn) {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  inp.onchange = () => inp.files[0] && fn(inp.files[0]);
  inp.click();
}

function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }
