// Storage manager: one API for every module, whatever the user picked in Settings.
//
//   mode 'local'  : DB + files on this device only.
//   mode 'github' : "Tài khoản GitHub": the library and progress sync through a private repo
//                   (storage/github.js); files (music, books) always stay on the device.
//   mode 'dropbox' | 'onedrive': the same data goes to a cloud drive (storage/dropbox.js, onedrive.js),
//                   and music / book files are uploaded there too (syncFiles) and fetched
//                   on demand by a device that does not have them yet.
// github needs the GitHub account (js/core/account.js; signing out goes back to 'local'); the drives keep
// their own connection (storage/clouds.js).
//
// Modules never talk to an adapter directly: they call storage.addFile / storage.open.
import { db, uid, now, getSetting, setSetting, withoutSyncHooks, SYNCED_TABLES, LIVE_TABLES } from '../db.js';
import { onProgressSaved } from '../progress.js';
import { touchDevice, thisDevice } from '../device.js';
import { account } from '../account.js';
import { bus } from '../bus.js';
import { tasks, abortError } from '../tasks.js';
import { local } from './local.js';
import { github } from './github.js';
import { dropbox } from './dropbox.js';
import { onedrive } from './onedrive.js';

// Cloud drives that also hold the files. The adapter in use follows the storage mode.
export const drives = { dropbox, onedrive };
let activeMode = 'local';
// Where the library snapshot and progress live: the signed-in GitHub account, or the chosen drive.
const cloud = () => drives[activeMode] || github;
const cloudReady = () => activeMode === 'github' ? account.signedIn : !!drives[activeMode]?.connected();
const cloudTokenOk = () => activeMode === 'github' ? account.tokenValid() : !!drives[activeMode]?.connected();

export const MODES = {
  local:  { label: 'Chỉ trên máy', hint: 'Dữ liệu và tệp nằm trên thiết bị này. Không cần mạng, không cần tài khoản.' },
  github: { label: 'Tài khoản GitHub', hint: 'Đăng nhập GitHub (dán token): thư viện và tiến độ đồng bộ qua một kho riêng tư của bạn. Tệp nhạc/sách ở lại trên từng máy.' },
  dropbox: { label: 'Dropbox', hint: 'Đăng nhập Dropbox một lần: thư viện, tiến độ và cả tệp nhạc/sách đồng bộ qua thư mục riêng của app. Máy khác tải tệp về khi cần.' },
  onedrive: { label: 'OneDrive', hint: 'Đăng nhập OneDrive: thư viện, tiến độ và cả tệp nhạc/sách đồng bộ qua thư mục riêng của app (Apps/…). Máy khác tải tệp về khi cần.' },
};
export const isDrive = (m) => m in drives;

const TOMB_TTL = 120 * 864e5;   // deletions are remembered this long in the snapshot
const tkey = (t, id) => t + '\u0000' + String(id);

// Rows deleted on this device but not synced yet (syncQueue 'delete'): `${table}\0${id}` → when.
async function pendingDeletes(maxSeq = Infinity) {
  const out = new Map();
  for (const q of await db.syncQueue.toArray()) if (q.op === 'delete' && q.seq <= maxSeq) out.set(tkey(q.entity, q.entityId), q.createdAt || now());
  return out;
}

// Tombstones of the snapshot ({ table: { id: at } }) + this device's pending deletes, newest wins,
// expired ones dropped.
function mergeTombstones(remote = {}, pending = new Map()) {
  const out = {}, cutoff = now() - TOMB_TTL;
  const put = (t, id, at) => { if (at < cutoff) return; (out[t] ||= {}); if (!(out[t][id] >= at)) out[t][id] = at; };
  for (const [t, m] of Object.entries(remote || {})) for (const [id, at] of Object.entries(m || {})) put(t, id, +at || 0);
  for (const [k, at] of pending) { const [t, id] = k.split('\u0000'); put(t, id, at); }
  return out;
}

