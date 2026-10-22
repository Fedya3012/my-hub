// Full-screen writer (Ulysses / Scrivener Composition Mode): binder of chapters and scenes, a clean Markdown
// editor with autosave, word counts against the chapter / daily goal, focus and typewriter modes, preview,
// snapshots (manual + automatic before big deletions) and chapter notes. Flex Mode: text on the top half,
// tools and binder on the bottom half.
import { icon } from '../../../core/icons.js';
import { esc, toast, h, modal } from '../../../core/ui.js';
import { debounce } from '../../../core/perf.js';
import * as store from '../lib/store.js';
import { mdToHtml, countWords, today } from '../lib/text.js';
import { CH_STATUS } from '../lib/vocab.js';
import { FONTS, loadFont, get as pref, set as setPref } from '../lib/prefs.js';
import { fmtNum, ago, sheet, menu } from './common.js';

export async function openWriter(root, id, chapterId, { ctx, onClose }) {
  let v = await store.get(id);
  const el = document.createElement('div');
  el.className = 'fx-writer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Trình viết');
  document.body.append(el);
  document.body.classList.add('fx-writer-open');
  if (!v) { el.innerHTML = `<div class="empty"><p>Không tìm thấy truyện.</p><button class="btn" data-x>Quay lại</button></div>`; el.querySelector('[data-x]').onclick = () => { close(); onClose(); }; return { close }; }
  // Phones: the binder is a drawer over the text, closed by default and after picking a chapter.
  const narrow = () => matchMedia('(max-width: 860px)').matches;
  const binderOn = !narrow() && !!pref('binderOpen');
  let cur = null, dirty = false, closed = false, preview = false, focus = false, sessionStart = 0, todayBase = 0;
  const offs = [];
  el.innerHTML = `
    <div class="fold-top fx-w-top">
      <header class="fx-w-bar">
        <button class="icon-btn" data-a="back" aria-label="Đóng trình viết">${icon('fx-back')}</button>
        <button class="icon-btn" data-a="binder" aria-label="Chương và cảnh" aria-pressed="${binderOn}">${icon('fx-binder')}</button>
        <div class="fx-w-title"><b data-title></b><small data-sub></small></div>
        <span class="fx-w-count num" data-count aria-live="polite"></span>
        <button class="icon-btn" data-a="preview" aria-label="Xem trước" aria-pressed="false">${icon('fx-eye')}</button>
        <button class="icon-btn" data-a="focus" aria-label="Chế độ tập trung" aria-pressed="false">${icon('fx-focus')}</button>
        <button class="icon-btn" data-a="more" aria-label="Thêm">${icon('fx-more')}</button>
      </header>
      <div class="fx-w-main">
        <nav class="fx-w-binder" aria-label="Chương và cảnh" ${binderOn ? '' : 'hidden'}></nav>
        <div class="fx-w-scroll">
          <div class="fx-w-page">
            <input class="fx-w-ch" data-chtitle aria-label="Tên chương" placeholder="Tên chương">
            <textarea class="fx-w-text" data-text aria-label="Nội dung" placeholder="Bắt đầu viết… (Markdown: *nghiêng*, **đậm**, # tiêu đề, * * * chuyển cảnh)"></textarea>
            <div class="fx-w-prev fx-prose" data-prev hidden></div>
          </div>
        </div>
      </div>
    </div>
    <div class="fold-bottom">
      <div class="fx-w-tools" role="toolbar" aria-label="Định dạng">
        <button class="icon-btn" data-md="**" aria-label="Đậm">${icon('fx-bold')}</button>
        <button class="icon-btn" data-md="*" aria-label="Nghiêng">${icon('fx-italic')}</button>
        <button class="icon-btn" data-md="# " aria-label="Tiêu đề">${icon('fx-heading')}</button>
        <button class="icon-btn" data-md="> " aria-label="Trích dẫn">${icon('fx-quote')}</button>
        <button class="icon-btn" data-md="break" aria-label="Chuyển cảnh">${icon('fx-break')}</button>
        <span class="sp"></span>
        <div class="fx-w-goal" data-goal title="Mục tiêu hôm nay"><i></i></div>
        <button class="icon-btn" data-a="snap" aria-label="Chụp phiên bản">${icon('fx-snapshot')}</button>
        <button class="icon-btn" data-a="next" aria-label="Chương sau">${icon('arrow')}</button>
      </div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const ta = $('[data-text]'), titleIn = $('[data-chtitle]'), scroller = $('.fx-w-scroll');
  applyLook();
  offs.push(ctx.params.on('fanfic', applyLook));

  function applyLook() {
    loadFont(pref('font'));
    el.style.setProperty('--fx-font', FONTS[pref('font')]?.[1] || FONTS.serif[1]);
    el.style.setProperty('--fx-size', pref('fontSize') + 'px');
    el.style.setProperty('--fx-lh', pref('lineHeight'));
    el.style.setProperty('--fx-width', pref('width') + 'px');
    ta.spellcheck = !!pref('spellcheck');
  }

  // ── Binder ──
  function drawBinder() {
    const nav = $('.fx-w-binder');
    const li = (c) => `<button class="fx-w-b${c.id === cur?.id ? ' on' : ''}${c.parentId ? ' scene' : ''}" data-go="${c.id}"><span>${esc(c.title || 'Không tên')}</span><small class="num">${fmtNum(c.words)}</small></button>`;
    nav.innerHTML = `<p class="eyebrow">${esc(v.title)}</p>` + v.tops.map(c => li(c) + v.chapters.filter(s => s.parentId === c.id).map(li).join('')).join('')
      + `<div class="fx-w-b-add"><button class="btn small" data-add="ch">${icon('plus')}Chương</button>${cur && !cur.parentId ? `<button class="btn small" data-add="scene">${icon('plus')}Cảnh</button>` : ''}</div>`;
    nav.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { if (narrow()) toggleBinder(false); show(b.dataset.go); });
    nav.querySelector('[data-add="ch"]').onclick = async () => { const cid = await store.addChapter(id, {}, { quiet: true }); await reload(); show(cid); };
    nav.querySelector('[data-add="scene"]')?.addEventListener('click', async () => { const sid = await store.addChapter(id, {}, { parentId: cur.id, quiet: true }); await reload(); show(sid); });
  }
  const reload = async () => { store.snapshot.invalidate(); v = await store.get(id); };

  async function show(chId) {
    await flush();
    if (!v.chapters.length) { await store.addChapter(id, {}, { quiet: true }); await reload(); }
    cur = v.chapters.find(c => c.id === chId) || v.chapters.find(c => c.id === v.fic.lastChapterId) || v.tops[0] || v.chapters[0];
    titleIn.value = cur.title || '';
    ta.value = cur.body || '';
    sessionStart = countWords(ta.value);
    $('[data-title]').textContent = v.title;
    $('[data-sub]').textContent = cur.parentId ? `${v.chapters.find(c => c.id === cur.parentId)?.title || ''} › cảnh` : `${CH_STATUS[cur.status] || ''}${cur.editedAt ? ' · sửa ' + ago(cur.editedAt) : ''}`;
    history.replaceState(null, '', `#fanfic/write/${id}/${cur.id}`);
    drawBinder(); count(); grow();
    if (preview) renderPreview();
    if (!matchMedia('(pointer: coarse)').matches) ta.focus();
  }

  // ── Typing, autosave, counts ──
  let lastLen = 0;
  const save = debounce(() => flush(), 900);
  ta.addEventListener('beforeinput', () => { lastLen = ta.value.length; });
  ta.addEventListener('input', async () => {
    dirty = true;
    // A big deletion or paste over a lot of text: keep the text before it as a snapshot first.
    if (pref('autoSnapshot') && lastLen - ta.value.length > 400 && cur) {
      await store.snapshotChapter(cur.id, { kind: 'auto', label: 'Trước khi xoá nhiều chữ' });
      toast('Đã tự lưu phiên bản trước khi xoá');
    }
    count(); grow(); typewriter(); save();
  });
  titleIn.addEventListener('input', () => { dirty = true; save(); });
  async function flush() {
    if (!dirty || !cur) return;
    dirty = false;
    const body = ta.value, title = titleIn.value.trim() || cur.title;
    await store.saveChapter(cur.id, { body, title });
    cur.body = body; cur.title = title; cur.words = countWords(body);
    const c = v.chapters.find(x => x.id === cur.id); if (c) Object.assign(c, { body, title, words: cur.words });
    drawBinderCounts();
  }
  const drawBinderCounts = () => { const b = el.querySelector(`[data-go="${cur.id}"]`); if (b) { b.querySelector('span').textContent = cur.title; b.querySelector('small').textContent = fmtNum(cur.words); } };
  async function refreshToday() { const by = await store.writingDays(1); todayBase = (by.get(today()) || 0) - (countWords(ta.value) - sessionStart); count(); }
  function count() {
    const w = countWords(ta.value), session = w - sessionStart, goal = cur?.goal || 0, daily = pref('dailyGoal') || 0;
    const todayWords = Math.max(0, todayBase + session);
    $('[data-count]').textContent = `${fmtNum(w)}${goal ? ' / ' + fmtNum(goal) : ''} từ${session ? ` · ${session > 0 ? '+' : ''}${fmtNum(session)}` : ''}`;
    const g = $('[data-goal]');
    g.hidden = !daily;
    g.style.setProperty('--p', Math.min(100, todayWords / (daily || 1) * 100) + '%');
    g.title = `Hôm nay ${fmtNum(todayWords)} / ${fmtNum(daily)} từ`;
    g.classList.toggle('done', todayWords >= daily);
  }
  // The textarea grows with its text so the page scrolls as one sheet (like a document, not a box).
  function grow() { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  // Typewriter: keep the line being typed near the middle of the screen.
  const mirror = document.createElement('div');
  mirror.className = 'fx-w-mirror';
  $('.fx-w-page').append(mirror);
  function typewriter() {
    if (!pref('typewriter') || ta.selectionStart !== ta.selectionEnd) return;
    mirror.style.width = ta.clientWidth + 'px';
    mirror.textContent = ta.value.slice(0, ta.selectionStart);
    mirror.append(document.createElement('span'));
    const y = ta.offsetTop + mirror.scrollHeight;
    const want = y - scroller.clientHeight * 0.45;
    if (Math.abs(scroller.scrollTop - want) > 24) scroller.scrollTo({ top: want, behavior: 'smooth' });
  }

  // ── Toolbar ──
  el.querySelectorAll('[data-md]').forEach(b => b.onclick = () => format(b.dataset.md));
  function format(kind) {
    const s = ta.selectionStart, e = ta.selectionEnd, val = ta.value, sel = val.slice(s, e);
    let out, caret;
    if (kind === 'break') { out = `${val.slice(0, s).replace(/\n*$/, '')}\n\n* * *\n\n${val.slice(e).replace(/^\n*/, '')}`; caret = s + 9; }
    else if (kind.endsWith(' ')) { const ls = val.lastIndexOf('\n', s - 1) + 1; out = val.slice(0, ls) + kind + val.slice(ls); caret = e + kind.length; }
    else { out = val.slice(0, s) + kind + sel + kind + val.slice(e); caret = sel ? e + kind.length * 2 : s + kind.length; }
    ta.value = out; ta.focus(); ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event('input'));
  }
  ta.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'b') { e.preventDefault(); format('**'); }
    else if (mod && e.key === 'i') { e.preventDefault(); format('*'); }
    else if (mod && e.key === 's') { e.preventDefault(); flush().then(() => toast('Đã lưu')); }
    else if (mod && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); snap(); }
  });

  // ── Bar actions ──
  $('[data-a="back"]').onclick = async () => { await close(); onClose(); };
  $('[data-a="binder"]').onclick = () => toggleBinder($('.fx-w-binder').hidden);
  function toggleBinder(open) {
    $('.fx-w-binder').hidden = !open;
    $('[data-a="binder"]').setAttribute('aria-pressed', open);
    if (!narrow()) setPref('binderOpen', open ? 1 : 0);
  }
  $('[data-a="preview"]').onclick = (e) => { preview = !preview; e.currentTarget.setAttribute('aria-pressed', preview); ta.hidden = preview; $('[data-prev]').hidden = !preview; if (preview) renderPreview(); };
  const renderPreview = () => { $('[data-prev]').innerHTML = mdToHtml(ta.value) || '<p class="muted">Chưa có nội dung.</p>'; };
  $('[data-a="focus"]').onclick = (e) => setFocus(!focus, e.currentTarget);
  function setFocus(on, btn = $('[data-a="focus"]')) {
    focus = on; el.classList.toggle('focus', on); btn.setAttribute('aria-pressed', on);
    if (on) { document.documentElement.requestFullscreen?.().catch(() => {}); toast('Chế độ tập trung: Esc để thoát'); }
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  $('[data-a="snap"]').onclick = () => snap();
  async function snap() { await flush(); await store.snapshotChapter(cur.id); toast('Đã lưu phiên bản'); }
  $('[data-a="next"]').onclick = () => { const i = v.chapters.findIndex(c => c.id === cur.id); const order = v.tops.flatMap(c => [c, ...v.chapters.filter(s => s.parentId === c.id)]); const j = order.findIndex(c => c.id === cur.id); if (order[j + 1]) show(order[j + 1].id); else toast('Đây là phần cuối'); void i; };
  $('[data-a="more"]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Phiên bản đã lưu', icon: 'fx-snapshot', run: versions },
    { label: 'Ghi chú & mục tiêu chương', icon: 'fx-edit', run: inspector },
    { label: 'Xem trên trang tác phẩm', icon: 'fx-works', run: async () => { await close(); onClose(); } },
    v.published ? { label: 'Cập nhật bản trong Sách', icon: 'fx-publish', run: async () => { await flush(); await store.publish(id); toast('Đã cập nhật bản trong Sách'); } }
      : { label: 'Xuất bản sang Sách', icon: 'fx-publish', run: async () => { await flush(); await store.publish(id); await reload(); toast('Đã xuất bản sang Sách'); } },
  ]);

  async function versions() {
    await flush();
    const list = await store.versionsOf(cur.id);
    const box = h(`<div class="stack">${list.length ? `<ul class="fx-vers">${list.map(x => `<li><div><b>${esc(x.label || ({ manual: 'Chụp tay', auto: 'Tự động', publish: 'Xuất bản' })[x.kind])}</b><small class="muted">${new Date(x.createdAt).toLocaleString(globalThis.__LOCALE || 'vi-VN')} · ${fmtNum(x.words)} từ</small></div>
      <button class="btn small" data-view="${x.id}">Xem</button><button class="btn small" data-restore="${x.id}">Khôi phục</button></li>`).join('')}</ul>` : '<p class="muted">Chưa có phiên bản nào. Bấm biểu tượng máy ảnh để chụp trước khi sửa lớn.</p>'}</div>`);
    const s = sheet(`Phiên bản · ${cur.title}`, box, { wide: true });
    box.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { const x = list.find(y => y.id === b.dataset.view); sheet(x.label || 'Phiên bản', `<div class="fx-prose">${mdToHtml(x.body)}</div>`, { wide: true }); });
    box.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
      if (!(await modal({ title: 'Khôi phục phiên bản này?', body: '<p>Nội dung hiện tại được lưu thành một phiên bản trước khi thay.</p>', actions: [{ label: 'Huỷ', value: false }, { label: 'Khôi phục', kind: 'primary', value: true }] }))) return;
      await store.restoreVersion(b.dataset.restore); s.close(); await reload(); show(cur.id); toast('Đã khôi phục');
    });
  }
  function inspector() {
    const f = h(`<form class="fx-form">
      <label>Tóm tắt (thẻ corkboard)<textarea data-f="synopsis" rows="3">${esc(cur.synopsis || '')}</textarea></label>
      <div class="fx-2"><label>Trạng thái<select data-f="status">${Object.entries(CH_STATUS).map(([k, l]) => `<option value="${k}" ${k === cur.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Mục tiêu chương (từ)<input type="number" min="0" step="100" data-f="goal" value="${cur.goal || ''}"></label></div>
      <label>Ghi chú đầu chương (hiện cho người đọc)<textarea data-f="notesStart" rows="3">${esc(cur.notesStart || '')}</textarea></label>
      <label>Ghi chú cuối chương<textarea data-f="notesEnd" rows="3">${esc(cur.notesEnd || '')}</textarea></label>
      <footer class="row-actions"><button class="btn primary">${icon('check')}Lưu</button></footer></form>`);
    const s = sheet('Ghi chú & mục tiêu chương', f, { wide: true });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const g = (k) => f.querySelector(`[data-f="${k}"]`).value;
      const patch = { synopsis: g('synopsis').trim(), status: g('status'), goal: +g('goal') || 0, notesStart: g('notesStart'), notesEnd: g('notesEnd') };
      await store.saveChapter(cur.id, patch); Object.assign(cur, patch); count(); s.close();
    };
  }

  // Esc leaves focus mode first; save when the app goes to the background (phones kill tabs).
  const onKey = (e) => { if (e.key === 'Escape' && focus) { e.preventDefault(); setFocus(false); } };
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);
  ta.addEventListener('click', typewriter);
  ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) typewriter(); });

  async function close() {
    if (closed) return;
    closed = true;
    await flush();
    offs.forEach(f => f());
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    el.remove();
    document.body.classList.remove('fx-writer-open');
    store.changed([id]);
    ctx.bus.emit('cover:refresh');
  }

  await show(chapterId);
  refreshToday();
  return { close, show };
}
