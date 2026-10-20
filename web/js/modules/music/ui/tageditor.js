// Tag editor (one song or many at once): every common field, clean-up tools, fill from file
// name / folder pattern, artwork, and writing the tags back into MP3 (ID3v2.4) / FLAC files.
// Line-by-line lyrics and tap-sync live in editor.js → editLyrics (linked from here).
import '../lib/libicons.js';
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import { db } from '../../../core/db.js';
import * as store from '../lib/store.js';
import * as clean from '../lib/tagclean.js';
import { canWrite, formatOf, writeIntoFile, exportTagged, download, WRITABLE } from '../lib/tagwriter.js';
import { artHtml, hydrate } from '../lib/art.js';
import { sheet } from './sheets.js';

const RELEASE = { '': '(tự nhận biết)', album: 'Album', single: 'Single', ep: 'EP', compilation: 'Tuyển tập', live: 'Live', soundtrack: 'Nhạc phim', remix: 'Remix' };
// [key, label, type, wide]
const FIELDS = [
  ['title', 'Tên bài'], ['artist', 'Nghệ sĩ (nhiều người: dùng ; )'], ['album', 'Album'], ['albumArtist', 'Nghệ sĩ album'],
  ['composer', 'Sáng tác / nhạc sĩ'], ['label', 'Hãng đĩa'], ['releaseType', 'Loại phát hành', 'release'], ['genres', 'Thể loại (cách nhau bằng dấu phẩy)'],
  ['trackNo', 'Bài số', 'number'], ['trackTotal', 'trên tổng', 'number'], ['discNo', 'Đĩa số', 'number'], ['discTotal', 'trên tổng', 'number'],
  ['year', 'Năm', 'number'], ['bpm', 'BPM', 'number'], ['isrc', 'ISRC'], ['comment', 'Ghi chú', 'area', 1],
];
const RG = [['trackGain', 'Gain bài (dB)'], ['trackPeak', 'Đỉnh bài'], ['albumGain', 'Gain album (dB)'], ['albumPeak', 'Đỉnh album']];
const val = (t, k) => k === 'genres' ? (t.genres || []).join(', ') : k.startsWith('rg.') ? (t.rg?.[k.slice(3)] ?? '') : (t[k] ?? '');