// Last-write-wins merge of one table: newest updatedAt (then rev) per primary key. A tombstone
// at least as new as a row removes it (locally too), so a delete made on this device and not
// synced yet is never brought back by an older copy in the snapshot.
async function mergeTable(name, remoteRows = [], tomb = {}) {
  const table = db.table(name);
  const key = table.schema.primKey.keyPath;
  const map = new Map((await table.toArray()).map(r => [r[key], r]));
  const changed = [], removed = [];
  for (const r0 of remoteRows) {
    let r = r0;
    if (tomb[String(r[key])] >= (r.updatedAt || 0)) continue;
    const mine = map.get(r[key]);
    if (!mine || (r.updatedAt || 0) > (mine.updatedAt || 0) || (r.updatedAt === mine.updatedAt && (r.rev || 0) > (mine.rev || 0))) {
      // A file row from another device must not wipe this device's own copy of the bytes.
      if (name === 'files' && mine?.locations?.local) r = { ...r, locations: { ...r.locations, local: mine.locations.local } };
      map.set(r[key], r); changed.push(r);
    }
  }
  for (const [k, r] of map) {
    const at = tomb[String(k)];
    if (at != null && at >= (r.updatedAt || 0)) { map.delete(k); removed.push(k); }
  }
  return { all: [...map.values()], changed: changed.filter(r => map.has(r[key])), removed };
}

const HASH_MAX = 200 * 1024 * 1024;   // skip hashing huge files
const READ_CHUNK = 8 * 1024 * 1024;
const BIG_FILE = 4 * 1024 * 1024;     // smaller files never get their own progress task
const canHash = (blob) => blob.size <= HASH_MAX && !!crypto.subtle;

