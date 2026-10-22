// Books home: currently reading (with progress + continue), this year's goal, streak, quick stats,
// recently added, shelves, and an empty state that explains how to add books.
import { icon } from '../../../core/icons.js';
import { esc, toast, confirmBox } from '../../../core/ui.js';
import { onHold } from '../../../core/longpress.js';
import * as store from '../lib/store.js';
import { compute, goalProgress } from '../lib/stats.js';
import { coverHtml, cardHtml, hydrateCovers, fmtNum, fmtHours, fmtDate, menu } from './common.js';

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
  // Last 7 days: which days had a reading session (dots under the goal).
  const dayMs = 864e5, today0 = new Date().setHours(0, 0, 0, 0);
  const active = new Set(sessions.map(s => new Date(s.start).setHours(0, 0, 0, 0)));
  const week = Array.from({ length: 7 }, (_, i) => { const t = today0 - (6 - i) * dayMs; return { t, on: active.has(t), now: i === 6 }; });
  const hr = new Date().getHours();
  const hello = hr < 11 ? 'Chào buổi sáng' : hr < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const first = reading[0], others = reading.slice(1);
  const nowBtn = (b) => b.main ? `<button class="btn primary" data-read="${b.id}">${icon('play')}Đọc tiếp</button>` : `<button class="btn" data-prog="${b.id}">${icon('b-edit')}Cập nhật tiến độ</button>`;
  el.innerHTML = `
    <header class="bk-greet"><div><h1>${hello}</h1><p class="muted">${reading.length ? `Bạn đang đọc ${reading.length} cuốn` : 'Chọn một cuốn để bắt đầu'} · ${list.length} sách trong thư viện</p></div>
      <a class="btn small" href="#books/trending">${icon('b-sparkle')}Thịnh hành</a></header>
    ${first ? `<article class="bk-hero-now" data-id="${first.id}">
      ${coverHtml(first, 'lg')}
      <div class="bk-hero-now-b"><small class="muted">Đang đọc</small><h2>${esc(first.title)}</h2><p class="muted">${esc(first.authors.join(', '))}</p>
        <div class="bk-pbar"><i style="width:${first.percent}%"></i></div>
        <div class="bk-pmeta"><b class="num">${first.percent}%</b><span class="muted">${first.progress?.label ? esc(first.progress.label) : ''}${first.book.startedAt ? ' · bắt đầu ' + fmtDate(first.book.startedAt) : ''}</span></div>
        <div class="row-actions">${nowBtn(first)}</div></div></article>` : ''}
    <div class="bk-home-top">
      <section class="bk-panel bk-goal">
        <h2 class="section-title">${icon('b-target')}Mục tiêu ${year}</h2>
        ${gp ? `<div class="bk-goal-row"><div class="bk-ring" style="--p:${gp.percent}"><b class="num">${fmtNum(gp.done)}</b><small>/ ${gp.target} cuốn</small></div>
          <div class="bk-goal-info"><div class="bk-pbar"><i style="width:${gp.percent}%"></i></div>
            <span class="bk-pill ${gp.ahead >= 0 ? 'ok' : 'late'}">${gp.ahead >= 0 ? `Vượt kế hoạch ${fmtNum(gp.ahead, 1)} cuốn` : `Chậm ${fmtNum(-gp.ahead, 1)} cuốn`}</span></div></div>`
          : `<p class="muted">Đặt mục tiêu số sách đọc trong năm.</p><a class="btn small" href="#books/goals">${icon('plus')}Đặt mục tiêu</a>`}
        <div class="bk-week" aria-label="7 ngày gần nhất">${week.map(d => `<span class="${d.on ? 'on' : ''}${d.now ? ' now' : ''}" title="${new Date(d.t).toLocaleDateString('vi')}"></span>`).join('')}<small class="muted">${icon('b-flame')}${yr.streak} ngày liên tiếp</small></div>
      </section>
      <section class="bk-kpis">
        <div><b class="num">${fmtNum(yr.booksRead)}</b><span>Đã đọc ${year}</span></div>
        <div><b class="num">${fmtNum(yr.pages)}</b><span>Trang</span></div>
        <div><b class="num">${fmtHours(yr.hours)}</b><span>Thời gian</span></div>
        <div><b class="num">${yr.avgRating ? fmtNum(yr.avgRating, 2) : '—'}</b><span>Đánh giá TB</span></div>
        <div><b class="num">${yr.want}</b><span>Muốn đọc</span></div>
      </section>
    </div>
    ${others.length ? `<section class="bk-sec"><h2 class="section-title">${icon('b-scroll')}Cũng đang đọc</h2>
      <div class="bk-reading">${others.map(b => `<article class="bk-now" data-id="${b.id}">
        ${coverHtml(b, 'md')}
        <div class="bk-now-b"><b>${esc(b.title)}</b><small>${esc(b.authors.join(', '))}</small>
          <div class="bk-pbar"><i style="width:${b.percent}%"></i></div>
          <small class="muted">${b.percent}%${b.progress?.label ? ' · ' + esc(b.progress.label) : ''}</small>
          <div class="row-actions">${nowBtn(b).replace('class="btn primary"', 'class="btn primary small"').replace('class="btn"', 'class="btn small"')}</div></div></article>`).join('')}</div></section>` : ''}
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
  // Press and hold / right-click a book: the same quick actions as in the library, with "Chọn nhiều cuốn".
  onHold(el, '[data-id]', (card) => {
    const id = card.dataset.id, b = snap.byId.get(id);
    if (!b) return;
    const setSt = (status, label) => ({ label, icon: 'b-bookmark', run: async () => { await store.setStatus(id, status); toast(`Đã đổi trạng thái: ${label}`); } });
    menu(card, [
      b.main ? { label: 'Đọc tiếp', icon: 'play', run: () => openBook(ctx, b) } : null,
      { label: 'Mở trang sách', icon: 'book', run: () => go('book/' + id) },
      { label: 'Sửa thông tin', icon: 'b-edit', run: async () => (await import('./editor.js')).editBook(b, snap) },
      '-',
      setSt('want', 'Muốn đọc'), setSt('reading', 'Đang đọc'), setSt('finished', 'Đã đọc'),
      '-',
      { label: 'Chọn nhiều cuốn', icon: 'b-check-all', run: async () => { (await import('./library.js')).startSelect(id); go('library'); } },
      { label: 'Xoá sách', icon: 'trash', danger: true, run: async () => { if (await confirmBox('Xoá sách này?', `“${b.title}”, tệp, ghi chú và tiến độ sẽ bị xoá khỏi mọi thiết bị đồng bộ.`, 'Xoá')) { await store.removeBooks([id]); toast('Đã xoá'); } } },
    ].filter(Boolean));
  });
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
