// "Chỉ trên máy này": the user picks folders on this device and the app reads only those.
// Windows / desktop browsers keep a folder handle (nothing is copied: music and books stay where they are).
// Android has no handles, so the native FolderPicker keeps read access to the chosen tree (SAF) and each new file
// is copied into the app once, because the WebView cannot stream content:// addresses.
import { db, getSetting, setSetting } from '../db.js';
import { tasks } from '../tasks.js';
import { MUSIC, APPS, autoRemove, removeRows } from './folders.js';
import { storage } from './index.js';
import { esc } from '../ui.js';

const KEY = 'sync.localFolders', DONE = 'sync.localDone';
export const nativeRoot = () => (window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.FolderPicker?.pickRoot ? window.Capacitor.Plugins.FolderPicker : null);
export const canPickLocal = () => !!(window.showDirectoryPicker || nativeRoot());
export const localFolders = async () => (await getSetting(KEY, [])) || [];
const save = (list) => setSetting(KEY, list);
const uid = () => 'lf' + Math.random().toString(36).slice(2, 10);

export async function addLocalFolder() {
  const list = await localFolders();
  const P = nativeRoot();
  if (P) {
    const r = await P.pickRoot();
    if (!r || r.cancelled) return null;
    if (list.some(f => f.treeUri === r.treeUri)) return null;
    const name = decodeURIComponent(r.treeUri.split('%3A').pop() || r.treeUri).split('/').pop() || 'Thư mục';
    const rec = { id: uid(), name, kind: 'saf', treeUri: r.treeUri, apps: APPS.map(a => a[0]) };
    await save([...list, rec]);
    return rec;
  }
  const handle = await window.showDirectoryPicker({ mode: 'read' });
  for (const f of list) { const h = (await db.handles.get('lf:' + f.id))?.handle; if (h && (await h.isSameEntry(handle))) return null; }
  const rec = { id: uid(), name: handle.name, kind: 'handle', apps: APPS.map(a => a[0]) };
  await db.handles.put({ id: 'lf:' + rec.id, handle });
  await save([...list, rec]);
  return rec;
}

export async function removeLocalFolder(id) {
  const list = await localFolders();
  const rec = list.find(f => f.id === id);
  if (!rec) return;
  if (rec.kind === 'saf') await nativeRoot()?.releaseRoot?.({ treeUri: rec.treeUri }).catch(() => {});
  else await db.handles.delete('lf:' + id);
  const done = (await getSetting(DONE, {})) || {};
  for (const k of Object.keys(done)) if (k.startsWith(id + '/')) delete done[k];
  await setSetting(DONE, done);
  await save(list.filter(f => f.id !== id));
}

export async function setLocalApps(id, apps) {
  await save((await localFolders()).map(f => (f.id === id ? { ...f, apps } : f)));
}

async function listHandle(dir, prefix, out) {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'directory') await listHandle(h, prefix + name + '/', out);
    else out.push({ handle: h, name, relPath: prefix + name });
  }
}

// Reads only the chosen folders. → { added, failed, skipped? }
export async function scanLocal(track = (h) => h) {
  const folders = await localFolders();
  if (!folders.length) return { skipped: 'none', added: 0, failed: [] };
  const { isBookFile } = await import('../../modules/books/lib/formats.js');
  const done = (await getSetting(DONE, {})) || {};
  const res = { added: 0, failed: [] };
  const scan = track(tasks.start({ label: 'Đang quét thư mục trên máy', unit: 'items', cancellable: true, delay: 300 }));
  const todo = [];
  const listed = [];   // [folder, entries] read in full: used to drop library files that left the folder
  try {
    for (const f of folders) {
      scan.check();
      let entries = [];
      if (f.kind === 'saf') {
        entries = ((await nativeRoot().listTree({ treeUri: f.treeUri })).files || []).map(e => ({ saf: e, name: e.name, size: e.size, relPath: e.relPath }));
      } else {
        const handle = (await db.handles.get('lf:' + f.id))?.handle;
        if (!handle) { res.failed.push(`${f.name}: mất liên kết thư mục, hãy thêm lại`); continue; }
        if ((await handle.queryPermission?.({ mode: 'read' })) !== 'granted' && (await handle.requestPermission?.({ mode: 'read' })) !== 'granted') { res.failed.push(`${f.name}: chưa cấp quyền đọc`); continue; }
        const raw = [];
        await listHandle(handle, f.name + '/', raw);
        entries = raw;
      }
      listed.push([f, entries]);
      for (const e of entries) {
        const music = MUSIC.test(e.name), book = !music && isBookFile({ name: e.name });
        if (!((music && f.apps.includes('music')) || (book && f.apps.includes('books')))) continue;
        const key = `${f.id}/${e.relPath}`;
        const size = e.size ?? (e.handle ? (await e.handle.getFile()).size : 0);
        if (done[key] === size) continue;
        todo.push({ ...e, key, size, music, f });
      }
      scan.update({ detail: `${f.name} · ${todo.length} tệp mới` });
    }
  } catch (e) { scan.fail(e); throw e; }
  scan.finish(`Quét xong: ${todo.length} tệp mới`);
  res.removed = await pruneLocal(listed, done).catch((e) => { console.warn('[local folders] prune', e); return 0; });
  if (!todo.length) return res;

  const task = track(tasks.start({ label: `Đang nhập ${todo.length} tệp từ máy`, total: todo.length, unit: 'items', cancellable: true }));
  const music = await import('../../modules/music/lib/store.js');
  const books = await import('../../modules/books/ui/importer.js');
  const P = nativeRoot();
  try {
  for (let i = 0; i < todo.length; i++) {
    task.check();
    const e = todo[i];
    task.update({ done: i, detail: `${e.name} · ${Math.round(i / todo.length * 100)}%` });
    try {
      if (e.saf) {
        const { path } = await P.copyToCache({ uri: e.saf.uri, name: e.name });
        const blob = await (await fetch(window.Capacitor.convertFileSrc('file://' + path))).blob();
        const file = Object.assign(new File([blob], e.name, { type: blob.type }), { relPath: e.relPath });
        await (e.music ? music.importFiles([file], { kind: 'music', localFolder: e.f.id }) : books.importFiles([file], { localFolder: e.f.id }));
        await P.clearCache();
      } else {
        const item = { handle: e.handle, name: e.name, size: e.size, relPath: e.relPath };
        await (e.music ? music.importFiles([item], { kind: 'music', localFolder: e.f.id }) : books.importFiles([item], { localFolder: e.f.id }));
      }
      done[e.key] = e.size;
      res.added++;
      if (res.added % 25 === 0) await setSetting(DONE, done);   // not after every file: the map keeps growing
    } catch (err) {
      if (err?.name === 'AbortError') break;
      res.failed.push(`${e.name}: ${err.message}`);
    }
  }
  } finally { await setSetting(DONE, done); }
  task.finish(`Đã nhập ${res.added}/${todo.length}`);
  return res;
}

