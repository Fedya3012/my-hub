// Library: the home screen. Shows every item from every module in one place,
// with search, filters, sort, quick stats and quick actions that hand off to modules.
import { db, uid, now, softDeleteItem, logActivity, linkItems, relatedItems } from '../../core/db.js';
import { CONTENT_TYPES, STATUS, detectType } from '../../core/content-types.js';
import { listModules } from '../../core/registry.js';
import { progress } from '../../core/progress.js';
import { thisDevice } from '../../core/device.js';
import { extensions } from '../../core/extensions.js';
import { tasks } from '../../core/tasks.js';
import { incremental, debounce, cmpVi } from '../../core/perf.js';
import { filesFromDrop } from '../../core/dnd.js';
import { icon } from '../../core/icons.js';
import { esc, h, modal, confirmBox, fmtBytes, fmtAgo, fmtDuration } from '../../core/ui.js';

const RELATIONS = {
  'adapted-from':  ['Chuyển thể từ', 'Được chuyển thể thành'],
  'soundtrack-of': ['Nhạc phim của', 'Có nhạc phim'],
  'discusses':     ['Bàn về', 'Được bàn trong'],
  'notes-on':      ['Ghi chú về', 'Có ghi chú'],
  'contains':      ['Chứa', 'Nằm trong'],
  'related':       ['Liên quan', 'Liên quan'],
};

const SORTS = {
  updated: ['Mới cập nhật', (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)],
  opened:  ['Mở gần đây', (a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0)],
  added:   ['Mới thêm', (a, b) => (b.createdAt || 0) - (a.createdAt || 0)],
  title:   ['Tên A–Z', (a, b) => cmpVi(a.title, b.title)],
  rating:  ['Đánh giá', (a, b) => (b.rating || 0) - (a.rating || 0)],
};

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

const PREF_KEY = 'hub.library.view';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ sort: p.sort, layout: p.layout })); } catch { /* storage unavailable */ }
}

let root, ctx, state, data, offs = [];

