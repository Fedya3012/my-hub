// Sheets and menus: bottom sheets on phones, floating panels/popovers on desktop.
// Also the shared pickers: track menu, add to playlist, file info + signal path, queue,
// sleep timer, speed, and linking music to books / fanfic / podcasts.
import { db } from '../../../core/db.js';
import { icon } from '../../../core/icons.js';
import { esc, h, toast, confirmBox, fmtBytes } from '../../../core/ui.js';
import { CONTENT_TYPES } from '../../../core/content-types.js';
import { player } from '../lib/player.js';
import * as store from '../lib/store.js';
import { artHtml, hydrate } from '../lib/art.js';
import { techLine, badges, khz, kbps, channelsLabel, fmtTime, dB, CODECS } from '../lib/format.js';
import { prefs } from '../lib/prefs.js';
import { incremental } from '../../../core/perf.js';
import { cmpVi } from '../../../core/perf.js';

const narrow = () => matchMedia('(max-width: 720px)').matches;

// ── Sheet ───────────────────────────────────────────────────────
export function sheet({ title = '', body, cls = '', onClose, wide = false, actions = '' } = {}) {
  const el = h(`<div class="msheet-wrap ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="msheet${wide ? ' wide' : ''}">
      <div class="msheet-grab" aria-hidden="true"></div>
      ${title ? `<header class="msheet-head"><h2>${esc(title)}</h2>${actions}<button class="icon-btn" data-close aria-label="Đóng">${icon('x')}</button></header>` : ''}
      <div class="msheet-body"></div>
    </div></div>`);
  const bodyEl = el.querySelector('.msheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    el.classList.add('out');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => el.remove(), 220);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  // Drag the grab handle down to dismiss (phones).
  const grab = el.querySelector('.msheet-grab'), panel = el.querySelector('.msheet');
  let y0 = null;
  grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointermove', (e) => { if (y0 != null) panel.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  grab.addEventListener('pointerup', (e) => { if (y0 != null && e.clientY - y0 > 90) close(); else panel.style.transform = ''; y0 = null; });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  hydrate(el);
  return { el, body: bodyEl, close };
}

// ── Menu (popover on desktop, action sheet on phones) ───────────
// items: [{ icon, label, act, danger, hint } | '-']
export function menu(anchor, items, { title } = {}) {
  const list = items.filter(Boolean);
  const html = `<div class="mmenu" role="menu">${list.map((it, i) => it === '-' ? '<hr>' :
    `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon || 'arrow')}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`).join('')}</div>`;
  if (narrow() || !anchor) {
    const s = sheet({ title, body: html, cls: 'as-menu' });
    s.el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { s.close(); list[+b.dataset.i].act(); });
    return;
  }
  document.querySelector('.mpop')?.remove();
  const pop = h(`<div class="mpop">${html}</div>`);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  const left = Math.min(innerWidth - pr.width - 8, Math.max(8, r.right - pr.width));
  const top = r.bottom + pr.height + 8 < innerHeight ? r.bottom + 4 : Math.max(8, r.top - pr.height - 4);
  Object.assign(pop.style, { left: left + 'px', top: top + 'px' });
  const off = (e) => { if (!pop.contains(e.target)) close(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key); };
  setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key); });
  pop.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { close(); list[+b.dataset.i].act(); });
  pop.querySelector('button')?.focus();
}

