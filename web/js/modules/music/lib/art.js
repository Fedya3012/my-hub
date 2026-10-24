// Cover art: object URLs (cached), thumbnails, colour palette for album-art theming,
// and generated placeholders for tracks without a cover.
import { db } from '../../../core/db.js';
import { storage } from '../../../core/storage/index.js';
import { esc } from '../../../core/ui.js';

const urls = new Map();     // fileId -> object URL (or Promise of one)

// fileId, or an artwork ref: 'c:<id>|<id>|…' (2×2 collage of covers, cached), 'u:<url>' (ready URL).
export function fileUrl(fileId) {
  if (!fileId) return Promise.resolve(null);
  if (String(fileId).startsWith('u:')) return Promise.resolve(String(fileId).slice(2));
  if (!urls.has(fileId)) {
    urls.set(fileId, (async () => {
      if (String(fileId).startsWith('c:')) return collageUrl(String(fileId).slice(2).split('|').filter(Boolean));
      const row = await db.files.get(fileId);
      if (!row) return null;
      try { return URL.createObjectURL(await storage.open(row)); } catch { return null; }
    })());
  }
  return urls.get(fileId);
}

// ── Collages (playlists, artists, genres, years, labels, folders…) ──
// Drawn once from the covers' thumbnails, then kept in Cache Storage so the next visit is instant.
const ART_CACHE = 'hub-music-art';
export const collageRef = (ids) => {
  const u = [...new Set((ids || []).filter(Boolean))];
  if (!u.length) return null;
  if (u.length < 4) return u[0];
  return 'c:' + u.slice(0, 4).join('|');
};
async function collageUrl(ids) {
  const key = new Request('https://music-art.local/collage/' + encodeURIComponent(ids.join('|')));
  try {
    const c = await caches.open(ART_CACHE);
    const hit = await c.match(key);
    if (hit) return URL.createObjectURL(await hit.blob());
  } catch { /* no Cache Storage (private mode) */ }
  const S = 360, half = S / 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#222'; g.fillRect(0, 0, S, S);
  let drawn = 0;
  await Promise.all(ids.slice(0, 4).map(async (id, i) => {
    try {
      const row = await db.files.get(id);
      if (!row) return;
      const bmp = await createImageBitmap(await storage.open(row));
      const s = Math.min(bmp.width, bmp.height);
      g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, (i % 2) * half, Math.floor(i / 2) * half, half, half);
      bmp.close?.(); drawn++;
    } catch { /* missing cover: leave the tile dark */ }
  }));
  if (!drawn) return null;
  const blob = await new Promise(res => cv.toBlob(res, 'image/webp', 0.85));
  if (!blob) return null;
  try { await (await caches.open(ART_CACHE)).put(key, new Response(blob, { headers: { 'content-type': blob.type } })); } catch { /* ignore */ }
  return URL.createObjectURL(blob);
}
export async function clearArtCache() { try { await caches.delete(ART_CACHE); } catch { /* ignore */ } }

// ── Generated art: every tile shows a picture, even with no cover anywhere ──
const genCache = new Map();
export function genArt(seed = '', label = '') {
  const k = seed + '\u0001' + label;
  if (genCache.has(k)) return genCache.get(k);
  const h = hashHue(seed || label), h2 = (h + 50) % 360, h3 = (h + 200) % 360;
  const words = String(label || seed || '♪').trim().split(/\s+/).slice(0, 4);
  const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > 12 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  const xmlEsc = (x) => x.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r = (hashHue(seed + 'r') % 60) + 70;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},48%,46%)"/><stop offset="1" stop-color="hsl(${h2},55%,20%)"/></linearGradient></defs>`
    + `<rect width="300" height="300" fill="url(#g)"/><circle cx="${230 - r / 3}" cy="${70 + r / 4}" r="${r}" fill="hsl(${h3},60%,60%)" opacity=".22"/><circle cx="60" cy="250" r="${r * 1.4}" fill="#000" opacity=".16"/>`
    + `<g fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${lines.slice(0, 3).map((l, i) => `<text x="22" y="${200 + i * 30 - (lines.length - 1) * 15}" font-size="26" opacity=".92">${xmlEsc(l)}</text>`).join('')}</g></svg>`;
  const u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  genCache.set(k, u);
  return u;
}

