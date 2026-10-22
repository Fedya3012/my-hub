// Book page: cover + metadata, read / continue, status (with DNF reason), half-star rating,
// progress (page / % / time, manual for paper books), reading timer, review + private notes,
// moods / pace / content warnings / tags, shelves, reading history and sessions, annotations,
// background music (Music's library.drawer block), linked items from other modules.
import { db, relatedItems } from '../../../core/db.js';
import { icon } from '../../../core/icons.js';
import { esc, h, modal, confirmBox, toast } from '../../../core/ui.js';
import { extensions } from '../../../core/extensions.js';
import { CONTENT_TYPES } from '../../../core/content-types.js';
import { storage } from '../../../core/storage/index.js';
import { progress } from '../../../core/progress.js';
import * as store from '../lib/store.js';
import { FORMATS, engineOf } from '../lib/formats.js';
import { get as pref } from '../lib/prefs.js';
import { coverHtml, hydrateCovers, starsHtml, bindStars, statusOptions, fmtDate, fmtMin, sheet, menu, download } from './common.js';
import { openBook } from './home.js';

const TIMER_KEY = 'hub.books.timer';
export const timer = {
  get() { try { return JSON.parse(localStorage.getItem(TIMER_KEY)); } catch { return null; } },
  start(itemId) { try { localStorage.setItem(TIMER_KEY, JSON.stringify({ itemId, start: Date.now() })); } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem(TIMER_KEY); } catch { /* private mode */ } },
};