export async function mount(el, context) {
  root = el; ctx = context;
  state = { q: '', type: 'all', status: 'all', fav: false, tag: '', sort: 'updated', layout: 'grid', ...loadPrefs() };
  root.innerHTML = `
    <section class="page lib"><div class="fold-top">
      <header class="page-head">
        <div class="app-title"><p class="eyebrow">Trung tâm tổng hợp</p><h1>Thư viện</h1></div>
        <div class="head-actions">
          <label class="btn" title="Nhập tệp nhạc, sách, video, ảnh…">${icon('upload')}<span>Nhập tệp</span>
            <input type="file" id="lib-import" multiple hidden></label>
          <button class="btn" data-act="clean" title="Xoá các mục đã mất tệp gốc">${icon('refresh')}<span>Dọn dữ liệu Thư viện</span></button>
          <button class="btn primary" data-act="add">${icon('plus')}<span>Thêm mục</span></button>
        </div>
      </header>
      <div class="stats" id="lib-stats"></div>
      <section class="continue" id="lib-continue"></section></div>
      <div class="fold-bottom">
      <div class="toolbar">
        <div class="search">${icon('search')}<input id="lib-q" type="search" placeholder="Tìm tên, tác giả, thẻ…  ( / )" autocomplete="off" aria-label="Tìm kiếm"></div>
        <div class="chips" id="lib-types" role="group" aria-label="Loại nội dung"></div>
        <div class="filters">
          <select id="lib-status" aria-label="Trạng thái"><option value="all">Mọi trạng thái</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select id="lib-tag" aria-label="Thẻ"><option value="">Mọi thẻ</option></select>
          <button class="chip" id="lib-fav" aria-pressed="false">${icon('star')}Yêu thích</button>
          <select id="lib-sort" aria-label="Sắp xếp">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select>
          <div class="seg" role="group" aria-label="Kiểu hiển thị">
            <button data-layout="grid" aria-label="Lưới">${icon('grid')}</button><button data-layout="list" aria-label="Danh sách">${icon('list')}</button>
          </div>
        </div>
      </div>
      <p class="result-count" id="lib-count" aria-live="polite"></p>
      <div id="lib-results"></div></div>
      <aside class="drawer" id="lib-drawer" hidden aria-label="Chi tiết"></aside>
      <div class="dropzone" id="lib-drop" hidden><div>${icon('upload')}<p>Thả tệp để thêm vào Thư viện</p></div></div>
    </section>`;

  const $ = (s) => root.querySelector(s);
  const searchSoon = debounce(renderResults, 160);
  $('#lib-q').oninput = (e) => { state.q = e.target.value; searchSoon(); };
  $('#lib-status').onchange = (e) => { state.status = e.target.value; renderResults(); };
  $('#lib-tag').onchange = (e) => { state.tag = e.target.value; renderResults(); };
  $('#lib-sort').value = state.sort;
  $('#lib-sort').onchange = (e) => { state.sort = e.target.value; savePrefs(state); renderResults(); };
  $('#lib-fav').onclick = (e) => { state.fav = !state.fav; e.currentTarget.setAttribute('aria-pressed', state.fav); renderResults(); };
  root.querySelectorAll('[data-layout]').forEach(b => b.onclick = () => { state.layout = b.dataset.layout; savePrefs(state); renderResults(); });
  $('#lib-import').onchange = (e) => importFiles([...e.target.files]);
  root.querySelector('[data-act="add"]').onclick = addManual;
  root.querySelector('[data-act="clean"]').onclick = async () => (await import('../../core/storage/cleanup.js')).cleanDataAction('library', 'Thư viện');

  const onKey = (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#lib-q').focus(); }
    if (e.key === 'Escape') closeDrawer();
  };
  document.addEventListener('keydown', onKey);
  offs.push(() => document.removeEventListener('keydown', onKey));

  // Drag & drop import
  let depth = 0;
  const drop = $('#lib-drop');
  const dragOn = (e) => { if (e.dataTransfer?.types?.includes('Files')) { depth++; drop.hidden = false; } };
  const dragOff = () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } };
  const dropped = async (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); depth = 0; drop.hidden = true; importFiles(await filesFromDrop(e.dataTransfer)); };   // folders too
  const over = (e) => e.preventDefault();
  window.addEventListener('dragenter', dragOn); window.addEventListener('dragleave', dragOff);
  window.addEventListener('drop', dropped); window.addEventListener('dragover', over);
  offs.push(() => { window.removeEventListener('dragenter', dragOn); window.removeEventListener('dragleave', dragOff); window.removeEventListener('drop', dropped); window.removeEventListener('dragover', over); });

  const refreshSoon = debounce(refresh, 250);
  offs.push(() => refreshSoon.cancel());
  offs.push(ctx.bus.on('item:changed', refreshSoon));
  // Progress arriving from another device, or a pause here, refreshes "Tiếp tục".
  offs.push(ctx.bus.on('progress:pulled', refreshSoon));
  offs.push(ctx.bus.on('progress:changed', (p) => { if (p.state !== 'playing') refreshSoon(); }));
  await refresh();
}

export function unmount() { disposeList?.(); disposeList = null; offs.forEach(f => f()); offs = []; closeDrawer(); }

async function refresh() {
  const [items, files, modules, usage, prog, devices, me] = await Promise.all([
    db.items.toArray().then(r => r.filter(i => !i.deleted)),   // a Dexie .filter() cursor is ~5x slower than one getAll
    db.files.toArray(),
    listModules(),
    ctx.storage.adapters.local.usage(),
    db.progress.toArray(), db.devices.toArray(), thisDevice(),
  ]);
  const filesBy = new Map();
  for (const f of files) { if (!filesBy.has(f.itemId)) filesBy.set(f.itemId, []); filesBy.get(f.itemId).push(f); }
  const typeCount = new Map();
  for (const i of items) typeCount.set(i.type, (typeCount.get(i.type) || 0) + 1);
  keys = new WeakMap();
  data = { items, filesBy, modules, usage, me, typeCount,
    progress: new Map(prog.map(p => [p.itemId, p])), devices: new Map(devices.map(d => [d.id, d])) };
  renderStats(); renderContinue(); renderTypeChips(); renderTagOptions(); renderResults();
}

const pOf = (item) => data.progress.get(item.id);
function whereOf(p) {
  if (!p?.deviceId) return '';
  return p.deviceId === data.me.id ? 'máy này' : (data.devices.get(p.deviceId)?.name || 'thiết bị khác');
}

