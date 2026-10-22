// Shared UI bits for Xưởng Viết: popup menu, sheet (bottom sheet on phones), chips, work rows, formatters.
import { icon } from '../../../core/icons.js';
import { esc } from '../../../core/ui.js';
import { STATUSES, AUDIENCE, WARNINGS } from '../lib/vocab.js';

export const loc = () => globalThis.__LOCALE || 'vi-VN';
export const fmtNum = (n) => Number(n || 0).toLocaleString(loc());
export const fmtDate = (t) => t ? new Date(t).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export function ago(t) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  if (m < 1440) return `${Math.round(m / 60)} giờ trước`;
  if (m < 10080) return `${Math.round(m / 1440)} ngày trước`;
  return fmtDate(t);
}

// Tiny popup menu anchored to an element (or a pointer position): items [{ label, icon, run, danger }] and '-'.
export function menu(anchor, items, at = null) {
  document.querySelector('.fx-menu')?.remove();
  const list = items.filter(Boolean);
  const m = document.createElement('div');
  m.className = 'fx-menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = list.map((it, i) => it === '-' ? '<hr>' : `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`).join('');
  document.body.append(m);
  const r = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : anchor.getBoundingClientRect();
  m.style.top = Math.max(8, Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 4)) + 'px';
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, at ? r.left : r.right - m.offsetWidth)) + 'px';
  m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { m.remove(); list[+b.dataset.i].run(); });
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.remove(); });
  m.querySelector('button')?.focus();
}

// Bottom sheet on phones, centred panel on wide screens.
export function sheet(title, body, { wide = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'fx-sheet-wrap';
  wrap.innerHTML = `<div class="fx-sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="icon-btn" data-x aria-label="Đóng">${icon('x')}</button></header><div class="fx-sheet-body"></div></div>`;
  const b = wrap.querySelector('.fx-sheet-body');
  if (typeof body === 'string') b.innerHTML = body; else b.append(body);
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key, true); onClose?.(); };
  wrap.querySelector('[data-x]').onclick = close;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', key, true);
  document.body.append(wrap);
  return { el: b, close };
}

export const audienceBadge = (a) => { const d = AUDIENCE[a] || AUDIENCE.nr; return `<span class="fx-aud" style="--c:${d.color}" title="${esc(d.label)}">${d.short}</span>`; };
export const statusPill = (s) => `<span class="fx-st fx-st-${s}">${esc(STATUSES[s] || s)}</span>`;
export const chapterCount = (v) => `${v.chapterCount}/${v.planned || (v.status === 'complete' ? v.chapterCount : '?')}`;

export function tagChips(v, { max = 8 } = {}) {
  const out = [
    ...(v.fic.warnings || []).filter(w => w !== 'none').map(w => `<span class="fx-tag warn">${esc(WARNINGS[w] || w)}</span>`),
    ...v.relationships.map(t => `<span class="fx-tag rel">${esc(t.name)}</span>`),
    ...v.characters.map(t => `<span class="fx-tag char">${esc(t.name)}</span>`),
    ...v.tags.map(t => `<span class="fx-tag">${esc(t)}</span>`),
  ];
  return out.slice(0, max).join('') + (out.length > max ? `<span class="fx-tag more">+${out.length - max}</span>` : '');
}

// One work in a list (AO3 "blurb"): rating square, title, fandoms, tags, stats.
export function workRow(v, { select = false, selected = false } = {}) {
  const goal = v.fic.goal?.total || 0;
  return `<article class="fx-work${selected ? ' sel' : ''}" data-id="${v.id}" tabindex="0">
    ${select ? `<input type="checkbox" class="fx-check" ${selected ? 'checked' : ''} aria-label="Chọn">` : ''}
    ${audienceBadge(v.audience)}
    <div class="fx-work-b">
      <h3>${esc(v.title)}${v.origin === 'saved' && v.fic.author ? ` <small>của ${esc(v.fic.author)}</small>` : ''}</h3>
      <p class="fx-fandoms">${v.fandoms.map(f => esc(f.name)).join(', ') || '<span class="muted">Chưa có fandom</span>'}</p>
      <div class="fx-tags">${tagChips(v)}</div>
      ${v.fic.summary ? `<p class="fx-sum">${esc(v.fic.summary.slice(0, 220))}</p>` : ''}
      <p class="fx-stats muted">${statusPill(v.status)} · ${fmtNum(v.words)} từ · ${chapterCount(v)} chương${v.published ? ` · ${icon('book')}Trong Sách${v.dirty ? ' (có thay đổi)' : ''}` : ''}${v.readPercent ? ` · đã đọc ${v.readPercent}%` : ''} · ${ago(v.editedAt)}</p>
      ${goal ? `<div class="bar sm" title="${fmtNum(v.words)} / ${fmtNum(goal)} từ"><i style="width:${Math.min(100, v.words / goal * 100)}%"></i></div>` : ''}
    </div>
  </article>`;
}

// Comma list input with suggestions (fandoms, characters, tags).
export const listInput = (name, values, suggestions = [], placeholder = '') => {
  const id = 'fx-dl-' + name;
  return `<input data-f="${name}" value="${esc((values || []).join(', '))}" list="${id}" placeholder="${esc(placeholder)}" autocomplete="off">
    <datalist id="${id}">${[...new Set(suggestions)].slice(0, 300).map(s => `<option value="${esc(s)}">`).join('')}</datalist>`;
};

export function download(name, data, type = 'text/plain') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type + ';charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
