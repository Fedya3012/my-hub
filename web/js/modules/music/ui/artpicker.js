// "Đổi ảnh…": one sheet for every artwork in the music module (album, song, artist, playlist,
// genre, year, label, composer, folder). Pick a file, paste, drag & drop, or take a picture that is
// embedded in the songs; crop it square (drag to move, slider / wheel to zoom); or go back to automatic.
import '../lib/libicons.js';
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { readAudioMeta } from '../lib/meta.js';
import { storage } from '../../../core/storage/index.js';
import { artHtml, hydrate } from '../lib/art.js';
import { sheet } from './sheets.js';

// Embedded pictures of up to `max` tracks (deduplicated by size + first bytes).
export async function embeddedPictures(tracks, max = 12) {
  const out = [], seen = new Set();
  for (const t of tracks.slice(0, max)) {
    try {
      const f = await store.mainFile(t.id);
      if (!f) continue;
      const m = await readAudioMeta(await storage.open(f, { quiet: true }), { name: f.name });
      for (const p of m.pictures || []) {
        const k = p.data.length + ':' + Array.from(p.data.subarray(0, 32)).join(',');
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ blob: new Blob([p.data], { type: p.mime }), type: p.type, from: t.title });
      }
    } catch { /* cloud file offline */ }
  }
  return out;
}
const PIC_TYPES = { 3: 'Bìa trước', 4: 'Bìa sau', 0: 'Khác', 7: 'Nghệ sĩ chính', 8: 'Nghệ sĩ', 6: 'Đĩa', 5: 'Booklet', 2: 'Icon' };

// Square crop of an image blob. Resolves to a Blob (JPEG ≤ 1200 px) or null when cancelled.
export function cropSquare(blob, { title = 'Cắt ảnh vuông' } = {}) {
  return new Promise(async (resolve) => {
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch { toast('Không đọc được ảnh này', 'error'); resolve(null); return; }
    let done = false;
    const s = sheet({ title, body: `<div class="lcrop">
      <div class="lcrop-view" tabindex="0" aria-label="Kéo để di chuyển ảnh"><canvas width="600" height="600"></canvas></div>
      <label class="lcrop-zoom">${icon('search')}<input type="range" min="1" max="4" step="0.01" value="1" aria-label="Phóng to"></label>
      <p class="hint">${bmp.width} × ${bmp.height} px. Kéo để chọn phần ảnh, cuộn hoặc kéo thanh để phóng to.</p>
      <div class="row-actions"><button class="btn" data-full>Giữ nguyên tỷ lệ</button><button class="btn primary" data-ok>${icon('check')}Dùng ảnh này</button></div></div>`,
      onClose: () => { if (!done) resolve(null); } });
    const cv = s.el.querySelector('canvas'), g = cv.getContext('2d'), zoom = s.el.querySelector('input');
    const base = Math.min(bmp.width, bmp.height);
    let z = 1, cx = bmp.width / 2, cy = bmp.height / 2;
    const side = () => base / z;
    const clamp = () => { const h = side() / 2; cx = Math.min(bmp.width - h, Math.max(h, cx)); cy = Math.min(bmp.height - h, Math.max(h, cy)); };
    const draw = () => { clamp(); const sd = side(); g.clearRect(0, 0, 600, 600); g.drawImage(bmp, cx - sd / 2, cy - sd / 2, sd, sd, 0, 0, 600, 600); };
    draw();
    zoom.oninput = () => { z = +zoom.value; draw(); };
    const view = s.el.querySelector('.lcrop-view');
    view.addEventListener('wheel', (e) => { e.preventDefault(); z = Math.min(4, Math.max(1, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); zoom.value = z; draw(); }, { passive: false });
    let p0 = null;
    view.onpointerdown = (e) => { p0 = { x: e.clientX, y: e.clientY, cx, cy }; view.setPointerCapture(e.pointerId); };
    view.onpointermove = (e) => { if (!p0) return; const k = side() / view.clientWidth; cx = p0.cx - (e.clientX - p0.x) * k; cy = p0.cy - (e.clientY - p0.y) * k; draw(); };
    view.onpointerup = () => { p0 = null; };
    view.onkeydown = (e) => { const st = side() * 0.05; if (e.key === 'ArrowLeft') cx -= st; else if (e.key === 'ArrowRight') cx += st; else if (e.key === 'ArrowUp') cy -= st; else if (e.key === 'ArrowDown') cy += st; else return; e.preventDefault(); draw(); };
    const finish = async (crop) => {
      const sd = crop ? side() : null;
      const out = crop ? Math.min(1200, Math.round(sd)) : null;
      const c = document.createElement('canvas');
      if (crop) { c.width = c.height = out; c.getContext('2d').drawImage(bmp, cx - sd / 2, cy - sd / 2, sd, sd, 0, 0, out, out); }
      else { const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); }
      const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      done = true; s.close(); resolve(b);
    };
    s.el.querySelector('[data-ok]').onclick = () => finish(true);
    s.el.querySelector('[data-full]').onclick = () => finish(false);
  });
}