// Files imported from a folder that the scan no longer finds there (renamed, moved or deleted on the device).
// A renamed / moved song or book comes back on the import that follows: it is recognised by its tags.
// Rows from before localKey existed are matched by file name. An empty listing never removes anything.
async function pruneLocal(listed, done) {
  if (!(await autoRemove())) return 0;
  const gone = [];
  for (const [f, entries] of listed) {
    if (!entries.length) continue;
    const keys = new Set(entries.map(e => `${f.id}/${e.relPath}`)), names = new Set(entries.map(e => e.name));
    for (const r of await db.files.filter(r => r.localFolder === f.id && r.role === 'main').toArray()) {
      if (r.localKey ? !keys.has(r.localKey) : !names.has(r.name)) gone.push(r);
    }
  }
  if (!gone.length) return 0;
  const goneIds = new Set(gone.map(r => r.id)), whole = [];
  for (const r of gone) {
    if (r.localKey) delete done[r.localKey];
    // The entry keeps another copy this device can open: only this file goes, the song / book stays.
    const others = (await db.files.where('itemId').equals(r.itemId).toArray()).filter(o => o.role === 'main' && !goneIds.has(o.id) && o.locations?.local);
    if (others.length) await storage.removeFile(r).catch(() => {}); else whole.push(r);
  }
  await setSetting(DONE, done);
  return removeRows(whole);
}

// Settings page body for the local mode: the chosen folders, which app each one feeds, add / remove.
export async function localFolderPicker(el, toast, onChange) {
  const draw = async () => {
    const list = await localFolders();
    const chip = (f, a) => `<label style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid #cdd7da;border-radius:999px;font-size:13px;cursor:pointer"><input type="checkbox" data-app="${f.id}|${a[0]}" ${f.apps.includes(a[0]) ? 'checked' : ''}>${esc(a[1])}</label>`;
    el.innerHTML = `${list.map(f => `<div style="background:#fff;border:1px solid #e3e8ea;border-radius:14px;padding:12px 14px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:10px"><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(f.name)}</b>
          <span style="font-size:12px;color:#5b6b70">${f.kind === 'saf' ? 'Sao chép vào app' : 'Đọc trực tiếp'}</span>
          <button type="button" class="btn small" data-del="${f.id}" aria-label="Bỏ thư mục ${esc(f.name)}">Bỏ</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${APPS.map(a => chip(f, a)).join('')}</div></div>`).join('') || '<p class="hint">Chưa chọn thư mục nào.</p>'}
      <button type="button" class="btn primary" data-add>${canPickLocal() ? 'Thêm thư mục trong máy…' : 'Thiết bị này không hỗ trợ chọn thư mục'}</button>`;
    el.querySelector('[data-add]').disabled = !canPickLocal();
    el.querySelector('[data-add]').onclick = async () => {
      try { const r = await addLocalFolder(); if (r) { toast?.(`Đã thêm ${r.name}`); await draw(); onChange?.(); } }
      catch (e) { if (e?.name !== 'AbortError') toast?.(e.message, 'error'); }
    };
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await removeLocalFolder(b.dataset.del); await draw(); onChange?.(); });
    el.querySelectorAll('[data-app]').forEach(c => c.onchange = async () => {
      const [id, app] = c.dataset.app.split('|');
      const f = (await localFolders()).find(x => x.id === id);
      const next = c.checked ? [...new Set([...f.apps, app])] : f.apps.filter(a => a !== app);
      if (!next.length) { c.checked = true; toast?.('Chọn ít nhất một app cho thư mục này', 'warn'); return; }
      await setLocalApps(id, next);
    });
  };
  await draw();
}
