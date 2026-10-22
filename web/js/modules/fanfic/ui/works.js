// Works list: search, status chips, filters (origin, fandom, rating, in Books) kept across restarts, sort,
// multi-select with a flat selection bar, long-press / right-click menu on each work.
import { icon } from '../../../core/icons.js';
import { esc, toast, confirmBox } from '../../../core/ui.js';
import { incremental, debounce, cmpVi } from '../../../core/perf.js';
import { onHold } from '../../../core/longpress.js';
import * as store from '../lib/store.js';
import { STATUSES, AUDIENCE, ORIGINS } from '../lib/vocab.js';
import { get as pref, set as setPref } from '../lib/prefs.js';
import { workRow, menu, sheet } from './common.js';

const SORTS = {
  edited: ['Sửa gần đây', (a, b) => b.editedAt - a.editedAt],
  created: ['Mới tạo', (a, b) => (b.fic.createdAt || 0) - (a.fic.createdAt || 0)],
  title: ['Tên A–Z', (a, b) => cmpVi(a.title, b.title)],
  words: ['Số từ', (a, b) => b.words - a.words],
  fandom: ['Fandom', (a, b) => cmpVi(a.fandoms[0]?.name || '~', b.fandoms[0]?.name || '~') || cmpVi(a.title, b.title)],
  progress: ['Tiến độ đọc', (a, b) => b.readPercent - a.readPercent],
};
const KEY = 'hub.fanfic.filters';   // filters survive tab switches and restarts (UX rule)
const load = () => { try { return { status: '', origin: '', fandom: '', audience: '', published: '', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { status: '', origin: '', fandom: '', audience: '', published: '' }; } };
const save = (f) => { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* storage unavailable */ } };
let st = { q: '', f: load(), select: false, sel: new Set() };

