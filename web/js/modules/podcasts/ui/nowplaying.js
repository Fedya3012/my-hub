// Đang phát (#podcasts/play): big cover, Chép lời / Chương / Dấu trang / Ghi chú, waveform seek bar, orange play,
// skip buttons, speed, sleep timer, Voice Boost and Skip silence. Flex Mode (Z Flip half-open): the cover and panels
// sit in the top half (.fold-top), the waveform and controls in the bottom half (.fold-bottom).
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import * as store from '../lib/store.js';
import { player } from '../lib/player.js';
import { get, SPEEDS } from '../lib/prefs.js';
import { hash } from '../lib/net.js';
import { art, fmtClock, fmtLen, notesHtml, tsToSec, pick } from './common.js';

const PANELS = [['transcript', 'pc-transcript', 'Chép lời'], ['chapters', 'pc-chapters', 'Chương'], ['marks', 'pc-bookmark', 'Dấu trang'], ['notes', 'pc-qa', 'Ghi chú tập']];
let panel = 'transcript';
const peaksCache = new Map();   // episode id → Float32Array of real peaks (downloaded / local files only)

export async function render(el, { go, rerender }) {
  const e = player.ep;
  if (!e) {
    el.innerHTML = `<div class="pc-np-empty">${icon('podcast')}<p>Chưa phát tập nào.</p><a class="btn primary" href="#podcasts">Về Trang chủ</a></div>`;
    return;
  }
  const s = player.show;
  const [chs, marks] = await Promise.all([store.chapters(e), store.bookmarks(e.id)]);
  const cover = e.image || s?.image || '';
  el.innerHTML = `<div class="pc-np" style="--bgimg:url('${esc(cover)}')">
    <div class="fold-top">
      <header class="pc-np-bar">
        <button class="icon-btn" data-k="close" aria-label="Thu nhỏ">${icon('arrow')}</button>
        <a class="pc-np-from" href="#podcasts/show/${encodeURIComponent(e.showId)}"><small>Đang phát từ</small><b>${esc(s?.title || 'Podcast')}</b></a>
        <button class="icon-btn pc-np-hb" data-k="mark" aria-label="Đánh dấu">${icon('pc-bookmark')}</button>
        <a class="icon-btn pc-np-hb" href="#podcasts/queue" aria-label="Hàng chờ">${icon('pc-queue')}</a>
        <button class="icon-btn" data-k="menu" aria-label="Thêm">${icon('pc-more')}</button>
      </header>
      <div class="pc-np-cover">${art(cover, s?.title || e.title, 'np')}</div>
      <div class="pc-np-title"><h1>${esc(e.title)}</h1><p class="muted">${esc(s?.author || '')}<span data-chap></span></p></div>
      <nav class="pc-np-tabs" role="tablist">${PANELS.map(([k, ic, l]) => `<button role="tab" data-panel="${k}" aria-selected="${panel === k}">${icon(ic)}<span>${l}</span></button>`).join('')}</nav>
      <div class="pc-np-panel" data-body></div>
    </div>
    <div class="fold-bottom">
      <div class="pc-wave" data-wave role="slider" aria-label="Vị trí" tabindex="0"><canvas></canvas></div>
      <div class="pc-np-times"><span data-t>0:00</span><span data-left></span></div>
      <div class="pc-np-ctl">
        <button class="pc-pill" data-k="speed" aria-label="Tốc độ">${player.rate}×</button>
        <button class="icon-btn lg" data-k="back" aria-label="Lùi ${get('skipBack')} giây">${icon('pc-back')}<i>${get('skipBack')}</i></button>
        <button class="pc-play" data-k="toggle" aria-label="Phát">${icon('pc-play')}</button>
        <button class="icon-btn lg" data-k="fwd" aria-label="Tới ${get('skipFwd')} giây">${icon('pc-fwd')}<i>${get('skipFwd')}</i></button>
        <button class="pc-pill" data-k="sleep" aria-label="Hẹn giờ ngủ">${icon('pc-moon')}<span data-sleep></span></button>
      </div>
      <div class="pc-np-fx">
        <button class="pc-tog" data-fx="voiceBoost" aria-pressed="${!!get('voiceBoost')}">${icon('pc-boost')}Voice Boost</button>
        <button class="pc-tog" data-fx="skipSilence" aria-pressed="${!!get('skipSilence')}">${icon('pc-silence')}Bỏ khoảng lặng<span class="pc-saved" data-saved></span></button>
        <button class="pc-tog pc-np-fxmore" data-k="mark">${icon('pc-bookmark')}Đánh dấu</button>
        <a class="pc-tog pc-np-fxmore" href="#podcasts/queue">${icon('pc-queue')}Hàng chờ</a>
      </div>
    </div>
  </div>`;
  const $ = (q) => el.querySelector(q);
  const body = $('[data-body]'), wave = $('[data-wave]'), canvas = wave.querySelector('canvas');
  let cues = null, lastCue = -1;

  // ── Panels ──
  const showPanel = async () => {
    el.querySelectorAll('[data-panel]').forEach(b => b.setAttribute('aria-selected', b.dataset.panel === panel));
    lastCue = -1;
    if (panel === 'chapters') body.innerHTML = chs.length ? `<ol class="pc-chaps">${chs.map((c, i) => `<li><button data-seek="${c.start}" data-ci="${i}">${c.img ? `<img src="${esc(c.img)}" alt="" referrerpolicy="no-referrer" data-drop-on-error>` : ''}<span>${esc(c.title || 'Chương ' + (i + 1))}</span><small>${fmtClock(c.start)}</small></button></li>`).join('')}</ol>` : '<p class="muted pc-empty">Tập này không có chương.</p>';
    if (panel === 'marks') body.innerHTML = (marks.length ? `<ul class="pc-marks">${marks.map(m => `<li><button data-seek="${m.at}" aria-label="Tới ${fmtClock(m.at)}">${icon('pc-bookmark')}<b>${fmtClock(m.at)}</b></button><input class="pc-mark-note" data-note="${esc(m.id)}" value="${esc(m.note || '')}" placeholder="Thêm ghi chú…" enterkeyhint="done" aria-label="Ghi chú dấu trang ${fmtClock(m.at)}"><button class="icon-btn" data-delmark="${esc(m.id)}" aria-label="Xoá">${icon('x')}</button></li>`).join('')}</ul>` : '<p class="muted pc-empty">Chưa có dấu trang. Bấm “Đánh dấu” để lưu khoảnh khắc này.</p>');
    if (panel === 'notes') body.innerHTML = `<div class="pc-notes">${notesHtml(e.description) || '<p class="muted">Không có ghi chú.</p>'}</div>${(e.persons || []).length ? `<p class="muted">Người tham gia: ${e.persons.map(p => `${esc(p.name)} (${p.role === 'guest' ? 'khách mời' : p.role === 'host' ? 'dẫn' : esc(p.role)})`).join(', ')}</p>` : ''}`;
    if (panel === 'transcript') {
      body.innerHTML = '<p class="muted pc-loading">Đang tải bản chép lời…</p>';
      try { cues = (await store.transcript(e))?.cues || null; } catch (err) { cues = null; console.warn(err); }
      if (panel !== 'transcript') return;
      body.innerHTML = cues?.length
        ? `<div class="pc-tx">${cues.map((c, i) => `<p data-ci="${i}" ${c.start >= 0 ? `data-seek="${c.start}"` : ''}>${c.speaker ? `<b>${esc(c.speaker)}</b> ` : ''}${esc(c.text)}</p>`).join('')}</div>`
        : `<div class="pc-empty pc-tx-empty"><p class="muted">Tập này chưa có bản chép lời.</p><button class="btn sm" data-k="ai">${icon('pc-mic')}Tạo bằng AI</button><p class="muted"><small>Chạy trên máy (Whisper). Lần đầu tải mô hình ≈ 80 MB.</small></p></div>`;
      paintCue(true);
    }
  };
  const paintCue = (force) => {
    if (panel !== 'transcript' || !cues?.length || cues[0].start < 0) return;
    const t = player.time;
    let i = cues.findIndex((c, k) => t >= c.start && (k === cues.length - 1 || t < cues[k + 1].start));
    if (i === lastCue && !force) return;
    lastCue = i;
    body.querySelectorAll('.pc-tx p.on').forEach(p => p.classList.remove('on'));
    const p = body.querySelector(`.pc-tx p[data-ci="${i}"]`);
    if (p) { p.classList.add('on'); if (!body.matches(':hover')) body.scrollTo({ top: p.offsetTop - body.clientHeight / 2 + p.offsetHeight / 2, behavior: force ? 'auto' : 'smooth' }); }   // scroll the panel only, never the page
  };

  // ── Waveform ──
  const bars = 120;
  const seeded = (() => { let x = parseInt(hash(e.id).slice(0, 7), 36) || 1; return Array.from({ length: bars }, (_, i) => { x = (x * 16807) % 2147483647; const env = 0.55 + 0.45 * Math.sin(i / bars * Math.PI); return (0.25 + (x / 2147483647) * 0.75) * env; }); })();
  let peaks = peaksCache.get(e.id) || seeded;
  if (!peaksCache.has(e.id)) realPeaks(e, bars).then(p => { if (p) { peaksCache.set(e.id, p); peaks = p; draw(); } });
  const draw = () => {
    const w = wave.clientWidth, h = wave.clientHeight, dpr = devicePixelRatio || 1;
    if (!w) return;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const css = getComputedStyle(el.querySelector('.pc-np'));
    const on = css.getPropertyValue('--pc-accent').trim() || '#ff7a1a', off = css.getPropertyValue('--pc-wave-off').trim() || 'rgba(255,255,255,.25)';
    const pos = player.duration ? player.time / player.duration : 0;
    const bw = w / bars;
    for (let i = 0; i < bars; i++) {
      const v = peaks[i] || 0.1, bh = Math.max(3, v * h * 0.9);
      g.fillStyle = (i + 0.5) / bars <= pos ? on : off;
      g.beginPath(); g.roundRect ? g.roundRect(i * bw + bw * 0.2, (h - bh) / 2, bw * 0.6, bh, bw * 0.3) : g.rect(i * bw + bw * 0.2, (h - bh) / 2, bw * 0.6, bh); g.fill();
    }
    if (player.duration) {
      g.fillStyle = css.getPropertyValue('--fg').trim() || '#fff';
      for (const c of chs) if (c.start > 0) g.fillRect(c.start / player.duration * w - 0.5, h - 4, 1.5, 4);
      g.fillStyle = on;
      for (const m of marks) { g.beginPath(); g.arc(m.at / player.duration * w, 3, 2.5, 0, 7); g.fill(); }
    }
  };
  const seekAt = (x) => { const r = wave.getBoundingClientRect(); if (player.duration) player.seek(Math.max(0, Math.min(1, (x - r.left) / r.width)) * player.duration); draw(); };
  let dragging = false;
  wave.addEventListener('pointerdown', (ev) => { dragging = true; wave.setPointerCapture(ev.pointerId); seekAt(ev.clientX); });
  wave.addEventListener('pointermove', (ev) => { if (dragging) seekAt(ev.clientX); });
  wave.addEventListener('pointerup', () => { dragging = false; });
  wave.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowLeft') player.back(); if (ev.key === 'ArrowRight') player.fwd(); });

  const paint = () => {
    $('[data-t]').textContent = fmtClock(player.time);
    $('[data-left]').textContent = player.duration ? '-' + fmtClock(player.duration - player.time) : '';
    wave.setAttribute('aria-valuenow', Math.round(player.time)); wave.setAttribute('aria-valuemax', Math.round(player.duration));
    const c = [...chs].reverse().find(x => player.time >= x.start);
    $('[data-chap]').textContent = c ? ' · ' + c.title : '';
    const left = player.sleepLeft;
    $('[data-sleep]').textContent = left != null ? fmtClock(left) : player.sleep?.endOfEpisode ? 'Hết tập' : player.sleep?.chapterEnd != null ? 'Hết chương' : '';
    const sv = get('skipSilence') && player.savedEp >= 1 ? ' · −' + fmtClock(player.savedEp) : '';
    if ($('[data-saved]').textContent !== sv) $('[data-saved]').textContent = sv;
    draw(); paintCue();
  };
  const paintState = () => {
    const b = $('[data-k="toggle"]');
    b.innerHTML = icon(player.playing ? 'pc-pause' : 'pc-play');
    b.setAttribute('aria-label', player.playing ? 'Tạm dừng' : 'Phát');
    $('[data-k="speed"]').textContent = (player.el?.playbackRate && !player._boosted ? player.el.playbackRate : player.rate) + '×';
    el.querySelectorAll('[data-fx]').forEach(x => x.setAttribute('aria-pressed', !!get(x.dataset.fx)));
    paint();
  };

  // ── Actions ──
  el.addEventListener('click', async (ev) => {
    const sk = ev.target.closest('[data-seek]');
    if (sk) { player.seek(+sk.dataset.seek); return; }
    const ts = ev.target.closest('[data-ts]');
    if (ts) { player.seek(tsToSec(ts.dataset.ts)); return; }
    const dm = ev.target.closest('[data-delmark]');
    if (dm) { await store.deleteBookmark(dm.dataset.delmark); marks.splice(marks.findIndex(m => m.id === dm.dataset.delmark), 1); showPanel(); draw(); return; }
    const p = ev.target.closest('[data-panel]');
    if (p) { panel = p.dataset.panel; showPanel(); return; }
    const fx = ev.target.closest('[data-fx]');
    if (fx) { await player.setFx(fx.dataset.fx, !get(fx.dataset.fx)); return; }
    const k = ev.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    if (k === 'toggle') player.toggle();
    if (k === 'back') player.back();
    if (k === 'fwd') player.fwd();
    if (k === 'close') history.length > 1 ? history.back() : go('');
    if (k === 'speed') await speedSheet();
    if (k === 'sleep') await sleepSheet(chs);
    if (k === 'mark') {
      // Saved at once (no dialog in the way); the note can be typed in the Dấu trang panel right after.
      const at = Math.round(player.time);
      const id = await store.addBookmark(e, at, '');
      marks.splice(0, marks.length, ...(await store.bookmarks(e.id)));
      panel = 'marks'; await showPanel(); draw();
      body.querySelector(`[data-note="${CSS.escape(id)}"]`)?.focus();
      toast(`Đã lưu dấu trang ở ${fmtClock(at)}`);
    }
    if (k === 'ai') {
      const blob = await store.downloadedBlob(e.id);
      if (!blob) { toast('Hãy tải tập về máy trước, rồi tạo bản chép lời.', 'warn'); return; }
      try {
        const ai = await import('../../music/lib/lyrics-ai.js');
        const cs = await tasks.run({ label: 'Chép lời bằng AI', detail: e.title, cancellable: true }, (t) => ai.transcribeBlob(blob, { task: t, lang: (s?.language || '').slice(0, 2) }));
        if (cs.length) { await store.saveTranscript(e, cs, 'ai'); toast('Đã tạo bản chép lời'); showPanel(); } else toast('Không nghe được lời nói nào.', 'warn');
      } catch (err) { if (err?.name !== 'AbortError') toast('Không tạo được: ' + err.message, 'error'); }
    }
    if (k === 'menu') {
      const { episodeMenu } = await import('./common.js');
      await episodeMenu(e.id, {});
    }
  });

  body.addEventListener('change', async (ev) => {
    const n = ev.target.closest('[data-note]'); if (!n) return;
    await store.noteBookmark(n.dataset.note, n.value.trim());
    const m = marks.find(x => x.id === n.dataset.note); if (m) m.note = n.value.trim();
  });
  body.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('[data-note]')) ev.target.blur(); });

  for (const t of ['state', 'episode']) player.addEventListener(t, t === 'episode' ? rerenderSoon : paintState);
  player.addEventListener('time', paint);
  const ro = new ResizeObserver(draw); ro.observe(wave);
  const clock = setInterval(() => { if (player.sleep?.until) paint(); }, 1000);
  function rerenderSoon() { if (location.hash === '#podcasts/play') rerender(); }
  paintState(); showPanel();
  return () => {
    player.removeEventListener('state', paintState); player.removeEventListener('episode', rerenderSoon); player.removeEventListener('time', paint);
    ro.disconnect(); clearInterval(clock);
  };
}