// ── Track actions ───────────────────────────────────────────────
export function trackMenu(anchor, t, { playlist, linkId, onChange } = {}) {
  const go = (r) => { location.hash = 'music/' + r; };
  menu(anchor, [
    { icon: 'play', label: 'Phát ngay', act: () => player.play([t], { source: { kind: 'track', id: t.id, name: t.title } }) },
    { icon: 'queue', label: 'Phát tiếp theo', act: () => player.playNext([t.id]) },
    { icon: 'plus', label: 'Thêm vào hàng chờ', act: () => player.addToQueue([t.id]) },
    { icon: 'list', label: 'Thêm vào danh sách phát…', act: () => pickPlaylist([t.id]) },
    '-',
    { icon: 'heart', label: t.favorite ? 'Bỏ yêu thích' : 'Yêu thích', act: async () => { await store.setFavorite(t.id, !t.favorite); onChange?.(); } },
    { icon: 'star', label: 'Đánh giá…', hint: t.rating ? '★'.repeat(t.rating) : '', act: () => rateSheet(t, onChange) },
    { icon: 'album', label: 'Đi tới album', act: () => go('album/' + t.albumId) },
    { icon: 'user', label: 'Đi tới nghệ sĩ', act: () => go('artist/' + t.artistId) },
    '-',
    { icon: 'info', label: 'Thông tin tệp & đường tín hiệu', act: () => infoSheet(t) },
    { icon: 'edit', label: 'Sửa thẻ (tag editor)…', act: () => import('./editor.js').then(m => m.editTracks([t], onChange)) },
    { icon: 'image', label: 'Đổi ảnh bài hát…', act: async () => { const L = await store.library(); (await import('./artpicker.js')).artworkSheet({ kind: 'track', id: t.id, name: t.title, tracks: [t], cover: L.coverOf(t), onDone: onChange }); } },
    { icon: 'lyrics', label: 'Lời bài hát…', act: () => import('./editor.js').then(m => m.editLyrics(t)) },
    { icon: 'link', label: 'Gắn vào sách / fanfic / podcast…', act: () => linkPicker({ sourceId: t.id, source: 'track', name: t.title }) },
    playlist && playlist.kind === 'playlist' ? { icon: 'x', label: 'Bỏ khỏi danh sách này', act: async () => { await store.removeFromPlaylist([linkId]); onChange?.(); } } : null,
    { icon: 'trash', label: 'Xoá khỏi thư viện', danger: true, act: async () => {
      if (!(await confirmBox('Xoá bài hát?', `“${t.title}” sẽ bị xoá khỏi thư viện trên mọi thiết bị đồng bộ. Tệp trên máy này cũng bị xoá.`, 'Xoá'))) return;
      await store.deleteTracks([t.id]); toast('Đã xoá'); onChange?.();
    } },
  ], { title: t.title });
}

export function rateSheet(t, onChange) {
  const s = sheet({ title: 'Đánh giá', body: `<div class="mstars big" role="radiogroup">${[1, 2, 3, 4, 5].map(n =>
    `<button role="radio" aria-checked="${t.rating === n}" data-r="${n}" aria-label="${n} sao" class="${n <= t.rating ? 'on' : ''}">${icon('star')}</button>`).join('')}</div>
    <button class="btn small" data-r="0">Bỏ đánh giá</button>` });
  s.el.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => { await store.setRating(t.id, +b.dataset.r); s.close(); onChange?.(); });
}

export function starsHtml(r, id) {
  return `<span class="mstars" data-rate="${esc(id)}">${[1, 2, 3, 4, 5].map(n => `<button data-r="${n}" class="${n <= r ? 'on' : ''}" aria-label="${n} sao">${icon('star')}</button>`).join('')}</span>`;
}

export async function pickPlaylist(ids) {
  const L = await store.library();
  const pls = L.playlists.filter(p => p.kind === 'playlist');
  const s = sheet({ title: 'Thêm vào danh sách phát', body: `<div class="mpick">
    <button class="mpick-row new" data-new>${icon('plus')}<span>Danh sách phát mới…</span></button>
    ${pls.map(p => `<button class="mpick-row" data-id="${p.id}">${icon('list')}<span>${esc(p.name)}</span></button>`).join('')}</div>` });
  s.el.querySelector('[data-new]').onclick = async () => {
    s.close();
    const name = await ask('Tên danh sách phát', 'Danh sách mới');
    if (!name) return;
    await store.createPlaylist(name, ids); toast(`Đã tạo “${name}”`);
  };
  s.el.querySelectorAll('[data-id]').forEach(b => b.onclick = async () => { await store.addToPlaylist(b.dataset.id, ids); s.close(); toast('Đã thêm vào danh sách phát'); });
}

