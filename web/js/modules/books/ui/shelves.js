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
  el.innerHTML = `<div class="bk-sec-head"><h2>Bộ sách <span class="num muted">${list.length}</span></h2><button class="btn small" data-new>${icon('plus')}Tạo bộ mới</button></div>
    <div class="bk-shelves">${list.map(s => {
      const done = s.books.filter(b => b.status === 'finished').length;
      return `<a class="bk-shelf-card" href="#books/series/${esc(s.id)}"><div class="bk-shelf-covers">${s.books.slice(0, 4).map(b => coverHtml(b, 'xs')).join('')}</div>
        <div class="bk-shelf-b"><b>${esc(s.name)}</b><small>${(() => { const v = s.books.filter(b => b.kind === 'volume').length, c = s.books.filter(b => b.kind === 'chapter').length; return [v && v + ' Volume', c && c + ' chương', s.books.length - v - c && (s.books.length - v - c) + ' cuốn'].filter(Boolean).join(' · '); })()} · đã đọc ${done}</small><span class="bar"><i style="width:${done / s.books.length * 100}%"></i></span></div></a>`;
    }).join('') || '<p class="muted">Chưa có bộ sách. Đặt “Bộ sách” và “Tập số” trong Sửa thông tin, hoặc sửa hàng loạt ở Thư viện.</p>'}</div>`;
  hydrateCovers(el, snap.all.byId);
  el.querySelector('[data-new]').onclick = async () => {
    const body = h(`<label>Tên bộ sách / series<input id="sn" placeholder="Ví dụ: One Piece"></label>`);
    const name = await modal({ title: 'Tạo bộ sách mới', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Tạo và tải tệp lên', kind: 'primary', value: (f) => f.querySelector('#sn').value.trim() }] });
    if (name) { await addFiles({ name }); const sid = store.seriesId(name); location.hash = '#books/series/' + sid; }
  };
}

// "Chương 2" before "Chương 10", then the volume / chapter number set on the book.
const natural = (a, b) => (a.seriesIndex ?? 1e9) - (b.seriesIndex ?? 1e9) || natNum(a.title, b.title);
function natNum(a, b) {
  const x = a.match(/\d+/g)?.map(Number) || [], y = b.match(/\d+/g)?.map(Number) || [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return a.localeCompare(b, 'vi');
}

// A series page. A long series (manga, light novel) made of volumes and chapters gets a reading layout:
// continue button, Volumes grid (each with its chapters) and one Chapters list in reading order.
async function seriesPage(el, { snap, arg, go, ctx }) {
  const s = snap.all.seriesList.find(x => x.id === arg);
  if (!s) { el.innerHTML = '<p class="muted">Không tìm thấy bộ sách.</p>'; return; }
  const by = snap.all.byId;
  const vols = s.books.filter(b => b.kind === 'volume').sort(natural);
  const loose = s.books.filter(b => b.kind === 'chapter' && !(b.partOf && vols.some(v => v.id === b.partOf))).sort(natural);
  const whole = s.books.filter(b => b.kind === 'book').sort(natural);
  // Reading order: each volume's chapters, then chapters not in a volume yet. A volume without
  // chapter books (one file) counts as one entry.
  const chapters = [];
  for (const v of vols) { const ps = (v.parts || []).map(id => by.get(id)).filter(Boolean); if (ps.length) ps.forEach(c => chapters.push({ c, v })); else chapters.push({ c: v, v }); }
  loose.forEach(c => chapters.push({ c, v: null }));
  const manga = vols.length || loose.length;
  const order = manga ? chapters.map(x => x.c) : whole;
  const done = order.filter(b => b.status === 'finished').length;
  const next = order.find(b => b.status !== 'finished' && (b.main || b.parts));
  const readBtn = next ? `<button class="btn primary" data-read="${next.id}">${icon('play')}${next.percent > 0 ? 'Đọc tiếp' : 'Đọc'}: ${esc(next.title)}</button>` : '';
  const tab = sessionStorage.getItem('hub.books.seriesTab') || (vols.length ? 'vol' : 'ch');
  const chRow = ({ c, v }, i) => `<li data-id="${c.id}" class="${c.status === 'finished' ? 'done' : ''}"><span class="num muted">${i + 1}</span>
      <span class="bk-row-main"><b>${esc(c.title)}</b><small>${v && v !== c ? esc(v.title) + ' · ' : ''}${esc(store.STATUSES[c.status])}${c.percent > 0 && c.percent < 100 ? ` · ${c.percent}%` : ''}</small></span>
      ${c.main || c.parts ? `<button class="icon-btn sm" data-read="${c.id}" aria-label="Đọc">${icon('play')}</button>` : ''}</li>`;
  el.innerHTML = `<div class="bk-sec-head"><h2>${icon('b-series')} ${esc(s.name)}</h2>
      <button class="btn small" data-add>${icon('plus')}Thêm vào bộ</button><button class="btn small" data-ren>${icon('b-edit')}Đổi tên</button></div>
    <div class="bk-ser-hero">
      ${coverHtml(vols[0] || order[0] || s.books[0], 'md')}
      <div><p class="bk-ser-stats">${[vols.length && `<b>${vols.length}</b> Volume`, chapters.length && manga && `<b>${chapters.length}</b> chương`, whole.length && `<b>${whole.length}</b> sách hoàn chỉnh`].filter(Boolean).join(' · ')}</p>
        <div class="bar"><i style="width:${order.length ? done / order.length * 100 : 0}%"></i></div>
        <p class="muted">Đã đọc ${done}/${order.length}${next ? '' : order.length ? ' · đã đọc trọn bộ' : ''}</p>
        <div class="row-actions">${readBtn}</div></div>
    </div>
    ${manga ? `<div class="seg bk-ser-tabs" role="tablist"><button data-tab="vol" aria-pressed="${tab === 'vol'}">Volume (${vols.length})</button><button data-tab="ch" aria-pressed="${tab === 'ch'}">Chương (${chapters.length})</button>${whole.length ? `<button data-tab="bk" aria-pressed="${tab === 'bk'}">Sách (${whole.length})</button>` : ''}</div>
      <div data-pane="vol" ${tab === 'vol' ? '' : 'hidden'}>${vols.length ? `<div class="bk-ser-vols">${vols.map(v => {
          const ps = (v.parts || []).map(id => by.get(id)).filter(Boolean), d = ps.filter(c => c.status === 'finished').length;
          return `<article class="bk-ser-vol" data-id="${v.id}">${coverHtml(v, 'sm')}<div><b>${esc(v.title)}</b><small class="muted">${v.seriesIndex != null ? 'Vol ' + v.seriesIndex + ' · ' : ''}${ps.length ? `${ps.length} chương · đọc ${d}` : esc(store.STATUSES[v.status])}</small>
            <div class="bar"><i style="width:${ps.length ? d / ps.length * 100 : v.percent}%"></i></div>
            <div class="row-actions">${v.main || v.parts ? `<button class="btn small" data-read="${v.id}">${icon('play')}Đọc</button>` : ''}${ps.length ? `<button class="btn small" data-toggle>Chương</button>` : ''}</div>
            ${ps.length ? `<ol class="bk-ser-chs" hidden>${ps.map(c => `<li data-id="${c.id}" class="${c.status === 'finished' ? 'done' : ''}">${esc(c.title)}</li>`).join('')}</ol>` : ''}</div></article>`;
        }).join('')}</div>` : '<p class="muted">Chưa có Volume. Chọn các chương lẻ rồi bấm “Thêm vào bộ → Gộp chương lẻ thành Volume”.</p>'}</div>
      <div data-pane="ch" ${tab === 'ch' ? '' : 'hidden'}><ol class="bk-ser-chlist">${chapters.map(chRow).join('')}</ol></div>
      <div data-pane="bk" ${tab === 'bk' ? '' : 'hidden'}><ol class="bk-series-list">${whole.map(b => `<li data-id="${b.id}">${coverHtml(b, 'sm')}<span class="num bk-vol">${b.seriesIndex ?? '?'}</span><span class="bk-row-main"><b>${esc(b.title)}</b><small>${esc(store.STATUSES[b.status])}</small></span></li>`).join('')}</ol></div>`
    : `<ol class="bk-series-list">${s.books.map(b => `<li data-id="${b.id}">${coverHtml(b, 'sm')}<span class="num bk-vol">${b.seriesIndex ?? '?'}</span><span class="bk-row-main"><b>${esc(b.title)}</b><small>${esc(store.KINDS[b.kind] || '')} · ${esc(store.STATUSES[b.status])}${b.rating ? ` · ${b.rating}★` : ''}</small></span></li>`).join('')}</ol>`}`;
  hydrateCovers(el, by);
  const read = async (id) => (await import('./home.js')).openBook(ctx, by.get(id));
  el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-read]'); if (r) { e.stopPropagation(); read(r.dataset.read); return; }
    const t = e.target.closest('[data-toggle]'); if (t) { const ol = t.closest('.bk-ser-vol').querySelector('.bk-ser-chs'); ol.hidden = !ol.hidden; return; }
    const tb = e.target.closest('[data-tab]'); if (tb) { sessionStorage.setItem('hub.books.seriesTab', tb.dataset.tab); el.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-pressed', x === tb)); el.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== tb.dataset.tab); return; }
    const li = e.target.closest('[data-id]'); if (li && !e.target.closest('button')) go('book/' + li.dataset.id);
  });
  el.querySelector('[data-ren]').onclick = async () => {
    const body = h(`<label>Tên bộ<input id="sn" value="${esc(s.name)}"></label>`);
    const name = await modal({ title: 'Đổi tên bộ sách', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', kind: 'primary', value: (f) => f.querySelector('#sn').value.trim() }] });
    if (name) await store.updateSeries(s.id, { name });
  };
  el.querySelector('[data-add]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Tải tệp lên (chương / Volume / sách)', icon: 'upload', run: () => addFiles(s) },
    { label: 'Thêm sách có sẵn trong Thư viện', icon: 'plus', run: () => addExisting(s, snap) },
    loose.length > 1 ? { label: `Gộp ${loose.length} chương lẻ thành Volume`, icon: 'book', run: async () => { const v = await (await import('./volume.js')).groupVolume(loose.map(c => c.id), snap.all); if (v) await store.updateBook(v, { series: s.name, kind: 'volume' }); } } : null,
  ].filter(Boolean));
}

