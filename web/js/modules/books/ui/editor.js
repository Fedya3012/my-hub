// Metadata editing: one book (every field + custom columns), bulk edit (only the fields you tick),
// online lookup with candidate picker, cover change.
import { icon } from '../../../core/icons.js';
import { esc, h, toast, modal } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { FORMATS } from '../lib/formats.js';
import { lookup } from '../lib/online.js';
import { get as pref, set as setPref } from '../lib/prefs.js';
import { sheet, setCover, statusOptions } from './common.js';
import { candidatesHtml, applyCandidate } from './importer.js';

const list = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

export function editBook(b) {
  const cols = pref('customColumns') || [];
  const f = (name, label, value, attrs = '') => `<label>${label}<input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;
  const body = h(`<form class="bk-form">
    ${f('title', 'Tên sách', b.title, 'required')}
    ${f('authors', 'Tác giả (cách nhau bằng dấu phẩy)', b.authors.join(', '))}
    <div class="bk-form-2">${f('series', 'Bộ sách', b.series)}${f('seriesIndex', 'Tập số', b.seriesIndex ?? '', 'type="number" step="0.1" min="0"')}</div>
    <div class="bk-form-2">${f('isbn', 'ISBN', b.book.isbn)}${f('pages', 'Số trang', b.pages || '', 'type="number" min="0"')}</div>
    <div class="bk-form-2">${f('publisher', 'Nhà xuất bản', b.book.publisher)}${f('published', 'Năm / ngày xuất bản', b.book.published)}</div>
    <div class="bk-form-2">${f('language', 'Ngôn ngữ (vi, en…)', b.book.language)}
      <label>Định dạng<select name="format">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}" ${(b.book.physical ? 'paper' : b.format) === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label></div>
    ${f('tags', 'Thẻ', b.tags.join(', '))}${f('genres', 'Thể loại', (b.book.genres || []).join(', '))}
    <label>Giới thiệu<textarea name="description" rows="5">${esc(b.book.description || '')}</textarea></label>
    <div class="bk-form-2">${f('startedAt', 'Bắt đầu đọc', b.book.startedAt ? new Date(b.book.startedAt).toISOString().slice(0, 10) : '', 'type="date"')}${f('finishedAt', 'Đọc xong', b.book.finishedAt ? new Date(b.book.finishedAt).toISOString().slice(0, 10) : '', 'type="date"')}</div>
    <fieldset><legend>Cột tuỳ chỉnh</legend>
      ${cols.map(c => f('c:' + c.key, esc(c.label), b.book.custom?.[c.key] ?? '')).join('') || '<p class="muted">Chưa có cột nào.</p>'}
      <button type="button" class="btn small" data-addcol>${icon('plus')}Thêm cột (dùng cho mọi sách)</button></fieldset>
    <div class="row-actions"><button class="btn primary" type="submit">${icon('check')}Lưu</button></div></form>`);
  const s = sheet('Sửa thông tin sách', body, { wide: true });
  body.querySelector('[data-addcol]').onclick = async () => {
    const label = await modal({ title: 'Thêm cột', body: '<label>Tên cột (ví dụ: Người tặng, Vị trí trên kệ)<input id="bk-col"></label>', actions: [{ label: 'Huỷ', value: null }, { label: 'Thêm', kind: 'primary', value: (m) => m.querySelector('#bk-col').value.trim() }] });
    if (!label) return;
    const key = store.fold(label).replace(/[^a-z0-9]+/g, '_');
    await setPref('customColumns', [...cols.filter(c => c.key !== key), { key, label }]);
    s.close(); editBook(b);
  };
  body.onsubmit = async (e) => {
    e.preventDefault();
    const v = (n) => body.querySelector(`[name="${n}"]`).value.trim();
    const custom = { ...(b.book.custom || {}) };
    for (const c of cols) custom[c.key] = v('c:' + c.key);
    const fmt = v('format');
    await store.updateBook(b.id, {
      title: v('title') || b.title, authors: list(v('authors')), series: v('series'), seriesIndex: v('seriesIndex') === '' ? null : +v('seriesIndex'),
      isbn: v('isbn').replace(/[^0-9Xx]/g, ''), pages: +v('pages') || 0, publisher: v('publisher'), published: v('published'), language: v('language'),
      format: fmt === 'paper' ? '' : fmt, physical: fmt === 'paper' ? 1 : 0, tags: list(v('tags')), genres: list(v('genres')), description: body.querySelector('[name=description]').value,
      startedAt: v('startedAt') ? Date.parse(v('startedAt')) : b.book.startedAt, finishedAt: v('finishedAt') ? Date.parse(v('finishedAt')) : b.book.finishedAt, custom,
    });
    s.close(); toast('Đã lưu');
  };
}

// Bulk edit: tick a field to change it on every selected book.
export function bulkEdit(ids, snap) {
  const shelves = snap.all.shelves.filter(x => x.kind === 'book-shelf');
  const row = (k, label, input) => `<div class="bk-bulk-row"><label class="check"><input type="checkbox" data-on="${k}"> ${label}</label>${input}</div>`;
  const body = h(`<form class="bk-form">
    <p class="muted">Áp dụng cho ${ids.length} cuốn. Chỉ các mục được tick mới thay đổi.</p>
    ${row('authors', 'Tác giả', '<input name="authors">')}
    ${row('series', 'Bộ sách', '<input name="series"> <label class="check"><input type="checkbox" name="autoIndex"> Đánh số tập theo thứ tự chọn</label>')}
    ${row('status', 'Trạng thái', `<select name="status">${statusOptions('want')}</select>`)}
    ${row('rating', 'Đánh giá', '<input type="number" name="rating" min="0" max="5" step="0.5">')}
    ${row('language', 'Ngôn ngữ', '<input name="language">')}
    ${row('publisher', 'Nhà xuất bản', '<input name="publisher">')}
    ${row('addTags', 'Thêm thẻ', '<input name="addTags" placeholder="thẻ 1, thẻ 2">')}
    ${row('removeTags', 'Bỏ thẻ', '<input name="removeTags">')}
    ${row('genres', 'Thể loại (thay thế)', '<input name="genres">')}
    ${row('shelf', 'Thêm vào kệ', `<select name="shelf">${shelves.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>`)}
    ${row('physical', 'Sách giấy', '<select name="physical"><option value="1">Có</option><option value="0">Không</option></select>')}
    <div class="row-actions"><button class="btn primary" type="submit">${icon('check')}Áp dụng</button></div></form>`);
  const s = sheet(`Sửa ${ids.length} cuốn`, body, { wide: true });
  body.querySelectorAll('.bk-bulk-row input:not([data-on]), .bk-bulk-row select').forEach(i => i.addEventListener('input', () => { i.closest('.bk-bulk-row').querySelector('[data-on]').checked = true; }));
  body.onsubmit = async (e) => {
    e.preventDefault();
    const on = (k) => body.querySelector(`[data-on="${k}"]`).checked;
    const v = (n) => body.querySelector(`[name="${n}"]`).value.trim();
    const patch = {};
    if (on('authors')) patch.authors = list(v('authors'));
    if (on('series')) patch.series = v('series');
    if (on('status')) patch.status = v('status');
    if (on('rating')) patch.rating = Math.max(0, Math.min(5, Math.round(+v('rating') * 2) / 2));
    if (on('language')) patch.language = v('language');
    if (on('publisher')) patch.publisher = v('publisher');
    if (on('genres')) patch.genres = list(v('genres'));
    if (on('physical')) patch.physical = +v('physical');
    s.close();
    await store.bulkUpdate(ids, patch, { addTags: on('addTags') ? list(v('addTags')) : [], removeTags: on('removeTags') ? list(v('removeTags')) : [], addShelves: on('shelf') ? [v('shelf')] : [] });
    if (on('series') && body.querySelector('[name=autoIndex]').checked) for (let i = 0; i < ids.length; i++) await store.updateBook(ids[i], { seriesIndex: i + 1 });
    toast(`Đã sửa ${ids.length} cuốn`);
  };
}

// Search Open Library + Google Books and apply the chosen result to this book.
export async function onlineSheet(b) {
  const body = h(`<div class="stack"><div class="bk-isbn-row"><input name="q" value="${esc(b.book.isbn || b.title)}" aria-label="ISBN hoặc tên sách"><input name="a" value="${esc(b.authors[0] || '')}" placeholder="Tác giả" aria-label="Tác giả"><button class="btn" data-find>${icon('search')}Tìm</button></div>
    <label class="check"><input type="checkbox" name="only" checked> Chỉ điền các ô còn trống</label><div class="bk-cands"></div></div>`);
  const s = sheet('Tìm thông tin trên mạng', body, { wide: true });
  const box = body.querySelector('.bk-cands');
  const find = async () => {
    const q = body.querySelector('[name=q]').value.trim();
    const isbn = /^[\d\-Xx ]{10,17}$/.test(q) ? q : '';
    box.innerHTML = '<p class="muted">Đang tìm…</p>';
    try {
      const list = await lookup({ isbn, title: isbn ? '' : q, author: body.querySelector('[name=a]').value.trim() });
      box.innerHTML = candidatesHtml(list);
      box.querySelectorAll('[data-i]').forEach(x => x.onclick = async () => { await applyCandidate(b.id, b, list[+x.dataset.i], { onlyEmpty: body.querySelector('[name=only]').checked }); s.close(); toast('Đã cập nhật thông tin'); });
    } catch (e) { box.innerHTML = `<p class="hint">Không tìm được: ${esc(e.message)}</p>`; }
  };
  body.querySelector('[data-find]').onclick = find;
  find();
}

export function pickCover(b) {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; await setCover(b.id, f); store.changed([b.id]); toast('Đã đổi bìa'); };
  inp.click();
}
