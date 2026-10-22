// Trending books from the sources the user picked (Sách → Cài đặt → Nguồn Thịnh hành, or the "Nguồn" button here).
// Tap "Muốn đọc" to add a book. Books already in the library are marked.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { sources, labelOf, fetchSource } from '../lib/trend-sources.js';

export async function render(el, { snap, rerender }) {
  const list = (await sources()).filter(s => s.on);
  let cur = list[0]?.id;
  let ctrl = null;
  el.innerHTML = `
    <div class="bk-toolbar">
      <h2 class="section-title">${icon('b-sparkle')}Sách thịnh hành</h2>
      <a class="btn small" href="#books/settings/sources">${icon('settings')}Nguồn</a>
    </div>
    ${list.length ? `<div class="chips bk-chips" role="group" aria-label="Nguồn">${list.map(s => `<button class="chip${s.id === cur ? ' on' : ''}" data-s="${esc(s.id)}" aria-pressed="${s.id === cur}">${esc(labelOf(s))}</button>`).join('')}</div>` : ''}
    <div id="bk-trend-box"></div>`;
  const box = el.querySelector('#bk-trend-box');
  if (!list.length) { box.innerHTML = `<div class="empty">${icon('b-sparkle')}<p>Chưa bật nguồn nào. Bấm “Nguồn” để chọn.</p></div>`; return; }

  const inLibrary = (title) => { const t = store.fold(title); return snap.list.some(b => store.fold(b.title) === t); };

  const draw = async () => {
    ctrl?.abort();
    ctrl = new AbortController();
    box.innerHTML = `<p class="muted" role="status">Đang tải danh sách…</p>`;
    let items;
    try { items = await fetchSource(list.find(s => s.id === cur), ctrl.signal); }
    catch (e) {
      if (e.name === 'AbortError') return;
      box.innerHTML = `<div class="empty">${icon('b-sparkle')}<p>Không tải được danh sách thịnh hành. Kiểm tra mạng rồi thử lại.</p></div>`;
      return;
    }
    if (!items.length) { box.innerHTML = `<div class="empty">${icon('b-sparkle')}<p>Chưa có dữ liệu cho khoảng thời gian này.</p></div>`; return; }
    box.innerHTML = `<div class="bk-grid">${items.map((w, i) => `
      <article class="bk-card bk-trend" data-i="${i}">
        <span class="bk-cover" style="--h:${(i * 47) % 360}">${w.cover
          ? `<img src="${esc(w.cover)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
          : `<span class="bk-cover-ph"><b>${esc(w.title)}</b><small>${esc(w.authors[0] || '')}</small></span>`}</span>
        <span class="bk-card-t">${esc(w.title)}</span>
        <span class="bk-card-a">${esc(w.authors.join(', '))}</span>
        <span class="bk-card-f">${inLibrary(w.title)
          ? `<span class="bk-status st-want">Đã có trong Sách</span>`
          : `<button class="btn small" data-add="${i}">${icon('plus')}Muốn đọc</button>`}</span>
      </article>`).join('')}</div>`;
    box.querySelectorAll('[data-add]').forEach(btn => btn.onclick = async (e) => {
      e.stopPropagation();
      const w = items[+btn.dataset.add];
      btn.disabled = true;
      await store.createBook({ title: w.title, authors: w.authors, physical: 1 }, { quiet: true }).then(id => store.setStatus(id, 'want'));
      toast(`Đã thêm "${w.title}" vào Muốn đọc`);
      rerender?.();
    });
  };

  el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    cur = b.dataset.s;
    el.querySelectorAll('[data-s]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    draw();
  });
  await draw();
  return () => ctrl?.abort();
}
