// Chosen folders on a folder-capable drive (WebDAV, pCloud): the user ticks one or more folders on the drive
// and every music / book file inside them (any depth) is imported into the library. Files already imported are
// remembered by path + size (sync.folderDone), so a second sync only fetches what is new.
// Imported files then follow the normal rules: they are uploaded to the drive like any other file.
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

  const scan = tasks.start({ label: 'Đang quét thư mục trên ' + d.label, unit: 'items', cancellable: true, delay: 300 });
  const found = [];
  try {
    for (const f of folders) {
      scan.check();
      found.push(...await walk(d, f, []));
      scan.update({ detail: f });
    }
  } catch (e) { scan.fail(e); throw e; }
  scan.finish(`Tìm thấy ${found.length} tệp`);

  const { isBookFile } = await import('../../modules/books/lib/formats.js');
  const done = (await getSetting('sync.folderDone', {})) || {};
  const todo = found.filter(e => (MUSIC.test(e.name) || isBookFile({ name: e.name })) && done[e.path] !== e.size);
  if (!todo.length) return { added: 0, failed: [] };

  const task = tasks.start({ label: 'Đang nhập tệp từ ' + d.label, total: todo.length, unit: 'items', cancellable: true });
  const music = await import('../../modules/music/lib/store.js');
  const books = await import('../../modules/books/ui/importer.js');
  const res = { added: 0, failed: [] };
  for (let i = 0; i < todo.length; i++) {
    task.check();
    const e = todo[i];
    task.update({ done: i, detail: e.name });
    try {
      const blob = await d.getPath(e.path, { signal: task.signal });
      const file = new File([blob], e.name, { type: blob.type || '' });
      if (MUSIC.test(e.name)) await music.importFiles([file], { kind: 'music' });
      else await books.importFiles([file]);
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
