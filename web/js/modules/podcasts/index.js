// Podcast pages (#podcasts/...):
//   ''               Trang chủ: tìm kiếm, chip thể loại, Nghe tiếp (thẻ lớn), Tập mới, Top tuần này, Khám phá tập
//   discover[/<q>]   Khám phá: tìm online (Podcast Index + iTunes), lịch sử tìm, gợi ý, bảng xếp hạng, thịnh hành, thể loại, RSS riêng
//   preview/<feed>   Trang podcast chưa đăng ký (từ kết quả tìm kiếm)
//   show/<id>        Trang podcast: thông tin, đăng ký, cài đặt riêng (tốc độ, bỏ intro/outro, tự tải), danh sách tập
//   episode/<id>     Trang tập: ghi chú, chương, dấu trang, bản chép lời
//   play             Đang phát: bìa lớn, chép lời / chương / dấu trang, waveform, tốc độ, hẹn giờ ngủ, Voice Boost
//   queue            Hàng chờ (kéo thả)
//   inbox            Tập mới từ podcast đã đăng ký
//   subs             Đăng ký: lưới / danh sách, OPML
//   lists[/<id>]     Danh sách: bộ lọc thông minh, danh sách tự tạo, đã tải, dấu trang, thống kê
//   settings         Cài đặt: phát, tải về, tìm kiếm online, nhập tệp
import './lib/icons.js';
import { icon } from '../../core/icons.js';
import { debounce } from '../../core/perf.js';
import { dropFiles } from '../../core/dnd.js';
import { definePrefs, NAME } from './lib/prefs.js';

export { NAME };
const TABS = [['', 'pc-home', 'Trang chủ'], ['discover', 'pc-discover', 'Khám phá'], ['queue', 'pc-queue', 'Hàng chờ'], ['subs', 'pc-subs', 'Đăng ký'], ['lists', 'pc-filter', 'Danh sách'], ['settings', 'settings', 'Cài đặt']];
const PAGES = {
  '': () => import('./ui/home.js'), discover: () => import('./ui/discover.js'), preview: () => import('./ui/show.js'), show: () => import('./ui/show.js'),
  episode: () => import('./ui/episode.js'), play: () => import('./ui/nowplaying.js'), queue: () => import('./ui/queue.js'), inbox: () => import('./ui/queue.js'),
  subs: () => import('./ui/subs.js'), lists: () => import('./ui/lists.js'), settings: () => import('./ui/settings.js'),
};
const TAB_OF = { preview: 'discover', show: 'subs', episode: '', play: '', inbox: '' };

let root, ctx, route = '', offs = [], pageOff = null;

export async function mount(el, context, sub = '') {
  root = el; ctx = context;
  definePrefs();
  document.body.classList.add('pc-has-bottom');
  if (!document.querySelector('link[href*="podcasts/podcasts.css"]')) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./podcasts.css', import.meta.url).href }));
  const soon = debounce(() => { if (root?.isConnected && !['play', 'discover', 'settings'].includes(route.split('/')[0])) render(); }, 200);
  offs.push(ctx.bus.on('podcasts:changed', soon), ctx.bus.on('podcasts:queue', soon), ctx.bus.on('sync:done', soon), ctx.bus.on('progress:pulled', soon));
  offs.push(dropFiles(el, { overlay: 'Thả tệp âm thanh (MP3, M4A, M4B…) hoặc tệp OPML để thêm vào Podcast', onFiles: async (files) => (await import('./ui/settings.js')).importAny(files, ctx) }));
  await navigate(sub);
}

export function unmount() {
  document.body.classList.remove('pc-has-bottom', 'pc-np-open');
  offs.forEach(f => f()); offs = [];
  pageOff?.(); pageOff = null;
}

export async function navigate(sub) { route = sub || ''; await render(); }
export async function migrate() { /* 0.1.0: first version */ }
export const go = (r) => { location.hash = 'podcasts' + (r ? '/' + r : ''); };

async function render() {
  const [head, ...rest] = route.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  pageOff?.(); pageOff = null;
  const tab = TAB_OF[head] ?? head;
  const nav = () => TABS.map(([r, ic, l]) => `<a href="#podcasts${r ? '/' + r : ''}" class="${tab === r ? 'on' : ''}" ${tab === r ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></a>`).join('');
  const full = head === 'play';
  document.body.classList.toggle('pc-np-open', full);
  root.innerHTML = `<section class="page pc ${full ? 'pc-full' : ''}">
    ${full ? '' : `<header class="pc-head"><p class="eyebrow">${icon('podcast')} ${NAME}</p><nav class="pc-tabs" aria-label="Mục của ${NAME}">${nav()}</nav></header>`}
    <div class="pc-page" id="pc-page"></div>
    ${full ? '' : `<nav class="pc-bottom" aria-label="Mục chính của ${NAME}">${nav()}</nav>`}</section>`;
  const page = await (PAGES[head] || PAGES[''])();
  const out = await page.render(root.querySelector('#pc-page'), { ctx, head, arg, go, rerender: render });
  if (typeof out === 'function') pageOff = out;
}
