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
    el.innerHTML = `
      <div class="row-actions" style="flex-wrap:wrap;gap:6px;align-items:center">${crumbs()}</div>
      <label class="row-actions" style="min-height:44px;align-items:center;gap:10px">
        <input type="checkbox" data-pick="${esc(cur)}" ${cur && chosen.has(cur) ? 'checked' : ''} ${cur ? '' : 'disabled'}>
        <span>${cur ? 'Đồng bộ cả thư mục này' : 'Chọn thư mục trong ' + esc(d.label) + ' (bấm vào tên để mở)'}</span></label>
      <ul class="acct-choices" style="list-style:none;padding:0;margin:0">
        ${items.length ? items.map(e => `
          <li style="display:flex;align-items:center;gap:8px;min-height:44px;border-top:1px solid var(--line,#e3e8ea)">
            <input type="checkbox" data-pick="${esc(e.path)}" aria-label="Đồng bộ ${esc(e.name)}" ${chosen.has(e.path) ? 'checked' : ''}>
            <button type="button" class="btn small" data-go="${esc(e.path)}" style="flex:1;justify-content:flex-start">${esc(e.name)}</button>
          </li>`).join('') : '<li class="hint">Không có thư mục con.</li>'}
      </ul>
      ${chosen.size ? `<p class="hint">Đang đồng bộ: ${[...chosen].map(esc).join(', ')}</p>` : '<p class="hint">Chưa chọn thư mục nào.</p>'}`;
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
