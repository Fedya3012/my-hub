// Chosen folders on a folder-capable drive (Dropbox, OneDrive): the user ticks one or more folders on the drive
// and every music / book file inside them (any depth) is imported into the library. Files already imported are
// remembered by path + size (sync.folderDone), so a second sync only fetches what is new.
// The files are NOT copied into the app: they stay on the drive and are fetched only when played or opened.
import { drives, storage } from './index.js';
import { db, getSetting, setSetting } from '../db.js';
import { tasks } from '../tasks.js';

export const MUSIC = /\.(mp3|flac|m4a|m4b|mp4|aac|alac|ogg|oga|opus|wav|wave|aif|aiff|aifc|wv|ape|dsf|dff|wma)$/i;

export const folderList = async () => (await getSetting('sync.folders', [])) || [];
export async function setFolders(list) { await setSetting('sync.folders', [...new Set(list)]); }
// Which apps each chosen folder feeds: any of 'music' / 'books' (default: both). path → ['music', ...].
export const APPS = [['music', 'Trình phát nhạc'], ['books', 'Sách']];
const toApps = (v) => (!v ? APPS.map(a => a[0]) : Array.isArray(v) ? v : v === 'both' ? APPS.map(a => a[0]) : [v]);
export const folderApps = async () => {
  const raw = (await getSetting('sync.folderApps', {})) || {};
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, toApps(v)]));
};
export async function setFolderApps(path, list) {
  const map = (await getSetting('sync.folderApps', {})) || {};
  if (list.length >= APPS.length) delete map[path]; else map[path] = list;
  await setSetting('sync.folderApps', map);
}
const inFolder = (file, folder) => file === folder || file.startsWith(folder.replace(/\/$/, '') + '/');
export const canPickFolders = (mode) => typeof drives[mode]?.listDir === 'function';

async function walk(d, sub, out) {
  for (const e of await d.listDir(sub)) {
    if (e.isDir) await walk(d, e.path, out);
    else out.push(e);
  }
  return out;
}

export const autoRemove = async () => (await getSetting('sync.autoRemove', true)) !== false;
export const setAutoRemove = (on) => setSetting('sync.autoRemove', !!on);

// Library entries whose drive file was deleted: a file linked from a chosen folder that the full scan no longer lists.
// Skipped when auto-removal is off or the scan found nothing at all (a failed listing must never wipe the library).
async function pruneMissing(mode, folders, found, missing = []) {
  // A folder the drive reported as gone (404/409) is authoritative: its entries go even if nothing else was found.
  if ((!found.length && !missing.length) || !(await autoRemove())) return 0;
  const here = new Set(found.map(e => e.path.toLowerCase()));
  const rows = await db.files.filter(f => f.linked && f.locations?.[mode]?.key && folders.some(fo => inFolder(f.locations[mode].key.toLowerCase(), fo.toLowerCase()))).toArray();
  return removeLinked(mode, rows.filter(f => !here.has(f.locations[mode].key.toLowerCase())));
}

async function removeLinked(mode, gone) {
  if (!gone.length) return 0;
  const done = (await getSetting('sync.folderDone', {})) || {};
  for (const f of gone) delete done[f.locations[mode].key];
  await setSetting('sync.folderDone', done);
  return removeRows(gone);
}

// Deletes the library entries (music tracks / books) behind these file rows.
async function removeRows(gone) {
  const ids = { music: [], books: [] };
  for (const f of gone) {
    const item = await db.items.get(f.itemId);
    if (item && !item.deleted) (item.type === 'book' ? ids.books : ids.music).push(item.id);
    else await db.files.delete(f.id);
  }
  if (ids.music.length) await (await import('../../modules/music/lib/store.js')).deleteTracks(ids.music);
  if (ids.books.length) await (await import('../../modules/books/lib/store.js')).removeBooks(ids.books);
  return ids.music.length + ids.books.length;
}

// Linked files outside every chosen folder (the folder was unticked, or deleted and then dropped from the list):
// look each one up in its parent folder on the drive and remove those that are gone.
export async function pruneOrphans() {
  const mode = await storage.mode();
  const d = drives[mode];
  if (!d?.listDir || !d.connected() || !navigator.onLine) return 0;
  const folders = await folderList();
  const rows = await db.files.filter(f => f.linked && f.locations?.[mode]?.key && !folders.some(fo => inFolder(f.locations[mode].key.toLowerCase(), fo.toLowerCase()))).toArray();
  const cache = new Map();
  const names = async (dir) => {
    if (!cache.has(dir)) cache.set(dir, d.listDir(dir).then(l => new Set(l.map(e => e.path.toLowerCase())), e => e?.code === 'missing' ? new Set() : null));
    return cache.get(dir);
  };
  const gone = [];
  for (const f of rows) {
    const key = f.locations[mode].key;
    const set = await names(key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '');
    if (set && !set.has(key.toLowerCase())) gone.push(f);
  }
  return removeLinked(mode, gone);
}