export function ask(label, value = '') {
  return new Promise((res) => {
    const s = sheet({ title: label, body: `<form class="stack"><input name="v" value="${esc(value)}" aria-label="${esc(label)}" autofocus><div class="row-actions"><button class="btn primary">Lưu</button></div></form>`, onClose: () => res(null) });
    const f = s.el.querySelector('form'), i = f.querySelector('input');
    i.focus(); i.select();
    f.onsubmit = (e) => { e.preventDefault(); const v = i.value.trim(); res(v || null); s.close(); };
  });
}

// ── File info + signal path (Symfonium-style) ───────────────────
export async function infoSheet(t) {
  const file = await store.mainFile(t.id);
  const T = t.tech;
  const isCur = player.track?.id === t.id;
  const E = player.engine;
  const g = isCur ? player.gain : player.gainFor(t);
  const eq = player.eq;
  const outRate = isCur ? E.outputRate : null;
  const resample = T && outRate && T.codec !== 'DSD' ? T.sampleRate !== outRate : null;
  const decoded = isCur ? player.resolveInfo?.decoded : null;
  const row = (k, v) => v || v === 0 ? `<dt>${k}</dt><dd>${v}</dd>` : '';
  const codec = T ? CODECS[T.codec] : null;
  const steps = T ? [
    ['Nguồn', `${esc(T.codecLabel)} · ${T.codec === 'DSD' ? '1-bit ' + khz(T.sampleRate) : (T.floatPCM ? '32-bit float' : T.bitDepth ? T.bitDepth + '-bit' : '')} ${T.codec !== 'DSD' ? khz(T.sampleRate) : ''}`, T.lossless ? 'ok' : ''],
    ['Giải mã', decoded === 'dsf' || decoded === 'dff' ? `DSD → PCM 24-bit ${T.dsdRate === 'DSD64' ? '88.2' : '176.4'} kHz (bộ lọc FIR, trong app)` : decoded ? `${decoded.toUpperCase()} → WAV (bộ giải mã trong app, không mất dữ liệu)` : 'Trình duyệt (gốc)', decoded === 'dsf' || decoded === 'dff' ? 'warn' : 'ok'],
    ['ReplayGain', g.used === 'off' ? 'Tắt' : `${dB(g.db)} (${{ track: 'theo bài', album: 'theo album', untagged: 'không có thẻ, mức mặc định' }[g.used] || g.used})${g.clipped ? ' · đã giới hạn chống vỡ tiếng' : ''}`, g.used === 'off' || !g.db ? 'ok' : 'warn'],
    ['EQ', eq?.enabled ? `${esc(eq.name || 'Tuỳ chỉnh')} · ${eq.bands.filter(b => b.on).length} dải` : 'Tắt', eq?.enabled ? 'warn' : 'ok'],
    ['Chuyển bài', player.planFor(t, player.nextTrack).crossfade ? `Crossfade ${player.planFor(t, player.nextTrack).crossfade.toFixed(1)} s` : prefs().playback.gapless ? 'Gapless' : 'Có khoảng lặng', ''],
    ['Đầu ra', E.mode === 'direct' ? 'Phát trực tiếp (không Web Audio)' : outRate ? `Web Audio ${khz(outRate)} float 32-bit${resample ? ` · chuyển mẫu ${khz(T.sampleRate)} → ${khz(outRate)}` : ''}` : 'Chưa phát', resample ? 'warn' : 'ok'],
  ] : [];
  const body = h(`<div class="minfo">
    <div class="minfo-head">${artHtml((await store.library()).coverOf(t), t.album || t.title, { cls: 'md' })}
      <div><h3>${esc(t.title)}</h3><p class="muted">${esc(t.artist || '')}${t.album ? ' · ' + esc(t.album) : ''}</p><div class="mbadges">${badges(T, { hiRes: t.hiResNow, size: 'lg' })}</div></div></div>
    ${T ? `<section><h4>Định dạng</h4><dl class="kv">
      ${row('Codec', `${esc(T.codecLabel)}${codec ? ` <span class="muted">· ${esc(codec.full)}</span>` : ''}`)}
      ${row('Loại', T.lossless ? '<span class="pill ok">Lossless</span>' : '<span class="pill">Lossy (nén mất dữ liệu)</span>')}
      ${row('Bit depth', T.codec === 'DSD' ? '1-bit (DSD)' : T.floatPCM ? '32-bit float' : T.bitDepth ? T.bitDepth + '-bit' : '<span class="muted">— (codec lossy không có bit depth cố định)</span>')}
      ${row('Sample rate', khz(T.sampleRate) + (T.dsdRate ? ` · ${T.dsdRate}` : ''))}
      ${row('Bitrate', T.bitrate ? kbps(T.bitrate) + (T.vbr ? ' (VBR)' : T.vbr === false ? ' (CBR)' : '') : '')}
      ${row('Kênh', T.channels ? `${T.channels} · ${channelsLabel(T.channels)}` : '')}
      ${row('Thời lượng', fmtTime(t.duration))}
      ${row('Container', esc((T.container || '').toUpperCase()))}
      ${row('Encoder', esc(T.encoder || ''))}
      ${row('Hi-Res', t.hiResNow ? '<span class="hires">Hi-Res</span>' : '<span class="muted">Không</span>')}
    </dl></section>
    <section><h4>Đường tín hiệu</h4><ol class="spath">${steps.map(([k, v, q]) => `<li class="${q}"><b>${k}</b><span>${v}</span></li>`).join('')}</ol>
      <p class="hint">Trình duyệt luôn trộn âm thanh ở dạng float 32-bit rồi giao cho hệ điều hành, nên không có chế độ bit-perfect độc quyền như app gốc. Đặt "Tần số đầu ra" trùng với file trong Tuỳ chỉnh để tránh một lần chuyển mẫu.</p></section>`
      : '<p class="muted">Mục này chưa có tệp âm thanh, chỉ có thông tin. Thêm tệp từ Thư viện hoặc nhập lại.</p>'}
    <section><h4>Thẻ & tệp</h4><dl class="kv">
      ${row('Album', esc(t.album || ''))}${row('Nghệ sĩ album', esc(t.albumArtist || ''))}
      ${row('Số bài', t.trackNo ? `${t.trackNo}${t.trackTotal ? ' / ' + t.trackTotal : ''}` : '')}${row('Đĩa', t.discNo ? `${t.discNo}${t.discTotal ? ' / ' + t.discTotal : ''}` : '')}
      ${row('Năm', t.year || '')}${row('Thể loại', esc((t.genres || []).join(', ')))}${row('Sáng tác', esc(t.composer || ''))}
      ${row('ReplayGain bài', t.rg?.trackGain != null ? `${dB(t.rg.trackGain, 2)} · đỉnh ${(+t.rg.trackPeak || 0).toFixed(4)}` : '')}
      ${row('ReplayGain album', t.rg?.albumGain != null ? `${dB(t.rg.albumGain, 2)} · đỉnh ${(+t.rg.albumPeak || 0).toFixed(4)}` : '')}
      ${row('Tệp', file ? `<code>${esc(file.name)}</code>` : '')}${row('Dung lượng', file ? fmtBytes(file.size) : '')}
      ${row('Thư mục', esc(t.folder || ''))}
      ${row('Nơi lưu', file ? (file.locations?.local ? `<span class="pill">${icon('device')}Máy này</span>` : '') : '')}
      ${row('Đã nghe', `${t.plays} lần${t.lastPlayed ? ' · lần cuối ' + new Date(t.lastPlayed).toLocaleDateString((globalThis.__LOCALE || 'vi-VN')) : ''}`)}
    </dl>${t.warnings?.length ? `<p class="hint">${esc(t.warnings.join(' · '))}</p>` : ''}</section></div>`);
  sheet({ title: 'Thông tin tệp', body, wide: true });
}

