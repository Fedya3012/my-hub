// Volumes: chapter books uploaded one file per chapter, joined into one book (book.parts, in order).
// The editor reorders (drag or ↑↓), renames, adds and removes chapters, sorts by name and ungroups.
import { icon } from '../../../core/icons.js';
import { esc, h, modal, confirmBox, toast } from '../../../core/ui.js';
import { cmpVi } from '../../../core/perf.js';
import * as store from '../lib/store.js';

// "Chương 2" before "Chương 10": natural order on the numbers in the title.
const natural = (a, b) => {
  const x = a.title.match(/\d+/g)?.map(Number) || [], y = b.title.match(/\d+/g)?.map(Number) || [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return cmpVi(a.title, b.title);
};

// Shared title of the chapters ("Truyện A - Chương 1", "Truyện A - Chương 2" → "Truyện A").
function guessTitle(list) {
  let p = list[0]?.title || '';
  for (const b of list) while (p && !b.title.startsWith(p)) p = p.slice(0, -1);
  p = p.replace(/[\s\-–—_:.,(#]*(chương|chuong|chapter|chap|ch|phần|phan|tập|tap|volume|vol|v)?\s*\d*\s*$/i, '').trim();
  return p.length >= 3 ? p : (list[0]?.series || 'Volume mới');
}

// The editor: returns { title, parts } or null.
async function editor({ title, parts, snap, heading, ok }) {
  let order = parts.map(id => snap.byId.get(id)).filter(Boolean);
  const body = h(`<div class="bk-volx">
    <label>Tên Volume<input data-v="title" value="${esc(title)}"></label>
    <div class="bk-volx-tools">
      <button class="btn small" data-v="sort">Xếp theo số chương</button>
      <button class="btn small" data-v="rev">Đảo thứ tự</button>
      <button class="btn small" data-v="add">${icon('plus')}Thêm chương từ Thư viện</button>
      <button class="btn small" data-v="up">${icon('upload')}Tải tệp chương lên</button>
    </div>
    <ol class="bk-volx-list"></ol>
    <p class="hint">Kéo thả hoặc dùng ↑ ↓ để đổi thứ tự. Chương trong Volume được ẩn khỏi Thư viện (vẫn tìm được bằng ô tìm kiếm).</p>
  </div>`);
  const list = body.querySelector('.bk-volx-list');
  const draw = () => {
    list.innerHTML = order.map((b, i) => `<li draggable="true" data-i="${i}">
      <span class="num muted">${i + 1}</span><input class="bk-volx-t" data-rn="${i}" value="${esc(b.title)}" aria-label="Tên chương ${i + 1}">
      <button class="icon-btn sm" data-up="${i}" aria-label="Lên" ${i ? '' : 'disabled'}>↑</button>
      <button class="icon-btn sm" data-dn="${i}" aria-label="Xuống" ${i < order.length - 1 ? '' : 'disabled'}>↓</button>
      <button class="icon-btn sm" data-rm="${i}" aria-label="Bỏ khỏi Volume">${icon('x')}</button></li>`).join('') || '<li class="muted">Chưa có chương nào.</li>';
  };
  const move = (i, j) => { if (j < 0 || j >= order.length) return; const [x] = order.splice(i, 1); order.splice(j, 0, x); draw(); };
  list.onclick = (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.up) move(+t.dataset.up, +t.dataset.up - 1);
    else if (t.dataset.dn) move(+t.dataset.dn, +t.dataset.dn + 1);
    else if (t.dataset.rm) { order.splice(+t.dataset.rm, 1); draw(); }
  };
  // Rename a chapter in place (window.prompt does not exist in the Windows app).
  list.addEventListener('change', async (e) => {
    const i = e.target.dataset?.rn; if (i == null) return;
    const b = order[+i], name = e.target.value.trim();
    if (name && name !== b.title) { await store.updateBook(b.id, { title: name }); order[+i] = { ...b, title: name }; }
  });
  let from = -1;
  list.addEventListener('dragstart', (e) => { from = +e.target.closest('li')?.dataset.i; });
  list.addEventListener('dragover', (e) => e.preventDefault());
  list.addEventListener('drop', (e) => { e.preventDefault(); const to = +e.target.closest('li')?.dataset.i; if (from >= 0 && to >= 0) move(from, to); from = -1; });
  body.querySelector('[data-v="sort"]').onclick = () => { order.sort(natural); draw(); };
  body.querySelector('[data-v="rev"]').onclick = () => { order.reverse(); draw(); };
  body.querySelector('[data-v="add"]').onclick = async () => {
    const have = new Set(order.map(b => b.id));
    const pool = snap.list.filter(b => !have.has(b.id) && !b.parts && !b.fanfic && b.main && !b.main.virtual).sort(natural);
    if (!pool.length) { toast('Không còn sách nào để thêm', 'warn'); return; }
    const pb = h(`<div class="bk-volx"><input data-q placeholder="Lọc theo tên…"><ul class="bk-volx-pick">${pool.map(b => `<li><label><input type="checkbox" value="${esc(b.id)}"> ${esc(b.title)}${b.partOf ? ' <span class="muted">(đang ở Volume khác)</span>' : ''}</label></li>`).join('')}</ul></div>`);
    pb.querySelector('[data-q]').oninput = (e) => { const q = store.fold(e.target.value); pb.querySelectorAll('li').forEach(li => { li.hidden = q && !store.fold(li.textContent).includes(q); }); };
    const ids = await modal({ title: 'Thêm chương vào Volume', body: pb, actions: [{ label: 'Huỷ', value: null }, { label: 'Thêm', kind: 'primary', value: (el) => [...el.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value) }] });
    if (ids?.length) { order.push(...ids.map(id => snap.byId.get(id))); draw(); }
  };
  // New chapter files straight into this volume: imported as books (hidden in the Library once grouped).
  body.querySelector('[data-v="up"]').onclick = async () => {
    const imp = await import('./importer.js');
    const files = await imp.pickFiles();
    if (!files.length) return;
    const ids = await imp.importFiles(files);
    const fresh = await store.snapshot();
    const have = new Set(order.map(b => b.id));
    const add = ids.map(id => fresh.byId.get(id)).filter(b => b && !have.has(b.id)).sort(natural);
    order.push(...add); draw();
  };
  draw();
  const r = await modal({ title: heading, body, actions: [{ label: 'Huỷ', value: null }, { label: ok, kind: 'primary', value: (el) => ({ title: el.querySelector('[data-v="title"]').value.trim() || 'Volume', parts: order.map(b => b.id) }) }] });
  if (r && r.parts.length < 1) { toast('Volume cần ít nhất 1 chương', 'warn'); return null; }
  return r;
}

// From the library's multi-select.
export async function groupVolume(ids, snap) {
  const list = ids.map(id => snap.byId.get(id)).filter(b => b && !b.parts && !b.fanfic).sort(natural);
  if (list.length < 2) { toast('Chọn ít nhất 2 chương (sách có tệp) để gộp', 'warn'); return null; }
  const r = await editor({ title: guessTitle(list), parts: list.map(b => b.id), snap, heading: 'Gộp thành 1 Volume', ok: 'Gộp' });
  if (!r) return null;
  const first = list[0];
  const id = await store.createVolume(r.title, r.parts, { authors: first.authors, series: first.series });
  toast(`Đã gộp ${r.parts.length} chương thành “${r.title}”`);
  return id;
}

export async function editVolume(b, snap) {
  const r = await editor({ title: b.title, parts: b.parts || [], snap, heading: 'Quản lý Volume', ok: 'Lưu' });
  if (!r) return;
  if (r.title !== b.title) await store.updateBook(b.id, { title: r.title });
  await store.setVolumeParts(b.id, r.parts);
  toast('Đã lưu Volume');
}

export async function ungroup(b) {
  if (!(await confirmBox('Tách Volume?', `“${b.title}” sẽ bị bỏ, ${b.parts.length} chương trở lại Thư viện như sách riêng. Tệp chương không bị xoá.`, 'Tách'))) return false;
  await store.ungroupVolume(b.id);
  toast('Đã tách Volume');
  return true;
}

// A single book gets more chapters: it becomes the first chapter of a new volume with the same title,
// and the editor opens so chapters can be uploaded or picked.
export async function addChapters(b, snap) {
  if (b.parts) return editVolume(b, snap);
  if (b.partOf) { const v = snap.byId.get(b.partOf); if (v) return editVolume(v, snap); }
  const r = await editor({ title: b.title, parts: [b.id], snap, heading: 'Thêm chương', ok: 'Lưu thành Volume' });
  if (!r) return null;
  const id = await store.createVolume(r.title, r.parts, { authors: b.authors, series: b.series });
  toast(`Đã tạo Volume “${r.title}” với ${r.parts.length} chương`);
  return id;
}
