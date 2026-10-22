// "Thêm & nhập": add files / folders / linked folders / paper books, import Goodreads / StoryGraph /
// CSV / JSON, export (JSON, CSV, Goodreads CSV), bulk online metadata, organise file names by metadata.
import { db } from '../../../core/db.js';
import { icon } from '../../../core/icons.js';
import { esc, toast, saveJson, pickJson } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { BOOK_EXT, FORMATS } from '../lib/formats.js';
import { download, sheet } from './common.js';

export async function render(el, { ctx, snap }) {
  const imp = await import('./importer.js');
  const missing = snap.all.list.filter(b => !b.book.isbn || !(b.cover || b.book.coverUrl) || !b.book.description);
  el.innerHTML = `
  <a class="panel bk-tools-set" href="#books/settings" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;margin-bottom:12px">${icon('settings')}<span style="flex:1"><b>Cài đặt Sách</b><br><small class="muted">Chữ, nền trang, độ sáng, độ ấm, đọc to, nguồn Thịnh hành</small></span><span aria-hidden="true">›</span></a>
  <div class="bk-tools-grid">
    <section class="bk-panel"><h2 class="section-title">${icon('upload')}Thêm sách</h2>
      <p class="muted">Đọc được: ${BOOK_EXT.filter(e => FORMATS[e].engine).map(e => FORMATS[e].label).filter((v, i, a) => a.indexOf(v) === i).join(', ')}. Nhập và theo dõi được (đọc ở giai đoạn 2): CBR, CB7, DjVu, DOCX. Kéo thả tệp/thư mục vào trang Sách cũng được.</p>
      <div class="row-actions wrap">
        <button class="btn primary" data-a="files">${icon('upload')}Chọn tệp</button>
        <button class="btn" data-a="folder">${icon('b-folder')}Chọn thư mục (quét cả thư mục con)</button>
        ${imp.canLinkFolder() ? `<button class="btn" data-a="link">${icon('link')}Liên kết thư mục (không sao chép)</button>` : ''}
        <button class="btn" data-a="paper">${icon('b-scan')}Sách giấy / ISBN / mã vạch</button>
      </div></section>
    <section class="bk-panel"><h2 class="section-title">${icon('download')}Nhập danh sách</h2>
      <p class="muted">Goodreads: My Books → Import and export → Export Library. StoryGraph: Manage Account → Export StoryGraph Library. Hoặc CSV cùng cột với tệp xuất bên dưới. Sách trùng (ISBN hoặc tên + tác giả) được cập nhật, không tạo bản sao.</p>
      <div class="row-actions wrap"><button class="btn" data-a="csv">${icon('upload')}Nhập CSV (Goodreads / StoryGraph / CSV)</button><button class="btn" data-a="json-in">${icon('upload')}Nhập JSON của Sách</button></div></section>
    <section class="bk-panel"><h2 class="section-title">${icon('upload')}Xuất & sao lưu</h2>
      <div class="row-actions wrap"><button class="btn" data-a="json">${icon('download')}JSON (đầy đủ: sách, ghi chú, phiên đọc, mục tiêu)</button>
        <button class="btn" data-a="csv-out">${icon('download')}CSV</button><button class="btn" data-a="gr-out">${icon('download')}CSV kiểu Goodreads</button></div>
      <p class="muted">Bản sao lưu toàn app (Cài đặt → Sao lưu) cũng chứa toàn bộ dữ liệu Sách.</p></section>
    <section class="bk-panel"><h2 class="section-title">${icon('b-globe')}Thông tin sách trên mạng</h2>
      <p class="muted">${missing.length} cuốn thiếu ISBN, bìa hoặc giới thiệu. Lấy từ Open Library và Google Books, chỉ điền ô còn trống.</p>
      <button class="btn" data-a="meta" ${missing.length ? '' : 'disabled'}>${icon('b-globe')}Lấy thông tin cho ${missing.length} cuốn</button></section>
    <section class="bk-panel"><h2 class="section-title">${icon('b-folder')}Sắp xếp tên tệp theo thông tin</h2>
      <p class="muted">Xem trước rồi đổi tên tệp thành “Tác giả/Bộ sách/Tập - Tên.đuôi” (dùng khi tải tệp về máy).</p>
      <button class="btn" data-a="organize">${icon('list')}Xem trước</button></section>
    <section class="bk-panel"><h2 class="section-title">${icon('refresh')}Dọn dữ liệu Sách</h2>
      <p class="muted">Xoá khỏi thư viện những sách đã mất tệp gốc (tệp trong máy hoặc thư mục đồng bộ đã bị xoá). Sách giấy và sách còn tệp không bị đụng tới.</p>
      <button class="btn" data-a="clean">${icon('refresh')}Dọn dữ liệu Sách</button></section>
    <section class="bk-panel"><h2 class="section-title">${icon('cloud')}Đồng bộ</h2>
      <p class="muted">Thông tin sách, trạng thái, đánh giá, nhận xét, đánh dấu, ghi chú, phiên đọc, mục tiêu và tiến độ đọc đồng bộ giữa các máy qua tài khoản đồng bộ (Cài đặt → Tài khoản đồng bộ: GitHub, Dropbox hoặc OneDrive). Tệp sách ở lại trên từng máy: thêm tệp trên máy kia, app tự ghép với sách đã có nếu cùng tên và dung lượng.</p>
      <p class="hint">Muốn có cả tệp sách trên mọi máy: chọn thư mục Dropbox hoặc OneDrive trong Cài đặt → Thư mục đồng bộ.</p></section>
  </div>`;
  el.querySelector('[data-a="clean"]')?.addEventListener('click', async () => (await import('../../../core/storage/cleanup.js')).cleanDataAction('books', 'Sách'));
  const on = (a, fn) => el.querySelector(`[data-a="${a}"]`)?.addEventListener('click', fn);
  on('files', async () => imp.importFiles(await imp.pickFiles()));
  on('folder', async () => imp.importFiles(await imp.pickFiles({ folder: true })));
  on('link', () => imp.linkFolder());
  on('paper', () => imp.addPaperBook(ctx));
  on('csv', () => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv,text/csv' });
    inp.onchange = async () => { const f = inp.files[0]; if (f) await imp.importCsvText(await f.text()); };
    inp.click();
  });
  on('json-in', async () => { const data = await pickJson('Nhập JSON của Sách'); if (!data) return; try { toast(`Đã nhập ${await imp.importJson(data)} dòng`); } catch (e) { toast(e.message, 'error'); } });
  on('json', async () => saveJson(`sach-${new Date().toISOString().slice(0, 10)}.json`, await imp.exportJson()));
  on('csv-out', async () => { const { exportCsv } = await import('../lib/csv.js'); download('sach.csv', exportCsv(snap.all.list, (id) => snap.all.shelves.find(s => s.id === id)?.name || id), 'text/csv'); });
  on('gr-out', async () => { const { exportGoodreads } = await import('../lib/csv.js'); download('goodreads_library_export.csv', exportGoodreads(snap.all.list), 'text/csv'); });
  on('meta', () => imp.fetchMetadata(missing.map(b => b.id), { onlyEmpty: true }));
  on('organize', () => organize(snap));
}

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
function organize(snap) {
  const rows = snap.all.list.filter(b => b.main).map(b => {
    const ext = b.main.name.match(/\.(fb2\.zip|[^.]+)$/i)?.[0] || '';
    const name = [safe(b.authors[0] || 'Không rõ tác giả'), b.series ? safe(b.series) : null, `${b.seriesIndex != null ? String(b.seriesIndex).padStart(2, '0') + ' - ' : ''}${safe(b.title)}${ext}`].filter(Boolean).join('/');
    return { b, from: b.main.name, to: name };
  }).filter(r => r.from !== r.to);
  const s = sheet('Sắp xếp tên tệp', `<p class="muted">${rows.length} tệp sẽ đổi tên.</p><table class="bk-help">${rows.slice(0, 300).map(r => `<tr><td>${esc(r.from)}</td><td>→ ${esc(r.to)}</td></tr>`).join('')}</table>
    <div class="row-actions"><button class="btn primary" data-go ${rows.length ? '' : 'disabled'}>${icon('check')}Đổi tên</button></div>`, { wide: true });
  s.el.querySelector('[data-go]').onclick = async () => {
    for (const r of rows) await db.files.update(r.b.main.id, { name: r.to.split('/').pop(), path: r.to });
    s.close(); store.changed(); toast(`Đã đổi tên ${rows.length} tệp`);
  };
}
