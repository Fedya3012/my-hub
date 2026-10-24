// Sách → Cài đặt: the app's own settings in one place (reader display, light, reading mode, comics and PDF,
// read aloud and translation, tracking), the sources of the "Thịnh hành" tab, and file / data shortcuts.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { namespaceHtml, bindParams } from '../../../core/params-ui.js';
import { KINDS, UNAVAILABLE, sources, saveSources, resetSources, labelOf } from '../lib/trend-sources.js';

const GROUPS = [
  ['b-font', 'Chữ và bố cục', ['font', 'fontSize', 'lineHeight', 'margin', 'maxWidth', 'justify', 'hyphenate']],
  ['palette', 'Nền trang và ánh sáng', ['theme', 'customBg', 'customFg', 'brightness', 'warmth']],
  ['book', 'Cách đọc', ['flow', 'columns', 'animated', 'tapZones']],
  ['image', 'Truyện tranh và PDF', ['comicFit', 'comicRtl', 'panelZoom', 'pdfMode']],
  ['b-speak', 'Đọc to và dịch', ['ttsRate', 'translateTo']],
  ['b-chart', 'Theo dõi việc đọc', ['trackSessions', 'idleMinutes', 'wpm', 'halfStars']],
];

export async function render(el, { arg }) {
  el.innerHTML = `<div class="bk-settings stack">
    <h2 class="section-title">${icon('settings')}Cài đặt Sách</h2>
    ${GROUPS.map(([ic, title, keys]) => `<details class="panel prm-ns" open><summary>${icon(ic)}<b>${esc(title)}</b></summary>${namespaceHtml('books', keys)}</details>`).join('')}
    <details class="panel prm-ns" id="sources" ${arg === 'sources' ? 'open' : ''}><summary>${icon('b-sparkle')}<b>Nguồn Thịnh hành</b></summary><div data-sources></div></details>
    <details class="panel prm-ns" open><summary>${icon('b-folder')}<b>Tệp và dữ liệu</b></summary>
      <div class="row-actions" style="flex-wrap:wrap">
        <a class="btn" href="#settings/folders">${icon('b-folder')}Thư mục đồng bộ</a>
        <a class="btn" href="#books/tools">${icon('upload')}Thêm & nhập sách</a>
        <button class="btn" data-clean>${icon('refresh')}Dọn dữ liệu Sách</button>
      </div>
      <p class="hint">Thư mục đồng bộ quét sách trong thư mục đã chọn (trên máy, Dropbox, OneDrive hoặc Google Drive) và tự thêm sách mới mỗi lần đồng bộ.</p>
    </details>
  </div>`;
  const off = bindParams(el, toast);
  el.querySelector('[data-clean]').onclick = async () => (await import('../../../core/storage/cleanup.js')).cleanDataAction('books', 'Sách');
  await drawSources(el.querySelector('[data-sources]'));
  if (arg === 'sources') el.querySelector('#sources').scrollIntoView({ block: 'start' });
  return off;
}

async function drawSources(box) {
  const list = await sources();
  box.innerHTML = `<p class="hint">Bật, tắt và sắp xếp các nguồn hiện ở tab Thịnh hành. ${esc(UNAVAILABLE.join(', '))} không có kết nối công khai cho ứng dụng nên chưa thêm được.</p>
    <ul class="bk-src">${list.map((s, i) => `<li class="bk-src-row">
      <label class="check"><input type="checkbox" data-on="${i}" ${s.on ? 'checked' : ''}> ${esc(labelOf(s))}</label>
      <span class="bk-src-act">
        <button class="icon-btn sm" data-up="${i}" aria-label="Lên" ${i ? '' : 'disabled'}>${icon('b-up')}</button>
        <button class="icon-btn sm" data-down="${i}" aria-label="Xuống" ${i < list.length - 1 ? '' : 'disabled'}>${icon('b-down')}</button>
        <button class="icon-btn sm" data-del="${i}" aria-label="Xoá nguồn">${icon('x')}</button></span></li>`).join('')}</ul>
    <div class="bk-src-add">
      <select data-kind>${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
      <span data-argbox></span>
      <button class="btn small primary" data-add>${icon('plus')}Thêm nguồn</button>
      <button class="btn small" data-reset>Về mặc định</button>
    </div>`;
  const kindSel = box.querySelector('[data-kind]');
  const argBox = box.querySelector('[data-argbox]');
  const drawArg = () => {
    const k = KINDS[kindSel.value];
    argBox.innerHTML = k.args ? `<select data-arg>${Object.entries(k.args).map(([a, l]) => `<option value="${a}">${esc(l)}</option>`).join('')}</select>`
      : `<input data-arg placeholder="${esc(k.hint || '')}" aria-label="${esc(k.arg)}">`;
  };
  kindSel.onchange = drawArg; drawArg();
  const save = async (next) => { await saveSources(next); await drawSources(box); };
  box.querySelectorAll('[data-on]').forEach(c => c.onchange = () => save(list.map((s, i) => (i === +c.dataset.on ? { ...s, on: c.checked } : s))));
  const move = (i, d) => { const n = [...list]; [n[i], n[i + d]] = [n[i + d], n[i]]; return save(n); };
  box.querySelectorAll('[data-up]').forEach(b => b.onclick = () => move(+b.dataset.up, -1));
  box.querySelectorAll('[data-down]').forEach(b => b.onclick = () => move(+b.dataset.down, 1));
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => save(list.filter((_, i) => i !== +b.dataset.del)));
  box.querySelector('[data-add]').onclick = () => {
    const arg = box.querySelector('[data-arg]').value.trim();
    if (!arg) { toast('Nhập nội dung cho nguồn này', 'warn'); return; }
    save([...list, { id: 's' + Date.now().toString(36), kind: kindSel.value, arg, on: true }]);
  };
  box.querySelector('[data-reset]').onclick = async () => { await resetSources(); await drawSources(box); };
}
