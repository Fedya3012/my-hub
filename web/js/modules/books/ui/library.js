// Books library: advanced search (lib/query.js), status chips, sort, grid / list, multi-select with
// bulk edit (status, rating, tags, shelves, series, online metadata, delete, export) and
// "save this search" as a smart shelf or a virtual library.
import { icon } from '../../../core/icons.js';
import { esc, h, modal, confirmBox, toast } from '../../../core/ui.js';
import { incremental, debounce, cmpVi } from '../../../core/perf.js';
import * as store from '../lib/store.js';
import { compile, QUERY_HELP } from '../lib/query.js';
import { get as pref, set as setPref } from '../lib/prefs.js';
import { cardHtml, rowHtml, hydrateCovers, statusOptions, sheet, download, menu } from './common.js';

const SORTS = {
  added: ['Mới thêm', (a, b) => (b.book.addedAt || 0) - (a.book.addedAt || 0)],
  opened: ['Đọc gần đây', (a, b) => (b.progress?.updatedAt || b.item.lastOpenedAt || 0) - (a.progress?.updatedAt || a.item.lastOpenedAt || 0)],
  title: ['Tên A–Z', (a, b) => cmpVi(a.title, b.title)],
  author: ['Tác giả', (a, b) => cmpVi(store.authorSort(a.authors[0] || '~'), store.authorSort(b.authors[0] || '~')) || cmpVi(a.title, b.title)],
  series: ['Bộ sách', (a, b) => cmpVi(a.series || '~', b.series || '~') || (a.seriesIndex ?? 0) - (b.seriesIndex ?? 0)],
  rating: ['Đánh giá', (a, b) => b.rating - a.rating],
  finished: ['Ngày đọc xong', (a, b) => (b.book.finishedAt || 0) - (a.book.finishedAt || 0)],
  pages: ['Số trang', (a, b) => (b.pages || 0) - (a.pages || 0)],
  progress: ['Tiến độ', (a, b) => b.percent - a.percent],
};
const CHIPS = [['', 'Tất cả'], ['reading', 'Đang đọc'], ['want', 'Muốn đọc'], ['finished', 'Đã đọc'], ['onhold', 'Tạm dừng'], ['dnf', 'Bỏ dở']];

let st = { q: '', status: '', select: false, sel: new Set() };

