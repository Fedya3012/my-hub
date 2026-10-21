// Trending books: what readers are picking up now (Open Library trending lists, free, CORS-enabled).
// Tap a book to add it to "Muốn đọc". Books already in the library are marked.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import * as store from '../lib/store.js';

const PERIODS = [['daily', 'Hôm nay'], ['weekly', 'Tuần này'], ['monthly', 'Tháng này'], ['yearly', 'Năm nay']];
const OL = 'https://openlibrary.org/trending';
const cache = new Map();

async function fetchTrending(period, signal) {
  if (cache.has(period)) return cache.get(period);
  const r = await fetch(`${OL}/${period}.json?limit=30`, { signal });
  if (!r.ok) throw new Error(`openlibrary: ${r.status}`);
  const j = await r.json();
  const list = (j.works || []).map(w => ({
    title: w.title || '',
    authors: (w.author_name || []).slice(0, 3),
    year: w.first_publish_year || '',
    coverId: w.cover_i || null,
    key: w.key || '',
  })).filter(w => w.title);
  cache.set(period, list);
  return list;
}

export async function render(el, { ctx, snap, rerender }) {
  let period = 'weekly';
  let ctrl = null;
  el.innerHTML = `
    <div class="bk-toolbar">
      <h2 class="section-title">${icon('b-sparkle')}Sách thịnh hành</h2>
    </div>
    <div class="chips bk-chips" role="group" aria-label="Khoảng thời gian">${PERIODS.map(([k, l]) => `<button class="chip${k === period ? ' on' : ''}" data-p="${k}" aria-pressed="${k === period}">${l}</button>`).join('')}</div>
    <div id="bk-trend-box"></div>`;
  const box = el.querySelector('#bk-trend-box');

  const inLibrary = (title) => {
    const t = store.fold(title);
    return snap.list.some(b => store.fold(b.title) === t);
  };

  const draw = async () => {
    ctrl?.abort();
    ctrl = new AbortController();
    box.innerHTML = `<p class="muted" role="status">Đang tải danh sách…</p>`;
    let list;
    try { list = await fetchTrending(period, ctrl.signal); }
    catch (e) {
      if (e.name === 'AbortError') return;
      box.innerHTML = `<div class="empty">${icon('b-sparkle')}<p>Không tải được danh sách thịnh hành. Kiểm tra mạng rồi thử lại.</p></div>`;
      return;
    }
    if (!list.length) { box.innerHTML = `<div class="empty">${icon('b-sparkle')}<p>Chưa có dữ liệu cho khoảng thời gian này.</p></div>`; return; }
    box.innerHTML = `<div class="bk-grid">${list.map((w, i) => `
      <article class="bk-card bk-trend" data-i="${i}">
        <span class="bk-cover" style="--h:${(i * 47) % 360}">${w.coverId
          ? `<img src="https://covers.openlibrary.org/b/id/${w.coverId}-M.jpg" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
          : `<span class="bk-cover-ph"><b>${esc(w.title)}</b><small>${esc(w.authors[0] || '')}</small></span>`}</span>
        <span class="bk-card-t">${esc(w.title)}</span>
        <span class="bk-card-a">${esc(w.authors.join(', '))}</span>
        <span class="bk-card-f">${inLibrary(w.title)
          ? `<span class="bk-status st-want">Đã có trong Sách</span>`
          : `<button class="btn small" data-add="${i}">${icon('plus')}Muốn đọc</button>`}</span>
      </article>`).join('')}</div>`;
    box.querySelectorAll('[data-add]').forEach(btn => btn.onclick = async (e) => {
      e.stopPropagation();
      const w = list[+btn.dataset.add];
      btn.disabled = true;
      await store.createBook({ title: w.title, authors: w.authors, physical: 1 }, { quiet: true })
        .then(id => store.setStatus(id, 'want'));
      toast(`Đã thêm "${w.title}" vào Muốn đọc`);
      rerender?.();
    });
  };

  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
    period = b.dataset.p;
    el.querySelectorAll('[data-p]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    draw();
  });
  await draw();
  return () => ctrl?.abort();
}