// ── Queue ───────────────────────────────────────────────────────
export function queuePanel(el) {
  let lazyOff = null;
  const render = async () => {
    const L = await store.library();
    const q = player.queue, cur = player.index;
    el.innerHTML = `<div class="mq-head"><div><b>Hàng chờ</b><span class="muted"> · ${q.length} bài${player.source?.name ? ' · từ ' + esc(player.source.name) : ''}</span></div>
      <div class="row-actions"><button class="btn small" data-act="save">${icon('plus')}Lưu thành playlist</button><button class="btn small" data-act="clear">Xoá phần sau</button></div></div>
      <ol class="mq"></ol>`;
    const rowHtml = (id, i) => {
        const t = L.tracks.get(id);
        if (!t) return '';
        return `<li class="mq-row${i === cur ? ' cur' : ''}${i < cur ? ' past' : ''}" data-i="${i}">
          <span class="mq-drag" data-drag aria-label="Kéo để sắp xếp">${icon('drag')}</span>
          ${artHtml(L.coverOf(t), t.album || t.title, { cls: 'xs' })}
          <button class="mq-main" data-play="${i}"><span class="mq-t">${esc(t.title)}</span><span class="mq-s">${esc(t.artist || '')}</span></button>
          <span class="mq-d num">${fmtTime(t.duration)}</span>
          ${i !== cur ? `<button class="icon-btn sm" data-rm="${i}" aria-label="Bỏ khỏi hàng chờ">${icon('x')}</button>` : `<span class="mq-eq" aria-label="Đang phát"><i></i><i></i><i></i></span>`}
        </li>`;
      };
    // Any queue length: rows are added in chunks as you scroll (enough up front to show the current one).
    lazyOff?.();
    lazyOff = incremental(el.querySelector('.mq'), q, rowHtml, { first: Math.max(100, cur + 40), chunk: 200, onChunk: (box) => {
      box.querySelectorAll('[data-play]').forEach(b => b.onclick = () => player.jump(+b.dataset.play));
      box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => player.removeAt(+b.dataset.rm));
      hydrate(box);
    } });
    el.querySelector('.mq-row.cur')?.scrollIntoView({ block: 'center' });
    el.querySelector('[data-act="clear"]').onclick = () => player.clearUpcoming();
    el.querySelector('[data-act="save"]').onclick = async () => {
      const name = await ask('Tên danh sách phát', 'Hàng chờ ' + new Date().toLocaleDateString((globalThis.__LOCALE || 'vi-VN')));
      if (name) { await store.createPlaylist(name, [...player.queue]); toast('Đã lưu “' + name + '”'); }
    };
    dragSort(el.querySelector('.mq'), (from, to) => player.move(from, to));
  };
  const off = [() => player.removeEventListener('queue', render), () => player.removeEventListener('track', render), () => lazyOff?.()];
  player.addEventListener('queue', render);
  player.addEventListener('track', render);
  render();
  return () => off.forEach(f => f());
}

