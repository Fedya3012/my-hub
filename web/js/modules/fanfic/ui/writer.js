// Full-screen writer (Ulysses / Scrivener Composition Mode, Cold Turkey style lock):
//   binder of chapters and scenes · Markdown editor saved on every keystroke (local draft at once, database right
//   after) · focus mode (hides every bar, fullscreen) · typewriter scrolling · dimming of what is not being written
//   (paragraph or sentence) · [[links]] to character profiles and notes with suggestions · pinned side panel
//   (notes, character sheets, another chapter) · floating scratchpad · find & replace across chapters · repetition
//   and long-sentence check · paper colours, fonts, spacing · key sounds and ambient sound · session lock until a
//   word or time goal · version history with automatic snapshots. Flex Mode: text above the crease, tools below.
import { icon } from '../../../core/icons.js';
import { esc, toast, h, modal } from '../../../core/ui.js';
import { debounce } from '../../../core/perf.js';
import * as store from '../lib/store.js';
import { mdToHtml, countWords, today } from '../lib/text.js';
import { CH_STATUS } from '../lib/vocab.js';
import { FONTS, PAPERS, loadFont, get as pref, set as setPref } from '../lib/prefs.js';
import { fmtNum, ago, sheet, menu } from './common.js';

const DRAFT = (id) => 'hub.fanfic.draft.' + id;   // keystroke-level safety copy, cleared once the database has it

