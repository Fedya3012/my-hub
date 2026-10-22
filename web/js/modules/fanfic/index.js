// Xưởng Viết pages (#fanfic/...):
//   ''              Bàn viết: mục tiêu hôm nay, chuỗi ngày, viết tiếp, việc cần làm, tác phẩm đang viết
//   works           Tác phẩm: tìm, lọc (nguồn, trạng thái, fandom, xếp hạng; nhớ qua lần mở sau), sắp xếp, chọn nhiều
//   work/<id>       Trang tác phẩm: thông tin kiểu AO3, chương & cảnh (kéo thả), ghi chú, mục tiêu, xuất bản, nhạc
//   write/<id>[/<chapterId>]  Trình viết toàn màn hình (binder, Markdown, tập trung, phiên bản)
//   fandoms | fandom/<id>     Fandom: nguyên tác bên Sách, nhân vật, cặp đôi, tác phẩm
//   stats           Thống kê: số từ theo ngày, chuỗi ngày, thời gian viết, WPM, từ dùng nhiều
//   settings        Cài đặt: chữ, trang viết, hỗ trợ khi viết, âm thanh, mục tiêu, bút danh
//   tools           Thêm & nhập (TXT, Markdown, HTML/AO3), xuất (Markdown, TXT, HTML, EPUB)
import './lib/icons.js';
import { icon } from '../../core/icons.js';
import { debounce } from '../../core/perf.js';
import { dropFiles } from '../../core/dnd.js';
import { definePrefs } from './lib/prefs.js';

export const NAME = 'Xưởng Viết';
const TABS = [['', 'fx-desk', 'Bàn viết'], ['works', 'fx-works', 'Tác phẩm'], ['fandoms', 'fx-fandom', 'Fandom'], ['stats', 'fx-stats', 'Thống kê'], ['tools', 'upload', 'Thêm & nhập'], ['settings', 'settings', 'Cài đặt']];
const PAGES = {
  '': () => import('./ui/home.js'), works: () => import('./ui/works.js'), work: () => import('./ui/work.js'),
  stats: () => import('./ui/stats.js'), fandoms: () => import('./ui/fandoms.js'), fandom: () => import('./ui/fandoms.js'), tools: () => import('./ui/tools.js'), settings: () => import('./ui/settings.js'),
};

let root, ctx, route = '', offs = [], pageOff = null, writer = null;

export async function mount(el, context, sub = '') {
  root = el; ctx = context;
  definePrefs();
  document.body.classList.add('fx-has-bottom');
  if (!document.querySelector('link[href*="fanfic/fanfic.css"]')) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./fanfic.css', import.meta.url).href }));
  const soon = debounce(() => { if (root?.isConnected && !writer) render(); }, 150);
  offs.push(ctx.bus.on('fanfic:changed', soon), ctx.bus.on('sync:done', soon), ctx.bus.on('progress:pulled', soon));
  offs.push(dropFiles(el, { overlay: 'Thả tệp TXT, Markdown hoặc HTML (AO3) để thêm vào Xưởng Viết', onFiles: async (files) => (await import('./lib/io.js')).importFiles(files, ctx), when: () => !writer }));
  await navigate(sub);
}

export function unmount() {
  document.body.classList.remove('fx-has-bottom');
  offs.forEach(f => f()); offs = [];
  pageOff?.(); pageOff = null;
  closeWriter();
}

export async function navigate(sub) { route = sub || ''; await render(); }
export async function migrate() { /* 0.1.0: first version */ }
export const go = (r) => { location.hash = 'fanfic' + (r ? '/' + r : ''); };

async function render() {
  const [head, ...rest] = route.split('/');
  const arg = rest.join('/');
  if (head === 'write') return openWriter(rest[0], rest[1]);
  // A locked writing session (Cold Turkey style) keeps the writer open: go back to it instead of navigating away.
  if (writer?.locked?.()) { history.replaceState(null, '', `#fanfic/write/${writer.id}`); route = 'write/' + writer.id; writer.nudge?.(); return; }
  closeWriter();
  pageOff?.(); pageOff = null;
  const tab = { work: 'works', fandom: 'fandoms' }[head] ?? head;
  const nav = (cls) => TABS.map(([r, ic, l]) => `<a href="#fanfic${r ? '/' + r : ''}" class="${tab === r ? 'on' : ''}" ${tab === r ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></a>`).join('');
  root.innerHTML = `<section class="page fx">
    <header class="fx-head">
      <p class="eyebrow">${icon('quill')} ${NAME}</p>
      <nav class="fx-tabs" aria-label="Mục của ${NAME}">${nav()}</nav>
    </header>
    <div class="fx-page" id="fx-page"></div>
    <nav class="fx-bottom" aria-label="Mục chính của ${NAME}">${nav()}</nav></section>`;
  const page = await (PAGES[head] || PAGES[''])();
  const out = await page.render(root.querySelector('#fx-page'), { ctx, head, arg, go, rerender: render });
  if (typeof out === 'function') pageOff = out;
}

async function openWriter(id, chapterId) {
  if (!id) return go('works');
  if (writer && writer.id === id) { writer.show?.(chapterId); return; }
  closeWriter();
  const me = writer = { id };   // set before any await so a fast exit closes the stale writer
  const { openWriter: open } = await import('./ui/writer.js');
  const w = await open(root, id, chapterId, { ctx, onClose: () => { if (writer === me) writer = null; go('work/' + id); } });
  if (writer === me) Object.assign(me, w); else w?.close?.();
}
function closeWriter() { if (!writer) return; const w = writer; writer = null; w.close?.(); }