export async function render(el, { ctx, arg, go }) {
  const snap = await store.snapshot();
  if (arg) { const [k, v] = decodeURIComponent(arg).split(':'); if (k in st.f) { st.f = { ...load(), [k]: v }; save(st.f); } }
  const sort = SORTS[pref('worksSort')] ? pref('worksSort') : 'edited';
  const active = () => ['origin', 'fandom', 'audience', 'published'].filter(k => st.f[k]).length;
  el.innerHTML = `
    <div class="fx-toolbar">
      <label class="search">${icon('search')}<input id="fx-q" type="search" value="${esc(st.q)}" placeholder="Tìm tên, fandom, nhân vật, tag…" autocomplete="off" aria-label="Tìm tác phẩm"></label>
      <div class="fx-tools-row">
        <button class="fx-sort" data-sort aria-label="Sắp xếp">${esc(SORTS[sort][0])}${icon('fx-down')}</button>
        <span class="sp"></span>
        <button class="icon-btn${active() ? ' on' : ''}" data-filter aria-label="Bộ lọc">${icon('fx-filter')}${active() ? `<b class="fx-dot num">${active()}</b>` : ''}</button>
        <button class="icon-btn" data-new aria-label="Truyện mới">${icon('plus')}</button>
        <button class="icon-btn" data-sel aria-pressed="${st.select}" aria-label="Chọn nhiều">${icon('check')}</button>
      </div>
    </div>
    <div class="chips fx-chips" role="group" aria-label="Trạng thái">${[['', 'Tất cả'], ...Object.entries(STATUSES)].map(([k, l]) => `<button class="chip${st.f.status === k ? ' on' : ''}" data-st="${k}" aria-pressed="${st.f.status === k}">${l}<span class="num">${k ? snap.list.filter(v => v.status === k).length : snap.list.length}</span></button>`).join('')}</div>
    <div class="fx-selbar" hidden></div>
    <p class="result-count" id="fx-count" aria-live="polite"></p>
    <div id="fx-results" class="fx-works"></div>`;
  const $ = (s) => el.querySelector(s);
  let dispose = null, current = [];
  const match = (v, q) => !q || store.fold([v.title, v.fic.author, v.fic.summary, ...v.fandoms.map(f => f.name), ...v.characters.map(t => t.name), ...v.relationships.map(t => t.name), ...v.tags].join(' ')).includes(store.fold(q));
  const draw = () => {
    const f = st.f;
    current = snap.list.filter(v => (!f.status || v.status === f.status) && (!f.origin || v.origin === f.origin) && (!f.fandom || v.fic.fandomIds?.includes(f.fandom))
      && (!f.audience || v.audience === f.audience) && (!f.published || String(+v.published) === f.published) && match(v, st.q)).sort(SORTS[pref('worksSort')]?.[1] || SORTS.edited[1]);
    $('#fx-count').textContent = `${current.length} tác phẩm`;
    const box = $('#fx-results');
    dispose?.();
    if (!snap.list.length) { box.innerHTML = `<div class="empty">${icon('quill')}<p>Chưa có truyện nào. Bắt đầu một truyện mới, hoặc nhập tệp TXT / Markdown / HTML tải từ AO3.</p><button class="btn primary" data-new2>${icon('plus')}Truyện mới</button></div>`; box.querySelector('[data-new2]').onclick = newWork; return; }
    if (!current.length) { box.innerHTML = `<div class="empty">${icon('search')}<p>Không có tác phẩm nào khớp.</p></div>`; return; }
    dispose = incremental(box, current, (v) => workRow(v, { select: st.select, selected: st.sel.has(v.id) }), { chunk: 40 });
    selBar();
  };
  const newWork = async () => (await import('./edit.js')).editWork(null, { go });
  $('#fx-q').oninput = debounce((e) => { st.q = e.target.value; draw(); }, 140);
  $('[data-new]').onclick = newWork;
  $('[data-sort]').onclick = (e) => { const btn = e.currentTarget; menu(btn, Object.entries(SORTS).map(([k, [l]]) => ({ label: l, icon: k === pref('worksSort') ? 'check' : '', run: async () => { await setPref('worksSort', k); btn.firstChild.textContent = l; draw(); } }))); };
  $('[data-filter]').onclick = () => filterSheet(snap, () => { save(st.f); render(el, { ctx, go }); });
  el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { st.f.status = b.dataset.st; save(st.f); el.querySelectorAll('[data-st]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); draw(); });
  $('[data-sel]').onclick = (e) => { st.select = !st.select; if (!st.select) st.sel.clear(); e.currentTarget.setAttribute('aria-pressed', st.select); draw(); };

  const box = $('#fx-results');
  onHold(box, '[data-id]', (card, e) => quickMenu(card, e));
  box.addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    if (st.select) { toggle(card.dataset.id, card); return; }
    go('work/' + card.dataset.id);
  });
  box.addEventListener('keydown', (e) => { const c = e.target.closest('[data-id]'); if (c && e.key === 'Enter') go('work/' + c.dataset.id); });
  const toggle = (id, card) => {
    if (st.sel.has(id)) st.sel.delete(id); else st.sel.add(id);
    card.classList.toggle('sel', st.sel.has(id));
    const cb = card.querySelector('.fx-check'); if (cb) cb.checked = st.sel.has(id);
    selBar();
  };
  function quickMenu(card, e) {
    const id = card.dataset.id, v = snap.byId.get(id);
    if (!v) return;
    menu(card, [
      { label: 'Viết tiếp', icon: 'quill', run: () => go(`write/${id}`) },
      { label: 'Mở trang tác phẩm', icon: 'fx-works', run: () => go('work/' + id) },
      v.published ? { label: 'Đọc trong Sách', icon: 'book', run: () => ctx.go('books/read/' + id) } : null,
      { label: 'Sửa thông tin', icon: 'fx-edit', run: async () => (await import('./edit.js')).editWork(v, { go }) },
      '-',
      { label: v.published ? 'Cập nhật bản trong Sách' : 'Xuất bản sang Sách', icon: 'fx-publish', run: async () => { await store.publish(id); toast('Đã xuất bản sang Sách'); } },
      { label: 'Nhân bản', icon: 'fx-snapshot', run: async () => { const nid = await store.duplicateFanfic(id); toast('Đã nhân bản'); go('work/' + nid); } },
      { label: 'Chọn nhiều', icon: 'check', run: () => { st.select = true; st.sel.add(id); $('[data-sel]').setAttribute('aria-pressed', 'true'); draw(); } },
      '-',
      { label: 'Xoá truyện', icon: 'trash', danger: true, run: async () => { if (await confirmBox('Xoá truyện này?', `“${v.title}”, mọi chương, ghi chú và bản trong Sách sẽ bị xoá khỏi mọi thiết bị đồng bộ.`, 'Xoá')) { await store.removeFanfics([id]); toast('Đã xoá'); } } },
    ], e?.type === 'contextmenu' ? { x: e.clientX, y: e.clientY } : null);
  }
  function selBar() {
    const bar = $('.fx-selbar');
    bar.hidden = !st.select;
    if (!st.select) return;
    const ids = [...st.sel];
    bar.innerHTML = `<button class="icon-btn" data-b="x" aria-label="Thoát chọn">${icon('x')}</button><b class="num">${ids.length}</b><span>đã chọn</span>
      <span class="sp"></span>
      <button class="icon-btn" data-b="pub" ${ids.length ? '' : 'disabled'} aria-label="Xuất bản sang Sách">${icon('fx-publish')}</button>
      <button class="icon-btn" data-b="del" ${ids.length ? '' : 'disabled'} aria-label="Xoá">${icon('trash')}</button>
      <button class="icon-btn" data-b="more" aria-label="Thêm">${icon('fx-more')}</button>`;
    bar.querySelector('[data-b="x"]').onclick = () => { st.select = false; st.sel.clear(); $('[data-sel]').setAttribute('aria-pressed', 'false'); draw(); };
    bar.querySelector('[data-b="pub"]').onclick = async () => { for (const id of ids) await store.publish(id); toast(`Đã xuất bản ${ids.length} truyện sang Sách`); };
    bar.querySelector('[data-b="del"]').onclick = async () => { if (await confirmBox(`Xoá ${ids.length} truyện?`, 'Chương, ghi chú và bản trong Sách sẽ bị xoá khỏi mọi thiết bị đồng bộ.', 'Xoá')) { await store.removeFanfics(ids); st.sel.clear(); toast('Đã xoá'); } };
    bar.querySelector('[data-b="more"]').onclick = (e) => menu(e.currentTarget, [
      { label: st.sel.size === current.length ? 'Bỏ chọn hết' : `Chọn hết (${current.length})`, icon: 'check', run: () => { if (st.sel.size === current.length) st.sel.clear(); else current.forEach(v => st.sel.add(v.id)); draw(); } },
      ...Object.entries(STATUSES).map(([k, l]) => ({ label: 'Trạng thái: ' + l, icon: 'fx-works', disabled: !ids.length, run: async () => { for (const id of ids) await store.updateFanfic(id, { status: k }); toast('Đã đổi trạng thái'); } })),
      { label: 'Xuất Markdown (gộp)', icon: 'download', disabled: !ids.length, run: async () => (await import('../lib/io.js')).exportMany(ids, 'md') },
    ]);
  }
  draw();
  return () => dispose?.();
}