function moduleFor(item) {
  const m = data.modules.find(x => x.id === item.moduleId);
  if (!m) return { m: null, ready: false, reason: 'Chưa có module' };
  if (m.status === 'planned') return { m, ready: false, reason: `${m.name} sắp có` };
  if (!m.core && !m.state.enabled) return { m, ready: false, reason: `${m.name} đang tắt` };
  return { m, ready: true };
}

function renderStats() {
  const items = data.items;
  const inProg = items.filter(i => i.status === 'in-progress').length;
  const fav = items.filter(i => i.favorite).length;
  const week = items.filter(i => (i.createdAt || 0) > now() - 7 * 864e5).length;
  const counts = Object.keys(CONTENT_TYPES).map(t => [t, data.typeCount.get(t) || 0]).filter(([, n]) => n);
  const total = items.length || 1;
  const u = data.usage;
  root.querySelector('#lib-stats').innerHTML = `
    <div class="stat"><span class="stat-label">Tổng nội dung</span><strong class="num">${items.length}</strong><span class="stat-sub">+${week} trong 7 ngày</span></div>
    <div class="stat"><span class="stat-label">Đang dở</span><strong class="num">${inProg}</strong><span class="stat-sub">${items.filter(i => i.status === 'done').length} đã xong</span></div>
    <div class="stat"><span class="stat-label">Yêu thích</span><strong class="num">${fav}</strong><span class="stat-sub">${[...new Set(items.flatMap(i => i.tags || []))].length} thẻ</span></div>
    <div class="stat"><span class="stat-label">Dung lượng trên máy</span><strong class="num">${u ? fmtBytes(u.usage) : '—'}</strong><span class="stat-sub">${u ? 'còn trống ' + fmtBytes(u.quota - u.usage) : 'không đo được'}</span></div>
    <div class="stat stat-wide">
      <span class="stat-label">Theo loại</span>
      <div class="dist" role="img" aria-label="${counts.map(([t, n]) => `${CONTENT_TYPES[t].label} ${n}`).join(', ')}">
        ${counts.map(([t, n]) => `<span class="t-${t}" style="flex:${n}" title="${CONTENT_TYPES[t].label}: ${n}"></span>`).join('')}
      </div>
      <div class="legend">${counts.map(([t, n]) => `<button class="legend-item" data-type="${t}"><i class="dot t-${t}"></i>${CONTENT_TYPES[t].label} <b class="num">${n}</b><span class="pct">${Math.round(n / total * 100)}%</span></button>`).join('')}</div>
    </div>`;
  root.querySelectorAll('.legend-item').forEach(b => b.onclick = () => { state.type = b.dataset.type; renderTypeChips(); renderResults(); });
}

