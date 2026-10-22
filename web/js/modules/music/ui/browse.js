// Folder-first browsing page (#music/browse, #music/browse/<root>/<path>): live directory
// listing of the user's own folders, no import or library scan. See lib/folders.js.
import '../lib/libicons.js';
import { icon } from '../../../core/icons.js';
import { esc, toast, confirmBox } from '../../../core/ui.js';
import * as F from '../lib/folders.js';
import { artHtml, hydrate } from '../lib/art.js';
import { fmtTime, badges } from '../lib/format.js';
import { player } from '../lib/player.js';
import { menu } from './sheets.js';
import { incremental } from '../../../core/perf.js';

const KIND_IC = { internal: 'device', sd: 'sd', usb: 'usb', network: 'cloud', other: 'folder' };
let sortBy = localStorage.getItem('music.browse.sort') || 'name';
let desc = localStorage.getItem('music.browse.desc') === '1';
let abort = null;

const href = (root, path = '') => '#music/browse/' + encodeURIComponent(root.id) + (path ? '/' + path.split('/').map(encodeURIComponent).join('/') : '');
const UNSUPPORTED_NOTE = 'Trình duyệt này không giữ quyền truy cập thư mục (Firefox, Safari iOS và đa số trình duyệt Android). Thư mục bạn chọn chỉ duyệt được trong phiên này; mở lại app thì chọn lại. Dùng Chrome hoặc Edge trên máy tính để lưu thư mục.';
const PATH_NOTE = 'Trình duyệt không cho gõ đường dẫn trực tiếp (vd. /storage/XXXX-XXXX/Music, E:\\Music). Hãy chọn thư mục trong hộp thoại của hệ thống; thẻ SD và ổ USB hiện ở đó khi đã cắm.';

export async function browsePage(c, arg, rerender) {
  abort?.abort(); abort = new AbortController();
  const [rid, ...rest] = (arg || '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!rid) return rootsView(c, rerender);
  const root = await F.getRoot(rid);
  if (!root) { c.innerHTML = `<p class="muted">Thư mục này không còn (thư mục chỉ chọn trong phiên trước). <a href="#music/browse">Quay lại</a></p>`; return; }
  return folderView(c, root, rest.join('/'), rerender);
}

async function rootsView(c, rerender) {
  const roots = await F.roots();
  c.innerHTML = `<div class="lbr">
    <div class="lbr-intro"><p>${icon('folder')} <b>Duyệt theo thư mục</b>: mở thẳng thư mục nhạc trên máy, thẻ SD hoặc ổ USB, phát ngay, không nhập vào thư viện và không quét.</p>
      <p class="hint">${F.supported() ? 'Thư mục được nhớ trên máy này; sau khi mở lại app, trình duyệt có thể hỏi lại quyền đọc.' : esc(UNSUPPORTED_NOTE)}</p>
      <p class="hint">${esc(PATH_NOTE)}</p></div>
    <div class="row-actions">
      <button class="btn primary" data-add="internal">${icon('plus')}Thêm thư mục…</button>
      <button class="btn" data-add="sd">${icon('sd')}Thẻ SD…</button>
      <button class="btn" data-add="usb">${icon('usb')}Ổ USB / ổ ngoài…</button></div>
    ${roots.length ? `<div class="lbr-roots">${roots.map(r => `<div class="lbr-root" data-id="${esc(r.id)}">
        <a class="lbr-root-main" href="${href(r)}"><span class="lbr-ic">${icon(KIND_IC[r.kind] || 'folder')}</span>
          <span><b>${esc(r.name)}</b><small>${esc(F.KINDS[r.kind] || '')}${r.session ? ' · chỉ phiên này' : r.permission !== 'granted' ? ' · cần cấp quyền lại' : ''}</small></span></a>
        ${r.permission !== 'granted' && !r.session ? `<button class="btn small" data-grant="${esc(r.id)}">Cấp quyền</button>` : ''}
        <button class="icon-btn sm" data-more="${esc(r.id)}" aria-label="Thao tác">${icon('more')}</button></div>`).join('')}</div>`
      : '<p class="muted">Chưa có thư mục nào. Thêm một thư mục nhạc để bắt đầu.</p>'}</div>`;
  c.querySelectorAll('[data-add]').forEach(b => b.onclick = () => add(b.dataset.add, rerender));
  c.querySelectorAll('[data-grant]').forEach(b => b.onclick = async () => {
    const r = roots.find(x => x.id === b.dataset.grant);
    if ((await F.permission(r.handle, true)) === 'granted') location.hash = href(r); else toast('Chưa được cấp quyền đọc thư mục', 'warn');
  });
  c.querySelectorAll('[data-more]').forEach(b => b.onclick = () => {
    const r = roots.find(x => x.id === b.dataset.more);
    menu(b, [
      ...(!r.session ? Object.entries(F.KINDS).map(([k, v]) => ({ icon: KIND_IC[k], label: 'Đánh dấu: ' + v, act: async () => { await F.renameRoot(r.id, { kind: k }); rerender(); } })) : []),
      '-',
      { icon: 'trash', label: 'Bỏ thư mục khỏi danh sách', danger: true, act: async () => { if (await confirmBox('Bỏ thư mục?', `“${r.name}” chỉ bị bỏ khỏi danh sách, tệp không bị xoá.`, 'Bỏ')) { await F.removeRoot(r.id); rerender(); } } },
    ], { title: r.name });
  });
}

async function add(kind, rerender) {
  if (F.supported()) {
    try { const r = await F.addRoot(kind); location.hash = href(r); } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'error'); }
    return;
  }
  const inp = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
  inp.webkitdirectory = true;
  inp.onchange = () => { const r = F.addSessionRoot(inp.files, kind); if (r) location.hash = href(r); else rerender(); };
  inp.click();
}

