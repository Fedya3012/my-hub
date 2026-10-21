// Shelves (hand-picked), smart shelves (saved searches), virtual libraries; authors; series.
// Pages: shelves, shelf/<id>, authors, author/<id>, series, series/<id>.
import { icon } from '../../../core/icons.js';
import { esc, h, modal, confirmBox, toast } from '../../../core/ui.js';
import { incremental } from '../../../core/perf.js';
import * as store from '../lib/store.js';
import { compile } from '../lib/query.js';
import { cardHtml, hydrateCovers, coverHtml, menu } from './common.js';

const KINDS = { 'book-shelf': ['Kệ thường', 'b-shelf'], 'book-smart': ['Kệ thông minh', 'b-sparkle'], 'book-library': ['Thư viện ảo', 'library'] };

export async function render(el, args) {
  const { head } = args;
  if (head === 'shelves') return shelvesPage(el, args);
  if (head === 'shelf') return shelfPage(el, args);
  if (head === 'authors') return authorsPage(el, args);
  if (head === 'author') return authorPage(el, args);
  if (head === 'series') return args.arg ? seriesPage(el, args) : seriesList(el, args);
}

const membersOf = (s, snap) => s.kind === 'book-shelf' ? snap.list.filter(b => (b.book.shelfIds || []).includes(s.id)) : snap.list.filter(compile(s.query, { shelves: snap.all.shelves }));

function grid(el, list, snap, go) {
  const box = el.querySelector('.bk-grid');
  if (!list.length) { box.outerHTML = '<p class="muted">Chưa có sách.</p>'; return () => {}; }
  const off = incremental(box, list, (b) => cardHtml(b), { chunk: 60, onChunk: () => setTimeout(() => hydrateCovers(box, snap.all.byId)) });
  box.addEventListener('click', (e) => { const c = e.target.closest('[data-id]'); if (c) go('book/' + c.dataset.id); });
  return off;
}

async function shelvesPage(el, { snap }) {
  const shelves = snap.all.shelves;
  el.innerHTML = `<div class="bk-sec-head"><h2>Kệ sách</h2><div class="row-actions">
      <button class="btn" data-new="book-shelf">${icon('plus')}Kệ mới</button><button class="btn" data-new="book-smart">${icon('b-sparkle')}Kệ thông minh</button><button class="btn" data-new="book-library">${icon('library')}Thư viện ảo</button></div></div>
    <p class="muted">Kệ thường: tự chọn sách. Kệ thông minh: tự cập nhật theo điều kiện tìm kiếm (ví dụ <code>tag:manga status:want</code>). Thư viện ảo: chọn ở đầu trang để mọi mục chỉ hiện sách khớp điều kiện.</p>
    <div class="bk-shelves">${shelves.map(s => {
      const m = membersOf(s, snap);
      return `<article class="bk-shelf-card" data-shelf="${s.id}"><div class="bk-shelf-covers">${m.slice(0, 4).map(b => coverHtml(b, 'xs')).join('') || `<span class="muted">${icon(KINDS[s.kind]?.[1] || 'b-shelf')}</span>`}</div>
        <div class="bk-shelf-b"><b>${esc(s.name)}</b><small>${KINDS[s.kind]?.[0] || ''} · ${m.length} cuốn${s.query ? ` · <code>${esc(s.query)}</code>` : ''}</small></div>
        <button class="icon-btn sm" data-menu="${s.id}" aria-label="Tuỳ chọn">${icon('b-more')}</button></article>`;
    }).join('')}</div>`;
  hydrateCovers(el, snap.all.byId);
  el.querySelectorAll('[data-new]').forEach(b => b.onclick = () => edit(null, b.dataset.new));
  el.querySelectorAll('[data-shelf]').forEach(c => c.addEventListener('click', (e) => { if (!e.target.closest('[data-menu]')) location.hash = 'books/shelf/' + c.dataset.shelf; }));
  el.querySelectorAll('[data-menu]').forEach(b => b.onclick = () => {
    const s = shelves.find(x => x.id === b.dataset.menu);
    menu(b, [{ label: 'Sửa', icon: 'b-edit', run: () => edit(s, s.kind) }, { label: 'Xoá kệ', icon: 'trash', danger: true, run: async () => { if (await confirmBox('Xoá kệ?', `Kệ “${s.name}” sẽ bị xoá (sách vẫn còn).`, 'Xoá')) store.deleteShelf(s.id); } }]);
  });
}

