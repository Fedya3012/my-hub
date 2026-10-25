// Bản sao Xưởng Viết ra thư mục đã chọn trên Dropbox hoặc OneDrive. Mỗi truyện thành một thư mục con:
// work.json (siêu dữ liệu, mọi chương kèm nội dung) và một file .md cho từng chương. Dữ liệu chính vẫn ở app;
// bản sao chỉ được ghi đè khi truyện thay đổi, không bao giờ xoá gì trên thư mục đích.
import { drives } from '../../../core/storage/index.js';
import { bus } from '../../../core/bus.js';
import { toast } from '../../../core/ui.js';
import { get as pref, set as setPref } from './prefs.js';
import * as store from './store.js';
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80);

export const SUPPORTED = { dropbox: 'Dropbox', onedrive: 'OneDrive' };

// Target format: "dropbox|Thư mục/Con" (empty = off).
export function target() {
  const raw = pref('backupTarget') || '';
  const i = raw.indexOf('|');
  if (i < 0) return null;
  const mode = raw.slice(0, i), path = raw.slice(i + 1).replace(/^\/+|\/+$/g, '');
  return SUPPORTED[mode] ? { mode, path } : null;
}
export const setTarget = (mode, path) => setPref('backupTarget', mode ? `${mode}|${String(path || '').replace(/^\/+|\/+$/g, '')}` : '');
export const connected = (mode) => !!drives[mode]?.connected?.();

let timer = null, running = false, lastError = '';
// Writes changed works after a short pause in editing, so one save does not start a full copy.
export function watch() {
  const again = () => { clearTimeout(timer); timer = setTimeout(() => runIfNeeded(), 4000); };
  return bus.on('fanfic:changed', again);
}
async function runIfNeeded() {
  if (!target() || running) return;
  return backupAll().catch(e => { lastError = e.message; toast('Sao lưu Xưởng Viết lỗi: ' + e.message, 'error'); });
}

export async function backupAll({ onProgress } = {}) {
  const t = target();
  if (!t) throw new Error('Chưa chọn nơi lưu');
  if (!connected(t.mode)) throw new Error(`${SUPPORTED[t.mode]} chưa kết nối. Kết nối lại trong Cài đặt → Lưu trữ.`);
  if (running) return;
  running = true;
  try {
    const snap = await store.snapshot();
    const works = snap.list.filter(v => v.origin === 'mine');
    let done = 0;
    for (const v of works) {
      const base = [t.path, safeName(v.title) || v.id].filter(Boolean).join('/');
      const chapters = v.chapters.map(c => ({ id: c.id, parentId: c.parentId, title: c.title, order: c.order, status: c.status, synopsis: c.synopsis, tags: c.tags, body: c.body, notesStart: c.notesStart, notesEnd: c.notesEnd, words: c.words, editedAt: c.editedAt }));
      const meta = { id: v.id, title: v.title, item: v.item, fic: v.fic, chapters, savedAt: new Date().toISOString() };
      await put(t.mode, `${base}/work.json`, new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }));
      for (const [i, c] of v.tops.entries()) {
        const body = store.composeMd(c, v.chapters, {});
        await put(t.mode, `${base}/${String(i + 1).padStart(2, '0')} ${safeName(c.title) || 'Chương'}.md`, new Blob([body], { type: 'text/markdown' }));
      }
      done++; onProgress?.(done, works.length);
    }
    lastError = '';
    return { works: done };
  } finally { running = false; }
}
const put = (mode, key, blob) => drives[mode].putFile(key, blob);

export const lastBackupError = () => lastError;
