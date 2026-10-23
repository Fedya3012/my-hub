// Lyrics editor (Oto Music / Namida style): paste or import LRC, enhanced LRC, TTML, SRT or plain
// text; tap-to-sync line by line or word by word while listening, at 0.5–1× speed, looping the
// current line; per-line ±nudge and agent (singer 1 / 2 / together); a timeline with the waveform
// and draggable stamps; undo / redo; a translation track; LRCLIB search; export to every format.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { player } from '../lib/player.js';
import { parseLyrics, toLrc, toTtml, toSrt, toModel, lyricsKind, mergeTranslation, ensureLyricsCss } from '../lib/lyrics.js';
import { saveLyrics, searchLrclib, rowFromLrclib, SOURCE_LABEL } from '../lib/lyrics-sources.js';
import { fmtTime } from '../lib/format.js';
import { sheet } from './sheets.js';

const KIND_LABEL = { lrc: 'LRC', ttml: 'TTML (Apple)', srt: 'SRT / WebVTT', plain: 'Lời tĩnh (chưa có mốc thời gian)' };
const ts = (x) => x == null ? '—:—' : fmtTime(x) + '.' + String(Math.floor((x % 1) * 100)).padStart(2, '0');

// The file's tags can take the lyrics when the tag writer supports its format (MP3 / FLAC).
async function tagWriter(t) {
  try { const tw = await import('../lib/tagwriter.js'); return !!tw.writeLyrics && (!tw.canWrite || tw.canWrite(t)); } catch { return false; }
}

function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Peaks of the playing file for the timeline (decoded once per track, in the background).
const peaksCache = new Map();
async function peaksFor(t) {
  if (peaksCache.has(t.id)) return peaksCache.get(t.id);
  const job = (async () => {
    const src = player.engine.el?.currentSrc || player.engine.el?.src;
    if (!src || player.track?.id !== t.id) return null;
    const buf = await (await fetch(src)).arrayBuffer();
    if (buf.byteLength > 200e6) return null;
    const ctx = new OfflineAudioContext(1, 1, 22050);
    const a = await ctx.decodeAudioData(buf);
    const ch = a.getChannelData(0), per = Math.max(1, Math.floor(a.sampleRate / 50));   // 50 peaks / s
    const out = new Float32Array(Math.ceil(ch.length / per));
    for (let i = 0; i < out.length; i++) { let m = 0; for (let j = i * per, e = Math.min(ch.length, j + per); j < e; j++) { const v = Math.abs(ch[j]); if (v > m) m = v; } out[i] = m; }
    return { rate: 50, data: out };
  })().catch(() => null);
  peaksCache.set(t.id, job);
  return job;
}

