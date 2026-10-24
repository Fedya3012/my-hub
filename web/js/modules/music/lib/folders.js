// Folder-first browsing: no library scan, no import. The user adds root folders (internal storage,
// SD card, USB drive…) with the File System Access API; their handles are kept in IndexedDB
// (`handles` table, local to this device) and listed live. Files play straight from the handle
// as "virtual" tracks (store.registerVirtual), so nothing is copied into the app.
//
// The Android app has no showDirectoryPicker and its WebView cannot open <input webkitdirectory>: it uses the native
// FolderPicker (system folder dialog, access kept for good). A song is copied to the cache only when it is read
// (played or tagged), never the whole folder.
//
// Without showDirectoryPicker (Firefox, iOS Safari, most Android browsers) a folder picked with
// <input webkitdirectory> is browsed for this session only (the browser gives no lasting access).
// Browsers never accept a typed path like /storage/XXXX-XXXX/Music or E:\Music: the user must
// pick the folder once in the system dialog.
import { db, uid } from '../../../core/db.js';
import { readAudioMeta } from './meta.js';
import { registerVirtual } from './store.js';
import { cmpViNum } from '../../../core/perf.js';
import { nativeRoot } from '../../../core/storage/local-folders.js';

export const AUDIO = /\.(mp3|flac|m4a|m4b|mp4|aac|alac|ogg|oga|opus|wav|wave|aif|aiff|aifc|wv|ape|dsf|dff|wma)$/i;
const IMG = /^(cover|folder|front|album|albumart)\.(jpe?g|png|webp)$/i;
export const supported = () => typeof window.showDirectoryPicker === 'function' || !!nativeRoot();
const PREFIX = 'music-root:';

export const KINDS = { internal: 'Bộ nhớ máy', sd: 'Thẻ SD', usb: 'Ổ USB / ổ ngoài', network: 'Ổ mạng', other: 'Khác' };

// ── Roots ───────────────────────────────────────────────────────
const session = new Map(); // id -> { id, name, kind, session: true, tree }

export async function roots() {
  const rows = (await db.handles.where('id').startsWith(PREFIX).toArray()).map(r => ({ ...r, id: r.id.slice(PREFIX.length) }));
  for (const r of rows) r.permission = await permission(r.handle);
  return [...rows.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)), ...session.values()];
}

export async function permission(handle, ask = false) {
  if (!handle) return 'granted';   // Android folders (SAF) keep their access in the system
  try {
    const o = { mode: 'read' };
    let p = await handle.queryPermission?.(o) ?? 'granted';
    if (p !== 'granted' && ask) p = await handle.requestPermission(o);
    return p;
  } catch { return 'denied'; }
}

// Android (SAF): the folder tree is listed once per root and kept in memory; files are copied from the content
// address into the cache one at a time, when they are read.
const safTrees = new Map();   // root id -> { dirs: Map, files: [] }
const safFiles = new Map();   // uri -> Promise<File>
let safQueue = Promise.resolve();
async function safTree(root, refresh = false) {
  if (!refresh && safTrees.has(root.id)) return safTrees.get(root.id);
  const { files = [] } = await nativeRoot().listTree({ treeUri: root.treeUri });
  const tree = { dirs: new Map(), files: [] };
  for (const e of files) {
    const parts = String(e.relPath || e.name).split('/').filter(Boolean);
    let n = tree;
    for (const p of parts.slice(0, -1)) { if (!n.dirs.has(p)) n.dirs.set(p, { dirs: new Map(), files: [] }); n = n.dirs.get(p); }
    n.files.push(e);
  }
  safTrees.set(root.id, tree);
  return tree;
}
function safFile(e) {
  if (!safFiles.has(e.uri)) {
    const P = nativeRoot();
    const job = (safQueue = safQueue.catch(() => {}).then(async () => {
      const { path } = await P.copyToCache({ uri: e.uri, name: e.name });
      try {
        const blob = await (await fetch(window.Capacitor.convertFileSrc('file://' + path))).blob();
        return new File([blob], e.name, { type: blob.type, lastModified: e.lastModified || 0 });
      } finally { await P.clearCache().catch(() => {}); }
    }));
    safFiles.set(e.uri, job);
    job.catch(() => safFiles.delete(e.uri));
    if (safFiles.size > 12) safFiles.delete(safFiles.keys().next().value);
  }
  return safFiles.get(e.uri);
}

