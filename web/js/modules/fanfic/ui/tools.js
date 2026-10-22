// Thêm & nhập: new work, import files (TXT, Markdown, HTML from AO3), export everything, phase 2 list.
import { icon } from '../../../core/icons.js';
import * as store from '../lib/store.js';

export async function render(el, { ctx, go }) {
  const snap = await store.snapshot();
  el.innerHTML = `
    <div class="fx-tools">
      <button class="fx-tool" data-t="new">${icon('plus')}<b>Truyện mới</b><small>Bắt đầu viết từ trang trắng</small></button>
      <button class="fx-tool" data-t="import">${icon('upload')}<b>Nhập truyện của bạn</b><small>TXT, Markdown, HTML; tự tách chương</small></button>
      <button class="fx-tool" data-t="ao3">${icon('fx-research')}<b>Lưu truyện từ AO3</b><small>Tải bản HTML trên AO3 (Download → HTML) rồi chọn tệp: giữ fandom, tag, xếp hạng, chương</small></button>
      <button class="fx-tool" data-t="export" ${snap.list.length ? '' : 'disabled'}>${icon('download')}<b>Xuất tất cả (Markdown)</b><small>${snap.list.length} truyện, mỗi truyện một tệp</small></button>
    </div>
    <p class="hint">Có thể kéo thả tệp vào bất kỳ trang nào của Xưởng Viết. Xuất EPUB / PDF / HTML ở trang từng truyện. Nhập DOCX và EPUB sẽ có ở giai đoạn sau.</p>`;
  const io = () => import('../lib/io.js');
  el.querySelector('[data-t="new"]').onclick = async () => (await import('./edit.js')).editWork(null, { go });
  el.querySelector('[data-t="import"]').onclick = async () => { const m = await io(); m.importFiles(await m.pickFiles(), ctx, { origin: 'mine' }); };
  el.querySelector('[data-t="ao3"]').onclick = async () => { const m = await io(); m.importFiles(await m.pickFiles(), ctx, { origin: 'saved' }); };
  el.querySelector('[data-t="export"]').onclick = async () => (await io()).exportMany(snap.list.map(v => v.id), 'md');
}
