// Small DOM helpers shared by all modules.
import { icon } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, kind = 'info') {
  const host = document.getElementById('toasts');
  const el = h(`<div class="toast toast-${kind}" role="status">${esc(msg)}</div>`);
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

// In-page modal (browser confirm()/prompt() are not used: they don't work everywhere).
export function modal({ title, body, actions = [{ label: 'Đóng', value: null }] }) {
  return new Promise((resolve) => {
    const el = h(`<div class="modal-wrap" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal">
        <header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Đóng">${icon('x')}</button></header>
        <div class="modal-body"></div>
        <footer></footer>
      </div></div>`);
    const bodyEl = el.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const foot = el.querySelector('footer');
    const close = (v) => { el.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    for (const a of actions) {
      const b = h(`<button class="btn ${a.kind || ''}">${esc(a.label)}</button>`);
      b.onclick = () => close(typeof a.value === 'function' ? a.value(bodyEl) : a.value);
      foot.appendChild(b);
    }
    el.querySelector('[data-close]').onclick = () => close(null);
    el.addEventListener('click', e => { if (e.target === el) close(null); });
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    (el.querySelector('input,select,textarea') || foot.lastElementChild)?.focus();
  });
}

export const confirmBox = (title, text, okLabel = 'Đồng ý', kind = 'danger') =>
  modal({ title, body: `<p>${esc(text)}</p>`, actions: [{ label: 'Huỷ', value: false }, { label: okLabel, value: true, kind }] });

// Export JSON: offers a download and a copyable text box (downloads are blocked in some
// embedded viewers, so the text box always works).
export function saveJson(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const body = h(`<div class="stack">
    <p class="muted">${esc(filename)} · ${fmtBytes(blob.size)}</p>
    <a class="btn primary" href="${url}" download="${esc(filename)}">${icon('download')} Tải tệp JSON</a>
    <textarea id="export-json" class="code" rows="10" readonly></textarea>
    <button class="btn" data-copy>Sao chép nội dung</button></div>`);
  body.querySelector('textarea').value = text;
  body.querySelector('[data-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast('Đã sao chép'); }
    catch { body.querySelector('textarea').select(); toast('Hãy nhấn Ctrl+C để sao chép'); }
  };
  return modal({ title: 'Xuất JSON', body }).finally(() => URL.revokeObjectURL(url));
}

// Import JSON from a file or pasted text.
export function pickJson(title = 'Nhập JSON') {
  const body = h(`<div class="stack">
    <label class="btn">${icon('upload')} Chọn tệp .json<input type="file" id="import-file" accept=".json,application/json" hidden></label>
    <textarea id="import-json" class="code" rows="8" placeholder="…hoặc dán nội dung JSON vào đây"></textarea></div>`);
  body.querySelector('input').onchange = async (e) => {
    const f = e.target.files[0];
    if (f) body.querySelector('textarea').value = await f.text();
  };
  return modal({ title, body, actions: [{ label: 'Huỷ', value: null }, { label: 'Nhập', kind: 'primary', value: (b) => b.querySelector('textarea').value }] })
    .then(text => {
      if (!text) return null;
      try { return JSON.parse(text); } catch { toast('JSON không hợp lệ', 'error'); return null; }
    });
}

export function fmtBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

const rtf = new Intl.RelativeTimeFormat(globalThis.__LOCALE_SHORT || 'vi', { numeric: 'auto' });
export function fmtAgo(ts) {
  if (!ts) return 'chưa';
  const s = (Math.min(ts, Date.now()) - Date.now()) / 1000; // another device's clock may run ahead
  const steps = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month'], [Infinity, 'year']];
  const div = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
  for (const [lim, unit] of steps) if (Math.abs(s) < lim) return rtf.format(Math.round(s / div[unit]), unit);
}

export function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