function renderContinue() {
  // Ordered by the last progress update from ANY device, so what you paused on Windows comes first on the phone.
  const list = data.items.filter(i => { const p = pOf(i); return p && p.state !== 'finished' && p.percent < 98; })
    .sort((a, b) => pOf(b).updatedAt - pOf(a).updatedAt).slice(0, 8);
  const el = root.querySelector('#lib-continue');
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<h2 class="section-title">${icon('clock')}Tiếp tục</h2>
    <div class="rail">${list.map(i => `
      <button class="cont" data-id="${i.id}">
        <span class="cover sm t-${i.type}">${icon(CONTENT_TYPES[i.type]?.icon)}</span>
        <span class="cont-body"><span class="cont-title">${esc(i.title)}</span>
        <span class="cont-sub">${esc(pOf(i).label)} · ${fmtAgo(pOf(i).updatedAt)}</span>
        <span class="cont-where">${icon(pOf(i).deviceId === data.me.id ? 'device' : 'cloud')}${esc(whereOf(pOf(i)))}</span>
        <span class="bar"><i style="width:${pOf(i).percent || 0}%"></i></span></span>
      </button>`).join('')}</div>`;
  el.querySelectorAll('.cont').forEach(b => b.onclick = () => openDrawer(b.dataset.id));
}

function renderTypeChips() {
  const el = root.querySelector('#lib-types');
  const types = Object.entries(CONTENT_TYPES).filter(([t]) => data.typeCount.has(t));
  el.innerHTML = [['all', { label: 'Tất cả' }], ...types].map(([t, d]) => {
    const n = t === 'all' ? data.items.length : data.typeCount.get(t);
    return `<button class="chip${state.type === t ? ' on' : ''}" aria-pressed="${state.type === t}" data-type="${t}">${t !== 'all' ? `<i class="dot t-${t}"></i>` : ''}${d.label}<span class="num">${n}</span></button>`;
  }).join('');
  el.querySelectorAll('.chip').forEach(b => b.onclick = () => { state.type = b.dataset.type; renderTypeChips(); renderResults(); });
}

function renderTagOptions() {
  const sel = root.querySelector('#lib-tag');
  const tags = [...new Set(data.items.flatMap(i => i.tags || []))].sort(cmpVi);
  sel.innerHTML = `<option value="">Mọi thẻ</option>` + tags.map(t => `<option ${t === state.tag ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

function storageBadges(item) {
  const fs = data.filesBy.get(item.id) || [];
  if (!fs.length) return '';
  const local = fs.some(f => f.locations?.local);
  return `<span class="loc" title="${local ? 'Có trên máy' : ''}">
    ${local ? icon('device') : ''}</span>`;
}

function filtered() {
  const q = fold(state.q.trim());
  return data.items.filter(i =>
    (state.type === 'all' || i.type === state.type) &&
    (state.status === 'all' || i.status === state.status) &&
    (!state.fav || i.favorite) &&
    (!state.tag || (i.tags || []).includes(state.tag)) &&
    (!q || keyOf(i).includes(q))
  ).sort(SORTS[state.sort][1]);
}

// Folded search text per item, built once per refresh instead of on every keystroke.
let keys = new WeakMap();
const keyOf = (i) => { let k = keys.get(i); if (k === undefined) keys.set(i, k = fold([i.title, i.subtitle, ...(i.tags || [])].join(' '))); return k; };

let disposeList = null;
function renderResults() {
  const list = filtered();
  root.querySelectorAll('[data-layout]').forEach(b => b.setAttribute('aria-pressed', b.dataset.layout === state.layout));
  root.querySelector('#lib-count').textContent = `${list.length} mục`;
  const el = root.querySelector('#lib-results');
  el.className = 'results ' + state.layout;
  if (!list.length) {
    el.innerHTML = `<div class="empty">${icon('search')}<p>Không có mục nào khớp bộ lọc.</p></div>`;
    return;
  }
  disposeList?.();
  disposeList = incremental(el, list, (i) => {
    const def = CONTENT_TYPES[i.type] || CONTENT_TYPES.note;
    const extra = i.meta?.duration ? fmtDuration(i.meta.duration) : i.meta?.pages ? `${i.meta.pages} trang` : '';
    return `<button class="card" data-id="${i.id}">
      <span class="cover t-${i.type}">${icon(def.icon)}<span class="initial">${esc(i.title.slice(0, 1))}</span></span>
      <span class="card-body">
        <span class="card-meta"><span class="type-tag">${def.label}</span>${extra ? `<span class="num">${extra}</span>` : ''}</span>
        <span class="card-title">${esc(i.title)}</span>
        <span class="card-sub">${esc(i.subtitle || '')}</span>
        ${pOf(i) && pOf(i).state !== 'finished' ? `<span class="bar"><i style="width:${pOf(i).percent || 0}%"></i></span>` : ''}
        <span class="card-foot">
          <span class="status s-${i.status}">${STATUS[i.status] || ''}</span>
          ${storageBadges(i)}${i.favorite ? `<span class="fav" title="Yêu thích">${icon('star')}</span>` : ''}
        </span>
      </span></button>`;
  }, { chunk: 90, onChunk: (box) => box.querySelectorAll('.card').forEach(b => b.onclick = () => openDrawer(b.dataset.id)) });
}

// ── Detail drawer ────────────────────────────────────────────────
let previewUrl = null, untrack = null;
function closeDrawer() {
  const d = root?.querySelector('#lib-drawer');
  if (d) d.hidden = true;
  if (untrack) { untrack(); untrack = null; }
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
}

async function openDrawer(id) {
  const item = await db.items.get(id);
  if (!item) return;
  const def = CONTENT_TYPES[item.type] || CONTENT_TYPES.note;
  const files = await db.files.where('itemId').equals(id).toArray();
  const related = await relatedItems(id);
  const acts = await db.activity.where('itemId').equals(id).reverse().sortBy('at');
  const owner = moduleFor(item);
  const prog = await progress.summary(id);
  if (untrack) { untrack(); untrack = null; }
  const d = root.querySelector('#lib-drawer');
  d.innerHTML = `
    <div class="drawer-inner">
      <header class="drawer-head">
        <span class="cover lg t-${item.type}">${icon(def.icon)}</span>
        <div class="drawer-title"><span class="type-tag">${def.label}</span><h2>${esc(item.title)}</h2><p>${esc(item.subtitle || '')}</p></div>
        <button class="icon-btn" data-act="close" aria-label="Đóng">${icon('x')}</button>
      </header>
      <div class="preview" id="lib-preview"></div>
      <div class="quick">
        <button class="btn primary" data-act="open" ${owner.ready ? '' : 'aria-disabled="true"'}>${icon('play')}${owner.ready ? `Mở bằng ${esc(owner.m.name)}` : esc(owner.reason)}</button>
        <button class="btn" data-act="fav" aria-pressed="${!!item.favorite}">${icon('star')}${item.favorite ? 'Bỏ yêu thích' : 'Yêu thích'}</button>
        <select id="lib-d-status" aria-label="Trạng thái">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === item.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn danger-ghost" data-act="delete">${icon('trash')}Xoá</button>
      </div>
      ${!owner.ready ? `<p class="hint">${!owner.m || owner.m.status === 'planned' ? 'Module mở loại nội dung này chưa được xây. Bạn vẫn quản lý, gắn thẻ và liên kết mục này ngay từ Thư viện.' : `<a href="#apps">Mở Quản lý ứng dụng</a> để bật module.`}</p>` : ''}
      <div id="lib-ext" class="lib-ext"></div>
      ${prog ? `<div class="block"><h3>Tiến độ · đồng bộ mọi thiết bị</h3><div class="bar lg"><i style="width:${prog.percent || 0}%"></i></div>
        <p class="resume">${prog.state === 'finished' ? 'Đã xong' : `Dừng ở <strong class="num">${esc(prog.label)}</strong>`} trên <strong>${esc(prog.where || 'thiết bị khác')}</strong> · ${esc(prog.ago)}</p>
        ${prog.state !== 'finished' && prog.where !== 'máy này' ? '<p class="hint">Mở trên máy này sẽ tiếp tục đúng chỗ đó.</p>' : ''}</div>` : ''}
      <div class="block"><h3>Thẻ</h3>
        <div class="tags">${(item.tags || []).map(t => `<span class="tag">${esc(t)}<button data-untag="${esc(t)}" aria-label="Bỏ thẻ ${esc(t)}">${icon('x')}</button></span>`).join('')}
        <form id="lib-tagform"><input id="lib-newtag" placeholder="Thêm thẻ" aria-label="Thêm thẻ"></form></div></div>
      <div class="block"><h3>Liên kết giữa các module <button class="btn small" data-act="link">${icon('link')}Liên kết</button></h3>
        ${related.length ? `<ul class="rel">${related.map(r => `<li><button data-goto="${r.item.id}">
          <span class="rel-kind">${esc(RELATIONS[r.link.relation]?.[r.dir === 'out' ? 0 : 1] || r.link.relation)}</span>
          <i class="dot t-${r.item.type}"></i><span class="rel-title">${esc(r.item.title)}</span><span class="type-tag">${CONTENT_TYPES[r.item.type]?.label}</span></button></li>`).join('')}</ul>`
          : '<p class="muted">Chưa liên kết với mục nào. Ví dụ: nối bài nhạc phim với bộ phim, cuốn sách với podcast bàn về nó.</p>'}</div>
      <div class="block"><h3>Tệp & nơi lưu</h3>
        ${files.length ? `<ul class="files">${files.map(f => `<li><span class="file-name">${esc(f.name)}</span><span class="num muted">${fmtBytes(f.size)}</span>
          <span class="locs">${f.locations?.local ? `<span class="pill">${icon('device')}Máy (${f.locations.local.kind})</span>` : ''}</span></li>`).join('')}</ul>`
          : '<p class="muted">Mục này chưa có tệp đính kèm.</p>'}</div>
      <div class="block"><h3>Hoạt động</h3>
        <ul class="activity">${acts.slice(0, 5).map(a => `<li><span>${{ open: 'Đã mở', play: 'Đã phát', finish: 'Đã xong', import: 'Đã nhập' }[a.action] || a.action}</span><span class="muted">${fmtAgo(a.at)}</span></li>`).join('') || '<li class="muted">Chưa có</li>'}
        <li><span>Thêm vào</span><span class="muted">${new Date(item.createdAt).toLocaleDateString((globalThis.__LOCALE || 'vi-VN'))}</span></li></ul></div>
    </div>`;
  d.hidden = false;
  d.querySelector('.drawer-inner').scrollTop = 0;

  // The Music module plays music itself (with its own block below), so no inline preview then.
  const main = files.find(f => f.role === 'main');
  if (main && !(owner.ready && item.moduleId === 'music')) showPreview(main, item);
  // Other modules add blocks here (e.g. Music: format info, linked background music).
  const ext = d.querySelector('#lib-ext');
  for (const fn of extensions('library.drawer')) {
    try { await fn({ item, el: ext, ctx, refresh: () => openDrawer(id) }); } catch (e) { console.error('[library.drawer]', e); }
  }

  d.querySelector('[data-act="close"]').onclick = closeDrawer;
  d.querySelector('[data-act="open"]').onclick = async () => {
    if (!owner.ready) {
      // Still announce the open so linked things (e.g. a soundtrack) can react; nobody routes it.
      ctx.toast(owner.reason, 'warn');
      ctx.bus.emit('item:open', { item, unhandled: true });
      return;
    }
    await logActivity(item.id, item.moduleId, 'open');
    ctx.bus.emit('item:open', { item });
  };
  d.querySelector('[data-act="fav"]').onclick = async () => { await db.items.update(id, { favorite: item.favorite ? 0 : 1 }); await refresh(); openDrawer(id); };
  d.querySelector('#lib-d-status').onchange = async (e) => { await db.items.update(id, { status: e.target.value }); await refresh(); };
  d.querySelector('[data-act="delete"]').onclick = async () => {
    if (!(await confirmBox('Xoá mục này?', `“${item.title}” sẽ bị xoá khỏi Thư viện trên mọi thiết bị đồng bộ.`, 'Xoá'))) return;
    for (const f of files) await ctx.storage.removeFile(f, { everywhere: false });
    await softDeleteItem(id); closeDrawer(); ctx.toast('Đã xoá'); refresh();
  };
  d.querySelector('#lib-tagform').onsubmit = async (e) => {
    e.preventDefault();
    const v = d.querySelector('#lib-newtag').value.trim();
    if (!v) return;
    await db.items.update(id, { tags: [...new Set([...(item.tags || []), v])] }); await refresh(); openDrawer(id);
  };
  d.querySelectorAll('[data-untag]').forEach(b => b.onclick = async () => {
    await db.items.update(id, { tags: (item.tags || []).filter(t => t !== b.dataset.untag) }); await refresh(); openDrawer(id);
  });
  d.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => openDrawer(b.dataset.goto));
  d.querySelector('[data-act="link"]').onclick = () => addLink(item);
}

async function showPreview(file, item) {
  const box = root.querySelector('#lib-preview');
  try {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = await ctx.storage.objectUrl(file);
    if (file.mime.startsWith('audio/')) box.innerHTML = `<audio controls preload="metadata" src="${previewUrl}"></audio>`;
    else if (file.mime.startsWith('video/')) box.innerHTML = `<video controls preload="metadata" src="${previewUrl}"></video>`;
    else if (file.mime.startsWith('image/')) box.innerHTML = `<img alt="${esc(file.name)}" src="${previewUrl}">`;
    else box.innerHTML = '';
    // Audio/video resume where you stopped on any device and keep saving as you play.
    const media = box.querySelector('audio,video');
    if (media) untrack = await progress.track(item, media);
  } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
}

async function addLink(item) {
  const others = data.items.filter(i => i.id !== item.id).sort((a, b) => cmpVi(a.title, b.title));
  const body = h(`<div class="stack">
    <label>Quan hệ<select id="link-rel">${Object.entries(RELATIONS).map(([k, [l]]) => `<option value="${k}">${esc(item.title)} · ${l}…</option>`).join('')}</select></label>
    <label>Mục liên kết<select id="link-to">${others.map(o => `<option value="${o.id}">${CONTENT_TYPES[o.type]?.label} · ${esc(o.title)}</option>`).join('')}</select></label></div>`);
  const r = await modal({ title: 'Liên kết với mục khác', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Liên kết', kind: 'primary', value: (b) => ({ rel: b.querySelector('#link-rel').value, to: b.querySelector('#link-to').value }) }] });
  if (!r) return;
  await linkItems(item.id, r.to, r.rel);
  ctx.toast('Đã liên kết');
  openDrawer(item.id);
}

// ── Adding content ───────────────────────────────────────────────
// Progress in the task tray: bytes over all files (reading + hashing + writing / uploading),
// "tên tệp (2/5)" as detail. Cancel stops the current file and skips the rest.
async function importFiles(files) {
  if (!files.length) return;
  ctx.storage.persistOnce().then(r => { if (r.asked) ctx.toast(r.granted ? 'Đã bật lưu trữ bền vững' : 'Trình duyệt chưa cho lưu trữ bền vững', r.granted ? 'info' : 'warn'); }).catch(() => {});
  let ok = 0, base = 0, cancelled = false;
  const total = files.reduce((s, f) => s + f.size, 0);
  const task = tasks.start({ label: `Đang thêm ${files.length} tệp vào Thư viện`, unit: 'bytes', total, cancellable: true, delay: total < 4e6 ? 400 : 0 });
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (task.cancelled) { cancelled = true; break; }
    task.update({ detail: `${file.name} (${i + 1}/${files.length})`, done: base });
    let item = null;
    try {
      const type = detectType(file);
      const item = {
        id: uid(), type, moduleId: CONTENT_TYPES[type].module,
        title: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '),
        subtitle: '', tags: [], status: 'new', favorite: 0, deleted: 0, rating: 0,
        createdAt: now(), meta: { originalName: file.name },
      };
      if (type === 'music' || type === 'video') item.meta.duration = await mediaDuration(file);
      await db.items.add(item);
      // addFile reports hashing + writing (each up to the file size): map that onto this file's share.
      await ctx.storage.addFile(item.id, file, { role: 'main', signal: task.signal,
        onProgress: ({ done, total: n }) => task.update({ done: base + (n ? done / n : 1) * file.size }) });
      await logActivity(item.id, item.moduleId, 'import');
      ok++;
    } catch (e) {
      if (item) await db.items.delete(item.id).catch(() => {});
      if (e?.name === 'AbortError' || task.cancelled) { cancelled = true; break; }
      ctx.toast(`${file.name}: ${e.message}`, 'error');
    }
    base += file.size;
    task.update({ done: base });
  }
  task.finish(`Đã thêm ${ok}/${files.length} tệp`);
  ctx.toast(cancelled ? `Đã huỷ · đã thêm ${ok} tệp vào Thư viện` : `Đã thêm ${ok} tệp vào Thư viện`, cancelled ? 'warn' : 'info');
  root.querySelector('#lib-import').value = '';
  refresh();
}

function mediaDuration(file) {
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith('video') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Math.round(el.duration) || null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    el.src = url;
  });
}

