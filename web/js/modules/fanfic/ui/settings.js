// Xưởng Viết → Cài đặt: the app's own settings in one place (page look, writing aids, sounds, goals, publishing),
// plus file / data shortcuts. Same params as Cài đặt → Xưởng Viết, so both stay in sync.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { namespaceHtml, bindParams } from '../../../core/params-ui.js';
import { h } from '../../../core/ui.js';
import { sheet } from './common.js';
import { target, setTarget, connected, backupAll, SUPPORTED } from '../lib/backup.js';

const GROUPS = [
  ['fx-type', 'Chữ và trang viết', ['font', 'fontSize', 'lineHeight', 'width', 'margin', 'paper']],
  ['fx-focus', 'Hỗ trợ khi viết', ['dim', 'typewriter', 'spellcheck', 'longSentence', 'autoSnapshot']],
  ['music', 'Âm thanh', ['keySound', 'keyVolume']],
  ['fx-stats', 'Mục tiêu', ['dailyGoal']],
  ['book', 'Xuất bản sang Sách', ['penName']],
];

// Nơi lưu bản sao: Dropbox hoặc OneDrive, một thư mục đã chọn. Bản sao chỉ ghi thêm và ghi đè, không xoá.
function backupBox() {
  const t = target();
  const opts = [['', 'Tắt'], ...Object.entries(SUPPORTED).map(([k, v]) => [k, v + (connected(k) ? '' : ' (chưa kết nối)')])];
  return `<details class="panel prm-ns" open><summary>${icon('b-folder')}<b>Nơi lưu bản sao</b></summary>
    <div class="stack">
      <label>Lưu bản sao vào<select data-bk-mode>${opts.map(([k, l]) => `<option value="${k}" ${(t?.mode || '') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label>Thư mục<span class="row-actions"><input data-bk-path value="${esc(t?.path || '')}" placeholder="Xưởng Viết" aria-label="Thư mục đích"><button class="btn small" data-bk-pick type="button">Chọn…</button></span></label>
      <div class="row-actions"><button class="btn primary small" data-bk-now type="button">${icon('upload')}Sao lưu ngay</button><small class="muted" data-bk-status></small></div>
      <p class="hint">Mỗi truyện thành một thư mục con gồm work.json và một file .md cho từng chương. Bản sao tự cập nhật sau khi bạn ngừng gõ vài giây. Thư mục đích không bao giờ bị xoá. Lưu vào máy và Google Drive sẽ có sau.</p>
    </div></details>`;
}
function bindBackup(el) {
  const mode = el.querySelector('[data-bk-mode]'), path = el.querySelector('[data-bk-path]'), status = el.querySelector('[data-bk-status]');
  const save = () => setTarget(mode.value, path.value);
  mode.onchange = () => { if (mode.value && !connected(mode.value)) { status.textContent = `${SUPPORTED[mode.value]} chưa kết nối. Kết nối trong Cài đặt → Lưu trữ rồi quay lại.`; } save(); };
  path.onchange = save;
  el.querySelector('[data-bk-pick]').onclick = () => pickFolder(mode.value, path);
  el.querySelector('[data-bk-now]').onclick = async () => {
    save();
    status.textContent = 'Đang sao lưu…';
    try { const r = await backupAll({ onProgress: (d, n) => { status.textContent = `Đang sao lưu ${d}/${n} truyện…`; } }); status.textContent = `Đã sao lưu ${r?.works ?? 0} truyện.`; }
    catch (e) { status.textContent = e.message; }
  };
}
async function pickFolder(mode, input) {
  if (!mode || !connected(mode)) return toast('Chọn Dropbox hoặc OneDrive đã kết nối trước', 'warn');
  let cur = (input.value || '').replace(/^\/+|\/+$/g, '');
  const box = h(`<div class="stack"><p class="muted" data-where></p><ul class="fx-mini" data-list></ul>
    <div class="row-actions"><button class="btn" data-up type="button">Lên</button><span class="sp"></span><button class="btn primary" data-use type="button">Chọn thư mục này</button></div></div>`);
  const s = sheet('Chọn thư mục đích', box);
  const load = async () => {
    box.querySelector('[data-where]').textContent = '/' + cur;
    const list = box.querySelector('[data-list]'); list.innerHTML = '<li class="muted">Đang mở…</li>';
    try {
      const items = (await drives[mode].listDir(cur)).filter(e => e.isDir);
      list.innerHTML = items.map((e, i) => `<li><button class="btn small" data-d="${i}" type="button">${icon('b-folder')}${esc(e.name)}</button></li>`).join('') || '<li class="muted">Không có thư mục con.</li>';
      list.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { cur = items[+b.dataset.d].path; load(); });
    } catch (e) { list.innerHTML = `<li class="muted">${esc(e.message)}</li>`; }
  };
  box.querySelector('[data-up]').onclick = () => { cur = cur.split('/').slice(0, -1).join('/'); load(); };
  box.querySelector('[data-use]').onclick = () => { input.value = cur; input.dispatchEvent(new Event('change')); s.close(); };
  load();
}

export async function render(el) {
  el.innerHTML = `<div class="fx-settings stack">
    <h2 class="section-title">${icon('settings')}Cài đặt Xưởng Viết</h2>
    ${GROUPS.map(([ic, title, keys]) => `<details class="panel prm-ns" open><summary>${icon(ic)}<b>${esc(title)}</b></summary>${namespaceHtml('fanfic', keys)}</details>`).join('')}
    <details class="panel prm-ns" open><summary>${icon('b-folder')}<b>Tệp và dữ liệu</b></summary>
      <div class="row-actions" style="flex-wrap:wrap">
        <a class="btn" href="#fanfic/tools">${icon('upload')}Thêm, nhập và xuất</a>
        <a class="btn" href="#settings/storage">${icon('refresh')}Đồng bộ</a>
      </div>
      <p class="hint">Truyện, chương, ghi chú, phiên bản và thống kê viết được đồng bộ theo chế độ lưu trữ bạn chọn.</p>
    </details>
  </div>`;
  el.querySelector('.fx-settings').insertAdjacentHTML('afterbegin', backupBox());
  bindBackup(el);
  const off = bindParams(el, toast);
  return off;
}