// Pause / cancel. Paused: no folder sync runs until "Đồng bộ ngay" resumes it; what was imported stays and the
// next run only fetches the files not imported yet. Cancel: stops the run, then reverts it: every library entry
// imported from the chosen folders is deleted and the progress (sync.folderDone / sync.localDone) is reset.
// The folder selection itself is kept, paused, so nothing comes back until the user syncs again.
const active = new Set();
let current = null;
const track = (h) => { active.add(h); return h; };
const stopRunning = () => { for (const h of active) tasks.cancel(h.id); active.clear(); };
export const folderPaused = async () => !!(await getSetting('sync.folderPaused', false));
export const folderSyncRunning = () => !!current;
export async function pauseFolderSync() {
  await setSetting('sync.folderPaused', true);
  stopRunning();
  await current?.catch(() => {});
}
export const resumeFolderSync = () => setSetting('sync.folderPaused', false);
export async function cancelFolderSync() {
  await pauseFolderSync();
  return tasks.run({ label: 'Đang huỷ đồng bộ thư mục', detail: 'Xoá các mục đã nhập…' }, async () => {
    const mode = await storage.mode();
    let rows;
    if (mode === 'local') {
      const ids = new Set((await (await import('./local-folders.js')).localFolders()).map(f => f.id));
      rows = await db.files.filter(f => !!f.localFolder && ids.has(f.localFolder)).toArray();
      await setSetting('sync.localDone', {});
    } else {
      const folders = (await folderList()).map(f => f.toLowerCase());
      rows = await db.files.filter(f => f.linked && f.locations?.[mode]?.key && folders.some(fo => inFolder(f.locations[mode].key.toLowerCase(), fo))).toArray();
      await setSetting('sync.folderDone', {});
    }
    return { removed: await removeRows(rows) };
  });
}

// Imports the new music and book files of the chosen folders. → { added, failed, skipped? }
// Skipped ({ skipped: 'paused' }) while paused; pass resume: true (the "Đồng bộ ngay" button) to resume first.
export async function syncFolders(opts = {}) {
  if (opts.resume) await resumeFolderSync();
  else if (!opts.pruneOnly && (await folderPaused())) return { skipped: 'paused', added: 0, failed: [] };
  if (current) await current.catch(() => {});
  const p = runSync(opts);
  current = p;
  try { return await p; } finally { if (current === p) current = null; active.clear(); }
}

async function runSync({ pruneOnly = false } = {}) {
  const mode = await storage.mode();
  if (mode === 'local') return pruneOnly ? { added: 0, failed: [], removed: 0, missing: [] } : (await import('./local-folders.js')).scanLocal(track);
  const d = drives[mode];
  if (!d || !d.listDir) return { skipped: 'no-folders' };
  if (!d.connected() || !navigator.onLine) return { skipped: 'offline' };
  const folders = await folderList();
  if (!folders.length) return { skipped: 'none' };
  const appMap = await folderApps();
  const allows = (path, app) => folders.some(f => inFolder(path, f) && (appMap[f] || APPS.map(a => a[0])).includes(app));

  // Progress: folders scanned (one step per folder listed) and files found; then files imported (x / y, %).
  const scan = track(tasks.start({ label: 'Đang quét thư mục trên ' + d.label, unit: 'items', cancellable: true, delay: 300 }));
  const found = [];
  let dirs = 0;
  const count = (e) => { if (e.isDir) dirs++; };
  const visit = async (sub) => {
    scan.check();
    const list = await d.listDir(sub);
    for (const e of list) { count(e); if (e.isDir) await visit(e.path); else found.push(e); }
    scan.update({ detail: `${dirs} thư mục · ${found.length} tệp` });
  };
  const missing = [];
  try {
    // A chosen folder deleted or renamed on the drive is skipped (and reported), the others still sync.
    for (const f of folders) {
      try { await visit(f); } catch (e) { if (e?.code === 'missing') missing.push(f); else throw e; }
    }
  } catch (e) { scan.fail(e); throw e; }
  scan.finish(`Quét xong: ${dirs} thư mục, ${found.length} tệp`);

  const removed = await pruneMissing(mode, folders, found, missing);
  if (pruneOnly) return { added: 0, failed: [], removed, missing };

  const { isBookFile } = await import('../../modules/books/lib/formats.js');
  const done = (await getSetting('sync.folderDone', {})) || {};
  // A music file is imported only when a chosen folder above it feeds music; a book only when one feeds books.
  const todo = found.filter(e => ((MUSIC.test(e.name) && allows(e.path, 'music')) || (!MUSIC.test(e.name) && isBookFile({ name: e.name }) && allows(e.path, 'books'))) && done[e.path] !== e.size);
  if (!todo.length) return { added: 0, failed: [], removed, missing };

  const task = track(tasks.start({ label: `Đang nhập ${todo.length} tệp từ ${d.label}`, total: todo.length, unit: 'items', cancellable: true }));
  const music = await import('../../modules/music/lib/store.js');
  const books = await import('../../modules/books/ui/importer.js');
  const res = { added: 0, failed: [], removed, missing };
  for (let i = 0; i < todo.length; i++) {
    task.check();
    const e = todo[i];
    task.update({ done: i, detail: `${e.name} · ${Math.round(i / todo.length * 100)}%` });
    try {
      const blob = await d.getPath(e.path, { signal: task.signal });
      const file = new File([blob], e.name, { type: blob.type || '' });
      // Stays on the drive: nothing is copied to this device or uploaded (see storage.addFile remote).
      const remote = () => e.path;
      if (MUSIC.test(e.name)) await music.importFiles([file], { kind: 'music', remote });
      else await books.importFiles([file], { remote });
      done[e.path] = e.size;
      await setSetting('sync.folderDone', done);
      res.added++;
    } catch (err) {
      if (err?.name === 'AbortError') break;
      res.failed.push(`${e.name}: ${err.message}`);
    }
  }
  task.finish(`Đã nhập ${res.added}/${todo.length}`);
  return res;
}
