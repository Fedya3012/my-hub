// Cross-device progress (where you stopped a song, book, video, podcast...).
// Every module uses this instead of writing its own position field:
//
//   const p = await progress.get(item.id);            // { position, duration, percent, deviceId, updatedAt }
//   audio.currentTime = p?.position || 0;
//   progress.track(item, audio);                       // auto-saves while playing, flushes on pause/close
//   await progress.save(item, { position: 289, total: 688, unit: 'page' });  // books, manual
//   extra: fields stored on the row too (the Music player keeps its queue in a virtual row 'music:session').
//
// Rows are keyed by itemId; the most recent write (from any device) wins. In GitHub
// mode a save pushes to GitHub within a few seconds, and opening the app on another device
// pulls it right away (storage.syncLive), so playback resumes at the same spot.
import { db, now } from './db.js';
import { bus } from './bus.js';
import { thisDevice, deviceName } from './device.js';
import { fmtDuration, fmtAgo } from './ui.js';

const LOCAL_EVERY = 5000;   // write to IndexedDB at most every 5s while playing
let syncHook = () => {};    // set by storage (avoids an import cycle)
export function onProgressSaved(fn) { syncHook = fn; }

function describe(p) {
  if (p.label) return p.label;
  if (p.unit === 'page') return `Trang ${Math.round(p.position)} / ${p.total || '?'}`;
  if (p.total) return `${fmtDuration(p.position)} / ${fmtDuration(p.total)}`;
  return `${Math.round(p.percent || 0)}%`;
}

export const progress = {
  get: (itemId) => db.progress.get(itemId),

  async save(item, { position, total, unit = 'second', label, state = 'paused', flush = false, extra } = {}) {
    const dev = await thisDevice();
    const percent = total ? Math.min(100, Math.max(0, position / total * 100)) : 0;
    const finished = percent >= 98;
    const row = {
      itemId: item.id, moduleId: item.moduleId, position, total, unit, percent,
      state: finished ? 'finished' : state, deviceId: dev.id, updatedAt: now(), ...(extra || {}),
    };
    row.label = label || describe(row);
    await db.progress.put(row);
    // Keep the item's status in step, without touching it on every tick.
    const want = finished ? 'done' : position > 0 ? 'in-progress' : null;
    if (want && item.status !== want && !extra?.virtual) { item.status = want; await db.items.update(item.id, { status: want }); }
    bus.emit('progress:changed', row);
    syncHook({ flush });
    return row;
  },

  // Bind an <audio>/<video> element: resume at the saved spot, save while playing.
  async track(item, media) {
    const saved = await this.get(item.id);
    const resumeAt = saved && saved.state !== 'finished' ? saved.position : 0;
    const seek = () => { if (resumeAt && media.duration > resumeAt) media.currentTime = resumeAt; };
    if (media.readyState >= 1) seek(); else media.addEventListener('loadedmetadata', seek, { once: true });
    let last = 0;
    const write = (state, flush) => {
      if (!media.duration || !isFinite(media.duration)) return;
      last = Date.now();
      return this.save(item, { position: media.currentTime, total: media.duration, state, flush });
    };
    const onTime = () => { if (Date.now() - last > LOCAL_EVERY) write('playing'); };
    const onPause = () => write('paused', true);
    const onEnd = () => write('finished', true);
    const onHide = () => { if (document.visibilityState === 'hidden' && !media.paused) write('playing', true); };
    media.addEventListener('timeupdate', onTime);
    media.addEventListener('pause', onPause);
    media.addEventListener('ended', onEnd);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      if (!media.paused) write('paused', true);
      media.removeEventListener('timeupdate', onTime);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('ended', onEnd);
      document.removeEventListener('visibilitychange', onHide);
    };
  },

  // Back to "not started" for one item. The row is kept (position 0, state 'reset') rather than deleted: a deleted row
  // would be restored by the next sync from another device, while a newer reset row wins the merge like any save.
  async reset(item, { flush = true } = {}) {
    const dev = await thisDevice();
    const old = await db.progress.get(item.id);
    const row = { itemId: item.id, moduleId: item.moduleId || old?.moduleId, position: 0, total: old?.total, unit: old?.unit || 'second', percent: 0,
      state: 'reset', deviceId: dev.id, updatedAt: now(), label: 'Chưa bắt đầu' };
    await db.progress.put(row);
    if (item.status && item.status !== 'new') { item.status = 'new'; await db.items.update(item.id, { status: 'new' }); }
    // Books and fanfics keep their own reading status next to the progress row: back to "want to read".
    const bk = await db.books.get(item.id);
    if (bk && (bk.status !== 'want' || bk.startedAt || bk.finishedAt || bk.manualPercent)) await db.books.update(item.id, { status: 'want', startedAt: null, finishedAt: null, manualPercent: 0 });
    bus.emit('progress:changed', row);
    syncHook({ flush });
    return row;
  },

  // Every item of the given modules (all modules when omitted) that has a saved position. Returns how many were reset.
  async resetAll(moduleIds = null) {
    const rows = (await db.progress.toArray()).filter(p => !String(p.itemId).includes(':') && p.state !== 'reset' && (p.position > 0 || p.state === 'finished')
      && (!moduleIds || moduleIds.includes(p.moduleId)));
    for (const p of rows) {
      const item = await db.items.get(p.itemId);
      await this.reset(item || { id: p.itemId, moduleId: p.moduleId }, { flush: false });
    }
    if (rows.length) { syncHook({ flush: true }); bus.emit('progress:reset', { moduleIds, count: rows.length }); }
    return rows.length;
  },

  // Text for the UI: "Dừng ở 1:23 / 3:45 trên Máy tính Windows · 5 phút trước"
  async summary(itemId) {
    const p = await this.get(itemId);
    if (!p) return null;
    return { ...p, where: await deviceName(p.deviceId), ago: fmtAgo(p.updatedAt) };
  },
};