export async function render(el, { ctx, snap, arg: id, go, rerender }) {
  const b = snap.all.byId.get(id);
  if (!b) { el.innerHTML = `<div class="empty"><p>Không tìm thấy sách.</p><a class="btn" href="#books/library">Về Thư viện</a></div>`; return; }
  const [sessions, notes, related] = await Promise.all([store.sessionsOf(id), store.annotations.list(id), relatedItems(id)]);
  const fmt = FORMATS[b.format];
  const readable = b.main && engineOf(b.format);
  const t = timer.get();
  const shelves = snap.all.shelves.filter(s => s.kind === 'book-shelf');
  const totalSec = sessions.reduce((a, s) => a + (s.seconds || 0), 0);
  const dnfSel = b.status === 'dnf';
  el.innerHTML = `
  <article class="bk-detail">
    <div class="bk-hero">
      ${coverHtml(b, 'lg')}
      <div class="bk-hero-b">
        <h1>${esc(b.title)}</h1>
        <p class="bk-by">${b.authors.map((a, i) => `<a href="#books/author/${esc(b.book.authorIds?.[i] || '')}">${esc(a)}</a>`).join(', ') || '<span class="muted">Chưa rõ tác giả</span>'}</p>
        ${b.series ? `<p><a href="#books/series/${esc(b.book.seriesId)}">${icon('b-series')}${esc(b.series)}${b.seriesIndex != null ? ' · tập ' + b.seriesIndex : ''}</a></p>` : ''}
        <p class="bk-facts muted">${[b.book.physical ? 'Sách giấy' : fmt?.label, b.pages ? b.pages + ' trang' : '', b.book.language, b.book.published, b.book.publisher, b.book.isbn ? 'ISBN ' + b.book.isbn : ''].filter(Boolean).map(esc).join(' · ')}</p>
        <div class="bk-rate">${starsHtml(b.rating, { edit: true, size: 'lg' })}<span class="num muted">${b.rating ? b.rating : ''}</span></div>
        <div class="row-actions bk-main-actions">
          ${readable ? `<button class="btn primary" data-a="read">${icon('play')}${b.percent > 0 && b.percent < 100 ? `Đọc tiếp · ${b.percent}%` : 'Đọc'}</button>`
            : b.main ? `<span class="hint">${esc(fmt?.phase2 || 'Chưa đọc được định dạng này trong app.')}</span>` : `<button class="btn" data-a="attach">${icon('upload')}Gắn tệp sách</button>`}
          <select data-a="status" aria-label="Trạng thái đọc">${statusOptions(b.status)}</select>
          <button class="btn" data-a="fav" aria-pressed="${b.favorite}">${icon(b.favorite ? 'b-star-fill' : 'star')}<span>${b.favorite ? 'Đã thích' : 'Yêu thích'}</span></button>
          <button class="icon-btn" data-a="more" aria-label="Thêm thao tác">${icon('b-more')}</button>
        </div>
        ${dnfSel ? `<label class="bk-dnf">Lý do bỏ dở<input list="bk-dnf-list" data-f="dnfReason" value="${esc(b.book.dnfReason || '')}" placeholder="Vì sao bỏ dở?"><datalist id="bk-dnf-list">${store.DNF_REASONS.map(r => `<option value="${esc(r)}">`).join('')}</datalist></label>` : ''}
      </div>
    </div>

    <section class="bk-panel bk-progress">
      <h2 class="section-title">${icon('clock')}Tiến độ</h2>
      <div class="bar lg"><i style="width:${b.percent}%"></i></div>
      <p class="muted">${b.percent}%${b.progress?.label ? ' · ' + esc(b.progress.label) : ''}${b.progress?.updatedAt ? ' · ' + fmtDate(b.progress.updatedAt) : ''} · đã đọc ${fmtMin(totalSec)} trong ${sessions.length} phiên</p>
      <div class="row-actions">
        <button class="btn small" data-a="progress">${icon('b-edit')}Cập nhật tiến độ</button>
        ${t?.itemId === id ? `<button class="btn small primary" data-a="timer-stop">${icon('b-stop')}Dừng hẹn giờ · <span data-tick class="num"></span></button>` : `<button class="btn small" data-a="timer">${icon('b-timer')}Bấm giờ đọc</button>`}
        <button class="btn small" data-a="session">${icon('plus')}Thêm phiên đọc</button>
      </div>
    </section>

    <div class="bk-cols">
      <section class="bk-panel">
        <h2 class="section-title">${icon('b-note')}Nhận xét & ghi chú</h2>
        <label>Nhận xét (review)<textarea data-f="review" rows="4" placeholder="Bạn nghĩ gì về cuốn sách?">${esc(b.book.review || '')}</textarea></label>
        <label>Ghi chú riêng tư<textarea data-f="notes" rows="3" placeholder="Chỉ mình bạn thấy">${esc(b.book.notes || '')}</textarea></label>
      </section>
      <section class="bk-panel">
        <h2 class="section-title">${icon('b-sparkle')}Cảm xúc, nhịp đọc, cảnh báo</h2>
        <div class="bk-moods">${Object.entries(store.MOODS).map(([k, l]) => `<button class="chip${(b.book.moods || []).includes(k) ? ' on' : ''}" data-mood="${k}" aria-pressed="${(b.book.moods || []).includes(k)}">${l}</button>`).join('')}</div>
        <label>Nhịp đọc<select data-f="pace"><option value="">—</option>${Object.entries(store.PACES).map(([k, l]) => `<option value="${k}" ${b.book.pace === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Cảnh báo nội dung (cách nhau bằng dấu phẩy)<input data-f="cw" data-list value="${esc((b.book.cw || []).join(', '))}"></label>
        <label>Thẻ<input data-f="tags" data-list value="${esc(b.tags.join(', '))}"></label>
        <label>Thể loại<input data-f="genres" data-list value="${esc((b.book.genres || []).join(', '))}"></label>
      </section>
    </div>

    <section class="bk-panel"><h2 class="section-title">${icon('b-shelf')}Kệ</h2>
      <div class="bk-moods">${shelves.map(s => `<button class="chip${(b.book.shelfIds || []).includes(s.id) ? ' on' : ''}" data-shelf="${s.id}" aria-pressed="${(b.book.shelfIds || []).includes(s.id)}">${esc(s.name)}</button>`).join('')}<a class="chip" href="#books/shelves">${icon('plus')}Kệ mới</a></div></section>

    <div id="bk-ext" class="bk-ext"></div>

    ${b.book.description ? `<section class="bk-panel"><h2 class="section-title">Giới thiệu</h2><p class="bk-desc">${esc(b.book.description)}</p></section>` : ''}

    <section class="bk-panel"><h2 class="section-title">${icon('b-highlight')}Đánh dấu & ghi chú trong sách <span class="num muted">${notes.length}</span>
      ${notes.length ? `<span class="bk-note-exp"><button class="btn small" data-a="export-notes">${icon('download')}Markdown</button><button class="btn small" data-a="export-txt">${icon('download')}TXT</button><button class="btn small" data-a="export-pdf">${icon('download')}PDF</button></span>` : ''}</h2>
      ${notes.length ? `<ul class="bk-notes">${notes.map(n => `<li class="k-${n.kind}" style="--hl:${store.COLORS[n.color] || store.COLORS.yellow}">
        <span class="bk-note-k">${icon({ highlight: 'b-highlight', underline: 'b-underline', note: 'b-note', bookmark: 'b-bookmark' }[n.kind] || 'b-note')}</span>
        <div>${n.text ? `<q>${esc(n.text)}</q>` : ''}${n.note ? `<p>${esc(n.note)}</p>` : ''}<small class="muted">${esc(n.label || '')} · ${fmtDate(n.createdAt)}</small></div>
        ${readable ? `<button class="icon-btn sm" data-go-note="${n.id}" aria-label="Mở chỗ này">${icon('arrow')}</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Bôi chọn chữ trong trình đọc để đánh dấu, gạch chân hoặc ghi chú.</p>'}</section>

    <section class="bk-panel"><h2 class="section-title">${icon('b-timer')}Lịch sử đọc</h2>
      <ul class="bk-hist">
        <li><span>Thêm vào</span><span class="muted">${fmtDate(b.book.addedAt)}</span></li>
        ${b.book.startedAt ? `<li><span>Bắt đầu</span><span class="muted">${fmtDate(b.book.startedAt)}</span></li>` : ''}
        ${(b.book.reads || []).map((r, i) => `<li><span>${r.dnf ? 'Bỏ dở' : `Đọc xong lần ${i + 1}`}</span><span class="muted">${r.start ? fmtDate(r.start) + ' → ' : ''}${fmtDate(r.end)}</span></li>`).join('')}
      </ul>
      ${sessions.length ? `<details><summary>${sessions.length} phiên đọc</summary><ul class="bk-sessions">${sessions.slice(0, 200).map(s => `<li><span>${fmtDate(s.start)} ${new Date(s.start).toLocaleTimeString(globalThis.__LOCALE || 'vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="num">${fmtMin(s.seconds || 0)}</span><span class="num muted">${s.pages ? s.pages + ' tr.' : s.to != null && s.from != null ? `${Math.round(s.from)}→${Math.round(s.to)}%` : ''}${s.words && s.seconds > 60 ? ` · ${Math.round(s.words / (s.seconds / 60))} từ/phút` : ''}</span>
        <button class="icon-btn sm" data-del-ses="${s.id}" aria-label="Xoá phiên">${icon('x')}</button></li>`).join('')}</ul></details>` : ''}
    </section>

    ${related.length ? `<section class="bk-panel"><h2 class="section-title">${icon('link')}Liên kết</h2><ul class="bk-hist">${related.map(r => `<li><span><i class="dot t-${r.item.type}"></i> ${esc(r.item.title)}</span><span class="muted">${esc(CONTENT_TYPES[r.item.type]?.label || r.item.type)} · ${esc(r.link.relation)}</span></li>`).join('')}</ul></section>` : ''}

    ${b.files.length ? `<section class="bk-panel"><h2 class="section-title">${icon('database')}Tệp</h2><ul class="bk-hist">${b.files.map(f => `<li><span>${esc(f.name)}</span><span class="muted">${f.role === 'cover' ? 'Bìa' : ''} ${(f.size / 1048576).toFixed(1)} MB${f.locations?.local?.kind === 'handle' ? ' · liên kết thư mục' : ''}</span></li>`).join('')}</ul>
      ${b.book.relPath ? `<p class="muted">Đường dẫn gốc: ${esc(b.book.relPath)}</p>` : ''}</section>` : ''}
  </article>`;
  hydrateCovers(el, snap.all.byId);

  const $ = (s) => el.querySelector(s);
  bindStars($('.bk-rate'), b.rating, (v) => store.updateBook(id, { rating: v }), { half: !!pref('halfStars') });
  $('[data-a="read"]')?.addEventListener('click', () => openBook(ctx, b));
  $('[data-a="attach"]')?.addEventListener('click', () => attachFile(b));
  $('[data-a="status"]').onchange = async (e) => {
    const v = e.target.value;
    if (v === 'finished' && b.percent < 100 && b.main) await progress.save(b.item, { position: 100, total: 100, unit: 'percent', label: 'Đã đọc xong', flush: true });
    await store.setStatus(id, v);
    toast(store.STATUSES[v]);
  };
  $('[data-a="fav"]').onclick = () => store.updateBook(id, { favorite: !b.favorite });
  $('[data-a="more"]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Sửa thông tin', icon: 'b-edit', run: async () => (await import('./editor.js')).editBook(b, snap) },
    { label: 'Tìm thông tin trên mạng', icon: 'b-globe', run: async () => (await import('./editor.js')).onlineSheet(b) },
    { label: 'Đổi ảnh bìa', icon: 'b-image', run: async () => (await import('./editor.js')).pickCover(b) },
    b.main ? { label: 'Tải tệp sách về máy', icon: 'download', run: async () => download(b.main.name, await storage.open(b.main)) } : null,
    b.main ? null : { label: 'Gắn tệp sách', icon: 'upload', run: () => attachFile(b) },
    '-',
    { label: 'Xoá sách', icon: 'trash', danger: true, run: async () => { if (await confirmBox('Xoá sách này?', `“${b.title}”, tệp, ghi chú và tiến độ sẽ bị xoá khỏi mọi thiết bị đồng bộ.`, 'Xoá')) { await store.removeBooks([id]); go('library'); } } },
  ]);
  // Text fields save when you leave them.
  el.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', async () => {
    const k = inp.dataset.f;
    const v = inp.hasAttribute('data-list') ? inp.value.split(',').map(s => s.trim()).filter(Boolean) : inp.value;
    await store.updateBook(id, { [k]: v });
  }));
  el.querySelectorAll('[data-mood]').forEach(c => c.onclick = () => {
    const set = new Set(b.book.moods || []);
    if (set.has(c.dataset.mood)) set.delete(c.dataset.mood); else set.add(c.dataset.mood);
    store.updateBook(id, { moods: [...set] });
  });
  el.querySelectorAll('[data-shelf]').forEach(c => c.onclick = () => store.toggleShelf([id], c.dataset.shelf));
  $('[data-a="progress"]').onclick = () => progressSheet(b);
  $('[data-a="session"]').onclick = () => manualSession(b);
  $('[data-a="timer"]')?.addEventListener('click', () => { timer.start(id); if (b.status !== 'reading') store.setStatus(id, 'reading'); rerender(); });
  $('[data-a="timer-stop"]')?.addEventListener('click', () => stopTimer(b, rerender));
  let tick = 0;
  if (t?.itemId === id) {
    const upd = () => { const s = el.querySelector('[data-tick]'); if (!s) return clearInterval(tick); const sec = Math.round((Date.now() - t.start) / 1000); s.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
    upd(); tick = setInterval(upd, 1000);
  }
  $('[data-a="export-notes"]')?.addEventListener('click', () => download(`${b.title} - ghi chú.md`, notesMarkdown(b, notes), 'text/markdown'));
  $('[data-a="export-txt"]')?.addEventListener('click', () => download(`${b.title} - ghi chú.txt`, notesText(b, notes), 'text/plain'));
  $('[data-a="export-pdf"]')?.addEventListener('click', () => printNotes(b, notes));
  el.querySelectorAll('[data-go-note]').forEach(btn => btn.onclick = () => { sessionStorage.setItem('hub.books.goto', btn.dataset.goNote); openBook(ctx, b); });
  el.querySelectorAll('[data-del-ses]').forEach(btn => btn.onclick = async () => { await store.removeSession(btn.dataset.delSes); rerender(); });

  // Other modules' blocks (Music: background music for this book, auto-play when opened).
  const ext = $('#bk-ext');
  for (const fn of extensions('library.drawer')) {
    try { await fn({ item: b.item, el: ext, ctx, refresh: rerender, from: 'books' }); } catch (e) { console.error('[books ext]', e); }
  }
  return () => clearInterval(tick);
}