export async function editLyrics(t, onDone) {
  ensureLyricsCss();
  const { db } = await import('../../../core/db.js');
  const cur = await db.lyrics.get(t.id);
  const canTags = await tagWriter(t);
  const s = sheet({ title: 'Lời bài hát', wide: true, cls: 'mly-sheet', onClose: () => cleanup(), body: `<div class="mly-edit">
    <div class="seg small mly-tabs" role="tablist">
      <button data-tab="text" aria-pressed="true">Văn bản</button><button data-tab="sync" aria-pressed="false">Đồng bộ</button>
      <button data-tab="tr" aria-pressed="false">Bản dịch</button><button data-tab="online" aria-pressed="false">Tìm trực tuyến</button></div>
    <div data-pane="text" class="stack">
      <textarea class="code" rows="12" spellcheck="false" placeholder="[00:12.30]Dòng lời có mốc thời gian&#10;[00:15.80]<00:15.80>Từng <00:16.20>chữ <00:16.70>(karaoke)&#10;[00:20.00]v2: Ca sĩ thứ hai (song ca)&#10;[bg: bè nền]&#10;&#10;…hoặc dán TTML / SRT / lời thường, rồi dùng tab Đồng bộ.">${esc(cur?.text || '')}</textarea>
      <div class="row-actions"><label class="btn small">${icon('upload')}Mở tệp<input type="file" accept=".lrc,.elrc,.ttml,.xml,.srt,.vtt,.txt" hidden></label>
        <button class="btn small" data-export>${icon('download')}Xuất…</button>
        <span class="hint" data-kind></span>${cur?.source ? `<span class="hint">· Nguồn: ${esc(SOURCE_LABEL[cur.source] || cur.source)}</span>` : ''}</div>
    </div>
    <div data-pane="sync" hidden class="mly-sync">
      <div class="mly-bar">
        <div class="seg small" role="group" aria-label="Kiểu gắn mốc"><button data-mode="line" aria-pressed="true">Theo dòng</button><button data-mode="word" aria-pressed="false">Từng từ</button></div>
        <div class="seg small" role="group" aria-label="Tốc độ khi gắn mốc">${[0.5, 0.75, 1].map(r => `<button data-rate="${r}" aria-pressed="${r === 1}">${String(r).replace('.', ',')}×</button>`).join('')}</div>
        <button class="btn small" data-loop aria-pressed="false" title="Lặp lại dòng đang chọn">${icon('repeat-one')}Lặp dòng</button>
        <span class="mly-ur"><button class="icon-btn sm" data-undo aria-label="Hoàn tác (Ctrl+Z)" title="Hoàn tác (Ctrl+Z)">↶</button><button class="icon-btn sm" data-redo aria-label="Làm lại (Ctrl+Y)" title="Làm lại (Ctrl+Y)">↷</button></span>
      </div>
      <canvas class="mly-tl" height="72" aria-label="Dòng thời gian: kéo các mốc để chỉnh, bấm để tua"></canvas>
      <p class="hint" data-sync-hint></p>
      <ol data-lines class="mly-lines"></ol>
      <div class="row-actions mly-transport"><button class="btn" data-play>${icon('play')}Phát / Dừng</button><button class="btn" data-back>−2s</button><button class="btn" data-fwd>+2s</button><button class="btn primary mly-stamp" data-stamp>${icon('clock')}Mốc <kbd>Space</kbd></button></div>
      <div class="row-actions"><span class="hint">Dời mọi mốc:</span><button class="btn small" data-nudge="-0.1">−0,1s</button><button class="btn small" data-nudge="-0.02">−0,02s</button><button class="btn small" data-nudge="0.02">+0,02s</button><button class="btn small" data-nudge="0.1">+0,1s</button>
        <span class="hint">Lưu dạng:</span><select data-outfmt class="small"><option value="lrc">LRC</option><option value="ttml">TTML</option></select></div>
    </div>
    <div data-pane="tr" hidden class="stack">
      <p class="hint">Mỗi dòng ở đây là bản dịch / phiên âm của dòng lời tương ứng (bỏ qua dòng trống trong lời). Có thể dán LRC bản dịch có mốc thời gian.</p>
      <div class="row-actions"><button class="btn small" data-aitr>${icon('translate')}Dịch bằng AI</button><span class="hint">Mô hình mã nguồn mở từ Hugging Face, chạy trên máy; dịch theo lời đã lưu; chọn ngôn ngữ đích và mô hình trong menu kiểu chữ lời.</span></div>
      <div class="mly-trgrid" data-trgrid></div>
      <textarea class="code" rows="10" data-trtext spellcheck="false" placeholder="Bản dịch dòng 1&#10;Bản dịch dòng 2&#10;…"></textarea>
    </div>
    <div data-pane="online" hidden class="stack">
      <p class="hint">Tìm lời trên LRCLIB (lrclib.net, miễn phí, cần mạng). Kết quả chỉ được lưu khi bạn bấm Dùng rồi Lưu.</p>
      <form class="mly-search" data-search><input type="search" name="q" value="${esc([t.title, t.artist].filter(Boolean).join(' '))}" aria-label="Tìm lời"><button class="btn small">${icon('search')}Tìm</button></form>
      <ol class="mly-results" data-results></ol>
    </div>
    <div class="row-actions"><button class="btn primary" data-save>${icon('check')}Lưu lời</button>
      ${canTags ? `<label class="hint"><input type="checkbox" data-totags> Ghi cả vào thẻ của tệp</label>` : ''}
      ${cur ? `<button class="btn danger-ghost" data-del>${icon('trash')}Xoá lời</button>` : ''}</div></div>` });
  const $ = (q) => s.el.querySelector(q), $$ = (q) => s.el.querySelectorAll(q);
  const ta = $('textarea'), trTa = $('[data-trtext]');
  trTa.value = cur?.trText || '';
  const kind = () => {
    const k = lyricsKind(ta.value);
    const p = k && k !== 'plain' ? parseLyrics(ta.value) : null;
    $('[data-kind]').textContent = !k ? '' : KIND_LABEL[k] + (p?.words ? ' · karaoke từng chữ' : p?.synced ? ' · theo dòng' : '') + (p?.lines.some(l => l.agent === 'v2') ? ' · song ca' : '') + (p?.lines.some(l => l.tr) ? ' · có bản dịch' : '');
  };
  ta.oninput = () => { kind(); dirtyText = true; };
  kind();
  $('input[type=file]').onchange = async (e) => { const f = e.target.files[0]; if (f) { ta.value = await f.text(); kind(); dirtyText = true; } };

  // ── Model, history ──
  let lines = [], at = 0, wi = 0, mode = 'line', undoS = [], redoS = [], dirtyText = true, outFmt = lyricsKind(ta.value) === 'ttml' ? 'ttml' : 'lrc', loopOn = false;
  $('[data-outfmt]').value = outFmt;
  const snap = () => JSON.stringify({ lines, at, wi });
  const push = () => { undoS.push(snap()); if (undoS.length > 300) undoS.shift(); redoS = []; };
  const restore = (x) => { const o = JSON.parse(x); lines = o.lines; at = o.at; wi = o.wi; commit(); };
  const undo = () => { if (!undoS.length) return toast('Không còn gì để hoàn tác'); redoS.push(snap()); restore(undoS.pop()); };
  const redo = () => { if (!redoS.length) return toast('Không còn gì để làm lại'); undoS.push(snap()); restore(redoS.pop()); };
  const loadModel = () => {
    if (!dirtyText) return;
    const p = parseLyrics(ta.value, t.duration);
    mergeTranslation(p, trTa.value);
    lines = toModel(p); at = 0; wi = 0; undoS = []; redoS = []; dirtyText = false;
    if (!p.synced) lines.forEach(l => { l.t = null; });
  };
  const serialize = () => outFmt === 'ttml' ? toTtml(lines, { duration: t.duration }) : toLrc(lines.map(l => ({ ...l, tr: null })));
  const commit = () => { ta.value = serialize(); kind(); drawSync(); };
  const endOf = (i) => lines[i]?.end ?? lines[i]?.wend ?? lines.slice(i + 1).find(l => l.t != null)?.t ?? (lines[i]?.t ?? 0) + 5;

  const hint = () => { $('[data-sync-hint]').innerHTML = mode === 'line'
    ? 'Bấm Phát rồi nhấn <b>Mốc</b> (phím Space) đúng lúc mỗi dòng bắt đầu. Bấm một dòng để chọn; nút −/+ chỉnh dòng đó 0,05s; kéo mốc trên dòng thời gian để chỉnh chính xác.'
    : 'Nhấn <b>Mốc</b> (Space) đúng lúc mỗi từ bắt đầu; sau từ cuối nhấn thêm một lần khi từ đó kết thúc. Bấm vào một từ để chọn lại.'; };
  const AG = { v1: '1', v2: '2', v1000: '⚭' };
  const drawSync = () => {
    $('[data-lines]').innerHTML = lines.map((l, i) => `<li class="${i === at ? 'cur' : ''}${l.agent === 'v2' ? ' v2' : ''}" data-i="${i}">
      <span class="mly-lt"><button type="button" class="mly-n" data-ln="-0.05" aria-label="Sớm hơn 0,05 giây">−</button><button type="button" class="num mly-time" data-seekto title="Phát từ mốc này">${ts(l.t)}</button><button type="button" class="mly-n" data-ln="0.05" aria-label="Muộn hơn 0,05 giây">+</button></span>
      <span class="mly-txt">${mode === 'word' && l.words.length
        ? `<span class="mly-words">${l.words.map((w, j) => `<button type="button" class="mly-w${w.t != null ? ' set' : ''}${i === at && j === wi ? ' cur' : ''}" data-j="${j}" title="${ts(w.t)}">${esc(w.text)}</button>`).join(' ')}<span class="mly-w mly-end${l.wend != null ? ' set' : ''}${i === at && wi === l.words.length ? ' cur' : ''}" title="Kết thúc dòng ${ts(l.wend)}">⏹</span></span>`
        : esc(l.text) || '♪'}${l.bg ? `<small class="mly-bgt">(${esc(l.bg.text)})</small>` : ''}${l.tr ? `<small class="mly-trt">${esc(l.tr)}</small>` : ''}</span>
      <button type="button" class="mly-ag" data-ag title="Người hát: 1 / 2 / cùng hát">${AG[l.agent] || '1'}</button></li>`).join('');
    $('[data-lines] li.cur')?.scrollIntoView({ block: 'nearest' });
    playIdx = -2;
  };
  $('[data-lines]').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const i = +li.dataset.i, L = lines[i];
    const nb = e.target.closest('[data-ln]');
    if (nb) { if (L.t == null) return; push(); const d = +nb.dataset.ln; L.t = Math.max(0, L.t + d); if (L.words[0]?.t != null) L.words.forEach(w => { if (w.t != null) w.t = Math.max(0, w.t + d); }); if (L.wend != null) L.wend += d; at = i; commit(); return; }
    if (e.target.closest('[data-seekto]')) { at = i; if (L.t != null && player.track?.id === t.id) player.seek(Math.max(0, L.t - 0.5)); drawSync(); return; }
    if (e.target.closest('[data-ag]')) { push(); L.agent = { v1: 'v2', v2: 'v1000', v1000: null }[L.agent || 'v1'] || null; if (L.agent === 'v1') L.agent = null; commit(); return; }
    at = i; const w = e.target.closest('[data-j]'); wi = w ? +w.dataset.j : 0; drawSync();
  });
  const stamp = () => {
    if (player.track?.id !== t.id) { toast('Hãy phát bài này trước khi gắn mốc', 'warn'); return; }
    const L = lines[at];
    if (!L) return;
    const now = Math.max(0, (player.engine.preciseTime ?? player.time) - 0.15 * player.engine.rate);
    push();
    if (mode === 'line' || !L.words.length) {
      const d = L.t != null && L.words[0]?.t != null ? now - L.t : null;
      L.t = now; if (d != null) { L.words.forEach(w => { if (w.t != null) w.t += d; }); if (L.wend != null) L.wend += d; }
      L.end = null;
      at = Math.min(lines.length - 1, at + 1); wi = 0;
    } else if (wi < L.words.length) {
      L.words[wi].t = now; if (wi === 0) L.t = now; wi++;
    } else {
      L.wend = now; at = Math.min(lines.length - 1, at + 1); wi = 0;
    }
    commit();
  };
  const setMode = (m) => { mode = m; wi = 0; $$('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === m)); hint(); drawSync(); };
  $$('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  const rate0 = player.engine.rate;
  $$('[data-rate]').forEach(b => b.onclick = () => { player.engine.setRate(+b.dataset.rate); $$('[data-rate]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $('[data-loop]').onclick = (e) => { loopOn = !loopOn; e.currentTarget.setAttribute('aria-pressed', loopOn); };
  $('[data-undo]').onclick = undo; $('[data-redo]').onclick = redo;
  $('[data-outfmt]').onchange = (e) => { outFmt = e.target.value; commit(); };
  $$('[data-nudge]').forEach(b => b.onclick = () => {
    const d = +b.dataset.nudge, f = (x) => x == null ? x : Math.max(0, x + d);
    push();
    for (const l of lines) { l.t = f(l.t); l.wend = f(l.wend); l.end = f(l.end); l.words.forEach(w => w.t = f(w.t)); if (l.bg) { l.bg.wend = f(l.bg.wend); l.bg.words.forEach(w => w.t = f(w.t)); } }
    commit(); toast(`Đã dời mọi mốc ${d > 0 ? '+' : '−'}${Math.abs(d).toString().replace('.', ',')}s`);
  });

  // ── Translation pane: one row per lyric line ──
  const drawTr = () => {
    $('[data-trgrid]').innerHTML = lines.length ? `<ol class="mly-trlist">${lines.map((l, i) => `<li><span>${esc(l.text)}</span><input data-tri="${i}" value="${esc(l.tr || '')}" placeholder="Bản dịch…" aria-label="Bản dịch dòng ${i + 1}"></li>`).join('')}</ol>` : '<p class="hint">Chưa có lời.</p>';
    trTa.hidden = true;
  };
  $('[data-trgrid]').addEventListener('input', (e) => {
    const i = e.target.dataset.tri;
    if (i == null) return;
    lines[+i].tr = e.target.value.trim() || null;
    trTa.value = lines.map(l => l.tr || '').join('\n').replace(/\n+$/, '');
  });

  $('[data-aitr]').onclick = async () => {
    try {
      const { translateLyrics } = await import('../lib/lyrics-translate.js');
      const r = await translateLyrics(t);
      if (r) { trTa.value = r; dirtyText = true; loadModel(); drawTr(); }
    } catch (e) { toast(e.message || 'Không dịch được', 'warn'); }
  };

  // ── Online search ──
  $('[data-search]').onsubmit = async (e) => {
    e.preventDefault();
    const box = $('[data-results]');
    if (!navigator.onLine) { box.innerHTML = '<li class="hint">Đang ngoại tuyến.</li>'; return; }
    box.innerHTML = '<li class="hint">Đang tìm…</li>';
    try {
      const list = (await searchLrclib(e.target.q.value.trim(), t)).slice(0, 20);
      box.innerHTML = list.length ? list.map((r, i) => `<li><div><b>${esc(r.trackName)}</b> <span class="muted">${esc(r.artistName)}${r.albumName ? ' · ' + esc(r.albumName) : ''} · ${fmtTime(r.duration || 0)}</span>
        <span class="pill">${r.instrumental ? 'Không lời' : r.syncedLyrics ? 'Có mốc' : 'Lời tĩnh'}</span>
        <small class="mly-prev">${esc((r.plainLyrics || '').split('\n').slice(0, 2).join(' / '))}</small></div><button class="btn small" data-use="${i}">Dùng</button></li>`).join('') : '<li class="hint">Không tìm thấy.</li>';
      box.querySelectorAll('[data-use]').forEach(b => b.onclick = () => {
        const row = rowFromLrclib(list[+b.dataset.use]);
        if (!row) return toast('Bản này không có lời');
        ta.value = row.text; kind(); dirtyText = true; picked = 'lrclib'; tab('text'); toast('Đã đưa vào ô Văn bản, bấm Lưu để giữ');
      });
    } catch { box.innerHTML = '<li class="hint">Không kết nối được LRCLIB.</li>'; }
  };
  let picked = null;

  // ── Tabs ──
  const tab = (name) => {
    $$('[data-tab]').forEach(x => x.setAttribute('aria-pressed', x.dataset.tab === name));
    $$('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== name);
    if (name === 'sync' || name === 'tr') { loadModel(); }
    if (name === 'sync') { hint(); drawSync(); requestAnimationFrame(tick); if (player.track?.id === t.id) peaksFor(t).then(p => { peaks = p; }); }
    if (name === 'tr') drawTr();
    pane = name;
  };
  let pane = 'text';
  $$('[data-tab]').forEach(b => b.onclick = () => tab(b.dataset.tab));
  $('[data-play]').onclick = () => player.track?.id === t.id ? player.toggle() : player.play([t]);
  $('[data-back]').onclick = () => player.seekBy(-2);
  $('[data-fwd]').onclick = () => player.seekBy(2);
  $('[data-stamp]').onclick = stamp;
  s.el.addEventListener('keydown', (e) => {
    if (e.target.matches('textarea, input, select')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
    if (pane !== 'sync') return;
    if (e.code === 'Space') { e.preventDefault(); stamp(); } else if (e.code === 'Backspace') { e.preventDefault(); undo(); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); wi = 0; drawSync(); } else if (e.code === 'ArrowDown') { e.preventDefault(); at = Math.min(lines.length - 1, at + 1); wi = 0; drawSync(); }
  });
  $('[data-export]').onclick = async (e) => {
    loadModel();
    const { menu } = await import('./sheets.js');
    const base = (t.fileName || t.title || 'lyrics').replace(/\.[^.]+$/, '');
    menu(e.currentTarget, [
      { icon: 'download', label: 'LRC theo dòng (.lrc)', act: () => download(base + '.lrc', toLrc(lines, { words: false, tr: false })) },
      { icon: 'download', label: 'LRC nâng cao, từng chữ (.lrc)', act: () => download(base + '.lrc', toLrc(lines, { words: true })) },
      { icon: 'download', label: 'LRC song ngữ (kèm bản dịch)', act: () => download(base + '.lrc', toLrc(lines, { words: true, tr: true })) },
      { icon: 'download', label: 'TTML (Apple Music)', act: () => download(base + '.ttml', toTtml(lines, { duration: t.duration }), 'application/ttml+xml') },
      { icon: 'download', label: 'Phụ đề SRT', act: () => download(base + '.srt', toSrt(lines)) },
      { icon: 'copy', label: 'Sao chép văn bản thường', act: () => navigator.clipboard?.writeText(lines.map(l => l.text).join('\n')).then(() => toast('Đã sao chép')) },
    ], { title: 'Xuất lời' });
  };

  // ── Timeline (waveform + draggable stamps) and loop, while the sync pane is open ──
  const cv = $('.mly-tl');
  let peaks = null, playIdx = -2, drag = null, view0 = 0;
  const SPAN = 12;
  const xToT = (x) => view0 + x / cv.clientWidth * SPAN;
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, w = cv.clientWidth;
    let best = -1, bd = 9;
    lines.forEach((l, i) => { if (l.t == null) return; const lx = (l.t - view0) / SPAN * w; if (Math.abs(lx - x) < bd) { bd = Math.abs(lx - x); best = i; } });
    if (best >= 0) { push(); drag = { i: best, d0: lines[best].t }; at = best; cv.setPointerCapture(e.pointerId); }
    else if (player.track?.id === t.id) player.seek(Math.max(0, xToT(x)));
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) { cv.style.cursor = 'pointer'; return; }
    const r = cv.getBoundingClientRect(), L = lines[drag.i];
    const nt = Math.max(0, xToT(e.clientX - r.left)), d = nt - L.t;
    L.t = nt; L.words.forEach(w => { if (w.t != null) w.t += d; }); if (L.wend != null) L.wend += d;
  });
  const endDrag = () => { if (drag) { drag = null; commit(); } };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  let raf = 0, closed = false;
  const tick = () => {
    if (closed || pane !== 'sync' || !s.el.isConnected) return;
    const now = player.track?.id === t.id ? (player.engine.preciseTime ?? player.time) : 0;
    // Loop the selected line
    if (loopOn && player.playing && lines[at]?.t != null && player.track?.id === t.id) {
      const e = endOf(at);
      if (now > e + 0.15 || now < lines[at].t - 1.5) player.seek(Math.max(0, lines[at].t - 0.25));
    }
    // Highlight the line being heard (only when it changes)
    let pi = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i].t != null && lines[i].t <= now) pi = i;
    if (pi !== playIdx) {
      s.el.querySelector('[data-lines] li.playing')?.classList.remove('playing');
      s.el.querySelector(`[data-lines] li[data-i="${pi}"]`)?.classList.add('playing');
      playIdx = pi;
    }
    drawTl(now);
    raf = requestAnimationFrame(tick);
  };
  const css = getComputedStyle(s.el);
  const acc = css.getPropertyValue('--accent').trim() || '#e0457b', fg = css.color || '#ccc';
  const drawTl = (now) => {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    view0 = Math.max(0, now - SPAN * 0.35);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.fillStyle = fg; g.globalAlpha = 0.28;
    if (peaks?.data) {
      const { rate, data } = peaks;
      for (let x = 0; x < w; x += 2) {
        const a = Math.floor((view0 + x / w * SPAN) * rate), b = Math.floor((view0 + (x + 2) / w * SPAN) * rate);
        let m = 0; for (let k = a; k < b && k < data.length; k++) if (data[k] > m) m = data[k];
        const bh = Math.max(1, m * (h - 18)); g.fillRect(x, (h - 14 - bh) / 2 + 2, 1.5, bh);
      }
    } else { g.fillRect(0, h / 2 - 7, w, 1); }
    g.globalAlpha = 0.5; g.font = '10px system-ui';
    for (let s2 = Math.ceil(view0); s2 < view0 + SPAN; s2++) { const x = (s2 - view0) / SPAN * w; g.fillRect(x, h - 12, 1, 4); if (s2 % 2 === 0) g.fillText(fmtTime(s2), x + 2, h - 2); }
    lines.forEach((l, i) => {
      if (l.t == null || l.t < view0 - 1 || l.t > view0 + SPAN) return;
      const x = (l.t - view0) / SPAN * w;
      g.globalAlpha = i === at ? 1 : 0.7; g.fillStyle = i === at ? acc : fg;
      g.fillRect(x - 1, 0, 2, h - 14);
      g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.fill();
      g.fillText(String(i + 1), x + 3, 16);
      g.globalAlpha = 0.45;
      for (const wd of l.words) if (wd.t != null && wd.t !== l.t) { const wx = (wd.t - view0) / SPAN * w; g.fillRect(wx, h - 26, 1, 10); }
      g.fillStyle = fg;
    });
    g.globalAlpha = 1; g.fillStyle = acc;
    const px = (now - view0) / SPAN * w; g.fillRect(px - 1, 0, 2, h);
  };
  const cleanup = () => { closed = true; cancelAnimationFrame(raf); if (player.engine.rate !== rate0) player.engine.setRate(rate0); };

  $('[data-save]').onclick = async () => {
    if (pane === 'sync' || pane === 'tr') { if (!dirtyText) ta.value = serialize(); }
    if (!dirtyText && lines.length) trTa.value = lines.map(l => l.tr || '').join('\n').replace(/\n+$/, '');
    const where = await saveLyrics(t, { text: ta.value, trText: trTa.value.trim() || null, offset: cur?.offset || 0, source: picked || 'user', toTags: !!$('[data-totags]')?.checked });
    s.close(); toast(where === 'tags' ? 'Đã lưu lời (cả trong thẻ của tệp)' : 'Đã lưu lời'); onDone?.();
  };
  $('[data-del]')?.addEventListener('click', async () => { await saveLyrics(t, { text: '' }); s.close(); toast('Đã xoá lời'); onDone?.(); });
  return s;
}