async function edit(s, kind) {
  const smart = kind !== 'book-shelf';
  const body = h(`<form class="stack"><label>Tên<input name="name" value="${esc(s?.name || '')}" required></label>
    ${smart ? `<label>Điều kiện tìm kiếm<input name="query" value="${esc(s?.query || '')}" placeholder="author:tolkien rating:>=4"></label>` : ''}</form>`);
  const r = await modal({ title: s ? 'Sửa kệ' : `${KINDS[kind][0]} mới`, body, actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', kind: 'primary', value: (f) => ({ name: f.querySelector('[name=name]').value.trim(), query: f.querySelector('[name=query]')?.value.trim() || '' }) }] });
  if (!r?.name) return;
  if (s) await store.updateShelf(s.id, r); else await store.createShelf(r.name, kind, { query: r.query });
  toast('Đã lưu');
}

async function shelfPage(el, { snap, arg, go }) {
  const s = snap.all.shelves.find(x => x.id === arg);
  if (!s) { el.innerHTML = '<p class="muted">Không tìm thấy kệ.</p>'; return; }
  const list = membersOf(s, snap);
  el.innerHTML = `<div class="bk-sec-head"><h2>${icon(KINDS[s.kind]?.[1] || 'b-shelf')} ${esc(s.name)} <span class="num muted">${list.length}</span></h2>
    ${s.query ? `<a class="btn small" href="#books/library/${encodeURIComponent(s.query)}">${icon('search')}Mở trong Thư viện</a>` : ''}</div><div class="bk-grid"></div>`;
  return grid(el, list, snap, go);
}

async function authorsPage(el, { snap }) {
  const ids = new Set(snap.list.flatMap(b => b.book.authorIds || []));
  const list = snap.all.authorsList.filter(a => ids.has(a.id));
  el.innerHTML = `<div class="bk-sec-head"><h2>Tác giả <span class="num muted">${list.length}</span></h2></div>
    <div class="bk-people">${list.map(a => `<a class="bk-person" href="#books/author/${esc(a.id)}"><span class="bk-avatar">${esc(a.name.slice(0, 1))}</span>
      <span><b>${esc(a.name)}</b><small>${a.books.length} cuốn · ${a.books.filter(b => b.status === 'finished').length} đã đọc</small></span></a>`).join('') || '<p class="muted">Chưa có tác giả.</p>'}</div>`;
}

async function authorPage(el, { snap, arg, go }) {
  const a = snap.all.authorsList.find(x => x.id === arg);
  if (!a) { el.innerHTML = '<p class="muted">Không tìm thấy tác giả.</p>'; return; }
  const list = a.books.filter(b => snap.byId.has(b.id));
  const rated = list.filter(b => b.rating);
  el.innerHTML = `<div class="bk-sec-head"><h2>${icon('b-author')} ${esc(a.name)}</h2><button class="btn small" data-ren>${icon('b-edit')}Sửa tên / ghi chú</button></div>
    <p class="muted">${list.length} cuốn · ${list.filter(b => b.status === 'finished').length} đã đọc${rated.length ? ` · trung bình ${(rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(2)} sao` : ''}</p>
    ${a.bio ? `<p class="bk-desc">${esc(a.bio)}</p>` : ''}<div class="bk-grid"></div>`;
  el.querySelector('[data-ren]').onclick = async () => {
    const body = h(`<form class="stack"><label>Tên<input name="n" value="${esc(a.name)}"></label><label>Ghi chú / tiểu sử<textarea name="bio" rows="4">${esc(a.bio || '')}</textarea></label></form>`);
    const r = await modal({ title: 'Tác giả', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', kind: 'primary', value: (f) => ({ name: f.querySelector('[name=n]').value.trim(), bio: f.querySelector('[name=bio]').value }) }] });
    if (r?.name) await store.updateAuthor(a.id, r);
  };
  return grid(el, list, snap, go);
}

async function seriesList(el, { snap }) {
  const ids = new Set(snap.list.map(b => b.book.seriesId).filter(Boolean));
  const list = snap.all.seriesList.filter(s => ids.has(s.id));
  el.innerHTML = `<div class="bk-sec-head"><h2>Bộ sách <span class="num muted">${list.length}</span></h2></div>
    <div class="bk-shelves">${list.map(s => {
      const done = s.books.filter(b => b.status === 'finished').length;
      return `<a class="bk-shelf-card" href="#books/series/${esc(s.id)}"><div class="bk-shelf-covers">${s.books.slice(0, 4).map(b => coverHtml(b, 'xs')).join('')}</div>
        <div class="bk-shelf-b"><b>${esc(s.name)}</b><small>${s.books.length} tập · đã đọc ${done}</small><span class="bar"><i style="width:${done / s.books.length * 100}%"></i></span></div></a>`;
    }).join('') || '<p class="muted">Chưa có bộ sách. Đặt “Bộ sách” và “Tập số” trong Sửa thông tin, hoặc sửa hàng loạt ở Thư viện.</p>'}</div>`;
  hydrateCovers(el, snap.all.byId);
}

async function seriesPage(el, { snap, arg, go }) {
  const s = snap.all.seriesList.find(x => x.id === arg);
  if (!s) { el.innerHTML = '<p class="muted">Không tìm thấy bộ sách.</p>'; return; }
  const next = s.books.find(b => b.status !== 'finished');
  el.innerHTML = `<div class="bk-sec-head"><h2>${icon('b-series')} ${esc(s.name)}</h2><button class="btn small" data-ren>${icon('b-edit')}Đổi tên</button></div>
    <p class="muted">${s.books.length} tập · đã đọc ${s.books.filter(b => b.status === 'finished').length}${next ? ` · tiếp theo: <a href="#books/book/${next.id}">${esc(next.title)}</a>` : ' · đã đọc trọn bộ'}</p>
    <ol class="bk-series-list">${s.books.map(b => `<li data-id="${b.id}">${coverHtml(b, 'sm')}<span class="num bk-vol">${b.seriesIndex ?? '?'}</span><span class="bk-row-main"><b>${esc(b.title)}</b><small>${esc(store.STATUSES[b.status])}${b.rating ? ` · ${b.rating}★` : ''}</small></span></li>`).join('')}</ol>`;
  hydrateCovers(el, snap.all.byId);
  el.querySelectorAll('[data-id]').forEach(li => li.onclick = () => go('book/' + li.dataset.id));
  el.querySelector('[data-ren]').onclick = async () => {
    const body = h(`<label>Tên bộ<input id="sn" value="${esc(s.name)}"></label>`);
    const name = await modal({ title: 'Đổi tên bộ sách', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', kind: 'primary', value: (f) => f.querySelector('#sn').value.trim() }] });
    if (name) await store.updateSeries(s.id, { name });
  };
}