async function addManual() {
  const body = h(`<form class="stack" id="add-form">
    <label>Loại<select id="add-type">${Object.entries(CONTENT_TYPES).map(([k, d]) => `<option value="${k}">${d.label}</option>`).join('')}</select></label>
    <label>Tên<input id="add-title" required placeholder="Ví dụ: Rừng Na Uy"></label>
    <label>Tác giả / nghệ sĩ / kênh<input id="add-sub" placeholder="Haruki Murakami"></label>
    <label>Thẻ (cách nhau bằng dấu phẩy)<input id="add-tags" placeholder="tiểu thuyết, nhật bản"></label></form>`);
  const r = await modal({ title: 'Thêm mục', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Thêm', kind: 'primary', value: (b) => ({
    type: b.querySelector('#add-type').value, title: b.querySelector('#add-title').value.trim(),
    subtitle: b.querySelector('#add-sub').value.trim(), tags: b.querySelector('#add-tags').value.split(',').map(s => s.trim()).filter(Boolean) }) }] });
  if (!r || !r.title) return;
  const id = uid();
  await db.items.add({ id, ...r, moduleId: CONTENT_TYPES[r.type].module, status: 'new', favorite: 0, deleted: 0, rating: 0, createdAt: now(), meta: {} });
  ctx.toast('Đã thêm “' + r.title + '”');
  await refresh();
  openDrawer(id);
}