function sortFiles(list) {
  const k = sortBy;
  const out = [...list].sort((a, b) => k === 'date' ? (a.lastModified || 0) - (b.lastModified || 0) : k === 'size' ? (a.size || 0) - (b.size || 0)
    : k === 'track' ? ((a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 999) - (b.trackNo || 999)) : F.byName(a, b));
  return desc ? out.reverse() : out;
}

async function folderView(c, root, path, rerender) {
  if (!root.session && (await F.permission(root.handle)) !== 'granted') {
    c.innerHTML = `<div class="lbr"><p>Cần cấp lại quyền đọc “${esc(root.name)}” (trình duyệt hỏi lại sau mỗi lần mở app).</p><button class="btn primary" data-grant>${icon('check')}Cấp quyền</button> <a class="btn" href="#music/browse">Danh sách thư mục</a></div>`;
    c.querySelector('[data-grant]').onclick = async () => { if ((await F.permission(root.handle, true)) === 'granted') rerender(); };
    return;
  }
  let res;
  try { res = await F.list(root, path); }
  catch (e) { c.innerHTML = `<p class="muted">Không mở được thư mục: ${esc(e.message)}. Có thể thẻ SD / ổ USB đã bị rút. <a href="#music/browse">Quay lại</a></p>`; return; }
  const parts = path.split('/').filter(Boolean);
  const dirs = res.dirs.sort(F.byName);
  if (desc && sortBy === 'name') dirs.reverse();
  const signal = abort.signal;
  c.innerHTML = `<div class="lbr">
    <nav class="mcrumbs lbr-crumbs"><a href="#music/browse">${icon('folder')}Thư mục</a> / <a href="${href(root)}">${esc(root.name)}</a>${parts.map((p, i) => ` / <a href="${href(root, parts.slice(0, i + 1).join('/'))}">${esc(p)}</a>`).join('')}</nav>
    ${root.session ? `<p class="hint">${esc(F.supported() ? 'Thư mục này chỉ duyệt được trong phiên này (chọn bằng hộp thoại tải tệp). Dùng “Thêm thư mục…” để app nhớ thư mục.' : UNSUPPORTED_NOTE)}</p>` : ''}
    <div class="mtool"><span class="mtool-count muted">${dirs.length} thư mục · ${res.files.length} bài</span>
      <div class="mtool-right"><label class="msort">${icon('sort')}<select data-sort aria-label="Sắp xếp">${Object.entries({ name: 'Tên', track: 'Số bài', date: 'Ngày sửa', size: 'Dung lượng' }).map(([k, v]) => `<option value="${k}" ${k === sortBy ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <button class="icon-btn sm mdir" data-dir aria-pressed="${desc}" aria-label="Đảo chiều">${icon('chev-down')}</button></div></div>
    <div class="mtool2">
      ${res.files.length ? `<button class="btn small" data-play>${icon('play')}Phát thư mục này</button>` : ''}
      <button class="btn small" data-rec>${icon('play')}Phát cả thư mục con</button><button class="btn small" data-shuf>${icon('shuffle')}Ngẫu nhiên</button>
      <span class="grow"></span>${dirs.length ? `<button class="btn small" data-xall="1">${icon('expand-all')}<span>Mở rộng tất cả</span></button>` : ''}</div>
    ${dirs.length ? `<div class="lbr-dirs">${dirs.map(d => dirNode(root, d)).join('')}</div>` : ''}
    <div class="mlist" data-files></div></div>`;
  c.querySelector('[data-sort]').onchange = (e) => { sortBy = e.target.value; localStorage.setItem('music.browse.sort', sortBy); rerender(); };
  c.querySelector('[data-dir]').onclick = () => { desc = !desc; localStorage.setItem('music.browse.desc', desc ? '1' : '0'); rerender(); };
  const playAll = async (recursive, shuffle) => {
    const files = recursive ? await F.walk(root, path, { signal }) : sortFiles(res.files);
    if (!files.length) { toast('Không có bài nào', 'warn'); return; }
    // Tags are read in the background; titles fill in while it plays.
    const all = await F.toTracks(root, files, { signal, lazy: true });
    player.play(all, { start: shuffle ? Math.floor(Math.random() * all.length) : 0, shuffle, source: { kind: 'browse', id: root.id + '/' + path, name: parts.at(-1) || root.name } });
  };
  c.querySelector('[data-play]')?.addEventListener('click', () => playAll(false, false));
  c.querySelector('[data-rec]').onclick = () => playAll(true, false);
  c.querySelector('[data-shuf]').onclick = () => playAll(true, true);
  bindDirs(c, root, signal);
  const xall = c.querySelector('[data-xall]');
  if (xall) xall.onclick = async () => {
    const open = xall.dataset.xall === '1';
    for (const d of c.querySelectorAll('.lbr-dir')) await toggleDir(d, root, signal, open);
    xall.dataset.xall = open ? '0' : '1';
    xall.querySelector('span').textContent = open ? 'Thu gọn tất cả' : 'Mở rộng tất cả';
  };
  // Files: rows appear at once with file names, tags and art fill in as they are read.
  const box = c.querySelector('[data-files]');
  const files = sortFiles(res.files);
  const tracks = await F.toTracks(root, files, { image: res.image, signal }).catch(() => []);
  const ordered = sortBy === 'track' ? sortFiles(tracks.map((t, i) => ({ ...files[i], trackNo: t.trackNo, discNo: t.discNo, _t: t }))).map(x => x._t) : tracks;
  if (signal.aborted) return;
  // Big flat folders: rows are added in chunks while scrolling (one click handler for the whole list).
  const stop = incremental(box, ordered, row, { chunk: 200, onChunk: hydrate });
  signal.addEventListener('abort', stop, { once: true });
  box.onclick = (e) => { const r = e.target.closest('.mrow'); if (r) player.play(ordered, { start: +r.dataset.i, source: { kind: 'browse', id: root.id + '/' + path, name: parts.at(-1) || root.name } }); };
}

function row(t, i) {
  return `<div class="mrow" role="row" data-id="${esc(t.id)}" data-i="${i}" tabindex="0">${artHtml(t.cover, t.album || t.title, { cls: 'xs', label: t.album || t.title })}
    <span class="mrow-main"><span class="mrow-t">${esc(t.title)}</span><span class="mrow-s">${esc(t.artist || t.fileName)}${t.album ? ' · ' + esc(t.album) : ''}</span></span>
    <span class="mrow-b">${t.tech ? badges(t.tech, { size: 'sm' }) : ''}</span><span class="mrow-d num">${fmtTime(t.duration)}</span></div>`;
}

const dirNode = (root, d) => `<section class="msec lbr-dir" data-path="${esc(d.path)}" data-open="0">
  <div class="msec-h"><button class="msec-t" aria-expanded="false"><span class="msec-chev">${icon('chev-down')}</span>${icon('folder')}<span class="msec-name">${esc(d.name)}</span></button>
  <a class="icon-btn sm" href="${href(root, d.path)}" aria-label="Mở ${esc(d.name)}">${icon('chev-right')}</a></div>
  <div class="msec-b" hidden></div></section>`;

function bindDirs(scope, root, signal) {
  scope.querySelectorAll(':scope .lbr-dir:not([data-bound])').forEach(d => {
    d.dataset.bound = '1';
    d.querySelector(':scope > .msec-h .msec-t').onclick = () => toggleDir(d, root, signal, d.dataset.open !== '1');
  });
}
async function toggleDir(d, root, signal, open) {
  const b = d.querySelector(':scope > .msec-b');
  d.dataset.open = open ? '1' : '0';
  d.querySelector(':scope > .msec-h .msec-t').setAttribute('aria-expanded', open);
  b.hidden = !open;
  if (!open || d.dataset.loaded) return;
  d.dataset.loaded = '1';
  b.innerHTML = '<p class="muted">Đang đọc…</p>';
  try {
    const r = await F.list(root, d.dataset.path);
    const files = sortFiles(r.files);
    b.innerHTML = r.dirs.sort(F.byName).map(x => dirNode(root, x)).join('') + '<div class="mlist" data-sub></div>';
    bindDirs(b, root, signal);
    const tracks = await F.toTracks(root, files, { image: r.image, signal });
    const box = b.querySelector('[data-sub]');
    if (tracks.length) signal.addEventListener('abort', incremental(box, tracks, row, { chunk: 200, onChunk: hydrate }), { once: true });
    else box.innerHTML = r.dirs.length ? '' : '<p class="muted">Không có tệp nhạc.</p>';
    box.onclick = (e) => { const x = e.target.closest('.mrow'); if (x) player.play(tracks, { start: +x.dataset.i, source: { kind: 'browse', name: d.dataset.path } }); };
  } catch (e) { b.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