// Big blobs are read in 8 MB slices (so reading from disk reports progress), then digested.
async function sha256(blob, { onProgress, signal } = {}) {
  if (!canHash(blob)) return null;
  let buf;
  if (blob.size <= READ_CHUNK) buf = await blob.arrayBuffer();
  else {
    buf = new Uint8Array(blob.size);
    for (let off = 0; off < blob.size; off += READ_CHUNK) {
      if (signal?.aborted) throw abortError();
      buf.set(new Uint8Array(await blob.slice(off, off + READ_CHUNK).arrayBuffer()), off);
      onProgress?.(Math.min(blob.size, off + READ_CHUNK) * 0.9);
    }
  }
  const d = await crypto.subtle.digest('SHA-256', buf);
  onProgress?.(blob.size);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Progress for one storage operation: report to the caller's onProgress if given, otherwise to
// an own tray task, but only for big files (small ones finish before anyone could read a bar).
function reporter({ onProgress, signal, quiet, big, label, detail, total }) {
  const own = !onProgress && !quiet && big
    ? tasks.start({ label, detail, total, unit: 'bytes', cancellable: true, delay: 300 }) : null;
  const sig = own && signal ? anySignal([signal, own.signal]) : own?.signal || signal;
  return {
    signal: sig,
    report(done, phase) { onProgress?.({ done, total, phase }); own?.update({ done, detail: phase ? `${detail} · ${phase}` : detail }); },
    finish(msg) { own?.finish(msg); },
    fail(e) { if (!own) return; if (e?.name === 'AbortError') tasks.cancel(own.id); else own.fail(e); },
  };
}
function anySignal(list) {
  const c = new AbortController();
  for (const s of list) { if (s.aborted) { c.abort(s.reason); break; } s.addEventListener('abort', () => c.abort(s.reason), { once: true }); }
  return c.signal;
}

// Roles that are never uploaded to a cloud drive (see _syncFiles).
const DEVICE_ONLY_ROLES = new Set(['cover', 'thumb']);
export const storage = {
  adapters: { local },
  taskId: null,          // id of the running sync task (the account page mirrors its progress)

  async mode() {
    const m = await getSetting('storage.mode', 'local');
    if (MODES[m]) { activeMode = m; return m; }
    // Older modes (Google Drive / hybrid / Supabase): GitHub when signed in with it, otherwise Local.
    activeMode = account.signedIn && account.provider === 'github' ? 'github' : 'local';
    return activeMode;
  },

  async setMode(mode) {
    if (!MODES[mode]) throw new Error('Chế độ không hợp lệ: ' + mode);
    const prev = await this.mode();
    await setSetting('storage.mode', mode);
    activeMode = mode;
    if (prev !== mode && mode !== 'local') await setSetting('sync.fullPushNeeded', true);
    bus.emit('storage:mode', { mode, prev });
  },

  // First import on this device: ask the browser to keep our data (no eviction under storage
  // pressure). Returns { asked, granted } — asked is false when it was already done before.
  async persistOnce() {
    if (!navigator.storage?.persist) return { asked: false, granted: false };
    if (await navigator.storage.persisted().catch(() => false)) return { asked: false, granted: true };
    if (await getSetting('storage.persistAsked', false)) return { asked: false, granted: false };
    await setSetting('storage.persistAsked', true);
    const granted = await navigator.storage.persist().catch(() => false);
    return { asked: true, granted };
  },

  async status() {
    const [mode, backend, usage, pending, lastSync] = await Promise.all([
      this.mode(), local.backend(), local.usage(), db.syncQueue.count(),
      getSetting('sync.lastAt', null),
    ]);
    return {
      mode, backend, usage, pending, lastSync,
      cloud: { connected: cloud().connected(), signedIn: cloudReady(), needsReconnect: activeMode === 'github' ? account.needsReconnect : false, label: cloud().label, drive: isDrive(activeMode) },
    };
  },

  // Add a file for an item. `source` is a File/Blob, or { handle } to link without copying.
  // Progress: onProgress({ done, total, phase }) in bytes (hashing + writing / uploading), or,
  // without onProgress, files of 4 MB and more get their own task in the tray (unless quiet).
  // signal (AbortSignal) stops between chunks; nothing is saved then.
  // remote: { key } registers a file that stays on the drive (a chosen folder): no copy on this device, no upload,
  // no cache when played (open() fetches it each time), and removing it never deletes the drive's file.
  async addFile(itemId, source, { role = 'main', name, mime, onProgress, signal, quiet = false, remote = null, localFolder = null } = {}) {
    const id = uid();
    const blob = source.handle ? await source.handle.getFile() : source;
    const fileName = name || blob.name || 'file';
    if (remote) {
      const row = { id, itemId, role, name: fileName, mime: mime || blob.type || 'application/octet-stream', size: blob.size,
        hash: null, locations: { [remote.drive || activeMode]: { key: remote.key } }, linked: true, syncStatus: 'remote-only', createdAt: now() };
      await db.files.put(row);
      return row;
    }
    const hashW = canHash(blob) ? blob.size : 0;
    const storeW = source.handle ? 0 : blob.size;
    const r = reporter({ onProgress, signal, quiet, big: blob.size >= BIG_FILE,
      label: 'Đang lưu tệp', detail: fileName, total: hashW + storeW });
    try {
      const row = {
        id, itemId, role,
        name: fileName,
        mime: mime || blob.type || 'application/octet-stream',
        size: blob.size,
        hash: await sha256(blob, { signal: r.signal, onProgress: (d) => r.report(d, 'kiểm tra tệp') }),
        locations: {},
        createdAt: now(),
      };
      if (r.signal?.aborted) throw abortError();
      row.locations.local = source.handle ? await local.link(id, source.handle)
        : await local.put(id, blob, { signal: r.signal, onProgress: (d) => r.report(hashW + d, 'ghi vào máy') });
      row.syncStatus = 'local-only';
      if (localFolder) row.localFolder = localFolder;   // imported from a 'Thư mục đồng bộ' folder: Dọn removes it once that folder is removed
      await db.files.put(row);
      r.report(hashW + storeW);
      r.finish(fileName);
      return row;
    } catch (e) { r.fail(e); throw e; }
  },

  // Get the bytes of a file: from this device, else (cloud drive modes) downloaded from the drive
  // and kept on this device from then on.
  async open(fileRow, { onProgress, signal } = {}) {
    const blob = await local.get(fileRow.locations?.local);
    if (blob) return blob;
    for (const [id, d] of Object.entries(drives)) {
      const key = fileRow.locations?.[id]?.key;
      if (!key || !d.connected() || !navigator.onLine) continue;
      const r = reporter({ onProgress, signal, quiet: false, big: fileRow.size >= 512 * 1024, label: 'Đang tải tệp từ ' + d.label, detail: fileRow.name, total: fileRow.size });
      try {
        const got = await d.getFile(key, { signal: r.signal, onProgress: (done, total) => r.report(done) });
        if (fileRow.linked) { r.finish(fileRow.name); return got; }   // a chosen-folder file: never kept on this device
        const loc = await local.put(fileRow.id, got);
        await withoutSyncHooks(() => db.files.update(fileRow.id, { 'locations.local': loc }));
        fileRow.locations = { ...fileRow.locations, local: loc };
        r.finish(fileRow.name);
        return got;
      } catch (e) { r.fail(e); throw e; }
    }
    if (Object.keys(fileRow.locations || {}).some(k => k in drives)) throw new Error('Tệp này nằm trên ' + MODES[Object.keys(fileRow.locations).find(k => k in drives)].label + ' nhưng chưa kết nối được (kiểm tra mạng, hoặc kết nối lại trong Cài đặt).');
    throw new Error(fileRow.locations?.gdrive ? 'Tệp này chỉ còn trên Google Drive cũ (đã bỏ hỗ trợ Drive). Thêm lại tệp vào app.' : 'Không tìm thấy tệp trên máy này.');
  },

  async objectUrl(fileRow, opts) { return URL.createObjectURL(await this.open(fileRow, opts)); },

  // A short-lived address the browser can stream from, for a file that stays on its drive. null if the drive
  // cannot give one (or is offline): the caller then uses open().
  async streamUrl(fileRow) {
    if (!fileRow?.linked || !navigator.onLine) return null;
    for (const [id, d] of Object.entries(drives)) {
      const key = fileRow.locations?.[id]?.key;
      if (key && d.streamUrl && d.connected()) return d.streamUrl(key);
    }
    return null;
  },

  async removeFile(fileRow) {
    await local.remove(fileRow.locations?.local);
    for (const [id, d] of Object.entries(drives)) {
      const key = fileRow.locations?.[id]?.key;
      if (key && !fileRow.linked && d.connected() && navigator.onLine) await d.removeFile(key).catch(() => {});
    }
    await db.files.delete(fileRow.id);
  },

  _timer: null,
  syncSoon(delay = 4000) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.sync().catch(e => bus.emit('sync:error', e)), delay);
  },

  // Two-way sync with the GitHub repo: merge DB snapshot (newest updatedAt wins, tombstones kept),
  // One sync at a time: a second call while one runs gets the same promise.
  // Progress shows in the tray (after 0.6 s, so a quick no-change sync stays invisible):
  // pull snapshot 0–30 %, merge 30–50 %, push 50–100 %. Cancel is safe:
  // the DB merge is one transaction.
  _running: null,
  sync(opts) {
    if (!this._running) this._running = this._sync(opts).finally(() => { this._running = null; });
    return this._running;
  },
  async _sync({ quiet = false } = {}) {
    const mode = await this.mode();
    if (mode === 'local') return { skipped: 'local' };
    if (!cloudReady()) return { skipped: 'signed-out' };
    if (!navigator.onLine) return { skipped: 'offline' };
    if (!cloud().connected()) {
      if (activeMode !== 'github') return { skipped: 'not-connected' };
      try { await account.accessToken(); } catch { return { skipped: 'not-connected' }; }
    }
    bus.emit('sync:start');
    const task = tasks.start({ label: 'Đồng bộ ' + cloud().label, detail: 'Đang tải dữ liệu từ ' + cloud().label + '…', unit: 'percent', cancellable: true, delay: 600, quiet });
    this.taskId = task.id;
    const signal = task.signal;
    const part = (from, span) => (d, n) => task.update({ done: from + (n ? Math.min(1, d / n) * span : 0) });
    try {
      const remote = await cloud().readSnapshot('hub-db.json', { signal, onProgress: part(0, 30) });
      task.check();
      task.update({ done: 30, detail: 'Đang gộp dữ liệu…' });
      const lastQ = (await db.syncQueue.orderBy('seq').last())?.seq || 0;
      const tombs = mergeTombstones(remote.data?.tombstones, await pendingDeletes(lastQ));
      const merged = {};
      let pulled = 0;
      const changedAll = {}, removedAll = {};
      for (let i = 0; i < SYNCED_TABLES.length; i++) {
        const t = SYNCED_TABLES[i];
        const { all, changed, removed } = await mergeTable(t, remote.data?.tables?.[t], tombs[t]);
        merged[t] = all; changedAll[t] = changed; removedAll[t] = removed; pulled += changed.length + removed.length;
        task.update({ done: 30 + (i + 1) / SYNCED_TABLES.length * 15 });
      }
      task.check();
      // Local file bytes of files deleted on another device.
      for (const id of removedAll.files || []) { const f = await db.files.get(id); if (f?.locations?.local) await local.remove(f.locations.local).catch(() => {}); }
      await withoutSyncHooks(() => db.transaction('rw', SYNCED_TABLES.map(t => db.table(t)), async () => {
        for (const t of SYNCED_TABLES) {
          if (changedAll[t].length) await db.table(t).bulkPut(changedAll[t]);
          if (removedAll[t].length) await db.table(t).bulkDelete(removedAll[t]);
        }
      }));
      task.update({ done: 50, detail: pulled ? `Đã nhận ${pulled} thay đổi · đang đẩy dữ liệu lên ${cloud().label}…` : `Đang đẩy dữ liệu lên ${cloud().label}…` });
      await cloud().writeSnapshot(remote.id, { format: 'my-hub-snapshot', schema: db.verno, at: new Date().toISOString(), tables: merged, tombstones: tombs }, 'hub-db.json', { signal, onProgress: part(50, 40) });
      await db.syncQueue.where('seq').belowOrEqual(lastQ).delete();   // changes made during the sync go next time
      await setSetting('sync.fullPushNeeded', false);

      task.update({ done: 90, detail: 'Đang đồng bộ tiến độ…' });
      const live = await this.syncLive({ quiet: true });
      if (live.signedOut) { task.finish('Thiết bị đã được đăng xuất'); return { signedOut: true }; }
      await setSetting('sync.lastAt', now());
      const result = { pulled: pulled + (live.pulled || 0), uploaded: 0 };
      task.finish(`Nhận ${result.pulled} thay đổi`);
      bus.emit('sync:done', result);
      if (cloud().files) this.syncFiles().catch(e => bus.emit('sync:error', e));
      return result;
    } catch (e) {
      if (task.cancelled || e?.name === 'AbortError') { bus.emit('sync:cancelled'); return { cancelled: true }; }
      if (!navigator.onLine) { task.finish('Mất mạng, sẽ đồng bộ tiếp khi có mạng'); bus.emit('sync:cancelled'); return { skipped: 'offline' }; }
      task.fail(e);
      throw e;
    } finally { this.taskId = null; }
  },

  // Upload the files that are on this device but not on the drive yet (music, books). One task with a
  // byte counter for the whole batch; each file's row is then marked so other devices can fetch it.
  _filesRunning: null,
  syncFiles() {
    if (!this._filesRunning) this._filesRunning = this._syncFiles().finally(() => { this._filesRunning = null; });
    return this._filesRunning;
  },
  async _syncFiles() {
    const mode = activeMode, d = drives[mode];
    if (!d?.files || !d.connected() || !navigator.onLine) return { skipped: true };
    // Derived images (album cover, thumbnail) stay on this device: they are not uploaded to the drive's app folder.
    // Covers and thumbnails uploaded before this rule are removed from the drive (only the app's own copies, by key).
    const d0 = drives[mode];
    for (const f of (await db.files.toArray()).filter(f => DEVICE_ONLY_ROLES.has(f.role) && f.locations?.[mode]?.key && !f.linked)) {
      await d0.removeFile(f.locations[mode].key).catch(() => {});
      const { [mode]: _gone, ...rest } = f.locations;
      await db.files.update(f.id, { locations: rest });
    }
    const todo = (await db.files.toArray()).filter(f => f.locations?.local && !f.locations[mode] && !f.deleted && f.size >= 0 && !DEVICE_ONLY_ROLES.has(f.role));
    if (!todo.length) return { uploaded: 0 };
    const total = todo.reduce((a, f) => a + (f.size || 0), 0);
    const task = tasks.start({ label: 'Tải tệp lên ' + d.label, detail: `${todo.length} tệp`, total: Math.max(1, total), unit: 'bytes', cancellable: true, delay: 600 });
    let done = 0, n = 0;
    try {
      for (const f of todo) {
        task.check();
        const blob = await local.get(f.locations.local);
        if (!blob) continue;   // linked folder not readable right now: try again next time
        const key = d.fileKey(f);
        await d.putFile(key, blob, { signal: task.signal, onProgress: (x) => task.update({ done: done + Math.min(x, f.size || x), detail: `${f.name} · ${n + 1}/${todo.length}` }) });
        done += f.size || blob.size; n++;
        await db.files.update(f.id, { [`locations.${mode}`]: { key } });
      }
      task.finish(`Đã tải lên ${n} tệp`);
      return { uploaded: n };
    } catch (e) {
      if (task.cancelled || e?.name === 'AbortError') return { cancelled: true };
      if (!navigator.onLine) { task.finish('Mất mạng, sẽ tải lên tiếp khi có mạng'); return { skipped: 'offline' }; }
      task.fail(e); throw e;
    }
  },

  // ── Account: first sign-in, devices, deleting the cloud copy ──
  // Is there anything of the user's own (not demo samples) on this device?
  async hasLocalData() {
    for (const t of ['items', 'collections', 'tracks', 'files']) {
      if (await db.table(t).filter(r => !r.deleted && !r.sample && !r.meta?.sample).count()) return true;
    }
    return false;
  },
  // Does the account already hold a library? (hub-db.json in the repo)
  async remoteHasData(mode = activeMode) {
    const r = await (drives[mode] || github).readSnapshot('hub-db.json');
    return !!r.data && Object.values(r.data.tables || {}).some(rows => rows?.length);
  },
  // "Gộp": the next sync merges everything (newer wins) and uploads this device's files.
  async mergeLocal() {
    await setSetting('sync.fullPushNeeded', true);
  },
  // "Dùng dữ liệu của tài khoản": replace this device's library with the snapshot.
  async replaceLocal() {
    const task = tasks.start({ label: 'Đang lấy dữ liệu từ ' + cloud().label, detail: 'Đang tải…', unit: 'percent', cancellable: true });
    try {
      const remote = await cloud().readSnapshot('hub-db.json', { signal: task.signal, onProgress: (d, n) => task.update({ done: n ? d / n * 60 : 30 }) });
      const live = await cloud().readSnapshot('hub-live.json', { signal: task.signal });
      task.check();
      task.update({ done: 65, detail: 'Đang thay dữ liệu trên máy…' });
      const tombs = remote.data?.tombstones || {};
      const keep = new Set((remote.data?.tables?.files || []).map(f => String(f.id)));
      for (const f of await db.files.toArray()) if (!keep.has(String(f.id))) await local.remove(f.locations?.local).catch(() => {});
      const me = await thisDevice();
      const tables = [...SYNCED_TABLES, ...LIVE_TABLES];
      await withoutSyncHooks(() => db.transaction('rw', [...tables.map(t => db.table(t)), db.syncQueue], async () => {
        for (const t of tables) {
          const kp = db.table(t).schema.primKey.keyPath;
          const mine = t === 'files' ? new Map((await db.files.toArray()).map(f => [f.id, f])) : null;
          await db.table(t).clear();
          let rows = ((t in (live.data?.tables || {}) ? live.data.tables : remote.data?.tables)?.[t] || [])
            .filter(r => !(tombs[t]?.[String(r[kp])] >= (r.updatedAt || 0)));
          // Keep local copies of files the account knows (no need to download them again).
          if (mine) rows = rows.map(r => mine.get(r.id)?.locations?.local ? { ...r, locations: { ...r.locations, local: mine.get(r.id).locations.local } } : r);
          if (rows.length) await db.table(t).bulkPut(rows);
        }
        await db.syncQueue.clear();
        await db.devices.put(me);
      }));
      await setSetting('sync.fullPushNeeded', false);
      task.finish(`Đã lấy ${Object.values(remote.data?.tables || {}).reduce((s, r) => s + (r?.length || 0), 0)} bản ghi`);
      bus.emit('sync:done', { pulled: 0, uploaded: 0 });
      return { ok: true };
    } catch (e) {
      if (task.cancelled || e?.name === 'AbortError') return { cancelled: true };
      task.fail(e); throw e;
    }
  },

  // Sign a device out from here: it drops its session on its next sync ('*' = every device).
  async signOutDevice(deviceId) {
    const marks = await getSetting('sync.signouts', {});
    marks[deviceId] = now();
    await setSetting('sync.signouts', marks);
    await this.syncLive({ quiet: true });
  },
  async signOutEverywhere() {
    if (!navigator.onLine) throw new Error('Cần có mạng để đăng xuất mọi thiết bị.');
    const marks = await getSetting('sync.signouts', {});
    marks['*'] = now();
    await setSetting('sync.signouts', marks);
    leavingAll = true;
    let r;
    try { r = await this.syncLive({ quiet: true }); } finally { leavingAll = false; }
    if (r?.skipped && !r.signedOut) throw new Error('Chưa gửi được yêu cầu lên ' + cloud().label + ', thử lại sau.');
    await account.signOut({ reason: 'signout-all' });
  },
  // 'signed-out' for a device whose sign-out request is newer than its last activity.
  async deviceState(d) {
    const marks = await getSetting('sync.signouts', {});
    const at = Math.max(marks[d.id] || 0, marks['*'] || 0);
    return at && at >= (d.lastSeenAt || 0) ? 'signed-out' : 'active';
  },

  // Delete everything My Hub stored in the GitHub repo (library, progress, devices).
  // Local copies stay on this device.
  async deleteCloudData() {
    const task = tasks.start({ label: 'Đang xoá dữ liệu trên ' + cloud().label, detail: 'Đang xoá…', unit: 'items' });
    try { const n = await cloud().deleteAll(); await db.syncQueue.clear(); task.finish(`Đã xoá ${n} tệp dữ liệu`); return n; }
    catch (e) { task.fail(e); throw e; }
  },
};