export async function openWriter(root, id, chapterId, { ctx, onClose }) {
  let v = await store.get(id);
  const el = document.createElement('div');
  el.className = 'fx-writer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Trình viết');
  document.body.append(el);
  document.body.classList.add('fx-writer-open');
  if (!v) { el.innerHTML = `<div class="empty"><p>Không tìm thấy truyện.</p><button class="btn" data-x>Quay lại</button></div>`; el.querySelector('[data-x]').onclick = () => { close(); onClose(); }; return { close }; }
  const narrow = () => matchMedia('(max-width: 860px)').matches;
  const binderOn = !narrow() && !!pref('binderOpen');
  let cur = null, dirty = false, closed = false, preview = false, focus = false, sessionStart = 0, todayBase = 0;
  let lock = null;                         // { words, until, startWords } while a session lock runs
  const ses = { start: Date.now(), active: 0, lastKey: 0, startWords: 0 };
  const offs = [];
  el.innerHTML = `
    <div class="fold-top fx-w-top">
      <header class="fx-w-bar">
        <button class="icon-btn" data-a="back" aria-label="Đóng trình viết">${icon('fx-back')}</button>
        <button class="icon-btn" data-a="binder" aria-label="Chương và cảnh" aria-pressed="${binderOn}">${icon('fx-binder')}</button>
        <div class="fx-w-title"><b data-title></b><small data-sub></small></div>
        <span class="fx-w-count num" data-count aria-live="polite"></span>
        <button class="icon-btn" data-a="pin" aria-label="Ghim tài liệu bên cạnh" aria-pressed="false">${icon('fx-pin')}</button>
        <button class="icon-btn" data-a="look" aria-label="Giao diện trang viết">${icon('fx-type')}</button>
        <button class="icon-btn" data-a="focus" aria-label="Chế độ tập trung" aria-pressed="false">${icon('fx-focus')}</button>
        <button class="icon-btn" data-a="more" aria-label="Thêm">${icon('fx-more')}</button>
      </header>
      <div class="fx-w-lockbar" data-lockbar hidden><span data-locktext></span><i data-lockbar-fill></i></div>
      <div class="fx-w-main">
        <nav class="fx-w-binder" aria-label="Chương và cảnh" ${binderOn ? '' : 'hidden'}></nav>
        <div class="fx-w-scroll">
          <div class="fx-w-page">
            <input class="fx-w-ch" data-chtitle aria-label="Tên chương" placeholder="Tên chương">
            <div class="fx-w-field">
              <div class="fx-w-dim" data-dim aria-hidden="true"></div>
              <textarea class="fx-w-text" data-text aria-label="Nội dung" placeholder="Bắt đầu viết… (*nghiêng*, **đậm**, # tiêu đề, * * * chuyển cảnh, [[Tên nhân vật]] để liên kết)"></textarea>
            </div>
            <div class="fx-w-prev fx-prose" data-prev hidden></div>
          </div>
          <div class="fx-w-suggest" data-suggest hidden role="listbox" aria-label="Gợi ý liên kết"></div>
        </div>
        <aside class="fx-w-pin" data-pinpanel hidden aria-label="Tài liệu ghim"></aside>
      </div>
    </div>
    <div class="fold-bottom">
      <div class="fx-w-tools" role="toolbar" aria-label="Định dạng">
        <button class="icon-btn" data-md="**" aria-label="Đậm">${icon('fx-bold')}</button>
        <button class="icon-btn" data-md="*" aria-label="Nghiêng">${icon('fx-italic')}</button>
        <button class="icon-btn" data-md="# " aria-label="Tiêu đề">${icon('fx-heading')}</button>
        <button class="icon-btn" data-md="break" aria-label="Chuyển cảnh">${icon('fx-break')}</button>
        <button class="icon-btn" data-md="[[" aria-label="Liên kết nhân vật / ghi chú">${icon('link')}</button>
        <span class="sp"></span>
        <button class="fx-w-goal" data-goal aria-label="Mục tiêu hôm nay"><i></i></button>
        <button class="icon-btn" data-a="scratch" aria-label="Ghi chú nhanh (Ctrl + .)">${icon('fx-idea')}</button>
        <button class="icon-btn" data-a="sound" aria-label="Âm thanh">${icon('music')}</button>
        <button class="icon-btn" data-a="snap" aria-label="Chụp phiên bản">${icon('fx-snapshot')}</button>
      </div>
    </div>
    <div class="fx-scratch" data-scratch hidden role="dialog" aria-label="Ghi chú nhanh">
      <header><b>${icon('fx-idea')}Ghi chú nhanh</b><button class="icon-btn sm" data-a="scratch-x" aria-label="Đóng">${icon('x')}</button></header>
      <textarea data-scratchtext placeholder="Ý tưởng chợt đến… (tự lưu, theo truyện)"></textarea>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const ta = $('[data-text]'), titleIn = $('[data-chtitle]'), scroller = $('.fx-w-scroll'), dimEl = $('[data-dim]');
  applyLook();
  offs.push(ctx.params.on('fanfic', applyLook));

  function applyLook() {
    loadFont(pref('font'));
    el.style.setProperty('--fx-font', FONTS[pref('font')]?.[1] || FONTS.serif[1]);
    el.style.setProperty('--fx-size', pref('fontSize') + 'px');
    el.style.setProperty('--fx-lh', pref('lineHeight'));
    el.style.setProperty('--fx-width', pref('width') + 'px');
    el.style.setProperty('--fx-margin', pref('margin') + 'px');
    const p = PAPERS[pref('paper')];
    if (p?.bg) { el.style.setProperty('--fx-paper', p.bg); el.style.setProperty('--fx-ink', p.fg); el.dataset.paper = pref('paper'); }
    else { el.style.removeProperty('--fx-paper'); el.style.removeProperty('--fx-ink'); delete el.dataset.paper; }
    el.classList.toggle('dimming', pref('dim') !== 'off');
    ta.spellcheck = !!pref('spellcheck');
    paintDim();
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
  function toggleBinder(open) {
    $('.fx-w-binder').hidden = !open;
    $('[data-a="binder"]').setAttribute('aria-pressed', open);
    if (!narrow()) setPref('binderOpen', open ? 1 : 0);
  }

  async function show(chId) {
    await flush();
    if (cur) todayBase += countWords(ta.value) - sessionStart;   // words written in the previous chapter stay in today's total
    if (!v.chapters.length) { await store.addChapter(id, {}, { quiet: true }); await reload(); }
    cur = v.chapters.find(c => c.id === chId) || v.chapters.find(c => c.id === v.fic.lastChapterId) || v.tops[0] || v.chapters[0];
    titleIn.value = cur.title || '';
    ta.value = cur.body || '';
    // A local draft newer than the database copy (the app was closed mid-sentence): bring it back.
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT(cur.id)) || 'null');
      if (d && d.at > (cur.editedAt || 0) && d.body !== cur.body) { ta.value = d.body; titleIn.value = d.title ?? titleIn.value; dirty = true; toast('Đã khôi phục đoạn chưa kịp lưu'); save(); }
      else localStorage.removeItem(DRAFT(cur.id));
    } catch { /* storage unavailable */ }
    sessionStart = countWords(ta.value);
    $('[data-title]').textContent = v.title;
    $('[data-sub]').textContent = cur.parentId ? `${v.chapters.find(c => c.id === cur.parentId)?.title || ''} › cảnh` : `${CH_STATUS[cur.status] || ''}${cur.editedAt ? ' · sửa ' + ago(cur.editedAt) : ''}`;
    history.replaceState(null, '', `#fanfic/write/${id}/${cur.id}`);
    drawBinder(); count(); grow(); paintDim();
    if (preview) renderPreview();
    autoSnapshot();
    if (!matchMedia('(pointer: coarse)').matches) ta.focus();
  }

  // One automatic snapshot per chapter per hour of writing, so yesterday's text is always one click away.
  async function autoSnapshot() {
    if (!cur?.body?.trim()) return;
    const last = (await store.versionsOf(cur.id))[0];
    if (!last || Date.now() - last.createdAt > 3600e3) await store.snapshotChapter(cur.id, { kind: 'auto', label: 'Đầu phiên viết' });
  }

  // ── Typing: local draft at once, database right after; counts, dimming, typewriter, sounds ──
  let lastLen = 0;
  const save = debounce(() => flush(), 350);
  ta.addEventListener('beforeinput', () => { lastLen = ta.value.length; });
  ta.addEventListener('input', async (e) => {
    dirty = true;
    try { localStorage.setItem(DRAFT(cur.id), JSON.stringify({ body: ta.value, title: titleIn.value, at: Date.now() })); } catch { /* storage unavailable */ }
    const now = Date.now();
    if (ses.lastKey && now - ses.lastKey < 60000) ses.active += now - ses.lastKey;   // pauses over a minute are not writing time
    ses.lastKey = now;
    if (pref('autoSnapshot') && lastLen - ta.value.length > 400 && cur) {
      await store.snapshotChapter(cur.id, { kind: 'auto', label: 'Trước khi xoá nhiều chữ' });
      toast('Đã tự lưu phiên bản trước khi xoá');
    }
    keySound(e.inputType);
    count(); grow(); paintDim(); typewriter(); suggest(); save();
  });
  titleIn.addEventListener('input', () => { dirty = true; try { localStorage.setItem(DRAFT(cur.id), JSON.stringify({ body: ta.value, title: titleIn.value, at: Date.now() })); } catch { /* storage unavailable */ } save(); });
  async function flush() {
    if (!dirty || !cur) return;
    dirty = false;
    const body = ta.value, title = titleIn.value.trim() || cur.title;
    await store.saveChapter(cur.id, { body, title });
    try { localStorage.removeItem(DRAFT(cur.id)); } catch { /* storage unavailable */ }
    cur.body = body; cur.title = title; cur.words = countWords(body);
    const c = v.chapters.find(x => x.id === cur.id); if (c) Object.assign(c, { body, title, words: cur.words });
    const b = el.querySelector(`[data-go="${cur.id}"]`); if (b) { b.querySelector('span').textContent = cur.title; b.querySelector('small').textContent = fmtNum(cur.words); }
  }
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
    lockTick();
  }
  const written = () => todayBase + countWords(ta.value) - sessionStart;   // today's words, across chapters
  function grow() { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  const mirror = document.createElement('div');
  mirror.className = 'fx-w-mirror';
  $('.fx-w-field').append(mirror);
  function caretY() {
    mirror.style.width = ta.clientWidth + 'px';
    mirror.textContent = ta.value.slice(0, ta.selectionStart);
    const s = document.createElement('span'); s.textContent = '​'; mirror.append(s);
    return { y: s.offsetTop, x: s.offsetLeft };
  }
  function typewriter() {
    if (!pref('typewriter') || ta.selectionStart !== ta.selectionEnd) return;
    const y = $('.fx-w-field').offsetTop + caretY().y;
    const want = y - scroller.clientHeight * 0.45;
    if (Math.abs(scroller.scrollTop - want) > 24) scroller.scrollTo({ top: want, behavior: 'smooth' });
  }

  // Dimming + [[link]] highlighting: a copy of the text under a transparent-ink textarea. Only the paragraph (or
  // sentence) holding the caret keeps full colour.
  function paintDim() {
    const mode = pref('dim');
    if (mode === 'off' || preview) { dimEl.innerHTML = ''; return; }
    const val = ta.value, pos = ta.selectionStart;
    let a, b;
    if (mode === 'sentence') {
      a = Math.max(val.lastIndexOf('\n', pos - 1), ...['. ', '! ', '? ', '… '].map(m => { const i = val.lastIndexOf(m, pos - 1); return i < 0 ? -1 : i + 1; })) + 1;
      const ends = ['\n', '. ', '! ', '? ', '… '].map(m => { const i = val.indexOf(m, pos); return i < 0 ? val.length : i + 1; });
      b = Math.min(...ends);
    } else {
      const p = val.lastIndexOf('\n\n', pos - 1); a = p < 0 ? 0 : p + 2;
      const q = val.indexOf('\n\n', pos); b = q < 0 ? val.length : q;
    }
    const mark = (s) => esc(s).replace(/\[\[([^\]\n]+)\]\]/g, '<u>[[$1]]</u>');
    dimEl.innerHTML = `<span class="far">${mark(val.slice(0, a))}</span><span class="near">${mark(val.slice(a, b))}</span><span class="far">${mark(val.slice(b))}</span>​`;
  }
  ['keyup', 'click', 'select'].forEach(t => ta.addEventListener(t, () => { paintDim(); }));

  // ── [[links]]: suggestions while typing, preview links open the profile / note ──
  let targets = [];
  async function loadTargets() {
    const notes = await store.notesOf(id);
    targets = [
      ...v.characters.map(t => ({ name: t.name, kind: 'Nhân vật', tagId: t.id, note: notes.find(n => n.tagId === t.id || (n.kind === 'character' && store.fold(n.title) === store.fold(t.name))) })),
      ...notes.filter(n => n.title && !v.characters.some(t => store.fold(t.name) === store.fold(n.title))).map(n => ({ name: n.title, kind: 'Ghi chú', note: n })),
      ...v.chapters.map(c => ({ name: c.title, kind: c.parentId ? 'Cảnh' : 'Chương', chapter: c })),
    ];
  }
  const sug = $('[data-suggest]');
  let sugList = [], sugI = 0;
  function suggest() {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/\[\[([^\]\n]{0,40})$/);
    if (!m) { sug.hidden = true; return; }
    const q = store.fold(m[1]);
    sugList = targets.filter(t => store.fold(t.name).includes(q)).slice(0, 8);
    if (!sugList.length && !m[1]) { sug.hidden = true; return; }
    sugI = 0;
    const { x, y } = caretY();
    const field = $('.fx-w-field');
    sug.style.left = Math.min(field.offsetLeft + x, scroller.clientWidth - 240) + 'px';
    sug.style.top = field.offsetTop + y + parseFloat(getComputedStyle(ta).lineHeight) + 4 + 'px';
    sug.innerHTML = (sugList.length ? sugList : [{ name: m[1], kind: 'Tạo hồ sơ nhân vật mới', create: true }]).map((t, i) => `<button role="option" data-i="${i}" class="${i === sugI ? 'on' : ''}"><b>${esc(t.name)}</b><small>${esc(t.kind)}</small></button>`).join('');
    if (!sugList.length) sugList = [{ name: m[1], create: true }];
    sug.hidden = false;
    sug.querySelectorAll('[data-i]').forEach(b => b.onmousedown = (e) => { e.preventDefault(); pick(+b.dataset.i); });
  }
  async function pick(i) {
    const t = sugList[i]; if (!t) return;
    const s = ta.selectionStart, before = ta.value.slice(0, s).replace(/\[\[([^\]\n]{0,40})$/, `[[${t.name}]]`);
    sug.hidden = true;
    replaceText(before + ta.value.slice(s).replace(/^\]\]/, ''), before.length);
    if (t.create) { await store.saveNote({ fanficId: id, kind: 'character', title: t.name }); await loadTargets(); toast(`Đã tạo hồ sơ “${t.name}”`); }
  }
  ta.addEventListener('keydown', (e) => {
    if (sug.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sugI = (sugI + (e.key === 'ArrowDown' ? 1 : -1) + sugList.length) % sugList.length; sug.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === sugI)); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(sugI); }
    else if (e.key === 'Escape') { e.stopPropagation(); sug.hidden = true; }
  }, true);
  async function openTarget(name) {
    const t = targets.find(x => store.fold(x.name) === store.fold(name));
    if (t?.chapter) return show(t.chapter.id);
    pinShow(t?.note ? { note: t.note.id } : { name });
  }

  // ── Toolbar ──
  el.querySelectorAll('[data-md]').forEach(b => b.onclick = () => format(b.dataset.md));
  function format(kind) {
    const s = ta.selectionStart, e = ta.selectionEnd, val = ta.value, sel = val.slice(s, e);
    let out, caret;
    if (kind === 'break') { out = `${val.slice(0, s).replace(/\n*$/, '')}\n\n* * *\n\n${val.slice(e).replace(/^\n*/, '')}`; caret = s + 9; }
    else if (kind === '[[') { out = val.slice(0, s) + '[[' + sel + (sel ? ']]' : '') + val.slice(e); caret = s + 2 + sel.length + (sel ? 2 : 0); }
    else if (kind.endsWith(' ')) { const ls = val.lastIndexOf('\n', s - 1) + 1; out = val.slice(0, ls) + kind + val.slice(ls); caret = e + kind.length; }
    else { out = val.slice(0, s) + kind + sel + kind + val.slice(e); caret = sel ? e + kind.length * 2 : s + kind.length; }
    replaceText(out, caret);
  }
  // Replace the whole text but keep the browser's undo history (Ctrl+Z): only the changed middle part is typed in.
  function replaceText(out, caret) {
    const old = ta.value;
    let a = 0; while (a < old.length && a < out.length && old[a] === out[a]) a++;
    let b = 0; while (b < old.length - a && b < out.length - a && old[old.length - 1 - b] === out[out.length - 1 - b]) b++;
    ta.focus(); ta.setSelectionRange(a, old.length - b);
    const mid = out.slice(a, out.length - b);
    if (!(mid ? document.execCommand('insertText', false, mid) : document.execCommand('delete')) || ta.value !== out) { ta.value = out; ta.dispatchEvent(new Event('input')); }
    ta.setSelectionRange(caret, caret);
  }
  ta.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'b') { e.preventDefault(); format('**'); }
    else if (mod && e.key === 'i') { e.preventDefault(); format('*'); }
    else if (mod && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); snap(); }
    else if (mod && e.key === 's') { e.preventDefault(); flush().then(() => toast('Đã lưu')); }
  });

  // ── Bar actions ──
  $('[data-a="back"]').onclick = () => tryClose();
  $('[data-a="binder"]').onclick = () => toggleBinder($('.fx-w-binder').hidden);
  $('[data-a="focus"]').onclick = () => setFocus(!focus);
  function setFocus(on) {
    focus = on; el.classList.toggle('focus', on); $('[data-a="focus"]').setAttribute('aria-pressed', on);
    if (on) { document.documentElement.requestFullscreen?.().catch(() => {}); toast('Chế độ tập trung: chạm mép trên hoặc nhấn Esc để thoát'); ta.focus(); }
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  el.addEventListener('pointerdown', (e) => { if (focus && e.clientY < 28 && e.pointerType !== 'mouse') setFocus(false); });
  $('[data-a="snap"]').onclick = () => snap();
  async function snap() { await flush(); await store.snapshotChapter(cur.id); toast('Đã lưu phiên bản'); }
  $('[data-a="look"]').onclick = () => tools().then(t => t.lookSheet());
  $('[data-a="sound"]').onclick = () => tools().then(t => t.soundSheet(ctx, v.item));
  $('[data-goal]').onclick = () => tools().then(t => t.lockSheet(api));
  $('[data-a="more"]').onclick = (e) => menu(e.currentTarget, [
    { label: preview ? 'Quay lại viết' : 'Xem trước', icon: 'fx-eye', run: togglePreview },
    { label: 'Tìm và thay thế', icon: 'search', hint: 'Ctrl+H', run: () => tools().then(t => t.findReplace(api)) },
    { label: 'Kiểm tra lặp từ và câu dài', icon: 'fx-plot', run: () => tools().then(t => t.analyze(api)) },
    { label: lock ? 'Phiên khoá đang chạy' : 'Khoá phiên viết…', icon: 'fx-lock', run: () => tools().then(t => t.lockSheet(api)) },
    '-',
    { label: 'Phiên bản đã lưu', icon: 'fx-snapshot', run: versions },
    { label: 'Ghi chú & mục tiêu chương', icon: 'fx-edit', run: inspector },
    { label: 'Ghi chú nhanh', icon: 'fx-idea', hint: 'Ctrl+.', run: () => scratch(true) },
    '-',
    v.published ? { label: 'Cập nhật bản trong Sách', icon: 'fx-publish', run: async () => { await flush(); await store.publish(id); toast('Đã cập nhật bản trong Sách'); } }
      : { label: 'Xuất bản sang Sách', icon: 'fx-publish', run: async () => { await flush(); await store.publish(id); await reload(); toast('Đã xuất bản sang Sách'); } },
    { label: 'Trang tác phẩm', icon: 'fx-works', run: () => tryClose() },
  ]);
  function togglePreview() {
    preview = !preview;
    $('.fx-w-field').hidden = preview; $('[data-prev]').hidden = !preview;
    if (preview) renderPreview(); else { paintDim(); ta.focus(); }
  }
  function renderPreview() {
    const html = mdToHtml(ta.value).replace(/\[\[([^\]\n]+)\]\]/g, (m, n) => `<a href="#" class="fx-wl" data-wl="${n}">${n}</a>`);
    $('[data-prev]').innerHTML = html || '<p class="muted">Chưa có nội dung.</p>';
    $('[data-prev]').querySelectorAll('[data-wl]').forEach(a => a.onclick = (e) => { e.preventDefault(); openTarget(a.dataset.wl); });
  }

  // ── Pinned side panel (split screen): a note, a character sheet, another chapter, or the story notes list ──
  $('[data-a="pin"]').onclick = () => { const p = $('[data-pinpanel]'); if (p.hidden) pinShow(null); else pinHide(); };
  async function pinShow(sel) {
    const p = $('[data-pinpanel]');
    p.hidden = false; $('[data-a="pin"]').setAttribute('aria-pressed', 'true'); el.classList.add('pinned');
    if (!narrow()) setPref('pinOpen', 1);
    const notes = await store.notesOf(id);
    const name = sel?.name;
    let note = sel?.note ? notes.find(n => n.id === sel.note) : null;
    const ch = sel?.chapter ? v.chapters.find(c => c.id === sel.chapter) : null;
    const opts = `<option value="">Chọn tài liệu để ghim…</option>
      <optgroup label="Ghi chú & hồ sơ">${notes.map(n => `<option value="n:${n.id}" ${note?.id === n.id ? 'selected' : ''}>${esc(n.title || 'Không tiêu đề')}</option>`).join('')}</optgroup>
      <optgroup label="Chương khác">${v.chapters.filter(c => c.id !== cur.id).map(c => `<option value="c:${c.id}" ${ch?.id === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</optgroup>`;
    p.innerHTML = `<header><select data-pinsel aria-label="Tài liệu ghim">${opts}</select><button class="icon-btn sm" data-pinx aria-label="Bỏ ghim">${icon('x')}</button></header>
      <div class="fx-w-pinbody fx-prose">${note ? `<h3>${esc(note.title)}</h3>${mdToHtml(note.body) || '<p class="muted">Hồ sơ trống.</p>'}<p><button class="btn small" data-pinedit>${icon('fx-edit')}Sửa</button></p>`
        : ch ? `<h3>${esc(ch.title)}</h3>${mdToHtml(ch.body)}` : name ? `<p>Chưa có hồ sơ cho “${esc(name)}”.</p><button class="btn small" data-pinnew>${icon('plus')}Tạo hồ sơ nhân vật</button>`
        : `<ul class="fx-pinlist">${notes.map(n => `<li><button data-pn="${n.id}"><b>${esc(n.title || 'Không tiêu đề')}</b><small>${esc((n.body || '').slice(0, 90))}</small></button></li>`).join('') || '<li class="muted">Chưa có ghi chú. Thêm ở trang tác phẩm, hoặc gõ [[Tên]] để tạo hồ sơ.</li>'}</ul>`}</div>`;
    p.querySelector('[data-pinx]').onclick = pinHide;
    p.querySelector('[data-pinsel]').onchange = (e) => { const [k, vId] = e.target.value.split(':'); pinShow(k === 'n' ? { note: vId } : k === 'c' ? { chapter: vId } : null); };
    p.querySelectorAll('[data-pn]').forEach(b => b.onclick = () => pinShow({ note: b.dataset.pn }));
    p.querySelector('[data-pinnew]')?.addEventListener('click', async () => { const nid = await store.saveNote({ fanficId: id, kind: 'character', title: name }); await loadTargets(); pinShow({ note: nid }); });
    p.querySelector('[data-pinedit]')?.addEventListener('click', () => tools().then(t => t.editNote(note, () => pinShow({ note: note.id }))));
  }
  function pinHide() { $('[data-pinpanel]').hidden = true; $('[data-a="pin"]').setAttribute('aria-pressed', 'false'); el.classList.remove('pinned'); if (!narrow()) setPref('pinOpen', 0); }

  // ── Floating scratchpad (per work, synced) ──
  const scr = $('[data-scratch]'), scrText = $('[data-scratchtext]');
  scrText.value = v.fic.scratch || '';
  const saveScratch = debounce(() => store.updateFanfic(id, { scratch: scrText.value }), 600);
  scrText.oninput = saveScratch;
  $('[data-a="scratch"]').onclick = () => scratch(scr.hidden);
  $('[data-a="scratch-x"]').onclick = () => scratch(false);
  function scratch(open) { scr.hidden = !open; if (open) scrText.focus(); else ta.focus(); }

  // ── Session lock (Cold Turkey style): no leaving until the word or time goal is met ──
  function lockTick() {
    if (!lock) return;
    const words = written() - lock.startWords, left = Math.max(0, lock.until - Date.now());
    const doneW = lock.words ? words >= lock.words : true, doneT = lock.until ? left <= 0 : true;
    const pW = lock.words ? Math.min(1, words / lock.words) : 1, pT = lock.until ? 1 - left / (lock.until - lock.start) : 1;
    $('[data-locktext]').textContent = doneW && doneT ? 'Đã đạt mục tiêu phiên. Có thể thoát.'
      : `Phiên khoá: ${lock.words ? `${fmtNum(Math.max(0, words))}/${fmtNum(lock.words)} từ` : ''}${lock.words && lock.until ? ' · ' : ''}${lock.until ? `còn ${Math.ceil(left / 60000)} phút` : ''}`;
    $('[data-lockbar-fill]').style.width = Math.round(Math.min(pW, pT) * 100) + '%';
    if (doneW && doneT) { lock.done = true; el.classList.remove('locked'); }
  }
  const lockTimer = setInterval(() => lockTick(), 15000);
  const beforeUnload = (e) => { if (lock && !lock.done) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  async function tryClose() {
    if (lock && !lock.done) {
      const ok = await modal({ title: 'Phiên viết đang khoá', body: `<p>${esc($('[data-locktext]').textContent)}</p><p class="muted">Viết tiếp để mở khoá. Nếu thật sự cần thoát, gõ <b>BỎ CUỘC</b> rồi bấm Thoát.</p><input id="fx-giveup" autocomplete="off">`,
        actions: [{ label: 'Viết tiếp', kind: 'primary', value: false }, { label: 'Thoát', value: (b) => b.querySelector('#fx-giveup').value.trim().toUpperCase() === 'BỎ CUỘC' }] });
      if (!ok) { ta.focus(); return; }
    }
    await close(); onClose();
  }

  // ── Key sounds (synthesised: no files) ──
  let actx = null;
  function keySound(type) {
    const kind = pref('keySound');
    if (kind === 'off') return;
    try {
      actx ||= new AudioContext();
      const t = actx.currentTime, vol = pref('keyVolume') * (kind === 'soft' ? 0.35 : 0.6);
      const ret = type === 'insertLineBreak' || type === 'insertParagraph';
      const len = kind === 'soft' ? 0.03 : 0.045;
      const buf = actx.createBuffer(1, Math.ceil(actx.sampleRate * len), actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, kind === 'soft' ? 6 : 3);
      const src = actx.createBufferSource(); src.buffer = buf;
      const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = (kind === 'soft' ? 1800 : 3200) * (0.9 + Math.random() * 0.2); f.Q.value = 1.2;
      const g = actx.createGain(); g.gain.value = vol;
      src.connect(f).connect(g).connect(actx.destination); src.start(t);
      if (ret && kind === 'typewriter') {   // carriage return bell
        const o = actx.createOscillator(), og = actx.createGain();
        o.frequency.value = 2093; og.gain.setValueAtTime(vol * 0.25, t + 0.05); og.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        o.connect(og).connect(actx.destination); o.start(t + 0.05); o.stop(t + 0.85);
      }
    } catch { /* audio unavailable */ }
  }

  async function versions() {
    await flush();
    const list = await store.versionsOf(cur.id);
    const box = h(`<div class="stack">${list.length ? `<ul class="fx-vers">${list.map(x => `<li><div><b>${esc(x.label || ({ manual: 'Chụp tay', auto: 'Tự động', publish: 'Xuất bản' })[x.kind])}</b><small class="muted">${new Date(x.createdAt).toLocaleString(globalThis.__LOCALE || 'vi-VN')} · ${ago(x.createdAt)} · ${fmtNum(x.words)} từ</small></div>
      <button class="btn small" data-view="${x.id}">Xem</button><button class="btn small" data-restore="${x.id}">Khôi phục</button></li>`).join('')}</ul>` : '<p class="muted">Chưa có phiên bản nào. Bấm biểu tượng máy ảnh để chụp trước khi sửa lớn.</p>'}</div>`);
    const s = sheet(`Phiên bản · ${cur.title}`, box, { wide: true });
    box.querySelectorAll('[data-view]').forEach(b => b.onclick = async () => (await tools()).versionDiff(list.find(y => y.id === b.dataset.view), ta.value, (text) => { insertAtCaret(text); }));
    box.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
      if (!(await modal({ title: 'Khôi phục phiên bản này?', body: '<p>Nội dung hiện tại được lưu thành một phiên bản trước khi thay.</p>', actions: [{ label: 'Huỷ', value: false }, { label: 'Khôi phục', kind: 'primary', value: true }] }))) return;
      await store.restoreVersion(b.dataset.restore); s.close(); await reload(); show(cur.id); toast('Đã khôi phục');
    });
  }
  function insertAtCaret(text) {
    const s = ta.selectionStart;
    replaceText(ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd), s + text.length);
    toast('Đã chèn đoạn từ phiên bản cũ');
  }
  function inspector() {
    const f = h(`<form class="fx-form">
      <label>Tóm tắt (thẻ corkboard)<textarea data-f="synopsis" rows="3">${esc(cur.synopsis || '')}</textarea></label>
      <label>Thẻ (POV, mạch truyện…)<input data-f="tags" value="${esc((cur.tags || []).join(', '))}" placeholder="POV Draco, hồi tưởng"></label>
      <div class="fx-2"><label>Trạng thái<select data-f="status">${Object.entries(CH_STATUS).map(([k, l]) => `<option value="${k}" ${k === cur.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Mục tiêu chương (từ)<input type="number" min="0" step="100" data-f="goal" value="${cur.goal || ''}"></label></div>
      <label>Ghi chú đầu chương (hiện cho người đọc)<textarea data-f="notesStart" rows="3">${esc(cur.notesStart || '')}</textarea></label>
      <label>Ghi chú cuối chương<textarea data-f="notesEnd" rows="3">${esc(cur.notesEnd || '')}</textarea></label>
      <footer class="row-actions"><button class="btn primary">${icon('check')}Lưu</button></footer></form>`);
    const s = sheet('Ghi chú & mục tiêu chương', f, { wide: true });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const g = (k) => f.querySelector(`[data-f="${k}"]`).value;
      const patch = { synopsis: g('synopsis').trim(), tags: store.splitList(g('tags')), status: g('status'), goal: +g('goal') || 0, notesStart: g('notesStart'), notesEnd: g('notesEnd') };
      await store.saveChapter(cur.id, patch); Object.assign(cur, patch); count(); s.close();
    };
  }

  // What the tools module (find/replace, analysis, lock, look, sound) needs from the writer.
  const api = {
    id, get v() { return v; }, get cur() { return cur; }, ta, flush, reload, show, paint: () => { count(); grow(); paintDim(); },
    startLock(words, minutes) { lock = { words, until: minutes ? Date.now() + minutes * 60000 : 0, start: Date.now(), startWords: written() }; $('[data-lockbar]').hidden = false; el.classList.add('locked'); lockTick(); },
    stopLock() { lock = null; $('[data-lockbar]').hidden = true; el.classList.remove('locked'); },
    get lock() { return lock; },
  };
  const tools = () => import('./writer-tools.js');

  // Esc leaves focus mode first; save when the app goes to the background (phones kill tabs).
  const onKey = (e) => {
    if (e.key === 'Escape' && focus) { e.preventDefault(); setFocus(false); }
    if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); scratch(scr.hidden); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'f') && !document.querySelector('.fx-sheet-wrap')) { e.preventDefault(); tools().then(t => t.findReplace(api)); }
  };
  const onHide = () => { if (document.visibilityState === 'hidden') { flush(); logSession(false); } };
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);
  ta.addEventListener('click', typewriter);
  ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) typewriter(); });
  ta.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 150));

  let logged = 0;
  async function logSession(end) {
    const secs = Math.round(ses.active / 1000) - logged;
    if (secs > 0 || end) { await store.logWriting(id, { seconds: Math.max(0, secs), sessions: end && ses.active > 60000 ? 1 : 0 }); logged += Math.max(0, secs); }
  }

  async function close() {
    if (closed) return;
    closed = true;
    await flush();
    await logSession(true).catch(() => {});
    offs.forEach(f => f());
    clearInterval(lockTimer);
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    actx?.close?.();
    el.remove();
    document.body.classList.remove('fx-writer-open');
    store.changed([id]);
    ctx.bus.emit('cover:refresh');
  }

  await show(chapterId);
  ses.startWords = countWords(ta.value);
  refreshToday();
  loadTargets();
  if (!narrow() && pref('pinOpen')) pinShow(null);
  return { close, show, locked: () => !!(lock && !lock.done), nudge: () => { toast('Phiên viết đang khoá: viết tới mục tiêu để thoát', 'warn'); ta.focus(); } };
}