export async function render(el, { ctx, snap, arg, go }) {
  if (arg) st.q = decodeURIComponent(arg);
  const view = pref('libView'), sort = SORTS[pref('libSort')] ? pref('libSort') : 'added';
  el.innerHTML = `
    <div class="bk-toolbar">
      <div class="search">${icon('search')}<input id="bk-q" type="search" value="${esc(st.q)}" placeholder="Tìm: tên, tác giả… hoặc author: tag: rating:>=4 status:reading" autocomplete="off" aria-label="Tìm sách">
        <button class="icon-btn sm" data-help aria-label="Cú pháp tìm kiếm">?</button></div>
      <div class="bk-tools">
        <select id="bk-sort" aria-label="Sắp xếp">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="seg" role="group" aria-label="Kiểu hiển thị"><button data-view="grid" aria-pressed="${view === 'grid'}" aria-label="Lưới">${icon('grid')}</button><button data-view="list" aria-pressed="${view === 'list'}" aria-label="Danh sách">${icon('list')}</button></div>
        <button class="btn primary" data-add aria-label="Thêm sách">${icon('plus')}<span>Thêm</span></button>
        <button class="btn" data-sel aria-pressed="${st.select}">${icon('b-check-all')}<span>Chọn</span></button>
        <button class="icon-btn" data-more aria-label="Thêm">${icon('b-more')}</button>
      </div>
    </div>
    <div class="chips bk-chips" role="group" aria-label="Trạng thái">${CHIPS.map(([k, l]) => `<button class="chip${st.status === k ? ' on' : ''}" data-st="${k}" aria-pressed="${st.status === k}">${l}<span class="num">${k ? snap.list.filter(b => b.status === k).length : snap.list.length}</span></button>`).join('')}</div>
    <div class="bk-bulk" hidden></div>
    <p class="result-count" id="bk-count" aria-live="polite"></p>
    <div id="bk-results"></div>`;
  const $ = (s) => el.querySelector(s);
  let dispose = null, current = [];
  const draw = () => {
    let m;
    try { m = compile(st.q, { shelves: snap.all.shelves }); } catch { m = () => true; }
    current = snap.list.filter(b => (!st.status || b.status === st.status) && m(b)).sort(SORTS[pref('libSort')]?.[1] || SORTS.added[1]);
    $('#bk-count').textContent = `${current.length} cuốn`;
    const box = $('#bk-results');
    const v = pref('libView');
    box.className = v === 'list' ? 'bk-list' : 'bk-grid';
    dispose?.();
    if (!current.length) { box.innerHTML = `<div class="empty">${icon('search')}<p>Không có sách nào khớp.</p></div>`; return; }
    dispose = incremental(box, current, (b) => (v === 'list' ? rowHtml : cardHtml)(b, { select: st.select, selected: st.sel.has(b.id) }), {
      chunk: 60, onChunk: (part) => setTimeout(() => hydrateCovers(box, snap.byId)),
    });
    bulkBar();
  };
  const soon = debounce(draw, 140);
  $('#bk-q').oninput = (e) => { st.q = e.target.value; soon(); };
  $('#bk-sort').onchange = async (e) => { await setPref('libSort', e.target.value); draw(); };
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = async () => { await setPref('libView', b.dataset.view); el.querySelectorAll('[data-view]').forEach(x => x.setAttribute('aria-pressed', x === b)); draw(); });
  el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { st.status = b.dataset.st; el.querySelectorAll('[data-st]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); draw(); });
  $('[data-sel]').onclick = (e) => { st.select = !st.select; if (!st.select) st.sel.clear(); e.currentTarget.setAttribute('aria-pressed', st.select); draw(); };
  $('[data-help]').onclick = () => sheet('Cú pháp tìm kiếm', `<table class="bk-help">${QUERY_HELP.map(([q, d]) => `<tr><td><code>${esc(q)}</code></td><td>${esc(d)}</td></tr>`).join('')}</table><p class="muted">Kết hợp nhiều điều kiện bằng dấu cách (tất cả phải đúng). Không phân biệt dấu tiếng Việt.</p>`);
  $('[data-add]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Thêm tệp sách', icon: 'upload', run: async () => { const m = await import('./importer.js'); m.importFiles(await m.pickFiles()); } },
    { label: 'Thêm cả thư mục', icon: 'b-folder', run: async () => { const m = await import('./importer.js'); m.importFiles(await m.pickFiles({ folder: true })); } },
    { label: 'Sách giấy (ISBN / quét mã)', icon: 'b-scan', run: async () => (await import('./importer.js')).addPaperBook(ctx) },
  ]);
  $('[data-more]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Lưu tìm kiếm thành kệ thông minh', icon: 'b-sparkle', run: () => saveSearch(st.q, 'book-smart') },
    { label: 'Lưu thành thư viện ảo', icon: 'library', run: () => saveSearch(st.q, 'book-library') },
    '-',
    { label: 'Xuất kết quả ra CSV', icon: 'download', run: async () => { const { exportCsv } = await import('../lib/csv.js'); download('sach.csv', exportCsv(current, (id) => snap.all.shelves.find(s => s.id === id)?.name || id), 'text/csv'); } },
  ]);

  const box = $('#bk-results');
  // Long-press (touch) or right-click a book: quick actions menu.
  let lastMenu = 0, suppressClick = false, pressTimer = null, pressAt = null;
  const quickMenu = (card) => {
    if (Date.now() - lastMenu < 800) return;
    lastMenu = Date.now(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 700);
    const id = card.dataset.id, b = snap.byId.get(id);
    if (!b) return;
    const setSt = (status, label) => ({ label, icon: 'b-bookmark', run: async () => { await store.setStatus(id, status); toast(`Đã đổi trạng thái: ${label}`); } });
    menu(card, [
      { label: 'Mở trang sách', icon: 'book', run: () => go('book/' + id) },
      { label: 'Sửa thông tin', icon: 'b-edit', run: async () => (await import('./editor.js')).editBook(b, snap) },
      '-',
      setSt('want', 'Muốn đọc'), setSt('reading', 'Đang đọc'), setSt('finished', 'Đã đọc'),
      '-',
      { label: 'Chọn nhiều cuốn', icon: 'b-check-all', run: () => { st.select = true; st.sel.add(id); $('[data-sel]').setAttribute('aria-pressed', 'true'); draw(); } },
      { label: 'Xoá sách', icon: 'trash', danger: true, run: async () => { if (await confirmBox('Xoá sách này?', `“${b.title}”, tệp, ghi chú và tiến độ sẽ bị xoá khỏi mọi thiết bị đồng bộ.`, 'Xoá')) { await store.removeBooks([id]); toast('Đã xoá'); } } },
    ]);
  };
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  box.addEventListener('contextmenu', (e) => { const c = e.target.closest('[data-id]'); if (!c || st.select) return; e.preventDefault(); quickMenu(c); });
  box.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('[data-id]');
    if (!c || st.select || e.pointerType === 'mouse') return;
    pressAt = [e.clientX, e.clientY];
    pressTimer = setTimeout(() => quickMenu(c), 500);
  });
  box.addEventListener('pointermove', (e) => { if (pressTimer && pressAt && Math.hypot(e.clientX - pressAt[0], e.clientY - pressAt[1]) > 10) cancelPress(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => box.addEventListener(t, cancelPress));
  box.addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
    if (st.select || e.target.matches('.bk-check')) { toggle(card.dataset.id, card); return; }
    go('book/' + card.dataset.id);
  });
  box.addEventListener('keydown', (e) => { const c = e.target.closest('[data-id]'); if (c && e.key === 'Enter') go('book/' + c.dataset.id); });
  const toggle = (id, card) => {
    if (st.sel.has(id)) st.sel.delete(id); else st.sel.add(id);
    card.classList.toggle('sel', st.sel.has(id));
    const cb = card.querySelector('.bk-check'); if (cb) cb.checked = st.sel.has(id);
    bulkBar();
  };

  function bulkBar() {
    const bar = $('.bk-bulk');
    bar.hidden = !st.select;
    if (!st.select) return;
    const ids = [...st.sel];
    bar.innerHTML = `<b class="num">${ids.length}</b> đã chọn
      <button class="btn small" data-b="all">Chọn hết (${current.length})</button>
      <select data-b="status" ${ids.length ? '' : 'disabled'} aria-label="Đổi trạng thái"><option value="">Trạng thái…</option>${statusOptions('')}</select>
      <button class="btn small" data-b="edit" ${ids.length ? '' : 'disabled'}>${icon('b-edit')}Sửa hàng loạt</button>
      <button class="btn small" data-b="meta" ${ids.length ? '' : 'disabled'}>${icon('b-globe')}Lấy thông tin</button>
      <button class="btn small danger-ghost" data-b="del" ${ids.length ? '' : 'disabled'}>${icon('trash')}Xoá</button>`;
    bar.querySelector('[data-b="all"]').onclick = () => { if (st.sel.size === current.length) st.sel.clear(); else current.forEach(b => st.sel.add(b.id)); draw(); };
    bar.querySelector('[data-b="status"]').onchange = async (e) => { if (!e.target.value) return; for (const id of ids) await store.setStatus(id, e.target.value); toast(`Đã đổi trạng thái ${ids.length} cuốn`); };
    bar.querySelector('[data-b="edit"]').onclick = async () => (await import('./editor.js')).bulkEdit(ids, snap);
    bar.querySelector('[data-b="meta"]').onclick = async () => (await import('./importer.js')).fetchMetadata(ids, { onlyEmpty: true });
    bar.querySelector('[data-b="del"]').onclick = async () => {
      if (!(await confirmBox(`Xoá ${ids.length} cuốn?`, 'Sách, tệp sách trên máy này, ghi chú và tiến độ sẽ bị xoá khỏi mọi thiết bị đồng bộ.', 'Xoá'))) return;
      await store.removeBooks(ids); st.sel.clear(); toast('Đã xoá');
    };
  }
  draw();
  return () => dispose?.();
}

async function saveSearch(q, kind) {
  if (!q.trim()) { toast('Nhập điều kiện tìm kiếm trước', 'warn'); return; }
  const body = h(`<label>Tên<input id="ss-name" value="${esc(q.slice(0, 40))}"></label>`);
  const name = await modal({ title: kind === 'book-library' ? 'Lưu thư viện ảo' : 'Lưu kệ thông minh', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', kind: 'primary', value: (b) => b.querySelector('#ss-name').value.trim() }] });
  if (!name) return;
  await store.createShelf(name, kind, { query: q });
  toast(kind === 'book-library' ? 'Đã lưu. Chọn thư viện ảo ở đầu trang.' : 'Đã lưu kệ thông minh');
}