function filterSheet(snap, done) {
  const f = st.f;
  const opt = (k, entries) => entries.map(([v, l]) => `<button type="button" class="chip${f[k] === v ? ' on' : ''}" data-k="${k}" data-v="${esc(v)}">${esc(l)}</button>`).join('');
  const box = document.createElement('div');
  box.className = 'fx-filters';
  box.innerHTML = `
    <h3>Nguồn</h3><div class="chips">${opt('origin', [['', 'Tất cả'], ...Object.entries(ORIGINS)])}</div>
    <h3>Fandom</h3><div class="chips">${opt('fandom', [['', 'Tất cả'], ...snap.fandomList.filter(x => x.works.length).map(x => [x.id, `${x.name} (${x.works.length})`])])}</div>
    <h3>Xếp hạng</h3><div class="chips">${opt('audience', [['', 'Tất cả'], ...Object.entries(AUDIENCE).map(([k, a]) => [k, `${a.short} · ${a.label}`])])}</div>
    <h3>Trong Sách</h3><div class="chips">${opt('published', [['', 'Tất cả'], ['1', 'Đã xuất bản'], ['0', 'Chưa xuất bản']])}</div>
    <footer class="row-actions"><button class="btn" data-reset>Xoá bộ lọc</button></footer>`;
  const s = sheet('Bộ lọc', box, { onClose: done });
  box.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { f[b.dataset.k] = b.dataset.v; box.querySelectorAll(`[data-k="${b.dataset.k}"]`).forEach(x => x.classList.toggle('on', x === b)); });
  box.querySelector('[data-reset]').onclick = () => { Object.assign(f, { origin: '', fandom: '', audience: '', published: '' }); s.close(); };
}
