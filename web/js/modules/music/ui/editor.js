// Editors: track metadata (one or many tracks at once, cover art), lyrics (paste LRC / text,
// tap-to-sync timestamps while listening), smart playlist rules.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { player } from '../lib/player.js';
import { parseLyrics, toLrc, isLrc } from '../lib/lyrics.js';
import { fmtTime } from '../lib/format.js';
import { sheet } from './sheets.js';

const FIELDS = [
  ['title', 'Tên bài'], ['artist', 'Nghệ sĩ (nhiều người: dùng ; )'], ['album', 'Album'], ['albumArtist', 'Nghệ sĩ album'],
  ['trackNo', 'Số bài', 'number'], ['discNo', 'Đĩa số', 'number'], ['year', 'Năm', 'number'], ['genres', 'Thể loại (cách nhau bằng dấu phẩy)'],
  ['composer', 'Sáng tác'], ['comment', 'Ghi chú'],
];

// The full tag editor (all fields, clean-up, artwork, writing into MP3/FLAC) lives in tageditor.js.
export async function editTracks(tracks, onDone) {
  const { tagEditor } = await import('./tageditor.js');
  return tagEditor(tracks, onDone);
}

// ── Lyrics editor ───────────────────────────────────────────────
// Lyrics editor lives in ./lyrics-editor.js (TTML / SRT / translation / timeline / LRCLIB).
export async function editLyrics(t, onDone) { return (await import('./lyrics-editor.js')).editLyrics(t, onDone); }

// ── Smart playlist editor ───────────────────────────────────────
export async function editSmart(pl, onDone) {
  const rules = structuredClone(pl?.rules || { match: 'all', rules: [{ field: 'hiRes', op: 'is', value: 1 }], sort: 'title', limit: '' });
  const s = sheet({ title: pl ? 'Sửa danh sách thông minh' : 'Danh sách thông minh mới', wide: true, body: `<form class="msmart stack">
    <label>Tên<input name="name" value="${esc(pl?.name || 'Hi-Res của tôi')}" required></label>
    <p>Khớp <select name="match"><option value="all">tất cả</option><option value="any">bất kỳ</option></select> điều kiện:</p>
    <div data-rules class="stack"></div>
    <button type="button" class="btn small" data-add>${icon('plus')}Thêm điều kiện</button>
    <div class="msmart-row"><label>Sắp xếp<select name="sort">${Object.entries(store.SMART_SORTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Giới hạn số bài<input name="limit" type="number" min="1" placeholder="Không giới hạn" value="${esc(rules.limit || '')}"></label></div>
    <p class="hint" data-count></p>
    <div class="row-actions"><button class="btn primary">${icon('check')}Lưu</button></div></form>` });
  const f = s.el.querySelector('form');
  f.match.value = rules.match; f.sort.value = rules.sort || 'random';
  const L = await store.library();
  const count = () => { s.el.querySelector('[data-count]').textContent = `Hiện khớp ${store.evalSmart({ ...rules, limit: f.limit.value }, [...L.tracks.values()]).length} bài. Danh sách tự cập nhật khi thư viện thay đổi.`; };
  const draw = () => {
    const box = s.el.querySelector('[data-rules]');
    box.innerHTML = rules.rules.map((r, i) => {
      const type = store.SMART_FIELDS[r.field][1];
      const val = type === 'bool' ? `<select data-k="value"><option value="1">có</option><option value="0">không</option></select>`
        : type === 'codec' ? `<select data-k="value">${['FLAC', 'ALAC', 'MP3', 'AAC', 'Opus', 'Vorbis', 'PCM', 'WavPack', 'DSD', 'APE'].map(c => `<option>${c}</option>`).join('')}</select>`
        : `<input data-k="value" ${type === 'text' ? '' : 'type="number"'} value="${esc(r.value ?? '')}">`;
      return `<div class="msmart-rule" data-i="${i}"><select data-k="field">${Object.entries(store.SMART_FIELDS).map(([k, [l]]) => `<option value="${k}" ${k === r.field ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select data-k="op">${Object.entries(store.SMART_OPS[type]).map(([k, l]) => `<option value="${k}" ${k === r.op ? 'selected' : ''}>${l}</option>`).join('')}</select>${val}
        <button type="button" class="icon-btn sm" data-del aria-label="Xoá điều kiện">${icon('x')}</button></div>`;
    }).join('');
    box.querySelectorAll('[data-i]').forEach(row => {
      const r = rules.rules[+row.dataset.i];
      const v = row.querySelector('[data-k="value"]');
      if (v.tagName === 'SELECT') v.value = String(r.value ?? v.value);
      row.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
        r[inp.dataset.k] = inp.value;
        if (inp.dataset.k === 'field') { const ty = store.SMART_FIELDS[r.field][1]; r.op = Object.keys(store.SMART_OPS[ty])[0]; r.value = ty === 'bool' ? 1 : ty === 'codec' ? 'FLAC' : ''; draw(); }
        count();
      });
      row.querySelector('[data-del]').onclick = () => { rules.rules.splice(+row.dataset.i, 1); draw(); count(); };
    });
  };
  s.el.querySelector('[data-add]').onclick = () => { rules.rules.push({ field: 'artist', op: 'contains', value: '' }); draw(); };
  f.match.onchange = () => { rules.match = f.match.value; count(); };
  f.limit.oninput = count;
  draw(); count();
  f.onsubmit = async (e) => {
    e.preventDefault();
    rules.sort = f.sort.value; rules.limit = f.limit.value ? +f.limit.value : '';
    if (pl) await store.updatePlaylist(pl.id, { name: f.name.value.trim(), rules });
    else await store.createPlaylist(f.name.value.trim(), [], { kind: 'smart', rules });
    s.close(); toast('Đã lưu danh sách thông minh'); onDone?.();
  };
}
