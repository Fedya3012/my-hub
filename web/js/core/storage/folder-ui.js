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
      : node.dirs.map(c => rowHtml(c, depth + 1)).join('');
    return `<div>
      <div style="display:flex;flex-direction:row;align-items:center;gap:6px;min-height:44px;padding:0 8px;background:${on ? '#eef7f7' : 'transparent'};border-radius:10px;opacity:${inherited ? .6 : 1}">
        <button type="button" data-open="${esc(e.path)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Thu gọn' : 'Mở'} ${esc(e.name)}" style="flex:none;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:0;background:none;cursor:pointer;padding:0">${ARROW(isOpen)}</button>
        <input type="checkbox" data-pick="${esc(e.path)}" aria-label="Đồng bộ ${esc(e.name)}" ${on || inherited ? 'checked' : ''} ${inherited ? 'disabled' : ''} style="width:20px;height:20px;accent-color:#0f7f88;flex:none">
        ${FOLDER}
        <span style="flex:1;min-width:0;font-size:15px;font-weight:${on ? 700 : 600};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name)}</span>
        ${on ? `<span style="display:flex;gap:4px;flex:none">${APPS.map(([k, l]) => `<label title="${l}" style="display:flex;flex-direction:row;align-items:center;gap:3px;min-height:28px;padding:0 8px;border-radius:999px;font-size:12px;cursor:pointer;background:#fff;border:1px solid #cfd8dc"><input type="checkbox" data-app="${esc(e.path)}" value="${k}" ${mine.includes(k) ? 'checked' : ''} style="width:14px;height:14px;accent-color:#0f7f88">${l}</label>`).join('')}</span>` : ''}
      </div>
      ${isOpen ? `<div style="margin-left:23px;padding-left:10px;border-left:1px solid #dde6e8">${sub}</div>` : ''}
    </div>`;
  };

  const draw = async () => {
    if (!kids.has('')) { el.innerHTML = '<p class="hint">Đang mở thư mục…</p>'; await load(''); }
    const root = kids.get('');
    if (root.error) { el.innerHTML = `<p class="hint">Không mở được thư mục: ${esc(root.error)}</p>`; kids.delete(''); return; }
    el.innerHTML = `
      <p class="hint" style="margin:0 0 8px">${chosen.size ? 'Đã chọn ' + chosen.size + ' thư mục' : 'Chưa chọn thư mục nào'} · tích thư mục cha là gồm cả thư mục con</p>
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