function notesMarkdown(b, notes) {
  return `# ${b.title}\n${b.authors.join(', ')}\n\n` + notes.map(n => `${n.kind === 'bookmark' ? '🔖' : '>'} ${n.text || ''}\n${n.note ? `\n${n.note}\n` : ''}\n— ${n.label || ''}\n`).join('\n');
}

function notesText(b, notes) {
  return `${b.title}\n${b.authors.join(', ')}\n${'='.repeat(40)}\n\n` + notes.map(n => `${n.kind === 'bookmark' ? '[Dấu trang]' : '"' + (n.text || '') + '"'}${n.note ? `\nGhi chú: ${n.note}` : ''}\n(${n.label || ''})\n`).join('\n');
}

// PDF: a printable page in a hidden frame; the system print dialog saves it as PDF (Windows, Android, browsers).
function printNotes(b, notes) {
  const f = Object.assign(document.createElement('iframe'), { title: 'In ghi chú' });
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(f);
  const d = f.contentDocument;
  d.open();
  d.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(b.title)} - ghi chú</title><style>
    body{font:12pt/1.5 Georgia,serif;margin:2cm;color:#111} h1{font-size:18pt;margin:0} .a{color:#555;margin:0 0 1em}
    .n{break-inside:avoid;margin:0 0 14pt;padding-left:10pt;border-left:4pt solid var(--c,#f5d04a)} .n p{margin:0} .m{font-style:italic;margin-top:4pt} .l{color:#777;font-size:9pt}
  </style></head><body><h1>${esc(b.title)}</h1><p class="a">${esc(b.authors.join(', '))}</p>${notes.map(n => `<div class="n" style="--c:${store.COLORS[n.color] || store.COLORS.yellow}"><p>${n.kind === 'bookmark' ? '🔖 Dấu trang' : esc(n.text || '')}</p>${n.note ? `<p class="m">${esc(n.note)}</p>` : ''}<p class="l">${esc(n.label || '')}</p></div>`).join('')}</body></html>`);
  d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 300);
}

// Manual progress for paper books (or any book): page, percent or minutes.
export async function progressSheet(b) {
  const body = h(`<form class="stack">
    <div class="seg bk-unit" role="group"><button type="button" data-u="page" aria-pressed="true">Trang</button><button type="button" data-u="percent" aria-pressed="false">%</button></div>
    <label data-for="page">Đang ở trang<input type="number" name="page" min="0" ${b.pages ? `max="${b.pages}"` : ''} value="${Math.round((b.percent / 100) * (b.pages || 0)) || ''}"></label>
    <label data-for="page">Tổng số trang<input type="number" name="total" min="1" value="${b.pages || ''}"></label>
    <label data-for="percent" hidden>Phần trăm<input type="range" name="pct" min="0" max="100" value="${b.percent}"><output class="num">${b.percent}%</output></label>
    <label>Vừa đọc thêm (phút, để ghi phiên đọc)<input type="number" name="min" min="0" placeholder="0"></label></form>`);
  let unit = 'page';
  body.querySelectorAll('[data-u]').forEach(x => x.onclick = () => { unit = x.dataset.u; body.querySelectorAll('[data-u]').forEach(y => y.setAttribute('aria-pressed', y === x)); body.querySelectorAll('[data-for]').forEach(l => l.hidden = l.dataset.for !== unit); });
  body.querySelector('[name=pct]').oninput = (e) => { body.querySelector('output').textContent = e.target.value + '%'; };
  const r = await modal({ title: 'Cập nhật tiến độ', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', kind: 'primary', value: (f) => ({
    page: +f.querySelector('[name=page]').value, total: +f.querySelector('[name=total]').value, pct: +f.querySelector('[name=pct]').value, min: +f.querySelector('[name=min]').value }) }] });
  if (!r) return;
  const before = b.percent;
  if (unit === 'page' && r.total) {
    if (r.total !== b.pages) await store.updateBook(b.id, { pages: r.total });
    await progress.save(b.item, { position: Math.min(r.page, r.total), total: r.total, unit: 'page', flush: true });
  } else await progress.save(b.item, { position: r.pct, total: 100, unit: 'percent', label: `${r.pct}%`, flush: true });
  const after = unit === 'page' && r.total ? r.page / r.total * 100 : r.pct;
  if (r.min > 0) await store.saveSession({ itemId: b.id, start: Date.now() - r.min * 60000, end: Date.now(), seconds: r.min * 60, from: before, to: after,
    pages: b.pages ? Math.max(0, Math.round((after - before) / 100 * (r.total || b.pages))) : 0, source: 'manual' });
  if (after >= 100) await store.setStatus(b.id, 'finished');
  else if (b.status === 'want') await store.setStatus(b.id, 'reading');
  else store.changed([b.id]);
}

async function manualSession(b) {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const body = h(`<form class="stack"><label>Bắt đầu<input type="datetime-local" name="start" value="${now}"></label>
    <label>Số phút<input type="number" name="min" min="1" value="30"></label><label>Số trang đã đọc<input type="number" name="pages" min="0" value="0"></label></form>`);
  const r = await modal({ title: 'Thêm phiên đọc', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Thêm', kind: 'primary', value: (f) => ({ start: Date.parse(f.querySelector('[name=start]').value), min: +f.querySelector('[name=min]').value, pages: +f.querySelector('[name=pages]').value }) }] });
  if (!r?.min) return;
  await store.saveSession({ itemId: b.id, start: r.start || Date.now(), end: (r.start || Date.now()) + r.min * 60000, seconds: r.min * 60, pages: r.pages, source: 'manual' });
  store.changed([b.id]);
}

async function stopTimer(b, rerender) {
  const t = timer.get();
  timer.clear();
  if (!t) return rerender();
  const sec = Math.round((Date.now() - t.start) / 1000);
  if (sec < 30) { toast('Phiên quá ngắn, không ghi'); return rerender(); }
  const body = h(`<form class="stack"><p>Bạn đã đọc ${fmtMin(sec)}.</p><label>Số trang đã đọc (tuỳ chọn)<input type="number" name="pages" min="0"></label>
    ${b.pages ? `<label>Đang ở trang<input type="number" name="at" min="0" max="${b.pages}"></label>` : ''}</form>`);
  const r = await modal({ title: 'Ghi phiên đọc', body, actions: [{ label: 'Lưu', kind: 'primary', value: (f) => ({ pages: +f.querySelector('[name=pages]').value || 0, at: +(f.querySelector('[name=at]')?.value || 0) }) }] }) || { pages: 0, at: 0 };
  await store.saveSession({ itemId: b.id, start: t.start, end: Date.now(), seconds: sec, pages: r.pages, source: 'timer' });
  if (r.at && b.pages) await progress.save(b.item, { position: r.at, total: b.pages, unit: 'page', flush: true });
  store.changed([b.id]);
}

async function attachFile(b) {
  const { pickFiles } = await import('./importer.js');
  const [f] = await pickFiles();
  if (!f) return;
  const { formatOf, extractMeta, asNamedFile } = await import('../lib/formats.js');
  if (!formatOf(f.name)) { toast('Không phải tệp sách', 'warn'); return; }
  await storage.addFile(b.id, f, { role: 'main', name: f.name });
  const meta = await extractMeta(asNamedFile(f, f.name));
  await store.updateBook(b.id, { format: formatOf(f.name), physical: 0, ...(b.pages ? {} : { pages: meta.pages || 0 }), ...(meta.words ? { words: meta.words } : {}) });
  if (meta.coverBlob && !b.cover) { const { setCover } = await import('./common.js'); await setCover(b.id, meta.coverBlob); }
  store.changed([b.id]);
  toast('Đã gắn tệp');
}
