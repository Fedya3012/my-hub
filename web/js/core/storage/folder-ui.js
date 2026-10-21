// The folder picker in Settings → Lưu trữ (drive modes that can list folders): a tree of the drive's folders.
// Sub-folders sit indented under their parent with an expand arrow and a guide line; tick folders to sync.
// Saved at once; "Đồng bộ ngay" then imports their music and books. A ticked folder covers everything below it.
import { drives } from './index.js';
import { folderList, setFolders, canPickFolders, folderApps, setFolderApps, APPS, autoRemove, setAutoRemove } from './folders.js';
import { esc } from '../ui.js';

const FOLDER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b6b70" stroke-width="1.8" aria-hidden="true" style="flex:none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ARROW = (open) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34464b" stroke-width="2.2" aria-hidden="true" style="transition:transform .15s;transform:rotate(${open ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;
const under = (p, parent) => p.startsWith(parent.replace(/\/$/, '') + '/');

export async function folderPicker(el, mode, toast) {
  if (!canPickFolders(mode)) { el.innerHTML = ''; return; }
  const d = drives[mode];
  const chosen = new Set(await folderList());
  let apps = await folderApps();
  let auto = await autoRemove();
  const open = new Set();
  const kids = new Map(); // path → { dirs, files } | { error } | 'loading'

  const load = async (p) => {
    if (kids.has(p)) return;
    kids.set(p, 'loading');
    try {
      const all = await d.listDir(p);
      kids.set(p, { dirs: all.filter(e => e.isDir), files: all.filter(e => !e.isDir).length });
    } catch (e) { kids.set(p, { error: e?.code === 'missing' ? 'Thư mục không còn trên ' + d.label : e.message }); }
  };

  const covered = (p) => [...chosen].some(c => c !== p && under(p, c));
  const rowHtml = (e, depth) => {
    const on = chosen.has(e.path), inherited = !on && covered(e.path), isOpen = open.has(e.path);
    const mine = apps[e.path] || APPS.map(a => a[0]);
    const node = kids.get(e.path);
    const sub = !isOpen ? '' : node === 'loading' || !node ? '<div class="hint" style="margin:4px 0 4px 0;padding-left:8px">Đang mở…</div>'
      : node.error ? `<div class="hint" style="padding-left:8px;color:#b3261e">${esc(node.error)}</div>`
      : `${node.dirs.map(c => rowHtml(c, depth + 1)).join('')}${!node.dirs.length ? `<div class="hint" style="padding:4px 8px">Không có thư mục con${node.files ? ` · ${node.files} tệp` : ''}</div>` : node.files ? `<div class="hint" style="padding:2px 8px">+ ${node.files} tệp ngay trong thư mục này</div>` : ''}`;
    return `<div>
      <div style="display:flex;flex-direction:row;align-items:center;gap:6px;min-height:44px;padding:0 8px;background:${on ? '#e8f5f5' : inherited ? '#f3fafa' : '#fff'};border-radius:10px">
        <button type="button" data-open="${esc(e.path)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Thu gọn' : 'Mở'} ${esc(e.name)}" style="flex:none;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:0;background:none;cursor:pointer;padding:0">${ARROW(isOpen)}</button>
        <input type="checkbox" data-pick="${esc(e.path)}" aria-label="Đồng bộ ${esc(e.name)}" ${on || inherited ? 'checked' : ''} ${inherited ? 'disabled' : ''} style="width:20px;height:20px;accent-color:#0f7f88;flex:none">
        ${FOLDER}
        <span style="flex:1;min-width:0;font-size:15px;font-weight:${on ? 700 : 600};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name)}</span>
        ${inherited ? '<span style="font-size:11px;color:#5b6b70;flex:none">gồm trong thư mục cha</span>' : ''}
      </div>
      ${on ? `<div style="display:flex;flex-wrap:wrap;gap:8px;padding:2px 8px 8px 72px">${APPS.map(([k, l]) => `<label style="display:flex;flex-direction:row;align-items:center;gap:4px;min-height:34px;padding:0 10px;border-radius:999px;border:1px solid #cfd8dc;cursor:pointer;font-size:13px;background:#fff"><input type="checkbox" data-app="${esc(e.path)}" value="${k}" ${mine.includes(k) ? 'checked' : ''} style="width:16px;height:16px;accent-color:#0f7f88">${l}</label>`).join('')}</div>` : ''}
      ${isOpen ? `<div style="margin-left:23px;padding-left:10px;border-left:2px solid #cfe3e5">${sub}</div>` : ''}
    </div>`;
  };

  const draw = async () => {
    if (!kids.has('')) { el.innerHTML = '<p class="hint">Đang mở thư mục…</p>'; await load(''); }
    const root = kids.get('');
    if (root.error) { el.innerHTML = `<p class="hint">Không mở được thư mục: ${esc(root.error)}</p>`; kids.delete(''); return; }
    el.innerHTML = `
      <div style="background:#fff;border:1px solid #e3e8ea;border-radius:14px;padding:12px 14px;margin-bottom:10px">
        <span style="display:block;font-size:15px;font-weight:600">${esc(d.label)}</span>
        <span style="display:block;font-size:12px;color:#2e7d32">Đã kết nối · ${chosen.size ? 'đã chọn ' + chosen.size + ' thư mục' : 'chưa chọn thư mục nào'}</span>
      </div>
      <p class="hint" style="margin:0 0 10px">Bấm mũi tên để mở thư mục con. Tích một thư mục là đồng bộ cả các thư mục con bên trong. Mỗi thư mục chọn được app nhận tệp.</p>
      <div style="background:#fff;border:1px solid #e3e8ea;border-radius:14px;padding:6px">
        ${root.dirs.length ? root.dirs.map(c => rowHtml(c, 0)).join('') : `<p class="hint" style="margin:10px 12px">Chưa có thư mục nào trong thư mục ứng dụng của ${esc(d.label)}. Thêm thư mục trên ${esc(d.label)} (trong thư mục Apps của app), rồi mở lại đây.</p>`}
      </div>
      ${chosen.size ? `<label style="display:flex;flex-direction:row;align-items:center;gap:8px;min-height:44px;margin-top:8px"><input type="checkbox" data-auto ${auto ? 'checked' : ''} style="width:20px;height:20px;flex:none;accent-color:#0f7f88"><span>Tự xoá khỏi thư viện những tệp đã bị xoá trên ${esc(d.label)} (khi đồng bộ)</span></label>` : ''}`;
    el.querySelector('[data-auto]')?.addEventListener('change', async (e) => { auto = e.target.checked; await setAutoRemove(auto); toast?.(auto ? 'Đã bật tự xoá tệp đã mất' : 'Đã tắt tự xoá tệp đã mất'); });
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => {
      const p = b.dataset.open;
      if (open.has(p)) open.delete(p); else { open.add(p); }
      draw();
      if (open.has(p) && !kids.has(p)) { await load(p); draw(); }
    });
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
      if (c.checked) { chosen.add(p); for (const x of [...chosen]) if (x !== p && under(x, p)) chosen.delete(x); } else chosen.delete(p);
      await setFolders([...chosen]);
      toast?.(c.checked ? 'Đã thêm thư mục đồng bộ' : 'Đã bỏ thư mục khỏi đồng bộ');
      draw();
    });
  };
  await draw();
}
