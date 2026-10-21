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

  const FOLDER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b6b70" stroke-width="1.8" aria-hidden="true" style="flex:none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const chip = (on, txt) => `<span style="font-size:12px;font-weight:600;padding:5px 10px;border-radius:999px;background:${on ? '#e3f1f2' : '#eceff1'};color:${on ? '#0f5f66' : '#34464b'}">${txt}</span>`;

  const draw = async () => {
    el.innerHTML = '<p class="hint">Đang mở thư mục…</p>';
    let items;
    try { items = (await d.listDir(cur)).filter(e => e.isDir); }
    catch (e) {
      if (e?.code === 'missing' && cur) { cur = cur.split('/').slice(0, -1).join('/'); toast?.('Thư mục không còn trên ' + d.label, 'warn'); return draw(); }
      el.innerHTML = `<p class="hint">Không mở được thư mục: ${esc(e.message)}</p>`;
      return;
    }
    const rows = items.map(e => ({ path: e.path, name: e.name }));
    const allOn = rows.length && rows.every(r => chosen.has(r.path));
    const rowHtml = (r, first) => {
      const on = chosen.has(r.path);
      const mine = apps[r.path] || APPS.map(a => a[0]);
      return `<div style="display:flex;flex-direction:column;gap:8px;padding:10px 12px;${first ? '' : 'border-top:1px solid #e3e8ea;'}background:${on ? '#f3fafa' : '#fff'}">
        <label style="display:flex;flex-direction:row;align-items:center;gap:10px;min-height:44px;cursor:pointer">
          <input type="checkbox" data-pick="${esc(r.path)}" aria-label="Đồng bộ ${esc(r.name)}" ${on ? 'checked' : ''} style="width:20px;height:20px;accent-color:#0f7f88;flex:none">${FOLDER}
          <span style="flex:1;min-width:0;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</span>
          <button type="button" class="btn small" data-go="${esc(r.path)}" aria-label="Mở ${esc(r.name)}" style="flex:none">›</button>
        </label>
        ${on ? `<div style="display:flex;flex-wrap:wrap;gap:8px;padding-left:30px">${APPS.map(([k, l]) => `<label style="display:flex;flex-direction:row;align-items:center;gap:4px;min-height:34px;padding:0 10px;border-radius:999px;border:1px solid #cfd8dc;cursor:pointer;font-size:13px"><input type="checkbox" data-app="${esc(r.path)}" value="${k}" ${mine.includes(k) ? 'checked' : ''} style="width:16px;height:16px;accent-color:#0f7f88">${l}</label>`).join('')}</div>` : ''}
      </div>`;
    };
    const chosenHtml = [...chosen].filter(p => !rows.some(r => r.path === p)).map(p => rowHtml({ path: p, name: p }, false)).join('');
    el.innerHTML = `
      <div style="display:flex;flex-direction:row;align-items:center;gap:12px;background:#fff;border:1px solid #e3e8ea;border-radius:14px;padding:12px 14px;margin-bottom:10px">
        <span style="flex:1;min-width:0"><span style="display:block;font-size:15px;font-weight:600">${esc(d.label)}</span><span style="display:block;font-size:12px;color:#2e7d32">Đã kết nối · ${chosen.size ? 'đã chọn ' + chosen.size + ' thư mục' : 'chưa chọn thư mục nào'}</span></span>
      </div>
      <p class="hint" style="margin:0 0 10px">Tích chọn một hoặc nhiều thư mục trên ổ. Tệp bên trong được quét, nhập vào thư viện (Nhạc, Sách) và cập nhật mỗi lần đồng bộ. Mỗi thư mục chọn được app nhận tệp.</p>
      <div style="background:#fff;border:1px solid #e3e8ea;border-radius:14px;overflow:hidden">
        <div style="display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px;padding:10px 12px;font-size:13px;background:#f4f7f8">${crumbs()}<span style="flex-grow:1"></span>
          ${rows.length ? `<label style="display:flex;flex-direction:row;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-all ${allOn ? 'checked' : ''} style="width:18px;height:18px;accent-color:#0f7f88">Chọn tất cả</label>` : ''}</div>
        ${cur ? `<label style="display:flex;flex-direction:row;align-items:center;gap:10px;min-height:44px;padding:0 12px;border-top:1px solid #e3e8ea;cursor:pointer"><input type="checkbox" data-pick="${esc(cur)}" ${chosen.has(cur) ? 'checked' : ''} style="width:20px;height:20px;accent-color:#0f7f88;flex:none"><span>Đồng bộ cả thư mục này</span></label>` : ''}
        ${rows.length ? rows.map((r, i) => rowHtml(r, i === 0 && !cur)).join('') : `<p class="hint" style="margin:10px 12px">${cur ? 'Thư mục này không có thư mục con.' : 'Chưa có thư mục nào trong thư mục ứng dụng của ' + esc(d.label) + '. Thêm thư mục trên ' + esc(d.label) + ' (trong thư mục Apps của app), rồi mở lại đây.'}</p>`}
        ${chosenHtml ? `<div style="padding:8px 12px;font-size:12px;color:#5b6b70;border-top:1px solid #e3e8ea">Thư mục đã chọn ở nơi khác:</div>${chosenHtml}` : ''}
      </div>
      ${chosen.size ? `<label style="display:flex;flex-direction:row;align-items:center;gap:8px;min-height:44px;margin-top:8px"><input type="checkbox" data-auto ${auto ? 'checked' : ''} style="width:20px;height:20px;flex:none;accent-color:#0f7f88"><span>Tự xoá khỏi thư viện những tệp đã bị xoá trên ${esc(d.label)} (khi đồng bộ)</span></label>` : ''}`;
    el.querySelector('[data-all]')?.addEventListener('change', async (e) => {
      rows.forEach(r => e.target.checked ? chosen.add(r.path) : chosen.delete(r.path));
      await setFolders([...chosen]);
      toast?.(e.target.checked ? 'Đã chọn tất cả thư mục' : 'Đã bỏ chọn tất cả');
      draw();
    });
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