export function forgetUrl(fileId) {
  const u = urls.get(fileId);
  urls.delete(fileId);
  Promise.resolve(u).then(x => x && URL.revokeObjectURL(x));
}

// JPEG/WebP for grids and lists (full covers can be several MB). 720 px keeps a 240 px tile sharp on a 3× phone
// screen; big views (album page, Đang phát) use the original cover.
export const THUMB = 720;
export async function makeThumb(blob, size = THUMB) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise(res => c.toBlob(b => res(b), 'image/webp', 0.9)).then(b => b || new Promise(res => c.toBlob(res, 'image/jpeg', 0.9)));
}

// ── Palette ─────────────────────────────────────────────────────
const toHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2hex(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

// { bg: dominant dark tone, accent: most vivid colour, light: bright tint, dark: deep tint }
export async function palette(blob) {
  try {
    const bmp = await createImageBitmap(blob, { resizeWidth: 40, resizeHeight: 40 });
    const c = document.createElement('canvas'); c.width = c.height = 40;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, 40, 40);
    const px = g.getImageData(0, 0, 40, 40).data;
    const buckets = new Map();
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = rgb2hsl(px[i], px[i + 1], px[i + 2]);
      const key = s < .12 ? 'g' + Math.round(l * 4) : Math.round(h / 24) + ':' + Math.round(l * 3);
      const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2];
      buckets.set(key, b);
    }
    const list = [...buckets.values()].map(b => ({ n: b.n, hsl: rgb2hsl(b.r / b.n, b.g / b.n, b.b / b.n) }));
    const dom = list.sort((a, b) => b.n - a.n)[0].hsl;
    const vivid = list.filter(x => x.n > 8).sort((a, b) => (b.hsl[1] * (1 - Math.abs(b.hsl[2] - .55)) * Math.sqrt(b.n)) - (a.hsl[1] * (1 - Math.abs(a.hsl[2] - .55)) * Math.sqrt(a.n)))[0]?.hsl || dom;
    const hue = vivid[1] > .15 ? vivid[0] : dom[0];
    const sat = Math.max(.35, Math.min(.85, vivid[1]));
    return {
      bg: hsl2hex(dom[0], Math.min(.55, dom[1]), Math.min(.22, Math.max(.1, dom[2] * .45))),
      accent: hsl2hex(hue, sat, .58),
      light: hsl2hex(hue, Math.min(.9, sat + .1), .72),
      dark: hsl2hex(hue, sat, .38),
    };
  } catch { return null; }
}

// ── Placeholder art (no cover) ──────────────────────────────────
export function hashHue(s = '') {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
export function placeholderStyle(seed) {
  const h = hashHue(seed);
  return `background: linear-gradient(135deg, hsl(${h} 45% 42%), hsl(${(h + 50) % 360} 55% 22%));`;
}

// <img> for a cover (fileId or artwork ref), falling back to generated art: never an empty tile.
export function artHtml(fileId, seed, { cls = '', alt = '', label } = {}) {
  const initial = esc((seed || '♪').trim().charAt(0).toUpperCase());
  const gen = genArt(seed || '', label ?? seed ?? '');
  return `<span class="mart ${cls} has-gen" style="${placeholderStyle(seed)}"><img class="mart-gen" src="${gen}" alt="" aria-hidden="true">${fileId ? `<img data-art="${esc(fileId)}" alt="${esc(alt)}" decoding="async" hidden>` : ''}<span class="mart-i" aria-hidden="true">${initial}</span></span>`;
}

// Fill every [data-art] image inside root (only those scrolled near the viewport).
let io = null;
export function hydrate(root) {
  io ||= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const img = e.target.querySelector('img[data-art]');
      if (img) load(img);
    }
  }, { rootMargin: '400px' });
  // Observe the frame: the image itself is hidden until loaded, and hidden elements never intersect.
  root.querySelectorAll('img[data-art]:not([data-done])').forEach(img => { img.dataset.done = '1'; io.observe(img.parentElement || img); });
}
async function load(img) {
  const u = await fileUrl(img.dataset.art);
  if (!u) return;
  img.onload = () => { img.hidden = false; img.parentElement?.classList.add('has-img'); };
  img.src = u;
}