async function speedSheet() {
  const cur = player.rate;
  const r = await pick('Tốc độ phát', `<div class="pc-speeds">${SPEEDS.map(v => `<button class="chip" data-v="${v}" aria-pressed="${v === cur}">${v}×</button>`).join('')}</div>
    <p class="muted">Giữ nguyên cao độ giọng. ${player.show ? `<button class="btn ghost sm" data-v="show">Chỉ dùng ${cur}× cho ${esc(player.show.title)}</button>` : ''}</p>`);
  if (r === 'show') return player.setRate(cur, { forShow: true }).then(() => toast('Đã lưu tốc độ riêng cho podcast này'));
  if (r) await player.setRate(+r, { forShow: !!player.show?.settings?.speed });
}

async function sleepSheet(chs) {
  const t = player.time;
  const next = chs.find(c => c.start > t + 1);
  const r = await pick('Hẹn giờ ngủ', `<div class="pc-menu">
    ${[5, 10, 15, 30, 45, 60, 90].map(m => `<button class="btn ghost" data-v="m${m}">${icon('pc-moon')}${m} phút</button>`).join('')}
    <button class="btn ghost" data-v="ep">${icon('pc-moon')}Hết tập này${player.duration ? ` (còn ${fmtLen(player.duration - t)})` : ''}</button>
    ${next ? `<button class="btn ghost" data-v="ch">${icon('pc-chapters')}Hết chương hiện tại</button>` : ''}
    ${player.sleep?.until ? `<button class="btn ghost" data-v="plus">${icon('pc-plus')}Thêm 5 phút</button>` : ''}
    ${player.sleep ? `<button class="btn" data-v="off">${icon('x')}Tắt hẹn giờ</button>` : ''}</div>`);
  if (!r) return;
  if (r === 'off') return player.cancelSleep();
  if (r === 'plus') return player.extendSleep(5);
  if (r === 'ep') return player.setSleep({ endOfEpisode: true });
  if (r === 'ch') return player.setSleep({ endOfChapter: next.start });
  player.setSleep({ minutes: +r.slice(1) });
  toast(`Sẽ dừng sau ${r.slice(1)} phút (nhỏ dần ở cuối)`);
}

// Real loudness bars from a downloaded or imported file (decoded once, at low cost: one peak per bar).
async function realPeaks(e, bars) {
  try {
    const blob = await store.downloadedBlob(e.id);
    if (!blob || blob.size > 200e6) return null;
    const ac = new OfflineAudioContext(1, 1, 8000);
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    const d = buf.getChannelData(0), step = Math.floor(d.length / bars), out = new Float32Array(bars);
    let max = 0;
    for (let i = 0; i < bars; i++) { let m = 0; for (let j = i * step; j < (i + 1) * step; j += 64) { const v = Math.abs(d[j]); if (v > m) m = v; } out[i] = m; if (m > max) max = m; }
    for (let i = 0; i < bars; i++) out[i] = max ? 0.15 + 0.85 * out[i] / max : 0.2;
    return out;
  } catch { return null; }
}