export function queueSheet() {
  const s = sheet({ title: '', body: '<div class="mqp"></div>', cls: 'as-queue', onClose: () => stop() });
  const stop = queuePanel(s.el.querySelector('.mqp'));
}

// Pointer-based drag sorting (touch + mouse). rows: children with [data-i]; handle: [data-drag].
// Keyboard: focus a ⠿ handle, Alt+↑ / Alt+↓ (or ↑ / ↓) moves the row one place.
export function dragSort(list, onMove) {
  if (!list) return;
  const rowsOf = () => [...list.children].filter(r => r.dataset.i != null);
  const bind = (hd) => {
    if (hd._ds) return; hd._ds = 1;
    hd.tabIndex = 0; hd.setAttribute('role', 'button');
    hd.setAttribute('aria-label', 'Kéo để sắp xếp (hoặc Alt + mũi tên lên/xuống)');
    hd.onkeydown = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const rows = rowsOf(), row = hd.closest('[data-i]'), pos = rows.indexOf(row);
      const other = rows[pos + (e.key === 'ArrowUp' ? -1 : 1)];
      if (!other) return;
      const from = +row.dataset.i, to = +other.dataset.i;
      onMove(from, to);
      // Optimistic: swap in the DOM so focus follows the row (the owner may re-render anyway).
      if (e.key === 'ArrowUp') other.before(row); else other.after(row);
      row.dataset.i = to; other.dataset.i = from;
      hd.focus();
    };
    hd.onpointerdown = (e) => {
      e.preventDefault();
      const row = hd.closest('[data-i]'), from = +row.dataset.i;
      const rows = rowsOf();
      const rect = row.getBoundingClientRect();
      const y0 = e.clientY;
      row.classList.add('dragging');
      hd.setPointerCapture(e.pointerId);
      let to = from;
      hd.onpointermove = (ev) => {
        const dy = ev.clientY - y0;
        row.style.transform = `translateY(${dy}px)`;
        const mid = rect.top + rect.height / 2 + dy;
        let k = rows.findIndex(r => { const b = r.getBoundingClientRect(); return mid < b.top + b.height / 2; });
        const pos = rows.indexOf(row);
        if (k === -1) k = rows.length - 1; else if (k > pos) k--;
        to = +rows[k].dataset.i;
        rows.forEach((r, i) => r.classList.toggle('drop-before', i === (k >= pos ? k + 1 : k) && i !== pos));
      };
      hd.onpointerup = hd.onpointercancel = () => {
        hd.onpointermove = hd.onpointerup = hd.onpointercancel = null;
        row.classList.remove('dragging'); row.style.transform = '';
        rows.forEach(r => r.classList.remove('drop-before'));
        if (to !== from) onMove(from, to);
      };
    };
  };
  list.querySelectorAll('[data-drag]').forEach(bind);
  // Rows added later (lazy chunks) get the same behaviour.
  if (!list._dsObs) { list._dsObs = new MutationObserver(() => list.querySelectorAll('[data-drag]').forEach(bind)); list._dsObs.observe(list, { childList: true }); }
}