async function askKind(n) {
  const body = h(`<div class="stack"><p>${n} tệp này là:</p>${Object.entries(store.KINDS).map(([k, l], i) => `<label class="check"><input type="radio" name="k" value="${k}" ${i === 1 ? '' : ''}${k === 'chapter' ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`);
  return modal({ title: 'Loại tệp', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Tiếp', kind: 'primary', value: (f) => f.querySelector('input:checked')?.value }] });
}
async function addFiles(s) {
  const imp = await import('./importer.js');
  const files = await imp.pickFiles();
  if (!files.length) return;
  const kind = await askKind(files.length);
  if (!kind) return;
  const ids = await imp.importFiles(files);
  const fresh = await store.snapshot();
  const list = ids.map(id => fresh.byId.get(id)).filter(Boolean).sort((a, b) => natNum(a.title, b.title));
  for (const b of list) await store.updateBook(b.id, { series: s.name, kind, seriesIndex: +(b.title.match(/\d+(?:\.\d+)?(?!.*\d)/)?.[0]) || null });
  toast(`Đã thêm ${list.length} ${store.KINDS[kind].toLowerCase()} vào “${s.name}”`);
}
async function addExisting(s, snap) {
  const pool = snap.all.list.filter(b => b.book.seriesId !== s.id).sort((a, b) => natNum(a.title, b.title));
  const body = h(`<div class="bk-volx"><input data-q placeholder="Lọc theo tên…"><ul class="bk-volx-pick">${pool.map(b => `<li><label><input type="checkbox" value="${esc(b.id)}"> ${esc(b.title)} <span class="muted">${esc(store.KINDS[b.kind])}</span></label></li>`).join('')}</ul></div>`);
  body.querySelector('[data-q]').oninput = (e) => { const q = store.fold(e.target.value); body.querySelectorAll('li').forEach(li => { li.hidden = q && !store.fold(li.textContent).includes(q); }); };
  const ids = await modal({ title: `Thêm vào “${s.name}”`, body, actions: [{ label: 'Huỷ', value: null }, { label: 'Thêm', kind: 'primary', value: (f) => [...f.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value) }] });
  for (const id of ids || []) await store.updateBook(id, { series: s.name });
  if (ids?.length) toast(`Đã thêm ${ids.length} vào “${s.name}”`);
}
