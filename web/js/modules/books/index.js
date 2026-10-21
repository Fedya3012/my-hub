// Books module pages (#books/...):
//   ''            Trang chủ: đang đọc, mục tiêu năm, chuỗi ngày, tiếp tục, mới thêm, kệ
//   library[/q]   Thư viện: lưới / danh sách, tìm kiếm nâng cao, lọc, sắp xếp, chọn nhiều + sửa hàng loạt
//   book/<id>     Trang sách: thông tin, trạng thái, đánh giá, nhận xét, phiên đọc, ghi chú, nhạc nền
//   read/<id>     Trình đọc (toàn màn hình)
//   shelves | shelf/<id> | authors | author/<id> | series | series/<id>
//   stats         Thống kê (khoảng thời gian tuỳ chọn, biểu đồ, heatmap, tổng kết năm)
//   goals         Mục tiêu, thử thách, huy hiệu
//   tools         Thêm sách, nhập/xuất (Goodreads, StoryGraph, CSV, JSON), metadata hàng loạt
import './lib/icons.js';
import { icon } from '../../core/icons.js';
import { esc } from '../../core/ui.js';
import { debounce } from '../../core/perf.js';
import { dropFiles } from '../../core/dnd.js';
import * as store from './lib/store.js';
import { definePrefs, get as pref } from './lib/prefs.js';

const TABS = [
  ['', 'b-home', 'Trang chủ'], ['library', 'library', 'Thư viện'], ['shelves', 'b-shelf', 'Kệ sách'],
  ['authors', 'b-author', 'Tác giả'], ['series', 'b-series', 'Bộ sách'], ['stats', 'b-chart', 'Thống kê'],
  ['goals', 'b-target', 'Mục tiêu'], ['tools', 'upload', 'Thêm & nhập'],
];
const PAGES = {
  '': () => import('./ui/home.js'), library: () => import('./ui/library.js'), book: () => import('./ui/detail.js'),
  shelves: () => import('./ui/shelves.js'), shelf: () => import('./ui/shelves.js'), authors: () => import('./ui/shelves.js'),
  author: () => import('./ui/shelves.js'), series: () => import('./ui/shelves.js'), stats: () => import('./ui/stats.js'),
  goals: () => import('./ui/stats.js'), tools: () => import('./ui/tools.js'),
};

let root, ctx, route = '', offs = [], pageOff = null, reader = null, readerCss = null;

export async function mount(el, context, sub = '') {
  root = el; ctx = context;
  definePrefs();
  if (!document.querySelector('link[href*="books/books.css"]')) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./books.css', import.meta.url).href }));
  await store.ensureRows();
  await store.ensureDefaultShelves();
  const soon = debounce(() => { if (root?.isConnected && !reader) render(); }, 150);
  offs.push(ctx.bus.on('books:changed', soon), ctx.bus.on('progress:pulled', soon));
  offs.push(dropFiles(el, { overlay: 'Thả tệp sách hoặc thư mục để thêm vào Sách', onFiles: async (files) => (await import('./ui/importer.js')).importFiles(files), when: () => !reader }));
  await navigate(sub);
}

export function unmount() {
  offs.forEach(f => f()); offs = [];
  pageOff?.(); pageOff = null;
  closeReader();
}

export async function navigate(sub) {
  route = sub || '';
  await render();
}

export async function migrate() { /* 0.1.0: first version */ }

export const go = (r) => { location.hash = 'books' + (r ? '/' + r : ''); };

async function render() {
  const [head, ...rest] = route.split('/');
  const arg = rest.join('/');
  if (head === 'read') return openReader(arg);
  closeReader();
  pageOff?.(); pageOff = null;
  const snap = await scoped();
  const tab = { book: 'library', shelf: 'shelves', author: 'authors' }[head] ?? head;
  const libs = snap.all.shelves.filter(s => s.kind === 'book-library');
  root.innerHTML = `<section class="page bk">
    <header class="bk-head">
      <div class="bk-head-t"><p class="eyebrow">${icon('book')} Sách</p>
        ${libs.length ? `<select class="bk-vlib" aria-label="Thư viện ảo"><option value="">Tất cả sách</option>${libs.map(l => `<option value="${l.id}" ${l.id === pref('library') ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}</div>
      <nav class="bk-tabs" aria-label="Mục của Sách">${TABS.map(([r, ic, l]) => `<a href="#books${r ? '/' + r : ''}" class="${tab === r ? 'on' : ''}" ${tab === r ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></a>`).join('')}</nav>
    </header>
    <div class="bk-page" id="bk-page"></div></section>`;
  root.querySelector('.bk-vlib')?.addEventListener('change', async (e) => { await (await import('./lib/prefs.js')).set('library', e.target.value); render(); });
  root.querySelector('.bk-tabs a.on')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  const page = await (PAGES[head] || PAGES[''])();
  const out = await page.render(root.querySelector('#bk-page'), { ctx, snap, head, arg, go, rerender: render });
  if (typeof out === 'function') pageOff = out;
}

// The snapshot narrowed to the active virtual library (a saved search that scopes every page).
export async function scoped() {
  const all = await store.snapshot();
  const libId = pref('library');
  const lib = libId && all.shelves.find(s => s.id === libId && s.kind === 'book-library');
  if (!lib) return { ...all, all };
  const { compile } = await import('./lib/query.js');
  const m = compile(lib.query, { shelves: all.shelves });
  const list = all.list.filter(m);
  return { ...all, list, byId: new Map(list.map(b => [b.id, b])), all, library: lib };
}

async function openReader(id) {
  if (reader?.id === id) return;
  closeReader();
  readerCss ||= document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./reader.css', import.meta.url).href }));
  const { openReader: open } = await import('./reader/reader.js');
  reader = { id, close: null };
  reader.close = await open(root, id, { ctx, onClose: () => { const back = history.length > 1 && reader?.fromApp; reader = null; if (back) history.back(); else go('book/' + id); } });
}
function closeReader() { if (!reader) return; const r = reader; reader = null; r.close?.(); }