// ── Sleep / speed ───────────────────────────────────────────────
// Sleep timer now lives in the timers sheet (smart fade, N tracks, workout/focus, ambient).
export function sleepSheet() { return import('./timers.js').then(m => m.timersSheet('sleep')); }

export function speedSheet() {
  const r = player.engine.rate;
  const s = sheet({ title: 'Tốc độ phát', body: `<div class="mchoices">${[0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map(v =>
    `<button class="chip" aria-pressed="${v === r}" data-v="${v}">${v}×</button>`).join('')}</div><p class="hint">Giữ nguyên cao độ giọng. Hữu ích cho podcast; nhạc nên để 1×.</p>` });
  s.el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { player.setRate(+b.dataset.v); s.close(); });
}

// ── Linking music <-> books / fanfic / podcasts ─────────────────
const TARGET_TYPES = ['book', 'fanfic', 'podcast', 'video', 'note'];

// From a track/album/playlist: pick which item it plays with.
export async function linkPicker({ sourceId, source, name }) {
  const items = (await db.items.where('type').anyOf(TARGET_TYPES).toArray()).filter(i => !i.deleted && i.id !== sourceId)
    .sort((a, b) => cmpVi(a.title, b.title));
  const linked = await store.targetsOf(sourceId);
  const body = h(`<div class="stack">
    <p class="muted">Khi mở mục được gắn, “${esc(name)}” có thể tự phát làm nhạc nền.</p>
    ${linked.length ? `<div class="mlinked">${linked.map(x => `<span class="tag"><i class="dot t-${x.item.type}"></i>${esc(x.item.title)}<button data-unlink="${x.link.id}" aria-label="Gỡ">${icon('x')}</button></span>`).join('')}</div>` : ''}
    <label class="search">${icon('search')}<input type="search" placeholder="Tìm sách, fanfic, podcast…" data-q></label>
    <div class="mpick" data-list></div>
    <label class="check"><input type="checkbox" data-auto checked> Tự động phát khi mở</label>
    <label class="check"><input type="checkbox" data-shuf> Phát ngẫu nhiên</label></div>`);
  const s = sheet({ title: 'Gắn nhạc vào nội dung', body });
  let off = null;
  const draw = (q = '') => {
    const nq = q.toLowerCase();
    const box = body.querySelector('[data-list]');
    const list = items.filter(i => !nq || i.title.toLowerCase().includes(nq));
    off?.();
    if (!list.length) { box.innerHTML = '<p class="muted">Chưa có sách, fanfic hay podcast nào trong Thư viện.</p>'; return; }
    off = incremental(box, list, (i) => `<button class="mpick-row" data-id="${i.id}"><i class="dot t-${i.type}"></i><span>${esc(i.title)}</span><small>${esc(CONTENT_TYPES[i.type]?.label || i.type)}</small></button>`, { chunk: 80, onChunk: (b) =>
      b.querySelectorAll('[data-id]').forEach(x => x.onclick = async () => {
        await store.linkMusic(sourceId, source, x.dataset.id, { autoplay: body.querySelector('[data-auto]').checked ? 1 : 0, shuffle: body.querySelector('[data-shuf]').checked ? 1 : 0 });
        s.close(); toast('Đã gắn nhạc. Mở mục đó trong Thư viện để nghe.');
      }) });
  };
  draw();
  body.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
  body.querySelectorAll('[data-unlink]').forEach(b => b.onclick = async () => { await store.unlinkMusic(b.dataset.unlink); b.closest('.tag').remove(); toast('Đã gỡ'); });
}