// Read an image from the clipboard (async Clipboard API), or null.
async function clipboardImage() {
  try {
    for (const it of await navigator.clipboard.read()) {
      const type = it.types.find(t => t.startsWith('image/'));
      if (type) return await it.getType(type);
    }
  } catch { /* permission denied / unsupported */ }
  return null;
}

// kind/id: see store.ART_KINDS. tracks: songs whose embedded art can be picked. cover: current ref.
export async function artworkSheet({ kind, id, name, tracks = [], cover, onDone }) {
  const custom = await store.hasCustomArtwork(kind, id);
  const s = sheet({ title: `Ảnh ${store.ART_KINDS[kind] || ''}: ${name || ''}`, wide: true, body: `<div class="lart">
    <div class="lart-cur">${artHtml(cover, name, { cls: 'hero' + (['artist', 'albumartist', 'composer'].includes(kind) ? ' round' : '') })}
      <p class="hint">${custom ? 'Đang dùng ảnh bạn chọn.' : 'Đang dùng ảnh tự động (ảnh trong tệp, ảnh thư mục, ảnh ghép từ bìa album, hoặc ảnh tạo sẵn).'}</p></div>
    <div class="lart-drop" tabindex="0" data-drop>${icon('image')}<b>Thả ảnh vào đây</b><span>hoặc dán (Ctrl+V) · JPG, PNG, WebP</span></div>
    <div class="row-actions"><label class="btn primary">${icon('upload')}Chọn ảnh…<input type="file" accept="image/*" hidden data-file></label>
      <button class="btn" data-paste>${icon('copy')}Dán ảnh</button>
      ${custom ? `<button class="btn danger-ghost" data-auto>${icon('refresh')}Về ảnh tự động</button>` : ''}</div>
    ${tracks.length ? `<h4>Ảnh có sẵn trong tệp nhạc</h4><div class="lart-emb" data-emb><p class="muted">Đang đọc ảnh trong tệp…</p></div>` : ''}</div>` });
  hydrate(s.el);
  const use = async (blob) => {
    if (!blob) return;
    const b = await cropSquare(blob);
    if (!b) return;
    try { await store.setArtwork(kind, id, b); toast('Đã đổi ảnh'); s.close(); onDone?.(); }
    catch (e) { toast(e.message, 'error'); }
  };
  s.el.querySelector('[data-file]').onchange = (e) => use(e.target.files[0]);
  s.el.querySelector('[data-paste]').onclick = async () => { const b = await clipboardImage(); if (b) use(b); else toast('Không có ảnh trong bộ nhớ tạm (hoặc trình duyệt chưa cho đọc). Thử Ctrl+V.', 'warn'); };
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/')); if (f) { e.preventDefault(); use(f); } };
  s.el.addEventListener('paste', onPaste);
  document.addEventListener('paste', onPaste);
  const obs = new MutationObserver(() => { if (!s.el.isConnected) { document.removeEventListener('paste', onPaste); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
  const drop = s.el.querySelector('[data-drop]');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/')); if (f) use(f); else toast('Chỉ nhận tệp ảnh', 'warn'); };
  s.el.querySelector('[data-auto]')?.addEventListener('click', async () => { await store.clearArtwork(kind, id); toast('Đã về ảnh tự động'); s.close(); onDone?.(); });
  const emb = s.el.querySelector('[data-emb]');
  if (emb) {
    const pics = await embeddedPictures(tracks);
    emb.innerHTML = pics.length ? pics.map((p, i) => `<button class="lart-pic" data-i="${i}" title="${esc(p.from)}"><img alt="" src="${URL.createObjectURL(p.blob)}"><small>${PIC_TYPES[p.type] || 'Ảnh'}</small></button>`).join('')
      : '<p class="muted">Các tệp này không có ảnh nhúng.</p>';
    emb.querySelectorAll('[data-i]').forEach(b => b.onclick = () => use(pics[+b.dataset.i].blob));
  }
}