// ── Live channel: progress + devices ──────────────────────────
// A tiny JSON file synced much more often than the full library, so "where I stopped"
// follows the user between Windows, Android and the APK within seconds.
let liveTimer = null, liveBusy = null, leavingAll = false;
storage.syncLive = async function ({ quiet = false } = {}) {
  if ((await this.mode()) === 'local' || !cloudReady() || !navigator.onLine) return { skipped: true };
  if (!cloud().connected()) { if (activeMode !== 'github') return { skipped: 'not-connected' }; try { await account.accessToken(); } catch { return { skipped: 'not-connected' }; } }
  if (liveBusy) return liveBusy;
  liveBusy = (async () => {
    await touchDevice();
    const remote = await cloud().readSnapshot('hub-live.json');
    // Sign-out requests ({ deviceId | '*': when }): newest per device.
    const marks = { ...(remote.data?.signouts || {}) };
    for (const [k, at] of Object.entries(await getSetting('sync.signouts', {}))) if (!(marks[k] >= at)) marks[k] = at;
    await setSetting('sync.signouts', marks);
    const me = await thisDevice();
    const dropped = !leavingAll && Math.max(marks[me.id] || 0, marks['*'] || 0) > account.signedInAt;
    const out = {}; let pulled = 0;
    for (const t of LIVE_TABLES) {
      const { all, changed } = await mergeTable(t, remote.data?.tables?.[t]);
      if (changed.length) await db.table(t).bulkPut(changed);
      out[t] = all; pulled += changed.length;
    }
    await cloud().writeSnapshot(remote.id, { format: 'my-hub-live', at: new Date().toISOString(), tables: out, signouts: marks }, 'hub-live.json');
    if (dropped) { await account.signOut({ reason: 'remote' }); return { signedOut: true }; }
    await setSetting('sync.liveAt', now());
    if (pulled && !quiet) bus.emit('progress:pulled', { pulled });
    return { pulled };
  })().finally(() => { liveBusy = null; });
  return liveBusy;
};
storage.syncLiveSoon = function (delay = 3000) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => this.syncLive().catch(e => bus.emit('sync:error', e)), delay);
};

