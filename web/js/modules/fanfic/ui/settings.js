// Xưởng Viết → Cài đặt: the app's own settings in one place (page look, writing aids, sounds, goals, publishing),
// plus file / data shortcuts. Same params as Cài đặt → Xưởng Viết, so both stay in sync.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { namespaceHtml, bindParams } from '../../../core/params-ui.js';

const GROUPS = [
  ['fx-type', 'Chữ và trang viết', ['font', 'fontSize', 'lineHeight', 'width', 'margin', 'paper']],
  ['fx-focus', 'Hỗ trợ khi viết', ['dim', 'typewriter', 'spellcheck', 'longSentence', 'autoSnapshot']],
  ['music', 'Âm thanh', ['keySound', 'keyVolume']],
  ['fx-stats', 'Mục tiêu', ['dailyGoal']],
  ['book', 'Xuất bản sang Sách', ['penName']],
];

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
  const off = bindParams(el, toast);
  return off;
}
