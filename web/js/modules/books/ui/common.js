// Shared UI bits for the Books pages: covers (lazy object URLs), stars (half stars), status pills,
// book cards and rows, sheets, small formatters.
import { icon } from '../../../core/icons.js';
import { esc } from '../../../core/ui.js';
import { storage } from '../../../core/storage/index.js';
import { db } from '../../../core/db.js';
import { STATUSES } from '../lib/store.js';
import { FORMATS, hue } from '../lib/formats.js';

export const loc = () => globalThis.__LOCALE || 'vi-VN';
export const fmtNum = (n, d = 0) => Number(n || 0).toLocaleString(loc(), { maximumFractionDigits: d });
export const fmtDate = (t) => t ? new Date(t).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtHours = (h) => h < 1 ? `${Math.round(h * 60)} phút` : `${fmtNum(h, 1)} giờ`;
export const fmtMin = (sec) => { const m = Math.round(sec / 60); return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60} phút`; };

// ── Covers ──
const urls = new Map();   // fileId -> object URL (kept for the session; covers are small)
export async function coverUrl(b) {
  if (b.cover) {
    if (urls.has(b.cover.id)) return urls.get(b.cover.id);
    try { const u = await storage.objectUrl(b.cover); urls.set(b.cover.id, u); return u; } catch { /* fall through */ }
  }
  return b.book.coverUrl || '';
}
export function forgetCover(fileId) { const u = urls.get(fileId); if (u) URL.revokeObjectURL(u); urls.delete(fileId); }

export function coverHtml(b, cls = '') {
  const fmt = b.book.physical ? 'paper' : b.format;
  return `<span class="bk-cover ${cls}" data-cover="${b.id}" style="--h:${hue(b.title + (b.authors[0] || ''))}">
    <span class="bk-cover-ph"><b>${esc(b.title)}</b><small>${esc(b.authors[0] || '')}</small></span>
    ${fmt ? `<span class="bk-fmt">${esc(FORMATS[fmt]?.label || fmt)}</span>` : ''}</span>`;
}

// Fill [data-cover] placeholders inside `root` with images as they come into view.
let io = null;
export function hydrateCovers(root, byId) {
  const els = root.querySelectorAll('[data-cover]:not([data-done])');
  const load = async (el) => {
    el.dataset.done = '1';
    const b = byId.get(el.dataset.cover);
    const u = b && await coverUrl(b);
    if (!u) return;
    const img = new Image();
    img.alt = ''; img.decoding = 'async';
    img.onload = () => el.classList.add('has-img');
    img.src = u;
    el.prepend(img);
  };
  if (!('IntersectionObserver' in window)) { els.forEach(load); return; }
  io ||= new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: '600px' });
  els.forEach(el => io.observe(el));
}

// ── Stars (0–5, half steps) ──
export function starsHtml(rating, { edit = false, size = '' } = {}) {
  const s = [1, 2, 3, 4, 5].map(n => {
    const cls = rating >= n ? 'on' : rating >= n - 0.5 ? 'half' : '';
    const ic = icon(cls === 'half' ? 'b-half' : cls ? 'b-star-fill' : 'star');
    return edit ? `<button type="button" class="bk-star ${cls}" data-star="${n}" aria-label="${n} sao">${ic}</button>` : `<i class="bk-star ${cls}">${ic}</i>`;
  }).join('');
  return `<span class="bk-stars ${size} ${edit ? 'edit' : ''}" ${edit ? 'role="group" aria-label="Đánh giá"' : `aria-label="${rating} sao"`}>${s}</span>`;
}
// Click the left half of a star for a half star, the right half for a full one; same value again clears.
export function bindStars(el, current, onChange, { half = true } = {}) {
  el.querySelectorAll('[data-star]').forEach(b => b.onclick = (e) => {
    const n = +b.dataset.star;
    const r = b.getBoundingClientRect();
    let v = half && e.clientX && (e.clientX - r.left) < r.width / 2 ? n - 0.5 : n;
    if (v === current) v = 0;
    onChange(v);
  });
}

export const statusPill = (s) => `<span class="bk-status st-${s}">${esc(STATUSES[s] || s)}</span>`;
export const statusOptions = (cur) => Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');

export function cardHtml(b, { select = false, selected = false } = {}) {
  return `<article class="bk-card${selected ? ' sel' : ''}" data-id="${b.id}" tabindex="0">
    ${select ? `<input type="checkbox" class="bk-check" data-check="${b.id}" ${selected ? 'checked' : ''} aria-label="Chọn">` : ''}
    ${coverHtml(b)}
    ${b.percent > 0 && b.percent < 100 ? `<span class="bk-prog"><i style="width:${b.percent}%"></i></span>` : ''}
    <span class="bk-card-t">${esc(b.title)}</span>
    <span class="bk-card-a">${esc(b.authors.join(', '))}</span>
    <span class="bk-card-f">${b.rating ? starsHtml(b.rating, { size: 'xs' }) : statusPill(b.status)}${b.favorite ? `<i class="bk-fav">${icon('b-star-fill')}</i>` : ''}</span>
  </article>`;
}

export function rowHtml(b, { select = false, selected = false } = {}) {
  return `<article class="bk-row${selected ? ' sel' : ''}" data-id="${b.id}" tabindex="0">
    ${select ? `<input type="checkbox" class="bk-check" data-check="${b.id}" ${selected ? 'checked' : ''} aria-label="Chọn">` : ''}
    ${coverHtml(b, 'sm')}
    <span class="bk-row-main"><b>${esc(b.title)}</b><small>${esc(b.authors.join(', '))}${b.series ? ` · ${esc(b.series)}${b.seriesIndex != null ? ' #' + b.seriesIndex : ''}` : ''}</small></span>
    <span class="bk-row-c">${statusPill(b.status)}</span>
    <span class="bk-row-c hide-sm">${b.rating ? starsHtml(b.rating, { size: 'xs' }) : ''}</span>
    <span class="bk-row-c num muted hide-sm">${b.pages ? b.pages + ' tr.' : ''}</span>
    <span class="bk-row-c num">${b.percent ? b.percent + '%' : ''}</span>
  </article>`;
}

// Save a cover image for a book (replaces the old one).
export async function setCover(itemId, blob) {
  const old = await db.files.where('itemId').equals(itemId).filter(f => f.role === 'cover').toArray();
  for (const f of old) { forgetCover(f.id); await storage.removeFile(f).catch(() => {}); }
  if (blob) await storage.addFile(itemId, blob, { role: 'cover', name: 'cover.' + ((blob.type || '').split('/')[1] || 'jpg').replace('jpeg', 'jpg'), quiet: true });
}

export function download(name, data, type = 'text/plain') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Bottom sheet on phones, centred panel on wide screens.
export function sheet(title, body, { wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'bk-sheet-wrap';
  wrap.innerHTML = `<div class="bk-sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="icon-btn" data-x aria-label="Đóng">${icon('x')}</button></header><div class="bk-sheet-body"></div></div>`;
  const b = wrap.querySelector('.bk-sheet-body');
  if (typeof body === 'string') b.innerHTML = body; else b.append(body);
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key, true); wrap.onclose?.(); };
  wrap.querySelector('[data-x]').onclick = close;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', key, true);
  document.body.append(wrap);
  return { el: b, close, wrap };
}

// Tiny popup menu anchored to a button: items [{ label, icon, run, danger }].
export function menu(anchor, items) {
  document.querySelector('.bk-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'bk-menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = items.filter(Boolean).map((it, i) => it === '-' ? '<hr>' : `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}${esc(it.label)}</button>`).join('');
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 4) + 'px';
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
  const list = items.filter(Boolean);
  m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { m.remove(); list[+b.dataset.i].run(); });
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  m.querySelector('button')?.focus();
}
