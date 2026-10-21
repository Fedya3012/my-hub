// The folder picker in Settings → Lưu trữ (drive modes that can list folders): a tree of the drive's folders.
// Sub-folders sit indented under their parent with an expand arrow and a guide line; tick folders to sync.
// Saved at once; "Đồng bộ ngay" then imports their music and books. A ticked folder covers everything below it.
import { drives } from './index.js';
import { folderList, setFolders, canPickFolders, folderApps, setFolderApps, APPS, MUSIC, autoRemove, setAutoRemove } from './folders.js';
import { esc, fmtBytes } from '../ui.js';
import { icon } from '../icons.js';
import { byId } from '../registry.js';
import { isBookFile } from '../../modules/books/lib/formats.js';

const FOLDER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b6b70" stroke-width="1.8" aria-hidden="true" style="flex:none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ARROW = (open) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34464b" stroke-width="2.2" aria-hidden="true" style="transition:transform .15s;transform:rotate(${open ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;
// Apps keep their own system name and icon.
const appName = (k) => byId(k)?.name || APPS.find(a => a[0] === k)?.[1] || k;
const appIcon = (k) => icon(byId(k)?.icon || 'note');
const fileKind = (name) => MUSIC.test(name) ? 'music' : isBookFile({ name }) ? 'books' : null;
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
      kids.set(p, { dirs: all.filter(e => e.isDir), files: all.filter(e => !e.isDir && fileKind(e.name)) });
    } catch (e) { kids.set(p, { error: e?.code === 'missing' ? 'Thư mục không còn trên ' + d.label : e.message }); }
  };

  // Per-folder numbers (size, files, music, books), counted by walking the folder in the background (2 at a time).
  const stats = new Map();
  const queue = [];
  let running = 0;
  const walk = async (p, acc) => {
    for (const e of await d.listDir(p)) {
      if (e.isDir) await walk(e.path, acc);
      else { acc.size += e.size || 0; acc.files++; const k = fileKind(e.name); if (k === 'music') acc.music++; else if (k === 'books') acc.books++; }
    }
    return acc;
  };
  const sumHtml = () => {
    const done = [...chosen].map(c => stats.get(c)).filter(t => t && t !== 'loading' && !t.error);
    if (!chosen.size) return 'Chưa chọn thư mục nào';
    const t = done.reduce((a, x) => ({ size: a.size + x.size, files: a.files + x.files }), { size: 0, files: 0 });
    return `Đã chọn ${chosen.size} thư mục` + (done.length === chosen.size ? ` · ${fmtBytes(t.size)} · ${t.files.toLocaleString('vi')} tệp` : ' · đang tính dung lượng…');
  };
  const showStat = (p) => { const m = el.querySelector('[data-sum]'); if (m) m.textContent = sumHtml(); const n = [...el.querySelectorAll('[data-stat]')].find(x => x.dataset.stat === p); if (n) n.innerHTML = statHtml(p); };
  const pump = () => {
    while (running < 2 && queue.length) {
      const p = queue.shift(); running++;
      walk(p, { size: 0, files: 0, music: 0, books: 0 }).then(r => stats.set(p, r), () => stats.set(p, { error: 1 })).finally(() => { running--; showStat(p); pump(); });
    }
  };
  const ensureStats = (p) => { if (stats.has(p)) return; stats.set(p, 'loading'); queue.push(p); pump(); };
  const statHtml = (p) => {
    const t = stats.get(p);
    if (!t || t === 'loading') return 'Đang tính…';
    if (t.error) return '';
    const parts = [t.files ? `${fmtBytes(t.size)} · ${t.files.toLocaleString('vi')} tệp` : 'Trống'];
    if (t.music || t.books) parts.push([t.music ? `${t.music.toLocaleString('vi')} nhạc` : '', t.books ? `${t.books.toLocaleString('vi')} sách` : ''].filter(Boolean).join(' · '));
    return esc(parts.join(' — '));
  };
  const covered = (p) => [...chosen].some(c => c !== p && under(p, c));
  const fileRow = (f) => { const k = fileKind(f.name); return `<div style="display:flex;flex-direction:row;align-items:center;gap:8px;min-height:34px;padding:0 8px 0 38px;font-size:13px;color:#34464b" title="${esc(appName(k))}"><span style="flex:none;display:flex;color:${k === 'music' ? '#0f7f88' : '#9a6a12'}">${appIcon(k).replace('class="ic "', 'class="ic" width="18" height="18"')}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>${f.size ? `<span style="flex:none;font-size:11px;color:#5b6b70">${esc(fmtBytes(f.size))}</span>` : ''}</div>`; };
  const rowHtml = (e, depth) => {
    const on = chosen.has(e.path), inherited = !on && covered(e.path), isOpen = open.has(e.path);
    const mine = apps[e.path] || APPS.map(a => a[0]);
    const node = kids.get(e.path);
    const sub = !isOpen ? '' : node === 'loading' || !node ? '<div class="hint" style="margin:4px 0 4px 0;padding-left:8px">Đang mở…</div>'
      : node.error ? `<div class="hint" style="padding-left:8px;color:#b3261e">${esc(node.error)}</div>`
      : node.dirs.map(c => rowHtml(c, depth + 1)).join('') + node.files.slice(0, 60).map(fileRow).join('') + (node.files.length > 60 ? `<div class="hint" style="padding:4px 8px">+ ${node.files.length - 60} tệp khác</div>` : '');
    return `<div>
      <div style="display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px;min-height:44px;padding:0 8px;background:${on ? '#eef7f7' : 'transparent'};border-radius:10px;opacity:${inherited ? .6 : 1}">
        <button type="button" data-open="${esc(e.path)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Thu gọn' : 'Mở'} ${esc(e.name)}" style="flex:none;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:0;background:none;cursor:pointer;padding:0">${ARROW(isOpen)}</button>
        <input type="checkbox" data-pick="${esc(e.path)}" aria-label="Đồng bộ ${esc(e.name)}" ${on || inherited ? 'checked' : ''} ${inherited ? 'disabled' : ''} style="width:20px;height:20px;accent-color:#0f7f88;flex:none">
        ${FOLDER}
        <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:15px;font-weight:${on ? 700 : 600};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name)}</span><span data-stat="${esc(e.path)}" style="font-size:12px;color:#5b6b70;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${statHtml(e.path)}</span></span>
        ${on ? `<span style="display:flex;flex-wrap:wrap;gap:6px;flex:1 0 100%;padding:0 0 8px 48px">${APPS.map(([k]) => `<label title="${esc(appName(k))}" style="display:flex;flex-direction:row;align-items:center;gap:5px;min-height:30px;padding:0 10px;white-space:nowrap;border-radius:999px;font-size:12px;cursor:pointer;background:#fff;border:1px solid #cfd8dc"><input type="checkbox" data-app="${esc(e.path)}" value="${k}" ${mine.includes(k) ? 'checked' : ''} style="width:14px;height:14px;accent-color:#0f7f88"><span style="display:flex;width:16px;height:16px">${appIcon(k)}</span>${esc(appName(k))}</label>`).join('')}</span>` : ''}
      </div>
      ${isOpen ? `<div style="margin-left:23px;padding-left:10px;border-left:1px solid #dde6e8">${sub}</div>` : ''}
    </div>`;
  };

  const draw = async () => {
    if (!kids.has('')) { el.innerHTML = '<p class="hint">Đang mở thư mục…</p>'; await load(''); }
    const root = kids.get('');
    if (root.error) { el.innerHTML = `<p class="hint">Không mở được thư mục: ${esc(root.error)}</p>`; kids.delete(''); return; }
    el.innerHTML = `
      <p class="hint" style="margin:0 0 8px"><span data-sum>${sumHtml()}</span> · tích thư mục cha là gồm cả thư mục con</p>
      <div style="background:#fff;border:1px solid #e3e8ea;border-radius:14px;overflow:hidden">
        <div style="display:flex;flex-direction:row;align-items:center;gap:8px;padding:10px 14px;font-size:13px;color:#34464b;background:#f4f7f8"><strong>${esc(d.label)}</strong><span style="flex:1"></span>${root.dirs.length ? `<label style="display:flex;flex-direction:row;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-all ${root.dirs.every(c => chosen.has(c.path)) ? 'checked' : ''} style="width:18px;height:18px;accent-color:#0f7f88">Chọn tất cả</label>` : ''}</div>
        <div style="padding:6px">
        ${root.dirs.length ? root.dirs.map(c => rowHtml(c, 0)).join('') : `<p class="hint" style="margin:10px 12px">Chưa có thư mục nào trong thư mục ứng dụng của ${esc(d.label)}. Thêm thư mục trên ${esc(d.label)} (trong thư mục Apps của app), rồi mở lại đây.</p>`}
        </div>
      </div>
      ${chosen.size ? `<label style="display:flex;flex-direction:row;align-items:center;gap:8px;min-height:44px;margin-top:8px"><input type="checkbox" data-auto ${auto ? 'checked' : ''} style="width:20px;height:20px;flex:none;accent-color:#0f7f88"><span>Tự xoá khỏi thư viện những tệp đã bị xoá trên ${esc(d.label)} (khi đồng bộ)</span></label>` : ''}`;
    el.querySelectorAll('[data-stat]').forEach(n => ensureStats(n.dataset.stat));
    chosen.forEach(ensureStats);
    el.querySelector('[data-all]')?.addEventListener('change', async (e) => {
      for (const c of root.dirs) { if (e.target.checked) chosen.add(c.path); else chosen.delete(c.path); }
      if (e.target.checked) for (const x of [...chosen]) if (root.dirs.some(c => c.path !== x && under(x, c.path))) chosen.delete(x);
      await setFolders([...chosen]);
      toast?.(e.target.checked ? 'Đã chọn tất cả thư mục' : 'Đã bỏ chọn tất cả');
      draw();
    });
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