export async function addRoot(kind = 'internal') {
  const P = !window.showDirectoryPicker && nativeRoot();
  if (P) {
    const r = await P.pickRoot();
    if (!r || r.cancelled) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    for (const x of await roots()) if (x.treeUri === r.treeUri) return x;
    const id = uid();
    const name = decodeURIComponent(r.treeUri.split('%3A').pop() || r.treeUri).split('/').pop() || 'Thư mục';
    await db.handles.put({ id: PREFIX + id, treeUri: r.treeUri, saf: true, name, kind, addedAt: Date.now() });
    return { id, treeUri: r.treeUri, saf: true, name, kind, permission: 'granted' };
  }
  const handle = await window.showDirectoryPicker({ id: 'music-' + kind, mode: 'read' });
  // Same folder twice: keep one.
  for (const r of await roots()) if (r.handle && (await r.handle.isSameEntry?.(handle))) return r;
  const id = uid();
  await db.handles.put({ id: PREFIX + id, handle, name: handle.name, kind, addedAt: Date.now() });
  return { id, handle, name: handle.name, kind, permission: 'granted' };
}

// <input webkitdirectory> fallback: the File list becomes an in-memory tree.
export function addSessionRoot(files, kind = 'other') {
  const list = [...files];
  if (!list.length) return null;
  const top = (list[0].webkitRelativePath || list[0].name).split('/')[0];
  const tree = { dirs: new Map(), files: [] };
  for (const f of list) {
    const parts = (f.webkitRelativePath || f.name).split('/').slice(1);
    let n = tree;
    for (const p of parts.slice(0, -1)) { if (!n.dirs.has(p)) n.dirs.set(p, { dirs: new Map(), files: [] }); n = n.dirs.get(p); }
    n.files.push(f);
  }
  const id = 's-' + uid();
  const r = { id, name: top, kind, session: true, tree, permission: 'granted', addedAt: Date.now() };
  session.set(id, r);
  return r;
}

export async function renameRoot(id, patch) { const r = await db.handles.get(PREFIX + id); if (r) await db.handles.put({ ...r, ...patch }); }
export async function removeRoot(id) {
  const r = await db.handles.get(PREFIX + id);
  if (r?.saf) nativeRoot()?.releaseRoot?.({ treeUri: r.treeUri }).catch(() => {});
  safTrees.delete(id); session.delete(id); await db.handles.delete(PREFIX + id);
}
export async function getRoot(id) {
  if (session.has(id)) return session.get(id);
  const r = await db.handles.get(PREFIX + id);
  return r ? { ...r, id, permission: await permission(r.handle) } : null;
}

// ── Listing ─────────────────────────────────────────────────────
// { dirs: [{ name, path }], files: [{ name, path, size, lastModified, get() }], image: File|null }
export async function list(root, path = '') {
  const parts = path.split('/').filter(Boolean);
  const dirs = [], files = [];
  let image = null;
  if (root.saf || root.session) {
    let n = root.saf ? await safTree(root, !parts.length) : root.tree;
    for (const p of parts) { n = n?.dirs.get(p); if (!n) throw new Error('Không tìm thấy thư mục'); }
    for (const name of n.dirs.keys()) dirs.push({ name, path: [...parts, name].join('/') });
    for (const f of n.files) {
      if (root.saf) {
        if (AUDIO.test(f.name)) files.push({ name: f.name, path: [...parts, f.name].join('/'), size: f.size, get: () => safFile(f) });
        continue;
      }
      if (IMG.test(f.name)) image ||= f;
      if (AUDIO.test(f.name)) files.push({ name: f.name, path: [...parts, f.name].join('/'), size: f.size, lastModified: f.lastModified, file: f, get: async () => f });
    }
  } else {
    let d = root.handle;
    for (const p of parts) d = await d.getDirectoryHandle(p);
    for await (const [name, h] of d.entries()) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'directory') dirs.push({ name, path: [...parts, name].join('/') });
      else if (IMG.test(name)) image ||= h;
      else if (AUDIO.test(name)) files.push({ name, path: [...parts, name].join('/'), handle: h, get: () => h.getFile() });
    }
    if (image) { try { image = await image.getFile(); } catch { image = null; } }
  }
  return { dirs, files, image };
}

