// Chosen folders on a folder-capable drive (Dropbox, OneDrive): the user ticks one or more folders on the drive
// and every music / book file inside them (any depth) is imported into the library. Files already imported are
// remembered by path + size (sync.folderDone), so a second sync only fetches what is new.
// The files are NOT copied into the app: they stay on the drive and are fetched only when played or opened.
import { drives, storage } from './index.js';
import { getSetting, setSetting } from '../db.js';
import { tasks } from '../tasks.js';

const MUSIC = /\.(mp3|flac|m4a|m4b|mp4|aac|alac|ogg|oga|opus|wav|wave|aif|aiff|aifc|wv|ape|dsf|dff|wma)$/i;

export const folderList = async () => (await getSetting('sync.folders', [])) || [];
export async function setFolders(list) { await setSetting('sync.folders', [...new Set(list)]); }
export const canPickFolders = (mode) => typeof drives[mode]?.listDir === 'function';

async function walk(d, sub, out) {
  for (const e of await d.listDir(sub)) {
    if (e.isDir) await walk(d, e.path, out);
    else out.push(e);
  }
  return out;
}

// Imports the new music and book files of the chosen folders. → { added, failed, skipped? }
export async function syncFolders({ signal } = {}) {
  const mode = await storage.mode();
  const d = drives[mode];
  if (!d || !d.listDir) return { skipped: 'no-folders' };
  if (!d.connected() || !navigator.onLine) return { skipped: 'offline' };
  const folders = await folderList();
  if (!folders.length) return { skipped: 'none' };

  // Progress: folders scanned (one step per folder listed) and files found; then files imported (x / y, %).
  const scan = tasks.start({ label: 'Đang quét thư mục trên ' + d.label, unit: 'items', cancellable: true, delay: 300 });
  const found = [];
  let dirs = 0;
  const count = (e) => { if (e.isDir) dirs++; };
  const visit = async (sub) => {
    scan.check();
    const list = await d.listDir(sub);
    for (const e of list) { count(e); if (e.isDir) await visit(e.path); else found.push(e); }
    scan.update({ detail: `${dirs} thư mục · ${found.length} tệp` });
  };
  try {
    for (const f of folders) await visit(f);
  } catch (e) { scan.fail(e); throw e; }
  scan.finish(`Quét xong: ${dirs} thư mục, ${found.length} tệp`);

  const { isBookFile } = await import('../../modules/books/lib/formats.js');
  const done = (await getSetting('sync.folderDone', {})) || {};
  const todo = found.filter(e => (MUSIC.test(e.name) || isBookFile({ name: e.name })) && done[e.path] !== e.size);
  if (!todo.length) return { added: 0, failed: [] };

  const task = tasks.start({ label: `Đang nhập ${todo.length} tệp từ ${d.label}`, total: todo.length, unit: 'items', cancellable: true });
  const music = await import('../../modules/music/lib/store.js');
  const books = await import('../../modules/books/ui/importer.js');
  const res = { added: 0, failed: [] };
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
