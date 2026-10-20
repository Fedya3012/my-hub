// Cài đặt → "Thông số": every parameter declared through core/params.js shows up here by itself
// (current and future modules), grouped by namespace. Read-only / live namespaces (device,
// account, playback, tasks) are listed in a collapsed "Trạng thái" block for reference.
import { params } from './params.js';
import { icon } from './icons.js';
import { esc } from './ui.js';

const shown = (d) => d.label && d.ui !== false && !d.readonly;

function control(ns, p) {
  const id = `prm-${ns}-${p.key}`.replace(/[^\w-]/g, '_');
  const key = esc(ns + '.' + p.key);
  const v = p.value;
  if (p.type === 'bool') return `<label class="check prm-row" for="${id}"><input type="checkbox" id="${id}" data-param="${key}" ${v ? 'checked' : ''}> ${esc(p.label)}</label>`;
  let input;
  if (p.type === 'enum') input = `<select id="${id}" data-param="${key}">${Object.entries(p.options || {}).map(([k, l]) => `<option value="${esc(k)}" ${String(v) === String(k) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (p.type === 'number' && p.min != null && p.max != null) input = `<span class="prm-range"><input type="range" id="${id}" data-param="${key}" min="${p.min}" max="${p.max}" step="${p.step || 'any'}" value="${v ?? p.default ?? 0}"><output class="num">${v ?? ''}${p.unit ? ' ' + esc(p.unit) : ''}</output></span>`;
  else if (p.type === 'number') input = `<input type="number" id="${id}" data-param="${key}" value="${v ?? ''}">`;
  else if (p.type === 'color') input = `<input type="color" id="${id}" data-param="${key}" value="${esc(v || '#1d6f8f')}">`;
  else input = `<input id="${id}" data-param="${key}" value="${esc(v ?? '')}">`;
  return `<label class="prm-row" for="${id}"><span>${esc(p.label)}</span>${input}</label>`;
}

export function paramsSectionHtml() {
  const reg = params.registry();
  const editable = reg.filter(sp => !sp.readonly && sp.params.some(shown));
  const live = reg.filter(sp => sp.readonly);
  return `<section class="set-block" id="params">
    <h2 class="section-title">${icon('grid')}Thông số dùng chung</h2>
    <p class="hint">Mọi module đọc cùng các thông số này (giao diện, ngôn ngữ, âm thanh, lưu trữ…). Module mới tự thêm thông số của mình vào đây; tất cả có trong bản sao lưu JSON và thông số “đồng bộ” theo tài khoản sang máy khác.</p>
    ${editable.map(sp => `<details class="panel prm-ns" data-ns="${esc(sp.ns)}">
      <summary>${icon(sp.icon || 'settings')}<b>${esc(sp.title)}</b><span class="muted">${sp.params.filter(shown).length} thông số</span></summary>
      <div class="prm-grid">${sp.params.filter(shown).map(p => control(sp.ns, p) + (p.hint ? `<small class="hint">${esc(p.hint)}</small>` : '')).join('')}</div>
      <div class="row-actions"><button class="btn small" data-param-reset="${esc(sp.ns)}">Về mặc định</button></div></details>`).join('')}
    <details class="panel prm-ns prm-live"><summary>${icon('device')}<b>Trạng thái hiện tại</b><span class="muted">chỉ đọc</span></summary>
      ${live.map(sp => `<h3 class="prm-h">${esc(sp.title)}</h3><dl class="kv">${sp.params.map(p => `<dt>${esc(p.label || p.key)}</dt><dd class="num" data-live="${esc(sp.ns + '.' + p.key)}">${esc(fmt(p.value))}</dd>`).join('')}</dl>`).join('')}
    </details>
  </section>`;
}
const fmt = (v) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// Returns an unsubscribe function (live values refresh in place).
export function bindParams(root, toast) {
  root.querySelectorAll('[data-param]').forEach(el => {
    const key = el.dataset.param;
    const out = el.parentElement.querySelector('output');
    const ev = el.type === 'range' || el.type === 'color' ? 'input' : 'change';
    el.addEventListener(ev, async () => {
      const v = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.type === 'range' || el.type === 'number' ? +el.value : el.value;
      if (out) out.textContent = el.value;
      try { await params.set(key, v); } catch (e) { toast?.(e.message, 'error'); }
    });
  });
  root.querySelectorAll('[data-param-reset]').forEach(b => b.onclick = async () => {
    await params.reset(b.dataset.paramReset);
    const sp = params.registry().find(x => x.ns === b.dataset.paramReset);
    for (const p of sp?.params || []) {
      const el = root.querySelector(`[data-param="${CSS.escape(sp.ns + '.' + p.key)}"]`);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!p.value; else el.value = p.value ?? '';
    }
    toast?.('Đã đặt lại ' + (sp?.title || ''));
  });
  return params.on('*', (e) => {
    const d = root.querySelector(`[data-live="${CSS.escape(e.key)}"]`);
    if (d) d.textContent = fmt(e.value);
    const el = root.querySelector(`[data-param="${CSS.escape(e.key)}"]`);
    if (el && document.activeElement !== el && e.source !== 'local') { if (el.type === 'checkbox') el.checked = !!e.value; else if (e.value != null) el.value = e.value; }
  });
}
