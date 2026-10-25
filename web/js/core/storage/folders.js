// Chosen folders on a folder-capable drive (Dropbox, OneDrive): the user ticks one or more folders on the drive
// and every music / book file inside them (any depth) is imported into the library. Files already imported are
// remembered by path + size (sync.folderDone), so a second sync only fetches what is new.
// The files are NOT copied into the app: they stay on the drive and are fetched only when played or opened.
import { drives, storage, isDrive } from './index.js';
import { db, getSetting, setSetting } from '../db.js';
import { tasks } from '../tasks.js';

export const MUSIC = /\.(mp3|flac|m4a|m4b|mp4|aac|alac|ogg|oga|opus|wav|wave|aif|aiff|aifc|wv|ape|dsf|dff|wma)$/i;

// Where the chosen folders live, separate from the sync account (storage.mode): 'local' (this device) and / or one
// drive that can list folders. Both can be on at once, e.g. books from Dropbox and music from this device: each
// chosen folder says which app it feeds. Unset: follows the sync account when that is a drive, otherwise 'local'.
export async function folderSources() {
  const raw = await getSetting('sync.folderSources', null);
  if (Array.isArray(raw)) {
    const ok = [...new Set(raw)].filter(k => k === 'local' || canPickFolders(k));
    if (ok.length) return ok.filter((k, i) => k === 'local' || ok.findIndex(x => x !== 'local') === i);
  }
  const s = await getSetting('sync.folderSource', null);
  if (s === 'local' || (s && canPickFolders(s))) return [s];
  const m = await storage.mode();
  return [isDrive(m) && canPickFolders(m) ? m : 'local'];
}
// The drive among the sources (at most one), or null.
export const driveSource = async () => (await folderSources()).find(k => k !== 'local') || null;
// Leaving a drive drops its folder list (its paths belong to the old drive); imported entries stay.
export async function setFolderSources(list) {
  const next = [...new Set(list)].filter(k => k === 'local' || canPickFolders(k));
  const cur = await driveSource();
  if (cur && !next.includes(cur)) { await setSetting('sync.folders', []); await setSetting('sync.folderDone', {}); }
  await setSetting('sync.folderSources', next.length ? next : ['local']);
}

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
export function canPickFolders(mode) { return typeof drives[mode]?.listDir === 'function'; }

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
export async function removeRows(gone) {
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
  const mode = await driveSource();
  const d = mode && drives[mode];
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
    const sources = await folderSources();
    let rows = [];
    if (sources.includes('local')) {
      const ids = new Set((await (await import('./local-folders.js')).localFolders()).map(f => f.id));
      rows = await db.files.filter(f => !!f.localFolder && ids.has(f.localFolder)).toArray();
      await setSetting('sync.localDone', {});
    }
    const mode = sources.find(k => k !== 'local');
    if (mode) {
      const folders = (await folderList()).map(f => f.toLowerCase());
      rows = rows.concat(await db.files.filter(f => f.linked && f.locations?.[mode]?.key && folders.some(fo => inFolder(f.locations[mode].key.toLowerCase(), fo))).toArray());
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
  // Chained on the running sync: two callers waiting on it would otherwise both start a run.
  const p = (current || Promise.resolve()).catch(() => {}).then(async () => {
    const release = storage.holdSync();   // one sync after the whole import, not one per song
    try { return await runSync(opts); } finally { release(); }
  });
  current = p;
  try { return await p; } finally { if (current === p) current = null; active.clear(); }
}

// Runs every chosen source (this device and / or the drive) and adds up the results.
async function runSync({ pruneOnly = false } = {}) {
  const sources = await folderSources();
  const out = { added: 0, failed: [], removed: 0, missing: [] };
  const skipped = [];
  for (const mode of sources) {
    const r = mode === 'local'
      ? (pruneOnly ? { added: 0, failed: [], removed: 0, missing: [] } : await (await import('./local-folders.js')).scanLocal(track))
      : await runDrive(mode, { pruneOnly });
    if (r.skipped) skipped.push(r.skipped);
    out.added += r.added || 0; out.removed += r.removed || 0;
    out.failed.push(...(r.failed || [])); out.missing.push(...(r.missing || []));
  }
  // Nothing ran at all: say why (all sources skipped); otherwise the totals.
  if (skipped.length === sources.length) out.skipped = skipped[0];
  return out;
}

// A stand-in for a File that is still on the drive: the tag reader only asks for its size and slices of it, so
// reading a song's tags downloads a few hundred KB (read-ahead window) instead of the whole file.
const HEAD = 1024 * 1024, TAIL = 256 * 1024;   // most songs need only these two ends (tags and cover art at the start, footers at the end)
function remoteFile(name, size, range, relPath = '') {
  // Both ends are requested at once on first use; anything else is fetched when asked for.
  const parts = [{ from: 0, to: Math.min(size, HEAD) }, { from: Math.max(Math.min(size, HEAD), size - TAIL), to: size }].filter(w => w.to > w.from)
    .map(w => Object.assign(w, { buf: null }));
  const load = (w) => (w.buf ||= range(w.from, w.to).then(b => new Uint8Array(b), (e) => { w.buf = null; throw e; }));
  const bytes = async (a, b) => {
    let w = parts.find(x => a >= x.from && b <= x.to);
    if (!w) { w = { from: a, to: Math.min(size, Math.max(b, a + 384 * 1024)), buf: null }; parts.push(w); }
    if (a < HEAD && !parts[0].buf) parts.slice(0, 2).forEach(load);   // first read: head and tail in parallel
    const buf = await load(w);
    return buf.slice(a - w.from, b - w.from).buffer;
  };
  return { name, size, type: '', relPath, retry: () => remoteFile(name, size, range, relPath), slice: (a = 0, b = size) => ({ arrayBuffer: () => bytes(Math.max(0, a), Math.min(size, b)) }) };
}

// Albums without a cover whose songs sit next to a cover image on the drive get that image.
async function fillFolderCovers(mode, images, d, dirOf, sidecar) {
  if (!images.length) return;
  const imgByDir = new Map(images.map(e => [dirOf(e.path), e]));
  const rows = await db.files.filter(f => f.role === 'main' && f.linked && !!f.locations?.[mode]?.key && imgByDir.has(dirOf(f.locations[mode].key))).toArray();
  if (!rows.length) return;
  const music = await import('../../modules/music/lib/store.js');
  const tracks = await db.tracks.where('itemId').anyOf(rows.map(f => f.itemId)).toArray();
  const dirOfItem = new Map(rows.map(f => [f.itemId, dirOf(f.locations[mode].key)]));
  const done = new Set();
  for (const t of tracks) {
    if (t.deleted || done.has(t.albumId)) continue;
    const al = await db.albums.get(t.albumId);
    if (!al || al.coverFileId) { done.add(t.albumId); continue; }
    try { await music.setAlbumCover(t.albumId, await sidecar(imgByDir.get(dirOfItem.get(t.itemId)))); done.add(t.albumId); }
    catch { /* try again next sync */ }
  }
}

// Albums whose cover is a row synced from another device (bytes not on this device), or gone: songs already
// imported are skipped by the scan, so nothing else would fix them. Each such album gets this device's copy from
// one of its songs in the folder: the folder image, else the picture embedded in the song (read by range).
// Songs whose file could not be read when they were imported (no audio info at all: they show up under
// "Nghệ sĩ không rõ") are removed and imported again from the drive, this time with their tags.
async function redoUnread(mode, found, done) {
  const here = new Set(found.map(e => e.path));
  const bad = await db.tracks.filter(t => !t.deleted && !t.tech && !!t.fileId).toArray();
  if (!bad.length) return;
  const rows = new Map((await db.files.bulkGet(bad.map(t => t.fileId))).filter(Boolean).map(f => [f.itemId, f]));
  const redo = bad.filter(t => { const k = rows.get(t.itemId)?.locations?.[mode]?.key; return k && here.has(k); });
  if (!redo.length) return;
  for (const t of redo) delete done[rows.get(t.itemId).locations[mode].key];
  await (await import('../../modules/music/lib/store.js')).deleteTracks(redo.map(t => t.itemId));
  await setSetting('sync.folderDone', done);
}

// The app was in the background at some point since `since` (or is now).
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); });
const wasHidden = (since) => document.hidden || hiddenAt >= since - 2000;
const untilVisible = () => new Promise(res => {
  if (!document.hidden) return setTimeout(res, 800);   // back already: let the network wake up
  const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); setTimeout(res, 800); } };
  document.addEventListener('visibilitychange', on);
});

