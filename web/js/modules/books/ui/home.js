// Books home: currently reading (with progress + continue), this year's goal, streak, quick stats,
// recently added, shelves, and an empty state that explains how to add books.
import { icon } from '../../../core/icons.js';
import { esc } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { compute, goalProgress } from '../lib/stats.js';
import { coverHtml, cardHtml, hydrateCovers, fmtNum, fmtHours, fmtDate } from './common.js';

export async function render(el, { ctx, snap, go }) {
  const list = snap.list;
  if (!list.length) {
    el.innerHTML = `<div class="empty bk-empty">${icon('book')}<h2>Chưa có sách nào</h2>
      <p>Thêm tệp EPUB, PDF, MOBI, AZW3, FB2, CBZ, TXT… (kéo thả cả thư mục), thêm sách giấy theo ISBN, hoặc nhập danh sách từ Goodreads / StoryGraph.</p>
      <div class="row-actions"><button class="btn primary" data-a="files">${icon('upload')}Thêm tệp sách</button><button class="btn" data-a="folder">${icon('b-folder')}Thêm cả thư mục</button>
      <button class="btn" data-a="paper">${icon('b-scan')}Sách giấy (ISBN)</button><a class="btn" href="#books/tools">${icon('download')}Nhập Goodreads / StoryGraph</a></div></div>`;
    bindAdd(el, ctx);
    return;
  }
  const sessions = await store.allSessions();
  const year = new Date().getFullYear();
  const yr = compute(list, sessions, { from: new Date(year, 0, 1).getTime() });
  const goal = (await store.goals.list()).find(g => g.year === year && !g.month && g.kind === 'books' && !g.query);
  const gp = goal && goalProgress(goal, list, sessions);
  const reading = list.filter(b => b.status === 'reading').sort((a, b) => (b.progress?.updatedAt || b.book.startedAt || 0) - (a.progress?.updatedAt || a.book.startedAt || 0));
  const recent = [...list].sort((a, b) => (b.book.addedAt || 0) - (a.book.addedAt || 0)).slice(0, 12);
  const want = list.filter(b => b.status === 'want').slice(0, 12);
  const shelves = snap.all.shelves.filter(s => s.kind !== 'book-library');
  el.innerHTML = `
    <div class="bk-home-top">
      <section class="bk-panel bk-goal">
        <h2 class="section-title">${icon('b-target')}Mục tiêu ${year}</h2>
        ${gp ? `<div class="bk-ring" style="--p:${gp.percent}"><b class="num">${fmtNum(gp.done)}</b><small>/ ${gp.target} cuốn</small></div>
          <p class="muted">${gp.ahead >= 0 ? `Vượt kế hoạch ${fmtNum(gp.ahead, 1)} cuốn` : `Chậm ${fmtNum(-gp.ahead, 1)} cuốn so với kế hoạch`}</p>`
          : `<p class="muted">Đặt mục tiêu số sách đọc trong năm.</p><a class="btn small" href="#books/goals">${icon('plus')}Đặt mục tiêu</a>`}
      </section>
      <section class="bk-panel bk-kpis">
        <div><span>Đã đọc ${year}</span><b class="num">${fmtNum(yr.booksRead)}</b></div>
        <div><span>Trang</span><b class="num">${fmtNum(yr.pages)}</b></div>
        <div><span>Thời gian</span><b class="num">${fmtHours(yr.hours)}</b></div>
        <div><span>${icon('b-flame')}Chuỗi ngày</span><b class="num">${yr.streak}</b></div>
        <div><span>Đánh giá TB</span><b class="num">${yr.avgRating ? fmtNum(yr.avgRating, 2) : '—'}</b></div>
        <div><span>Muốn đọc</span><b class="num">${yr.want}</b></div>
      </section>
    </div>
    ${reading.length ? `<section class="bk-sec"><h2 class="section-title">${icon('b-scroll')}Đang đọc</h2>
      <div class="bk-reading">${reading.map(b => `<article class="bk-now" data-id="${b.id}">
        ${coverHtml(b, 'md')}
        <div class="bk-now-b"><b>${esc(b.title)}</b><small>${esc(b.authors.join(', '))}</small>
          <div class="bar"><i style="width:${b.percent}%"></i></div>
          <small class="muted">${b.percent}%${b.progress?.label ? ' · ' + esc(b.progress.label) : ''}${b.book.startedAt ? ' · bắt đầu ' + fmtDate(b.book.startedAt) : ''}</small>
          <div class="row-actions">${b.main ? `<button class="btn primary small" data-read="${b.id}">${icon('play')}Đọc tiếp</button>` : `<button class="btn small" data-prog="${b.id}">${icon('b-edit')}Cập nhật tiến độ</button>`}</div></div></article>`).join('')}</div></section>` : ''}
    <section class="bk-sec"><h2 class="section-title">${icon('plus')}Mới thêm <a class="bk-more" href="#books/library">Xem tất cả</a></h2>
      <div class="bk-rail">${recent.map(b => cardHtml(b)).join('')}</div></section>
    ${want.length ? `<section class="bk-sec"><h2 class="section-title">${icon('b-bookmark')}Muốn đọc <a class="bk-more" href="#books/library/${encodeURIComponent('status:want')}">Xem tất cả</a></h2>
      <div class="bk-rail">${want.map(b => cardHtml(b)).join('')}</div></section>` : ''}
    <section class="bk-sec"><h2 class="section-title">${icon('b-shelf')}Kệ sách</h2>
      <div class="bk-shelf-chips">${shelves.map(s => `<a class="chip" href="#books/shelf/${s.id}">${icon(s.kind === 'book-smart' ? 'b-sparkle' : 'b-shelf')}${esc(s.name)}</a>`).join('')}<a class="chip" href="#books/shelves">${icon('plus')}Quản lý kệ</a></div></section>`;
  hydrateCovers(el, snap.byId);
  el.querySelectorAll('[data-id]').forEach(c => c.addEventListener('click', (e) => { if (!e.target.closest('button')) go('book/' + c.dataset.id); }));
  el.querySelectorAll('[data-read]').forEach(b => b.onclick = () => openBook(ctx, snap.byId.get(b.dataset.read)));
  el.querySelectorAll('[data-prog]').forEach(b => b.onclick = async () => (await import('./detail.js')).progressSheet(snap.byId.get(b.dataset.prog)));
}

export function bindAdd(el, ctx) {
  const imp = () => import('./importer.js');
  el.querySelector('[data-a="files"]')?.addEventListener('click', async () => { const m = await imp(); m.importFiles(await m.pickFiles()); });
  el.querySelector('[data-a="folder"]')?.addEventListener('click', async () => { const m = await imp(); m.importFiles(await m.pickFiles({ folder: true })); });
  el.querySelector('[data-a="paper"]')?.addEventListener('click', async () => (await imp()).addPaperBook(ctx));
}

// Open in the reader through the hub event, so linked music starts (Music listens to item:open).
export async function openBook(ctx, b) {
  if (!b) return;
  const { logActivity } = await import('../../../core/db.js');
  await logActivity(b.id, 'books', 'open');
  if (b.status === 'want' || b.status === 'onhold') await store.setStatus(b.id, 'reading');
  ctx.bus.emit('item:open', { item: b.item });
}