export async function tagEditor(tracks, onDone) {
  tracks = tracks.filter(t => t && !t.virtual);
  if (!tracks.length) return;
  const many = tracks.length > 1;
  const lyr = !many ? await db.lyrics.get(tracks[0].id) : null;
  const orig = tracks.map(t => ({ ...t, rg: t.rg ? { ...t.rg } : null, genres: [...(t.genres || [])], lyrics: !many ? (lyr?.text || '') : undefined }));
  const work = orig.map(t => ({ ...t, rg: t.rg ? { ...t.rg } : null, genres: [...t.genres] }));
  const writable = tracks.filter(canWrite).length;
  const L = await store.library();
  const t0 = tracks[0];
  const fmtNote = `Ghi được vào tệp: ${Object.entries(WRITABLE).map(([k, v]) => `<b>${k}</b> (${v})`).join(', ')}. Định dạng khác (M4A/ALAC/AAC, Opus/Ogg, WAV, AIFF, DSD, WavPack, APE) chỉ lưu trong thư viện.`;
  const s = sheet({ title: many ? `Sửa thẻ ${tracks.length} bài` : 'Sửa thẻ bài hát', wide: true, cls: 'as-tagedit', body: `<form class="ltag" autocomplete="off">
    <div class="ltag-side">
      <div class="ltag-art" data-art>${artHtml(L.coverOf(t0), t0.album || t0.title, { cls: 'hero' })}</div>
      <div class="ltag-art-act">
        <button type="button" class="btn small" data-art-album>${icon('image')}Ảnh bìa album…</button>
        ${!many ? `<button type="button" class="btn small" data-art-track>${icon('image')}Ảnh riêng bài này…</button>` : ''}
      </div>
      <details class="ltag-tools" open><summary>${icon('wand')}Dọn thẻ</summary>
        <div class="ltag-clean">${Object.entries(clean.CLEANUPS).map(([k, v]) => `<button type="button" class="chip" data-clean="${k}">${esc(v)}</button>`).join('')}</div>
        <label class="ltag-pat">Điền từ tên tệp / thư mục
          <input data-pattern value="%track% - %title%" list="ltag-pats" spellcheck="false"></label>
        <datalist id="ltag-pats"><option value="%track% - %title%"><option value="%track%. %title%"><option value="%artist% - %title%"><option value="%track% - %artist% - %title%"><option value="%artist%/%album%/%track% - %title%"><option value="%artist% - %album%/%track% %title%"><option value="%year% - %album%/%track%. %title%"></datalist>
        <div class="row-actions"><button type="button" class="btn small" data-pat-apply>${icon('check')}Áp dụng mẫu</button><span class="hint" data-pat-hint></span></div>
        <p class="hint">Trường: %track% %disc% %title% %artist% %album% %albumartist% %year% %genre% %composer% %skip%. Dùng / để lấy từ tên thư mục.</p>
      </details>
    </div>
    <div class="ltag-main">
      ${many ? '<p class="hint">Ô “(nhiều giá trị)” giữ nguyên giá trị riêng của từng bài. Ô bạn sửa được áp dụng cho tất cả.</p>' : `<p class="hint ltag-file"><code>${esc(t0.fileName || '')}</code>${t0.folder ? ` · ${esc(t0.folder)}` : ''}</p>`}
      <div class="ltag-grid" data-grid></div>
      <details class="ltag-rg"><summary>ReplayGain</summary><div class="ltag-grid" data-rg></div></details>
      ${!many ? `<div class="ltag-lyr"><label>Lời bài hát (thẻ lyrics)<textarea data-lyrics rows="4" placeholder="Dán lời, hoặc LRC [mm:ss.xx]…"></textarea></label>
        <button type="button" class="btn small" data-lyr-open>${icon('lyrics')}Soạn lời & đồng bộ từng dòng…</button></div>` : ''}
      ${many ? '<details class="ltag-prev" open><summary>Xem trước</summary><ol data-prev></ol></details>' : ''}
      <div class="ltag-write">
        <label class="check"><input type="checkbox" data-write ${writable ? 'checked' : 'disabled'}> Ghi thẻ vào tệp nhạc${writable ? ` (${writable}/${tracks.length} bài là ${[...new Set(tracks.filter(canWrite).map(formatOf))].join(', ')})` : ' (không có bài MP3/FLAC)'}</label>
        <p class="hint">${fmtNote} Tệp liên kết từ thư mục máy được ghi thành một bản sao trong app, tệp gốc của bạn không bị sửa.</p>
      </div>
      <div class="row-actions">${!many ? `<button type="button" class="btn" data-export>${icon('download')}Tải tệp kèm thẻ</button>` : ''}<span class="grow"></span><button class="btn primary">${icon('check')}Lưu</button></div>
    </div></form>` });
  const form = s.el.querySelector('form');
  hydrate(s.el);
  const touched = new Set();
  const common = (k) => { const v = work.map(t => String(val(t, k))); return v.every(x => x === v[0]) ? v[0] : null; };
  const input = (k, label, type, wide) => {
    const v = common(k);
    const ph = v === null ? '(nhiều giá trị)' : '';
    if (type === 'release') return `<label>${label}<select name="${k}">${Object.entries(RELEASE).map(([a, b]) => `<option value="${a}" ${v === a ? 'selected' : ''}>${b}</option>`).join('')}${v === null ? '<option value="\u0000" selected>(nhiều giá trị)</option>' : ''}</select></label>`;
    if (type === 'area') return `<label class="${wide ? 'span2' : ''}">${label}<textarea name="${k}" rows="2" placeholder="${ph}">${esc(v ?? '')}</textarea></label>`;
    const garbled = v && clean.looksGarbled(v);
    return `<label class="${wide ? 'span2' : ''}${garbled ? ' warn' : ''}">${label}<input name="${k}" ${type === 'number' ? 'type="number" inputmode="numeric"' : ''} value="${esc(v ?? '')}" placeholder="${ph}">${garbled ? `<small>Có vẻ lỗi mã hoá → “${esc(clean.fixMojibake(v))}”</small>` : ''}</label>`;
  };
  const draw = () => {
    form.querySelector('[data-grid]').innerHTML = FIELDS.filter(([k]) => !(many && k === 'title' && common('title') === null && false)).map(f => input(...f)).join('');
    form.querySelector('[data-rg]').innerHTML = RG.map(([k, l]) => input('rg.' + k, l, 'number')).join('');
    form.querySelectorAll('[name]').forEach(el => { el.oninput = el.onchange = () => setField(el.name, el.value); if (el.type === 'number') el.step = 'any'; });
    const prev = form.querySelector('[data-prev]');
    if (prev) prev.innerHTML = work.map((t, i) => `<li class="${changed(i) ? 'chg' : ''}"><span class="num">${t.discNo ? t.discNo + '-' : ''}${t.trackNo ?? '—'}</span> <b>${esc(t.title || '')}</b> <span class="muted">${esc(t.artist || '')} · ${esc(t.fileName || '')}</span></li>`).join('');
  };
  const setField = (k, v) => {
    if (v === '\u0000') return;
    touched.add(k);
    for (const t of work) {
      if (k.startsWith('rg.')) { t.rg = { ...(t.rg || {}) }; t.rg[k.slice(3)] = v === '' ? null : +v; }
      else if (k === 'genres') t.genres = v.split(',').map(x => x.trim()).filter(Boolean);
      else if (['trackNo', 'trackTotal', 'discNo', 'discTotal', 'year', 'bpm'].includes(k)) t[k] = v === '' ? null : +v;
      else t[k] = v;
    }
    const prev = form.querySelector('[data-prev]');
    if (prev) prev.querySelectorAll('li').forEach((li, i) => li.classList.toggle('chg', changed(i)));
  };
  const KEYS = [...FIELDS.map(f => f[0])];
  const diff = (i) => {
    const a = orig[i], b = work[i], p = {};
    for (const k of KEYS) if (String(val(a, k)) !== String(val(b, k))) p[k] = k === 'genres' ? b.genres : b[k] === '' ? null : b[k];
    if (JSON.stringify(a.rg || {}) !== JSON.stringify(b.rg || {})) {
      const r = b.rg || {};
      p.rg = Object.values(r).some(v => v != null && v !== '') ? { ...r, source: 'user' } : null;
    }
    return p;
  };
  const changed = (i) => Object.keys(diff(i)).length > 0;
  draw();
  const ly = form.querySelector('[data-lyrics]');
  if (ly) ly.value = orig[0].lyrics || '';

  form.querySelectorAll('[data-clean]').forEach(b => b.onclick = () => {
    let n = 0;
    for (const t of work) { const p = clean.cleanup(b.dataset.clean, t); if (Object.keys(p).length) { Object.assign(t, p); n++; } }
    draw();
    toast(n ? `Đã áp dụng cho ${n} bài · bấm Lưu để giữ` : 'Không có gì cần sửa');
  });
  const patIn = form.querySelector('[data-pattern]'), patHint = form.querySelector('[data-pat-hint]');
  const pathOf = (t) => (t.folder ? t.folder + '/' : '') + (t.fileName || '');
  const patPreview = () => { const r = clean.fromPattern(patIn.value, pathOf(work[0])); patHint.textContent = r ? Object.entries(r).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ') : 'Mẫu không khớp tên tệp đầu tiên'; };
  patIn.oninput = patPreview; patPreview();
  form.querySelector('[data-pat-apply]').onclick = () => {
    let n = 0;
    for (const t of work) { const r = clean.fromPattern(patIn.value, pathOf(t)); if (r) { Object.assign(t, r); n++; } }
    draw(); toast(n ? `Đã điền cho ${n}/${work.length} bài` : 'Mẫu không khớp tệp nào', n ? undefined : 'warn');
  };
  const artDone = async () => { const L2 = await store.library(); const t = L2.tracks.get(t0.id) || t0; form.querySelector('[data-art]').innerHTML = artHtml(L2.coverOf(t), t.album || t.title, { cls: 'hero' }); hydrate(form); onDone?.(); };
  form.querySelector('[data-art-album]').onclick = async () => {
    const { artworkSheet } = await import('./artpicker.js');
    const al = L.albums.get(t0.albumId);
    artworkSheet({ kind: 'album', id: t0.albumId, name: al?.title || t0.album, tracks: al?.tracks || tracks, cover: al?.cover, onDone: artDone });
  };
  form.querySelector('[data-art-track]')?.addEventListener('click', async () => {
    const { artworkSheet } = await import('./artpicker.js');
    artworkSheet({ kind: 'track', id: t0.id, name: t0.title, tracks: [t0], cover: L.coverOf(t0), onDone: artDone });
  });
  form.querySelector('[data-lyr-open]')?.addEventListener('click', () => import('./editor.js').then(m => m.editLyrics(t0, onDone)));

  const save = async () => {
    const jobs = work.map((t, i) => [t.id, diff(i)]).filter(([, p]) => Object.keys(p).length);
    const lyrChanged = ly && ly.value !== (orig[0].lyrics || '');
    if (lyrChanged) { if (jobs[0]) jobs[0][1].lyrics = ly.value; else jobs.push([t0.id, { lyrics: ly.value }]); }
    for (const [id, p] of jobs) await store.editTracks([id], p);
    return jobs.map(j => j[0]);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const ids = await save();
    const write = form.querySelector('[data-write]')?.checked;
    const targets = write ? (ids.length ? ids : []).map(id => tracks.find(t => t.id === id)).filter(canWrite) : [];
    s.close();
    if (!targets.length) { toast(ids.length ? 'Đã lưu thẻ' : 'Không có thay đổi'); onDone?.(); return; }
    await tasks.run({ label: 'Đang ghi thẻ vào tệp', total: targets.length }, async (task) => {
      let ok = 0;
      for (const t of targets) {
        task.update({ detail: t.fileName || t.title });
        const L2 = await store.library();
        try { if ((await writeIntoFile(L2.tracks.get(t.id) || t)).written) ok++; } catch (err) { console.warn('[tagwriter]', err); toast(`${t.title}: ${err.message}`, 'error'); }
        task.step();
      }
      toast(`Đã lưu thẻ · ghi vào ${ok} tệp`);
    }).catch(() => {});
    store.invalidate(); onDone?.();
  };
  form.querySelector('[data-export]')?.addEventListener('click', async () => {
    await save();
    const L2 = await store.library();
    try { const r = await exportTagged(L2.tracks.get(t0.id) || t0); download(r.blob, r.name); if (!r.written) toast('Định dạng này tải về nguyên bản (thẻ chỉ lưu trong thư viện)', 'warn'); }
    catch (err) { toast(err.message, 'error'); }
  });
}