const coverTried = new Set();
async function repairCovers(mode, found, d, dirOf, sidecar, IMG) {
  const albums = (await db.albums.toArray()).filter(a => !a.deleted);
  const covers = new Map((await db.files.bulkGet(albums.map(a => a.coverFileId).filter(Boolean))).filter(Boolean).map(f => [f.id, f]));
  const onDrive = (c) => Object.keys(c.locations || {}).some(k => k !== 'local' && drives[k]?.connected?.());
  const broken = albums.filter(a => !coverTried.has(a.id) && (!a.coverFileId || (c => !c || (!c.locations?.local && !onDrive(c)))(covers.get(a.coverFileId))));
  if (!broken.length) return;
  const byPath = new Map(found.map(e => [e.path, e]));
  const imgByDir = new Map(found.filter(e => IMG.test(e.name)).map(e => [dirOf(e.path), e]));
  const music = await import('../../modules/music/lib/store.js');
  const { readAudioMeta } = await import('../../modules/music/lib/meta.js');
  let fixed = 0, n = 0;
  const task = track(tasks.start({ label: 'Đang sửa ảnh bìa album', total: broken.length, unit: 'items', cancellable: true, delay: 500 }));
  try {
  for (const al of broken) {
    if (task.cancelled) break;
    task.update({ done: n++, detail: al.title || '' });
    const tracks = (await db.tracks.where('albumId').equals(al.id).toArray()).filter(t => !t.deleted);
    let tried = false;
    for (const t of tracks) {
      const row = (await db.files.where('itemId').equals(t.itemId).toArray()).find(f => f.role === 'main' && f.locations?.[mode]?.key && byPath.has(f.locations[mode].key));
      if (!row) continue;
      tried = true;
      const e = byPath.get(row.locations[mode].key), img = imgByDir.get(dirOf(e.path));
      let pic = img ? await sidecar(img).catch(() => null) : null;
      if (!pic && d.getRange && e.id && e.size > 0) {
        const m = await readAudioMeta(remoteFile(e.name, e.size, (a, b) => d.getRange(e.id, a, b), e.path), { name: e.name }).catch(() => null);
        if (m?.picture) pic = new Blob([m.picture.data], { type: m.picture.mime || 'image/jpeg' });
      }
      if (!pic) continue;
      try {
        if (al.coverFileId && covers.get(al.coverFileId)) await music.repairAlbumCover(al, pic);   // keep the synced row
        else await music.setAlbumCover(al.id, pic);
        fixed++;
      } catch { /* next sync */ }
      break;
    }
    if (tried) coverTried.add(al.id);   // a song without any art is read once per session, not on every sync
  }
  } finally { task.finish(fixed ? `Đã sửa ảnh bìa ${fixed} album` : 'Không có ảnh bìa nào cần sửa'); }
  if (fixed) music.invalidate?.();
}

