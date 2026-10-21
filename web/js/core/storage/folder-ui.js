// The folder picker in Settings → Lưu trữ (drive modes that can list folders): browse the drive, tick the
// folders to sync. Saved at once; "Đồng bộ ngay" then imports their music and books.
import { drives } from './index.js';
import { folderList, setFolders, canPickFolders } from './folders.js';
import { esc } from '../ui.js';

export async function folderPicker(el, mode, toast) {
  if (!canPickFolders(mode)) { el.innerHTML = ''; return; }
  const d = drives[mode];
  let cur = '';
  let chosen = new Set(await folderList());

  const crumbs = () => {
    const parts = cur.split('/').filter(Boolean);
    const out = [`<button type="button" class="btn small" data-go="">${esc(d.label)}</button>`];
    parts.forEach((p, i) => out.push(`<button type="button" class="btn small" data-go="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</button>`));
    return out.join(' / ');
  };

  const draw = async () => {
    el.innerHTML = '<p class="hint">Đang mở thư mục…</p>';
    let items;
    try { items = (await d.listDir(cur)).filter(e => e.isDir); }
    catch (e) {
      el.innerHTML = `<p class="hint">Không mở được thư mục: ${esc(e.message)}</p>`;
      return;
    }
    const row = 'display:flex;align-items:center;gap:10px;min-height:44px;padding:0 4px;border-top:1px solid #e3e8ea';
    el.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">${crumbs()}</div>
      ${cur ? `<label style="${row}"><input type="checkbox" data-pick="${esc(cur)}" ${chosen.has(cur) ? 'checked' : ''} style="width:20px;height:20px;flex:none"><span>Đồng bộ cả thư mục này</span></label>` : ''}
      ${items.length ? items.map(e => `
        <div style="${row}">
          <input type="checkbox" data-pick="${esc(e.path)}" aria-label="Đồng bộ ${esc(e.name)}" ${chosen.has(e.path) ? 'checked' : ''} style="width:20px;height:20px;flex:none">
          <button type="button" class="btn small" data-go="${esc(e.path)}" style="flex:1;min-width:0;justify-content:flex-start;text-align:left">${esc(e.name)}</button>
        </div>`).join('') : `<p class="hint" style="margin:8px 0">${cur ? 'Thư mục này không có thư mục con.' : 'Chưa có thư mục nào trong thư mục ứng dụng của ' + esc(d.label) + '. Thêm thư mục trên ' + esc(d.label) + ' (trong thư mục Apps của app), rồi mở lại đây.'}</p>`}
      ${chosen.size ? `<p class="hint" style="margin-top:8px">Đang đồng bộ: ${[...chosen].map(esc).join(', ')}</p>` : '<p class="hint" style="margin-top:8px">Chưa chọn thư mục nào.</p>'}`;
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { cur = b.dataset.go; draw(); });
    el.querySelectorAll('[data-pick]').forEach(c => c.onchange = async () => {
      const p = c.dataset.pick;
      if (c.checked) chosen.add(p); else chosen.delete(p);
      await setFolders([...chosen]);
      toast?.(c.checked ? 'Đã thêm thư mục đồng bộ' : 'Đã bỏ thư mục khỏi đồng bộ');
      draw();
    });
  };
  await draw();
}
