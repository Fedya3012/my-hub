// "Dọn dữ liệu" for an app: removes library entries whose file is gone. Two kinds of loss are detected:
// files linked from a synced drive folder that the drive no longer lists (folders.js scan), and files on this
// device (linked handle, OPFS, IndexedDB copy) that cannot be found any more. Cloud-only copies are kept.
import { db } from '../db.js';
import { local } from './local.js';
import { syncFolders } from './folders.js';
import { tasks } from '../tasks.js';

async function localMissing(f) {
  const loc = f.locations?.local;
  if (!loc) return false;
  try {
    if (loc.kind === 'handle') {
      const row = await db.handles.get(loc.ref);
      if (!row) return true;
      const h = row.handle;
      if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted') return false; // cannot tell
      await h.getFile();
      return false;
    }
    if (loc.kind === 'idb') return !(await db.blobs.where('id').equals(loc.ref).count());
    if (loc.kind === 'opfs') return !(await local.get(loc));
  } catch (e) { return e?.name === 'NotFoundError'; }
  return false;
}

// moduleId: an app id, or 'library' for everything. → { removed }
export async function cleanMissing(moduleId) {
  const t = tasks.start({ label: 'Đang dọn dữ liệu', unit: 'items', delay: 0 });
  let removed = 0;
  try {
    const r = await syncFolders({ pruneOnly: true }).catch(() => null);
    removed += r?.removed || 0;
    const items = (await db.items.filter(i => !i.deleted && (moduleId === 'library' || i.moduleId === moduleId)).toArray());
    const gone = { music: [], books: [], other: [] };
    for (let n = 0; n < items.length; n++) {
      const i = items[n];
      if (n % 50 === 0) t.update({ detail: `${n} / ${items.length}` });
      const files = (await db.files.where('itemId').equals(i.id).toArray()).filter(f => (f.role || 'main') === 'main');
      if (!files.length) continue;
      let lost = true;
      for (const f of files) if (!(await localMissing(f))) { lost = false; break; }
      if (lost) (i.type === 'book' ? gone.books : i.moduleId === 'music' ? gone.music : gone.other).push(i.id);
    }
    if (gone.music.length) await (await import('../../modules/music/lib/store.js')).deleteTracks(gone.music);
    if (gone.books.length) await (await import('../../modules/books/lib/store.js')).removeBooks(gone.books);
    if (gone.other.length) { const { softDeleteItem } = await import('../db.js'); for (const id of gone.other) await softDeleteItem(id); }
    removed += gone.music.length + gone.books.length + gone.other.length;
    t.finish(removed ? `Đã xoá ${removed} mục mất tệp` : 'Không có mục nào mất tệp');
  } catch (e) { t.fail(e); throw e; }
  return { removed };
}

// The button action shared by every app: confirm, clean, report. moduleId 'library' = everything.
export async function cleanDataAction(moduleId, appName) {
  const { confirmBox, toast } = await import('../ui.js');
  if (!(await confirmBox(`Dọn dữ liệu ${appName}?`, 'Xoá khỏi thư viện những mục đã mất tệp gốc (tệp trong máy hoặc thư mục đồng bộ đã bị xoá). Tệp còn tồn tại không bị đụng tới.', 'Dọn'))) return null;
  try {
    const r = await cleanMissing(moduleId);
    toast(r.removed ? `Đã xoá ${r.removed} mục mất tệp` : 'Không có mục nào mất tệp');
    return r;
  } catch (e) { toast(e.message, 'error'); return null; }
}