async function runDrive(mode, { pruneOnly = false } = {}) {
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
  await redoUnread(mode, found, done).catch(e => console.warn('[folders] redo', e));
  // Next to a song: its folder cover (cover.jpg…) and lyrics (.lrc…). The music import looks for them by folder, so
  // they travel with the song; each is downloaded once.
  const IMG = /^(cover|folder|front|album|albumart)\.(jpe?g|png|webp)$/i, LYR = /\.(lrc|ttml|srt)$/i;
  const dirOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  const stem = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();
  const sideByDir = new Map();
  for (const e of found) if (IMG.test(e.name) || LYR.test(e.name)) { const k = dirOf(e.path); (sideByDir.get(k) || sideByDir.set(k, []).get(k)).push(e); }
  const sideFiles = new Map();
  const sidecar = (e, signal) => {
    if (!sideFiles.has(e.path)) sideFiles.set(e.path, d.getPath(e.path, { signal }).then(b => Object.assign(new File([b], e.name, { type: b.type || '' }), { relPath: e.path })));
    return sideFiles.get(e.path);
  };
  // A music file is imported only when a chosen folder above it feeds music; a book only when one feeds books.
  // Songs imported before covers were picked up (or whose file has no embedded art): give their album the folder cover.
  await fillFolderCovers(mode, found.filter(e => IMG.test(e.name)), d, dirOf, sidecar);
  const todo = found.filter(e => ((MUSIC.test(e.name) && allows(e.path, 'music')) || (!MUSIC.test(e.name) && isBookFile({ name: e.name }) && allows(e.path, 'books'))) && done[e.path] !== e.size);
  // Covers are repaired after the import, as their own task: done before it, a big library sat for minutes with no
  // progress and the import never seemed to start.
  const covers = () => repairCovers(mode, found, d, dirOf, sidecar, IMG).catch(e => console.warn('[folders] covers', e));
  if (!todo.length) { await covers(); return { added: 0, failed: [], removed, missing }; }

  const task = track(tasks.start({ label: `Đang nhập ${todo.length} tệp từ ${d.label}`, total: todo.length, unit: 'items', cancellable: true }));
  const music = await import('../../modules/music/lib/store.js');
  const books = await import('../../modules/books/ui/importer.js');
  const res = { added: 0, failed: [], removed, missing }, retries = {};
  try {
  for (let i = 0; i < todo.length; i++) {
    task.check();
    const e = todo[i], t0 = Date.now();
    task.update({ done: i, detail: `${e.name} · ${Math.round(i / todo.length * 100)}%` });
    try {
      // Music: only the parts the tag reader asks for. Books are parsed whole, so they are downloaded.
      const lazy = MUSIC.test(e.name) && d.getRange && e.id && e.size > 0;
      let file;
      if (lazy) file = remoteFile(e.name, e.size, (a, b) => d.getRange(e.id, a, b, { signal: task.signal }), e.path);
      else { const blob = await d.getPath(e.path, { signal: task.signal }); file = new File([blob], e.name, { type: blob.type || '' }); }
      // Stays on the drive: nothing is copied to this device or uploaded (see storage.addFile remote).
      const remote = Object.assign(() => e.path, { drive: mode });
      if (MUSIC.test(e.name)) {
        const side = (sideByDir.get(dirOf(e.path)) || []).filter(x => IMG.test(x.name) || stem(x.name) === stem(e.name));
        const extra = (await Promise.all(side.map(x => sidecar(x, task.signal).catch(() => null)))).filter(Boolean);
        if (!file.relPath) file.relPath = e.path;
        const r = await music.importFiles([file, ...extra], { kind: 'music', remote });
        if (r?.failed?.length) throw new Error(String(r.failed[0]).replace(/^[^:]*:\s*/, ''));   // not marked done: retried next sync
      }
      else await books.importFiles([file], { remote });
      done[e.path] = e.size;
      res.added++;
      // The map holds every imported path: writing it after each file grew O(n²) on big folders.
      if (res.added % 25 === 0) await setSetting('sync.folderDone', done);
    } catch (err) {
      if (err?.name === 'AbortError') break;
      // Android cuts the network of an app in the background: a read that failed while (or right after) the app
      // was hidden is not the file's fault. Wait until the app is back, then try the same file again.
      if (wasHidden(t0) && (retries[e.path] = (retries[e.path] || 0) + 1) <= 3) {
        task.update({ detail: 'Tạm chờ: mở lại My Hub để tiếp tục nhập' });
        await untilVisible();
        i--; continue;
      }
      res.failed.push(`${e.name}: ${err.message}`);
    }
  }
  } finally { await setSetting('sync.folderDone', done); }   // also after a cancel / error
  task.finish(`Đã nhập ${res.added}/${todo.length}`);
  await covers();
  return res;
}