// Every audio file below path (depth-first), capped.
export async function walk(root, path = '', { max = 3000, signal } = {}) {
  const out = [];
  const go = async (p) => {
    if (out.length >= max || signal?.aborted) return;
    const r = await list(root, p);
    out.push(...r.files.sort(byName));
    for (const d of r.dirs.sort(byName)) await go(d.path);
  };
  await go(path);
  return out.slice(0, max);
}
export const byName = (a, b) => cmpViNum(a.name, b.name);

// ── Virtual tracks ──────────────────────────────────────────────
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(36) + s.length.toString(36); }
const metaCache = new Map(); // id -> track
const folderArt = new Map(); // root|dir -> object URL

// Turn listed files into playable tracks; reads tags (title, artist, art, format) lazily with a
// small concurrency limit. onEach(track) is called as each one is ready.
export async function toTracks(root, files, { image, onEach, signal, lazy = false } = {}) {
  const dirKey = (f) => root.id + '|' + f.path.split('/').slice(0, -1).join('/');
  if (image && files[0] && !folderArt.has(dirKey(files[0]))) folderArt.set(dirKey(files[0]), URL.createObjectURL(image));
  const out = files.map(f => {
    const id = 'vt:' + hash(root.id + '/' + f.path);
    const t = metaCache.get(id) || { id, virtual: true, title: f.name.replace(/\.[^.]+$/, '').replace(/^\d+[\s.-]+/, ''), artist: '', album: '', fileName: f.name,
      folder: root.name + '/' + f.path.split('/').slice(0, -1).join('/'), handle: f.handle, file: f.file, get: f.get, size: f.size, item: { type: 'music' }, type: 'music', plays: 0 };
    t.cover ||= folderArt.get(dirKey(f)) ? 'u:' + folderArt.get(dirKey(f)) : null;
    return t;
  });
  registerVirtual(out);
  let i = 0;
  const worker = async () => {
    while (i < out.length && !signal?.aborted) {
      const t = out[i], f = files[i]; i++;
      if (t.loaded) { onEach?.(t); continue; }
      try {
        const file = await f.get();
        t.size = file.size; t.lastModified = file.lastModified;
        const m = await readAudioMeta(file, { name: f.name });
        const g = m.tags || {};
        Object.assign(t, {
          title: g.title || t.title, artist: g.artist || '', album: g.album || '', albumArtist: g.albumArtist || '', year: g.year || null,
          trackNo: g.trackNo || null, discNo: g.discNo || null, genres: g.genre || [], duration: m.duration || null,
          rg: m.replayGain || null, codec: m.codec,
          tech: m.codec !== 'unknown' ? { container: m.container, codec: m.codec, codecLabel: m.codecLabel, lossless: !!m.lossless, bitDepth: m.bitDepth, sampleRate: m.sampleRate, dsdRate: m.dsdRate, channels: m.channels, bitrate: m.bitrate, vbr: m.vbr, mime: file.type } : null,
        });
        if (m.picture) t.cover = 'u:' + URL.createObjectURL(new Blob([m.picture.data], { type: m.picture.mime }));
      } catch { /* unreadable: keep the file name */ }
      t.loaded = true;
      metaCache.set(t.id, t);
      onEach?.(t);
    }
  };
  const job = Promise.all([worker(), worker(), worker(), worker()]);
  if (!lazy) await job;
  return out;
}
