// Full-screen reader shell around an engine (engine-foliate.js / engine-pdf.js):
// top bar (back, chapter, search, TOC, notes, bookmark, Aa settings, read aloud), bottom bar
// (progress slider, location, time left), tap zones, keyboard, selection popup (6 highlight
// colours, underline, note, copy, dictionary, translate, read from here, search), annotations,
// cross-device progress (core progress.save, location = CFI / PDF page), reading sessions with
// idle detection (time, pages, words -> WPM), end-of-book prompt, brightness, linked music
// (bus item:open is emitted by whoever opened the book; we emit item:close).
import { db, logActivity } from '../../../core/db.js';
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { params } from '../../../core/params.js';
import { progress } from '../../../core/progress.js';
import { storage } from '../../../core/storage/index.js';
import { tasks } from '../../../core/tasks.js';
import * as store from '../lib/store.js';
import { FORMATS, engineOf, asNamedFile } from '../lib/formats.js';
import { FONTS, THEMES, FONT_CSS, set as setPref } from '../lib/prefs.js';
import { themeColors } from './engine-foliate.js';

const P = () => params.all('books');

export async function openReader(root, id, { ctx, onClose }) {
  const b = await store.get(id);
  const el = document.createElement('div');
  el.className = 'bk-reader';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Trình đọc');
  document.body.append(el);
  document.body.classList.add('bk-reader-open');
  let closed = false, engine = null;
  const offs = [];
  const close = () => {
    if (closed) return;
    closed = true;
    finishSession();
    saveNow(true);
    tts.stop();
    offs.forEach(f => f());
    try { engine?.destroy(); } catch { /* ignore */ }
    el.remove();
    document.body.classList.remove('bk-reader-open');
    if (b) ctx.bus.emit('item:close', { item: b.item });
  };
  const fail = (msg) => {
    el.innerHTML = `<div class="bk-r-msg"><p>${msg}</p><button class="btn" data-x>${icon('b-back')}Quay lại</button></div>`;
    el.querySelector('[data-x]').onclick = () => { close(); onClose(); };
  };
  if (!b) { fail('Không tìm thấy sách.'); return close; }
  const fmt = b.format, eng = engineOf(fmt);
  if (!b.main) { fail('Sách này chưa có tệp để đọc (sách giấy). Gắn tệp ở trang sách, hoặc cập nhật tiến độ bằng tay.'); return close; }
  if (!eng) { fail(esc(FORMATS[fmt]?.phase2 || 'Chưa đọc được định dạng này.')); return close; }

  let prefs = P();
  el.innerHTML = `
    <header class="bk-r-top">
      <button class="icon-btn" data-a="back" aria-label="Đóng trình đọc">${icon('b-back')}</button>
      <div class="bk-r-title"><b>${esc(b.title)}</b><small data-chapter></small></div>
      <button class="icon-btn" data-a="search" aria-label="Tìm trong sách">${icon('search')}</button>
      <button class="icon-btn" data-a="toc" aria-label="Mục lục">${icon('b-toc')}</button>
      <button class="icon-btn" data-a="notes" aria-label="Đánh dấu và ghi chú">${icon('b-highlight')}</button>
      <button class="icon-btn" data-a="bookmark" aria-label="Dấu trang">${icon('b-bookmark')}</button>
      <button class="icon-btn" data-a="settings" aria-label="Tuỳ chỉnh hiển thị">${icon('b-font')}</button>
      <button class="icon-btn" data-a="tts" aria-label="Đọc to">${icon('b-speak')}</button>
      ${b.fanfic ? `<button class="icon-btn" data-a="fic-edit" aria-label="Sửa chương này trong Xưởng Viết">${icon('quill')}</button>` : ''}
      <button class="icon-btn" data-a="panelzoom" aria-label="Phóng từng ô" aria-pressed="false" hidden>${icon('b-panel')}</button>
    </header>
    <div class="bk-r-host"><div class="bk-r-loading">Đang mở sách…</div></div>
    <div class="bk-r-dim" aria-hidden="true"></div>
    <div class="bk-r-warm" aria-hidden="true"></div>
    <footer class="bk-r-bot">
      <button class="icon-btn sm" data-a="prev" aria-label="Trang trước">${icon('b-left')}</button>
      <input type="range" min="0" max="1000" value="0" data-slider aria-label="Vị trí trong sách">
      <button class="icon-btn sm" data-a="next" aria-label="Trang sau">${icon('b-right')}</button>
      <span class="bk-r-loc num" data-loc></span><span class="bk-r-left muted" data-left></span>
    </footer>
    <div class="bk-r-tts" hidden><button class="icon-btn sm" data-t="toggle" aria-label="Tạm dừng">${icon('b-pause')}</button><span data-t-text class="muted"></span><button class="icon-btn sm" data-t="stop" aria-label="Dừng đọc">${icon('b-stop')}</button></div>
    <div class="bk-r-end" hidden><span>Đã đến cuối sách.</span><button class="btn small primary" data-a="finish">${icon('check')}Đánh dấu đã đọc</button><button class="icon-btn sm" data-a="end-x" aria-label="Đóng">${icon('x')}</button></div>
    <div class="bk-r-sel" hidden role="toolbar" aria-label="Thao tác với đoạn chọn"></div>
    <aside class="bk-r-panel" hidden><header><h2 data-ptitle></h2><button class="icon-btn" data-a="panel-x" aria-label="Đóng">${icon('x')}</button></header><div class="bk-r-pbody"></div></aside>`;
  const $ = (s) => el.querySelector(s);
  const host = $('.bk-r-host');
  applyChrome();
  loadFonts(prefs.font);

  // ── Open the engine ──
  const saved = await progress.get(id);
  const gotoNote = sessionStorage.getItem('hub.books.goto'); sessionStorage.removeItem('hub.books.goto');
  let last = { fraction: saved?.percent ? saved.percent / 100 : 0, loc: saved?.loc || null, label: saved?.label || '' };
  try {
    const blob = b.main.virtual ? null : await storage.open(b.main);
    const file = blob && asNamedFile(blob, b.main.name);
    const mod = eng === 'pdf' && prefs.pdfMode !== 'reflow' ? await import('./engine-pdf.js') : await import('./engine-foliate.js');
    let source = file;
    // Fanfic from Xưởng Viết: built from its published chapters (service 'fanfic', docs/FANFIC.md).
    if (eng === 'fanfic') {
      const fic = await (ctx.services.get('fanfic') || await ctx.services.when('fanfic', 3000))?.book(id);
      if (!fic?.chapters.length) throw new Error('Truyện chưa có chương nào được xuất bản. Mở Xưởng Viết để xuất bản.');
      source = (await import('./text-book.js')).makeTextBook(fic);
    }
    if (eng === 'text') source = await (await import('./text-book.js')).bookFromText(file, { name: b.main.name, title: b.title, author: b.authors[0] });
    if (eng === 'pdf' && prefs.pdfMode === 'reflow') {
      const t = tasks.start({ label: 'Dàn lại chữ PDF', unit: 'percent', delay: 500 });
      source = await (await import('./engine-pdf.js')).pdfToTextBook(blob, { title: b.title, author: b.authors[0], onProgress: (f) => t.update({ done: f * 100 }) });
      t.finish();
    }
    host.innerHTML = '';
    const loc = saved?.loc && (eng === 'pdf' && prefs.pdfMode !== 'reflow' ? String(saved.loc).startsWith('pdf:') : !String(saved.loc).startsWith('pdf:')) ? saved.loc : null;
    engine = await mod.open(host, source, { lastLocation: loc, prefs, rtl: !!prefs.comicRtl });
    if (closed) { engine.destroy(); return close; }
  } catch (e) {
    console.error('[reader]', e);
    fail('Không mở được sách: ' + esc(e.message || e));
    return close;
  }
  if (!saved?.loc && saved?.percent) engine.goToFraction(saved.percent / 100);
  panelZoom();
  await logActivity(id, 'books', 'open').catch(() => {});
  if (b.status === 'want' || b.status === 'onhold') { b.status = 'reading'; store.setStatus(id, 'reading').catch(() => {}); }

  // ── Annotations ──
  let notes = await store.annotations.list(id);
  for (const a of notes) engine.addAnnotation(a);
  if (gotoNote) { const a = notes.find(x => x.id === gotoNote); if (a?.loc) engine.goTo(a.loc); }

  // ── Location, progress, sessions ──
  const words = b.book.words || (b.pages ? b.pages * 275 : 0);
  const sessions = await store.sessionsOf(id).catch(() => []);
  // Recent sessions are enough for the reading speed (the table only grows).
  const all = await db.readingSessions.orderBy('start').reverse().limit(300).toArray().catch(() => []);
  const wsec = all.filter(s => s.words && s.seconds > 60);
  const myWpm = wsec.length >= 3 ? wsec.reduce((a, s) => a + s.words, 0) / (wsec.reduce((a, s) => a + s.seconds, 0) / 60) : 0;
  const wpm = () => Math.max(60, Math.min(1200, myWpm || prefs.wpm || 230));
  let saveTimer = 0, dirty = false, sliding = false, lastAct = Date.now();
  const ses = { id: null, start: Date.now(), seconds: 0, from: last.fraction || 0 };
  engine.onRelocate((d) => {
    last = d;
    $('[data-loc]').textContent = d.label || '';
    $('[data-chapter]').textContent = d.tocLabel || '';
    if (!sliding) $('[data-slider]').value = Math.round((d.fraction || 0) * 1000);
    if (words) { const min = (1 - (d.fraction || 0)) * words / wpm(); $('[data-left]').textContent = min > 1 ? `còn ${min < 60 ? Math.round(min) + ' phút' : (min / 60).toFixed(1) + ' giờ'}` : ''; }
    $('.bk-r-end').hidden = !((d.fraction || 0) >= 0.995 && b.status !== 'finished');
    const bm = notes.some(n => n.kind === 'bookmark' && n.loc === d.loc);
    $('[data-a="bookmark"]').innerHTML = icon(bm ? 'b-bookmark-fill' : 'b-bookmark');
    $('[data-a="bookmark"]').setAttribute('aria-pressed', bm);
    dirty = true; activity();
    clearTimeout(saveTimer); saveTimer = setTimeout(() => saveNow(false), 2500);
  });
  function saveNow(flush) {
    if (!dirty || !last) return;
    dirty = false;
    const f = Math.max(0, Math.min(1, last.fraction || 0));
    const opts = engine?.kind === 'pdf'
      ? { position: last.page || 1, total: last.total || 1, unit: 'page', label: last.label }
      : { position: Math.round(f * 1000) / 10, total: 100, unit: 'percent', label: `${Math.round(f * 100)}%${last.tocLabel ? ' · ' + last.tocLabel : ''}` };
    progress.save(b.item, { ...opts, state: closed ? 'paused' : 'reading', flush, extra: { loc: last.loc } }).catch(e => console.warn('[reader] progress', e));
  }
  // Session: active seconds only (paused when hidden or idle longer than the idle setting).
  function activity() { lastAct = Date.now(); }
  const tick = setInterval(() => {
    if (document.visibilityState !== 'visible' && !tts.on) return;
    if (Date.now() - lastAct > (prefs.idleMinutes || 3) * 60000 && !tts.on) return;
    ses.seconds += 5;
    if (ses.seconds % 120 === 0) finishSession(true);   // checkpoint every 2 minutes
  }, 5000);
  offs.push(() => clearInterval(tick));
  function finishSession(checkpoint = false) {
    if (!prefs.trackSessions || ses.seconds < 30) return;
    const to = last.fraction || 0, delta = Math.max(0, to - ses.from);
    const row = { itemId: id, start: ses.start, end: Date.now(), seconds: ses.seconds, from: ses.from * 100, to: to * 100,
      pages: b.pages ? Math.round(delta * b.pages) : 0, words: words ? Math.round(delta * words) : 0, source: 'reader' };
    store.saveSession({ ...row, id: ses.id || undefined }).then(s => { ses.id = s.id; }).catch(() => {});
    if (!checkpoint) store.changed([id]);
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t => { el.addEventListener(t, activity, { passive: true }); });
  const onVis = () => { if (document.visibilityState === 'hidden') { saveNow(true); finishSession(true); } };
  document.addEventListener('visibilitychange', onVis);
  offs.push(() => document.removeEventListener('visibilitychange', onVis));

  // ── Controls ──
  const slider = $('[data-slider]');
  slider.oninput = () => { sliding = true; };
  slider.onchange = () => { sliding = false; engine.goToFraction(slider.value / 1000); };
  $('[data-a="back"]').onclick = () => { close(); onClose(); };
  $('[data-a="prev"]').onclick = () => engine.left ? engine.left() : engine.prev();
  $('[data-a="next"]').onclick = () => engine.right ? engine.right() : engine.next();
  $('[data-a="toc"]').onclick = () => panel('Mục lục', tocHtml(engine.toc), (body) => body.querySelectorAll('[data-href]').forEach(a => a.onclick = () => { engine.goTo(a.dataset.href); hidePanel(); }));
  $('[data-a="notes"]').onclick = () => notesPanel();
  $('[data-a="search"]').onclick = () => searchPanel();
  $('[data-a="settings"]').onclick = () => settingsPanel();
  const toggleBookmark = async () => {
    const hit = notes.find(n => n.kind === 'bookmark' && n.loc === last.loc);
    if (hit) { await store.annotations.remove(hit.id); notes = notes.filter(n => n !== hit); toast('Đã bỏ dấu trang'); }
    else { const a = await store.annotations.add({ itemId: id, kind: 'bookmark', loc: last.loc, label: last.label + (last.tocLabel ? ' · ' + last.tocLabel : ''), pos: last.fraction }); notes.push(a); toast('Đã thêm dấu trang'); }
    $('[data-a="bookmark"]').innerHTML = icon(hit ? 'b-bookmark' : 'b-bookmark-fill');
  };
  $('[data-a="bookmark"]').onclick = toggleBookmark;
  $('[data-a="tts"]').onclick = () => tts.on ? tts.stop() : tts.start();
  // Fanfic: jump to Xưởng Viết at the chapter being read (reading progress stays synced on the shared item).
  $('[data-a="fic-edit"]')?.addEventListener('click', () => { const i = last?.index ?? null; close(); ctx.services.get('fanfic')?.edit(id, i); });
  $('[data-a="finish"]').onclick = async () => { await store.setStatus(id, 'finished'); b.status = 'finished'; $('.bk-r-end').hidden = true; toast('Chúc mừng! Đã đọc xong 🎉'); };
  $('[data-a="end-x"]').onclick = () => { $('.bk-r-end').hidden = true; };
  $('[data-a="panel-x"]').onclick = hidePanel;

  // Tap zones: left / right third turns pages, middle toggles the bars.
  host.addEventListener('bk-tap', (e) => {
    if (!$('.bk-r-sel').hidden) { hideSel(); return; }
    const w = host.clientWidth, x = e.detail.x - host.getBoundingClientRect().left;
    if (prefs.tapZones && x < w * 0.25) engine.left ? engine.left() : engine.prev();
    else if (prefs.tapZones && x > w * 0.75) engine.right ? engine.right() : engine.next();
    else el.classList.toggle('bare');
  });
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    const k = e.key;
    if (k === 'Escape') { if (!$('.bk-r-panel').hidden) hidePanel(); else if (!$('.bk-r-sel').hidden) hideSel(); else { close(); onClose(); } }
    else if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault?.(); k === 'ArrowRight' && engine.right ? engine.right() : engine.next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault?.(); k === 'ArrowLeft' && engine.left ? engine.left() : engine.prev(); }
    else if (k === 'f') el.requestFullscreen?.().catch(() => {});
    else if (k === '+' || k === '=') changePref('fontSize', Math.min(40, prefs.fontSize + 1));
    else if (k === '-') changePref('fontSize', Math.max(12, prefs.fontSize - 1));
  };
  // Keys from the page iframe are re-dispatched on host and bubble up to el: one listener, so each key acts once.
  el.addEventListener('keydown', onKey);
  const onDocKey = (e) => { if (!el.contains(e.target) || e.target === document.body) onKey(e); };
  document.addEventListener('keydown', onDocKey);
  offs.push(() => document.removeEventListener('keydown', onDocKey));
  offs.push(ctx.bus.on('progress:pulled', async () => {
    const p = await progress.get(id);
    if (p?.loc && p.loc !== last.loc && p.deviceId && Math.abs((p.percent || 0) - (last.fraction || 0) * 100) > 1) {
      const t = document.createElement('div');
      t.className = 'bk-r-remote';
      t.innerHTML = `<span>Máy khác đang ở ${esc(p.label || Math.round(p.percent) + '%')}</span><button class="btn small">Đến đó</button>`;
      el.append(t);
      t.querySelector('button').onclick = () => { engine.goTo(p.loc); t.remove(); };
      setTimeout(() => t.remove(), 12000);
    }
  }));
  offs.push(params.on('ui', () => { if (prefs.theme === 'auto') { applyChrome(); engine?.applyPrefs(prefs); } }));

  // ── Selection popup ──
  engine.onSelect((s) => showSel(s));
  engine.onAnnotation((key) => {
    const a = notes.find(n => n.id === key || n.loc === key);
    if (a) showAnn(a);
  });
  function place(box, rect) {
    box.hidden = false;
    const w = box.offsetWidth, hgt = box.offsetHeight;
    let top = rect.top - hgt - 10; if (top < 60) top = rect.bottom + 10;
    box.style.top = Math.min(innerHeight - hgt - 8, top) + 'px';
    box.style.left = Math.max(8, Math.min(innerWidth - w - 8, rect.left + (rect.width || 0) / 2 - w / 2)) + 'px';
  }
  function hideSel() { $('.bk-r-sel').hidden = true; }
  function showSel(s) {
    const box = $('.bk-r-sel');
    box.innerHTML = `<div class="bk-r-colors">${Object.entries(store.COLORS).map(([k, c]) => `<button data-c="${k}" style="--c:${c}" aria-label="Tô màu ${k}"></button>`).join('')}</div>
      <div class="bk-r-acts">
        <button data-s="underline" aria-label="Gạch chân">${icon('b-underline')}</button><button data-s="note" aria-label="Ghi chú">${icon('b-note')}</button>
        <button data-s="copy" aria-label="Sao chép">${icon('b-copy')}</button><button data-s="dict" aria-label="Tra từ điển">${icon('b-dict')}</button>
        <button data-s="translate" aria-label="Dịch">${icon('b-translate')}</button><button data-s="speak" aria-label="Đọc to từ đây">${icon('b-speak')}</button>
        <button data-s="find" aria-label="Tìm trong sách">${icon('search')}</button></div>`;
    place(box, s.rect);
    const add = async (kind, color = 'yellow', note = '') => {
      const a = await store.annotations.add({ itemId: id, kind, color, text: s.text.slice(0, 4000), note, loc: s.loc, rects: s.rects, page: s.page, label: (s.label || last.label || '').trim(), pos: last.fraction });
      notes.push(a); engine.addAnnotation(a); s.clear(); hideSel();
      return a;
    };
    box.querySelectorAll('[data-c]').forEach(x => x.onclick = () => add('highlight', x.dataset.c));
    box.querySelector('[data-s="underline"]').onclick = () => add('underline', 'blue');
    box.querySelector('[data-s="note"]').onclick = async () => { const a = await add('note', 'purple'); editNote(a); };
    box.querySelector('[data-s="copy"]').onclick = async () => { try { await navigator.clipboard.writeText(s.text); toast('Đã sao chép'); } catch { toast('Không sao chép được', 'warn'); } hideSel(); };
    box.querySelector('[data-s="dict"]').onclick = () => { hideSel(); dictionary(s.text); };
    box.querySelector('[data-s="translate"]').onclick = () => { hideSel(); translate(s.text); };
    box.querySelector('[data-s="speak"]').onclick = () => { hideSel(); tts.start(s.text); };
    box.querySelector('[data-s="find"]').onclick = () => { hideSel(); searchPanel(s.text); };
  }
  function showAnn(a) {
    const box = $('.bk-r-sel');
    box.innerHTML = `<div class="bk-r-colors">${Object.entries(store.COLORS).map(([k, c]) => `<button data-c="${k}" style="--c:${c}" aria-label="Màu ${k}" ${a.color === k ? 'aria-pressed="true"' : ''}></button>`).join('')}</div>
      ${a.note ? `<p class="bk-r-annnote">${esc(a.note)}</p>` : ''}
      <div class="bk-r-acts"><button data-s="note">${icon('b-note')}Ghi chú</button><button data-s="copy">${icon('b-copy')}</button><button data-s="del">${icon('trash')}Xoá</button></div>`;
    const r = host.getBoundingClientRect();
    place(box, { top: r.top + r.height / 3, bottom: r.top + r.height / 3, left: r.left + r.width / 2, width: 0 });
    box.querySelectorAll('[data-c]').forEach(x => x.onclick = async () => { engine.removeAnnotation(a); a.color = x.dataset.c; await store.annotations.update(a.id, { color: a.color }); engine.addAnnotation(a); hideSel(); });
    box.querySelector('[data-s="note"]').onclick = () => { hideSel(); editNote(a); };
    box.querySelector('[data-s="copy"]').onclick = async () => { try { await navigator.clipboard.writeText(a.text || ''); toast('Đã sao chép'); } catch { /* denied */ } hideSel(); };
    box.querySelector('[data-s="del"]').onclick = async () => { engine.removeAnnotation(a); await store.annotations.remove(a.id); notes = notes.filter(n => n !== a); hideSel(); toast('Đã xoá'); };
  }
  function editNote(a) {
    panel('Ghi chú', `<blockquote class="bk-r-quote">${esc(a.text || '')}</blockquote><textarea class="bk-r-notearea" rows="6" placeholder="Viết ghi chú…">${esc(a.note || '')}</textarea><div class="row-actions"><button class="btn primary" data-save>${icon('check')}Lưu</button></div>`, (body) => {
      body.querySelector('textarea').focus();
      body.querySelector('[data-save]').onclick = async () => { a.note = body.querySelector('textarea').value; await store.annotations.update(a.id, { note: a.note }); hidePanel(); toast('Đã lưu ghi chú'); };
    });
  }

  // ── Panels ──
  function panel(title, html, bind) {
    const p = $('.bk-r-panel');
    p.querySelector('[data-ptitle]').textContent = title;
    const body = p.querySelector('.bk-r-pbody');
    body.innerHTML = html;
    p.hidden = false;
    bind?.(body);
  }
  function hidePanel() { $('.bk-r-panel').hidden = true; engine.clearSearch?.(); }
  const tocHtml = (items, depth = 0) => !items?.length ? (depth ? '' : '<p class="muted">Sách không có mục lục.</p>') : `<ul class="bk-r-toc">${items.map(t => `<li>${t.href ? `<button data-href="${esc(t.href)}" class="${last.tocLabel && t.label?.trim() === last.tocLabel ? 'on' : ''}">${esc(t.label?.trim() || '—')}</button>` : `<span>${esc(t.label || '')}</span>`}${tocHtml(t.subitems, depth + 1)}</li>`).join('')}</ul>`;
  function notesPanel() {
    const kinds = { highlight: 'Đánh dấu', underline: 'Gạch chân', note: 'Ghi chú', bookmark: 'Dấu trang' };
    const list = [...notes].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
    const marked = notes.some(n => n.kind === 'bookmark' && n.loc === last?.loc);
    // Phones hide the search and bookmark buttons in the top bar (too narrow), so both live here too.
    const acts = `<div class="row-actions wrap" style="margin-bottom:10px"><button class="btn small" data-pa="bm">${icon(marked ? 'b-bookmark-fill' : 'b-bookmark')}${marked ? 'Bỏ dấu trang này' : 'Thêm dấu trang ở trang này'}</button><button class="btn small" data-pa="find">${icon('search')}Tìm trong sách</button></div>`;
    panel(`Đánh dấu & ghi chú (${list.length})`, acts + (list.length ? `<ul class="bk-r-notes">${list.map(n => `<li style="--hl:${store.COLORS[n.color] || store.COLORS.yellow}" class="k-${n.kind}"><button data-goto="${n.id}">
      <small>${kinds[n.kind] || n.kind} · ${esc(n.label || '')}</small>${n.text ? `<q>${esc(n.text.slice(0, 300))}</q>` : ''}${n.note ? `<p>${esc(n.note)}</p>` : ''}</button></li>`).join('')}</ul>` : '<p class="muted">Chưa có. Bôi chọn chữ để đánh dấu, hoặc thêm dấu trang ở trang đang đọc.</p>'),
    (body) => {
      body.querySelector('[data-pa="bm"]').onclick = async () => { await toggleBookmark(); notesPanel(); };
      body.querySelector('[data-pa="find"]').onclick = () => searchPanel();
      body.querySelectorAll('[data-goto]').forEach(x => x.onclick = () => { const n = notes.find(y => y.id === x.dataset.goto); if (n?.loc) engine.goTo(n.loc); hidePanel(); });
    });
  }
  function searchPanel(q = '') {
    panel('Tìm trong sách', `<form class="bk-r-search"><input type="search" value="${esc(q)}" placeholder="Từ hoặc cụm từ…" aria-label="Tìm"><button class="btn" type="submit">${icon('search')}</button></form><p class="muted" data-n></p><ul class="bk-r-results"></ul>`, (body) => {
      const inp = body.querySelector('input'); inp.focus();
      let run = 0;
      const go = async () => {
        const my = ++run, query = inp.value.trim();
        const ul = body.querySelector('ul'); ul.innerHTML = '';
        engine.clearSearch();
        if (query.length < 2) return;
        let n = 0;
        body.querySelector('[data-n]').textContent = 'Đang tìm…';
        await engine.search(query, (hit) => {
          if (my !== run || n >= 500) return;
          n++;
          const li = document.createElement('li');
          li.innerHTML = `<button><small>${esc(hit.label || '')}</small><span>${esc(hit.excerpt?.pre || '')}<mark>${esc(hit.excerpt?.match || query)}</mark>${esc(hit.excerpt?.post || '')}</span></button>`;
          li.querySelector('button').onclick = () => { engine.goTo(hit.loc); if (innerWidth < 860) hidePanel(); };
          ul.append(li);
        }).catch(e => console.warn('[search]', e));
        if (my === run) body.querySelector('[data-n]').textContent = n ? `${n}${n >= 500 ? '+' : ''} kết quả` : 'Không tìm thấy';
      };
      body.querySelector('form').onsubmit = (e) => { e.preventDefault(); go(); };
      if (q) go();
    });
  }

  // ── Phóng từng ô (comics, manga, PDF page by page): the page is split into a grid (Cài đặt → cách chia trang)
  // and next / previous step through its cells in reading order (right to left for manga), then turn the page.
  function panelZoom() {
    const btn = $('[data-a="panelzoom"]');
    const usable = () => engine.kind === 'fixed' || (eng === 'pdf' && prefs.pdfMode === 'page');
    btn.hidden = !usable();
    const st = { on: false, i: 0 };
    const grid = () => { const [c, r] = String(prefs.panelZoom || '2x2').split('x').map(Number); return { c, r, n: c * r }; };
    const view = () => host.firstElementChild;
    const apply = () => {
      const v = view();
      if (!v) return;
      if (!st.on) { v.style.transform = ''; v.style.transformOrigin = ''; return; }
      const { c, r } = grid(), W = host.clientWidth, H = host.clientHeight;
      const row = Math.floor(st.i / c), col0 = st.i % c, col = prefs.comicRtl ? c - 1 - col0 : col0;
      const k = Math.min(c, r), cx = (col + 0.5) / c * W, cy = (row + 0.5) / r * H;
      v.style.transformOrigin = '0 0';
      v.style.transition = 'transform .25s ease';
      v.style.transform = `translate(${W / 2 - k * cx}px, ${H / 2 - k * cy}px) scale(${k})`;
    };
    const o = { next: engine.next?.bind(engine), prev: engine.prev?.bind(engine), left: engine.left?.bind(engine), right: engine.right?.bind(engine) };
    const fwd = async () => { if (st.on && st.i < grid().n - 1) { st.i++; return apply(); } st.i = 0; await o.next(); apply(); };
    const back = async () => { if (st.on && st.i > 0) { st.i--; return apply(); } await o.prev(); if (st.on) st.i = grid().n - 1; apply(); };
    engine.next = fwd; engine.prev = back;
    if (o.left || o.right) {
      engine.left = () => (st.on ? (prefs.comicRtl ? fwd() : back()) : o.left ? o.left() : o.prev());
      engine.right = () => (st.on ? (prefs.comicRtl ? back() : fwd()) : o.right ? o.right() : o.next());
    }
    btn.onclick = () => { st.on = !st.on; st.i = 0; btn.setAttribute('aria-pressed', st.on); btn.classList.toggle('on', st.on); apply(); };
    addEventListener('resize', apply);
    offs.push(() => removeEventListener('resize', apply));
  }

  function settingsPanel() {
    const p = prefs, fixed = engine.kind === 'fixed', pdf = eng === 'pdf';
    const sl = (k, label, min, max, step, unit = '') => `<label class="bk-r-row"><span>${label}</span><input type="range" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${p[k]}"><output class="num">${p[k]}${unit}</output></label>`;
    const tg = (k, label) => `<label class="bk-r-row check"><input type="checkbox" data-p="${k}" ${p[k] ? 'checked' : ''}> ${label}</label>`;
    panel('Hiển thị', `
      ${pdf ? `<div class="bk-r-seg">${[['scroll', 'Cuộn dọc'], ['page', 'Từng trang'], ['reflow', 'Dàn chữ']].map(([v, l]) => `<button data-pdf="${v}" aria-pressed="${p.pdfMode === v}">${l}</button>`).join('')}</div>
        ${engine.kind === 'pdf' ? `<div class="row-actions"><button class="btn small" data-z="out">${icon('b-zoom-out')}</button><button class="btn small" data-z="width">${icon('b-fit-w')}Vừa ngang</button><button class="btn small" data-z="page">${icon('b-fit-h')}Vừa trang</button><button class="btn small" data-z="in">${icon('b-zoom-in')}</button></div>` : ''}` : ''}
      ${fixed ? `<div class="bk-r-seg">${[['fit-page', 'Vừa trang'], ['fit-width', 'Vừa ngang']].map(([v, l]) => `<button data-fit="${v}" aria-pressed="${p.comicFit === v}">${l}</button>`).join('')}</div>${tg('comicRtl', 'Đọc phải sang trái (manga) — mở lại sách để áp dụng')}` : ''}
      ${engine.kind === 'reflow' ? `
      <div class="bk-r-themes">${Object.entries(THEMES).map(([k, t]) => `<button data-theme="${k}" style="background:${t.bg};color:${t.fg}" aria-pressed="${p.theme === k}">${esc(t.label)}</button>`).join('')}<button data-theme="auto" aria-pressed="${p.theme === 'auto'}">Theo app</button><button data-theme="custom" aria-pressed="${p.theme === 'custom'}">Tuỳ chỉnh</button></div>
      ${p.theme === 'custom' ? `<div class="bk-r-row"><label>Nền <input type="color" data-p="customBg" value="${p.customBg}"></label><label>Chữ <input type="color" data-p="customFg" value="${p.customFg}"></label></div>` : ''}
      <label class="bk-r-row"><span>Phông</span><select data-p="font">${Object.entries(FONTS).map(([k, [l]]) => `<option value="${k}" ${p.font === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${sl('fontSize', 'Cỡ chữ', 12, 40, 1, 'px')}${sl('lineHeight', 'Giãn dòng', 1, 2.6, 0.05)}${sl('margin', 'Lề', 0, 160, 4, 'px')}${sl('maxWidth', 'Độ rộng dòng', 360, 1600, 20, 'px')}
      <div class="bk-r-seg">${[['paginated', 'Lật trang'], ['scrolled', 'Cuộn']].map(([v, l]) => `<button data-flow="${v}" aria-pressed="${p.flow === v}">${l}</button>`).join('')}</div>
      <div class="bk-r-seg">${[['auto', 'Tự động'], ['1', '1 trang'], ['2', '2 trang']].map(([v, l]) => `<button data-cols="${v}" aria-pressed="${String(p.columns) === v}">${l}</button>`).join('')}</div>
      ${tg('justify', 'Căn đều')}${tg('hyphenate', 'Ngắt chữ')}${tg('animated', 'Hiệu ứng lật trang')}` : ''}
      ${sl('brightness', 'Độ sáng', 30, 100, 5, '%')}${sl('warmth', 'Độ ấm', 0, 100, 5, '%')}${tg('tapZones', 'Chạm cạnh để lật trang')}
      ${sl('ttsRate', 'Tốc độ đọc to', 0.5, 2.5, 0.1, '×')}
      <p class="muted">Mọi tuỳ chỉnh cũng có trong Cài đặt → Thông số → Sách & trình đọc.</p>`, (body) => {
      body.querySelectorAll('[data-p]').forEach(i => i.addEventListener(i.type === 'range' ? 'input' : 'change', () => {
        const v = i.type === 'checkbox' ? (i.checked ? 1 : 0) : i.type === 'range' ? +i.value : i.value;
        const out = i.parentElement.querySelector('output'); if (out) out.textContent = v + (out.textContent.match(/[a-z%×]+$/)?.[0] || '');
        changePref(i.dataset.p, v);
      }));
      body.querySelectorAll('[data-theme]').forEach(x => x.onclick = () => { changePref('theme', x.dataset.theme); settingsPanel(); });
      body.querySelectorAll('[data-flow]').forEach(x => x.onclick = () => { changePref('flow', x.dataset.flow); settingsPanel(); });
      body.querySelectorAll('[data-cols]').forEach(x => x.onclick = () => { changePref('columns', x.dataset.cols); settingsPanel(); });
      body.querySelectorAll('[data-fit]').forEach(x => x.onclick = () => { changePref('comicFit', x.dataset.fit); settingsPanel(); });
      body.querySelectorAll('[data-z]').forEach(x => x.onclick = () => engine.zoom?.(x.dataset.z));
      body.querySelectorAll('[data-pdf]').forEach(x => x.onclick = async () => {
        const was = prefs.pdfMode;
        await changePref('pdfMode', x.dataset.pdf);
        if ((was === 'reflow') !== (x.dataset.pdf === 'reflow')) { saveNow(true); close(); setTimeout(() => ctx.go('books/read/' + id + '?r=' + Date.now()), 50); return; }
        settingsPanel();
      });
    });
  }
  let prefTimer = 0;
  async function changePref(k, v) {
    prefs = { ...prefs, [k]: v };
    if (k === 'font') loadFonts(v);
    applyChrome();
    clearTimeout(prefTimer);
    prefTimer = setTimeout(() => engine?.applyPrefs(prefs), k === 'fontSize' || k === 'lineHeight' || k === 'margin' || k === 'maxWidth' ? 120 : 0);
    await setPref(k, v);
  }
  function applyChrome() {
    const t = themeColors(prefs);
    el.style.setProperty('--r-bg', t.bg); el.style.setProperty('--r-fg', t.fg);
    el.style.setProperty('--r-dim', String(1 - (prefs.brightness || 100) / 100));
    el.style.setProperty('--r-warm', String((prefs.warmth || 0) / 100 * 0.35));
  }

  // ── Dictionary / translation ──
  async function dictionary(text) {
    const word = text.trim().split(/\s+/).slice(0, 3).join(' ');
    const lang = (b.book.language || (/[ăâđêôơưàáạảãèéẹẻẽ]/i.test(word) ? 'vi' : 'en')).slice(0, 2);
    panel(`Từ điển: ${word}`, '<p class="muted">Đang tra…</p>');
    const body = $('.bk-r-pbody');
    try {
      let html = '';
      if (lang === 'en') {
        const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
        const j = r.ok ? await r.json() : [];
        html = (j || []).slice(0, 2).map(e => `<h3>${esc(e.word)} <small class="muted">${esc(e.phonetic || '')}</small></h3>${(e.meanings || []).map(m => `<p><i>${esc(m.partOfSpeech)}</i></p><ol>${m.definitions.slice(0, 4).map(d => `<li>${esc(d.definition)}${d.example ? `<br><small class="muted">“${esc(d.example)}”</small>` : ''}</li>`).join('')}</ol>`).join('')}`).join('');
      }
      if (!html) {
        const r = await fetch(`https://${lang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
        const j = r.ok ? await r.json() : {};
        html = Object.values(j).flat().slice(0, 4).map(e => `<p><i>${esc(e.partOfSpeech || '')}</i> <small class="muted">${esc(e.language || '')}</small></p><ol>${(e.definitions || []).slice(0, 4).map(d => `<li>${d.definition || ''}</li>`).join('')}</ol>`).join('');
        const tmp = new DOMParser().parseFromString(html, 'text/html').body; tmp.querySelectorAll('a').forEach(a => a.replaceWith(a.textContent)); tmp.querySelectorAll('*').forEach(n => { for (const at of [...n.attributes]) if (/^on/i.test(at.name)) n.removeAttribute(at.name); }); tmp.querySelectorAll('script,iframe,object,embed,img').forEach(n => n.remove()); html = tmp.innerHTML;
      }
      body.innerHTML = (html || '<p class="muted">Không tìm thấy định nghĩa.</p>') + `<p><a href="https://${lang}.wiktionary.org/wiki/${encodeURIComponent(word)}" target="_blank" rel="noopener">Mở Wiktionary</a></p>`;
    } catch { body.innerHTML = '<p class="muted">Cần kết nối mạng để tra từ điển (từ điển ngoại tuyến: giai đoạn 2).</p>'; }
  }
  function translate(text) {
    const to = prefs.translateTo || 'vi';
    const url = `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(to)}&text=${encodeURIComponent(text.slice(0, 4000))}&op=translate`;
    panel('Dịch', `<blockquote class="bk-r-quote">${esc(text.slice(0, 1200))}</blockquote>
      <div class="row-actions"><a class="btn primary" href="${url}" target="_blank" rel="noopener">${icon('b-translate')}Mở Google Dịch (sang ${esc(to)})</a>
      <a class="btn" href="https://www.deepl.com/translator#auto/${encodeURIComponent(to)}/${encodeURIComponent(text.slice(0, 1500))}" target="_blank" rel="noopener">DeepL</a></div>
      <p class="muted">Dịch ngay trong app (ngoại tuyến) là việc của giai đoạn 2.</p>`);
  }

  // ── Read aloud (Web Speech) ──
  const tts = {
    on: false, paused: false, utter: null,
    async start(fromText) {
      if (!('speechSynthesis' in window)) { toast('Thiết bị không hỗ trợ đọc to', 'warn'); return; }
      speechSynthesis.cancel();
      this.on = true; this.paused = false;
      $('.bk-r-tts').hidden = false;
      $('[data-a="tts"]').setAttribute('aria-pressed', 'true');
      ctx.services.get('player')?.duck?.(true);
      const first = fromText || await engine.tts.start().catch(() => null);
      this.say(first);
    },
    say(text) {
      if (!this.on) return;
      if (text == null) { this.stop(); toast('Đã đọc hết'); return; }
      if (!text.trim()) { engine.tts.next().then(t => this.say(t)); return; }
      $('[data-t-text]').textContent = text.slice(0, 80);
      const chunks = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
      let i = 0;
      const speakNext = () => {
        if (!this.on) return;
        if (i >= chunks.length) { engine.tts.next().then(t => this.say(t)).catch(() => this.stop()); return; }
        const u = new SpeechSynthesisUtterance(chunks[i++]);
        u.rate = prefs.ttsRate || 1;
        const lang = b.book.language || document.documentElement.lang || 'vi';
        u.lang = lang;
        const voice = speechSynthesis.getVoices().find(v => v.voiceURI === prefs.ttsVoice) || speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
        if (voice) u.voice = voice;
        u.onend = speakNext;
        u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') this.stop(); };
        this.utter = u;
        speechSynthesis.speak(u);
        activity();
      };
      speakNext();
    },
    toggle() {
      if (!this.on) return;
      if (this.paused) { speechSynthesis.resume(); this.paused = false; } else { speechSynthesis.pause(); this.paused = true; }
      $('[data-t="toggle"]').innerHTML = icon(this.paused ? 'play' : 'b-pause');
    },
    stop() {
      if (!this.on) return;
      this.on = false;
      try { speechSynthesis.cancel(); } catch { /* ignore */ }
      $('.bk-r-tts').hidden = true;
      $('[data-a="tts"]').setAttribute('aria-pressed', 'false');
      ctx.services.get('player')?.duck?.(false);
    },
  };
  $('[data-t="toggle"]').onclick = () => tts.toggle();
  $('[data-t="stop"]').onclick = () => tts.stop();

  el.tabIndex = -1;
  el.focus({ preventScroll: true });
  return close;
}

// Reader fonts come from Google Fonts on first use (Vietnamese subset); offline the fallbacks apply.
function loadFonts(key) {
  const fam = FONT_CSS[key];
  if (!fam || document.querySelector(`link[data-bk-font="${key}"]`)) return;
  const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${fam}&subset=vietnamese&display=swap` });
  l.dataset.bkFont = key;
  document.head.append(l);
}