// A saved position is pushed within seconds; pause/close pushes immediately.
onProgressSaved(({ flush }) => storage.syncLiveSoon(flush ? 0 : 8000));

// Signed out (here, from another device, or everywhere): back to Local, data stays on the device.
bus.on('account:changed', async ({ signedIn, reason }) => {
  if (signedIn) return;
  if ((await storage.mode()) === 'github') await storage.setMode('local');
  if (reason === 'remote') bus.emit('account:notice', { kind: 'warn', message: 'Thiết bị này đã được đăng xuất từ một máy khác. Dữ liệu vẫn còn trên máy.' });
});

// A change → sync about 8 s later; every 2 min while the app is visible.
const autoOk = async () => (await storage.mode()) !== 'local' && cloudReady() && cloudTokenOk() && navigator.onLine;
let qSoon = 0;   // one check per burst, however many rows a bulk write queued
db.syncQueue.hook('creating', () => { if (qSoon) return; qSoon = setTimeout(async () => { qSoon = 0; if (await autoOk()) storage.syncSoon(8000); }, 0); });
setInterval(async () => { if (document.visibilityState === 'visible' && await autoOk()) storage.sync({ quiet: true }).catch(() => {}); }, 120_000);

// Pull when the app comes to the foreground (open on phone after pausing on Windows),
// push when it goes to the background, and every 45s while visible.
document.addEventListener('visibilitychange', () => storage.syncLiveSoon(0));
setInterval(() => { if (document.visibilityState === 'visible') storage.syncLiveSoon(0); }, 45000);

// Sync when the connection comes back.
window.addEventListener('online', () => { storage.syncLive().catch(() => {}); storage.syncSoon(1000); });
