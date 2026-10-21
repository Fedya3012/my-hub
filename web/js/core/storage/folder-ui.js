// The folder picker in Settings → Lưu trữ (drive modes that can list folders): browse the drive, tick the
// folders to sync. Saved at once; "Đồng bộ ngay" then imports their music and books.
import { drives } from './index.js';
import { folderList, setFolders, canPickFolders, folderApps, setFolderApps, APPS, autoRemove, setAutoRemove } from './folders.js';
import { esc } from '../ui.js';

export async function folderPicker(el, mode, toast) {
  if (!canPickFolders(mode)) { el.innerHTML = ''; return; }
  const d = drives[mode];
  let cur = '';
  let chosen = new Set(await folderList());
  let apps = await folderApps();
  let auto = await autoRemove();

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
      ${chosen.size ? `<p class="hint" style="margin:12px 0 4px">Thư mục đang đồng bộ và app nhận tệp:</p>
        ${[...chosen].map(p => `<div style="${row}">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p)}">${esc(p)}</span>
          <span style="display:flex;gap:6px;flex:none">${APPS.map(([k, l]) => `<label style="display:flex;flex-direction:row;align-items:center;gap:4px;min-height:36px;padding:0 10px;border-radius:999px;border:1px solid #cfd8dc;cursor:pointer"><input type="checkbox" data-app="${esc(p)}" value="${k}" ${(apps[p] || APPS.map(a => a[0])).includes(k) ? 'checked' : ''} style="width:16px;height:16px">${l}</label>`).join('')}</span>
        </div>`).join('')}
        <label style="display:flex;flex-direction:row;align-items:center;gap:8px;min-height:44px;margin-top:6px"><input type="checkbox" data-auto ${auto ? 'checked' : ''} style="width:20px;height:20px;flex:none"><span>Tự xoá khỏi thư viện những tệp đã bị xoá trên ${esc(d.label)} (khi đồng bộ)</span></label>` : '<p class="hint" style="margin-top:8px">Chưa chọn thư mục nào.</p>'}`;
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { cur = b.dataset.go; draw(); });
    el.querySelector('[data-auto]')?.addEventListener('change', async (e) => { auto = e.target.checked; await setAutoRemove(auto); toast?.(auto ? 'Đã bật tự xoá tệp đã mất' : 'Đã tắt tự xoá tệp đã mất'); });
    el.querySelectorAll('[data-app]').forEach(cb => cb.onchange = async () => {
      const path = cb.dataset.app;
      const list = [...el.querySelectorAll('[data-app]')].filter(x => x.dataset.app === path && x.checked).map(x => x.value);
      if (!list.length) { cb.checked = true; toast?.('Chọn ít nhất một app cho thư mục này', 'warn'); return; }
      await setFolderApps(path, list);
      apps = await folderApps();
      toast?.('Đã đổi app nhận tệp của thư mục');
    });
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