// From an item (book, fanfic, podcast): pick the music it plays with.
export async function musicPickerFor(item, onDone) {
  const L = await store.library();
  const opts = [
    ...L.playlists.map(p => ({ id: p.id, kind: 'playlist', name: p.name, sub: p.kind === 'smart' ? 'Danh sách thông minh' : 'Danh sách phát', cover: null })),
    ...[...L.albums.values()].map(a => ({ id: a.id, kind: 'album', name: a.title, sub: 'Album · ' + a.artist, cover: a.cover })),
  ];
  const body = h(`<div class="stack"><p class="muted">Chọn danh sách phát hoặc album sẽ phát khi mở “${esc(item.title)}”.</p>
    <label class="search">${icon('search')}<input type="search" placeholder="Tìm" data-q></label><div class="mpick" data-list></div>
    <label class="check"><input type="checkbox" data-auto checked> Tự động phát khi mở</label>
    <label class="check"><input type="checkbox" data-shuf> Phát ngẫu nhiên</label></div>`);
  const s = sheet({ title: 'Gắn nhạc nền', body });
  const draw = (q = '') => {
    const nq = q.toLowerCase();
    body.querySelector('[data-list]').innerHTML = opts.filter(o => !nq || o.name.toLowerCase().includes(nq)).map(o =>
      `<button class="mpick-row" data-id="${o.id}" data-kind="${o.kind}">${o.cover ? artHtml(o.cover, o.name, { cls: 'xs' }) : icon(o.kind === 'album' ? 'album' : 'list')}<span>${esc(o.name)}</span><small>${esc(o.sub)}</small></button>`).join('')
      || '<p class="muted">Chưa có danh sách phát hay album nào.</p>';
    hydrate(body);
    body.querySelectorAll('[data-id]').forEach(b => b.onclick = async () => {
      await store.linkMusic(b.dataset.id, b.dataset.kind, item.id, { autoplay: body.querySelector('[data-auto]').checked ? 1 : 0, shuffle: body.querySelector('[data-shuf]').checked ? 1 : 0 });
      s.close(); toast('Đã gắn nhạc nền'); onDone?.();
    });
  };
  draw();
  body.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
}
