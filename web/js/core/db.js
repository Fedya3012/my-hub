// Database layer (Dexie / IndexedDB). Offline-first: IndexedDB is always the
// working copy; Google Drive (if enabled) only mirrors it. See docs/SCHEMA.md.
const Dexie = window.Dexie;

export const DB_NAME = 'my-hub';

export const db = new Dexie(DB_NAME);

// Version 1 of the schema. Only indexed fields are listed here; every record can
// hold any other fields. To change the schema, add db.version(2).stores({...})
// with an .upgrade() — never edit an existing version.
db.version(1).stores({
  // Every piece of content (song, book, video, podcast episode, note...).
  // Owned by one module (moduleId) but visible to all via the Library.
  items: 'id, type, moduleId, title, *tags, status, favorite, createdAt, updatedAt, lastOpenedAt, deleted, [type+updatedAt]',

  // Physical files behind items. One item can have several (main file, cover, subtitles...).
  // `locations` says where copies live: { local: {...}, gdrive: {...} }.
  files: 'id, itemId, role, hash, mime, syncStatus, updatedAt',

  // Blobs kept inside IndexedDB when OPFS is unavailable (small files, covers).
  blobs: 'id',

  // FileSystemHandles for files the user linked from their own folders (desktop Chrome/Edge).
  handles: 'id',

  // Typed relations between any two items, across modules
  // (e.g. a song "soundtrack-of" a movie, a book "contains" chapters, a playlist "contains" songs).
  links: 'id, fromId, toId, relation, [fromId+relation], [toId+relation]',

  // Groups: playlists, shelves, series, podcast shows. Members are stored in `links` (relation "contains").
  collections: 'id, kind, moduleId, name, updatedAt, deleted',

  // History of what the user did (opened, played, finished...). Drives stats and "Continue".
  activity: '++seq, itemId, moduleId, action, at',

  // Installed modules: version, enabled flag, order, per-module settings.
  modules: 'id, enabled, order',

  // Key/value app settings (storage mode, theme, update policy...).
  settings: 'key',

  // Custom themes created or imported by the user.
  themes: 'id',

  // Outbound changes waiting to be pushed to Google Drive (hybrid / gdrive modes).
  syncQueue: '++seq, entity, entityId, op, createdAt',
});

// Version 2: cross-device playback/reading state.
//   progress: one row per item (key = itemId) holding where the user stopped, on which
//             device and when. Synced on its own fast channel (see storage.syncLive) so
//             pausing a song on Windows and opening the phone resumes at the same spot.
//   devices:  every device that has used this library (name, platform, last seen).
db.version(2).stores({
  progress: 'itemId, moduleId, updatedAt, deviceId',
  devices: 'id, lastSeenAt',
}).upgrade(async (tx) => {
  // Move v1 items.progress into the new table.
  await tx.table('items').toCollection().modify((item) => {
    if (!item.progress) return;
    tx.table('progress').put({ itemId: item.id, moduleId: item.moduleId, ...item.progress, updatedAt: item.updatedAt || Date.now(), deviceId: null });
    delete item.progress;
  });
});

// Version 3: Music module. Music items stay in `items` (so the Library sees them); the
// music-specific detail lives in these tables. See docs/MUSIC.md.
//   tracks:    one row per music item (key = itemId): tags, album/artist ids, audio format
//              (codec, bit depth, sample rate…), ReplayGain, folder. Booleans are 0/1 so they index.
//   albums / artists: ids derived from the normalised names, so two devices importing the same
//              album produce the same row instead of duplicates.
//   plays:     play history (one row per listen) synced across devices -> play counts, "most played".
//   eqPresets: user EQ presets (built-in presets live in code).
//   lyrics:    LRC / plain lyrics per track (key = itemId).
// Playlists reuse `collections` (kind 'playlist' | 'smart') with members in `links` ('contains').
db.version(3).stores({
  tracks: 'itemId, albumId, artistId, *artistIds, albumArtistId, *genres, folder, codec, hiRes, lossless, addedAt, updatedAt, deleted',
  albums: 'id, title, artistId, year, updatedAt, deleted',
  artists: 'id, name, updatedAt, deleted',
  plays: 'id, itemId, at, deviceId',
  eqPresets: 'id, name, updatedAt',
  lyrics: 'itemId, updatedAt',
});

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export const now = () => Date.now();

// Tables whose changes are synced to Drive. activity (high volume) and modules
// (installed code versions differ per device) stay local.
export const SYNCED_TABLES = ['items', 'files', 'links', 'collections', 'themes', 'tracks', 'albums', 'artists', 'plays', 'eqPresets', 'lyrics'];
// Small, frequently changing tables synced on the fast "live" channel (hub-live.json).
// They stamp their own updatedAt/deviceId, so they skip the hooks below.
export const LIVE_TABLES = ['progress', 'devices'];

// Stamp updatedAt / rev on every write and queue the change for sync.
let syncHooksPaused = false;
export function withoutSyncHooks(fn) {
  syncHooksPaused = true;
  return Promise.resolve(fn()).finally(() => { syncHooksPaused = false; });
}

for (const name of SYNCED_TABLES) {
  const table = db.table(name);
  table.hook('creating', function (key, obj, tx) {
    if (syncHooksPaused) return;
    obj.updatedAt = obj.updatedAt || now();
    obj.rev = (obj.rev || 0) + 1;
    tx.on('complete', () => queueChange(name, key ?? obj.id, 'put'));
  });
  table.hook('updating', function (mods, key, obj, tx) {
    if (syncHooksPaused) return;
    tx.on('complete', () => queueChange(name, key, 'put'));
    return { updatedAt: now(), rev: (obj.rev || 0) + 1 };
  });
  table.hook('deleting', function (key, obj, tx) {
    if (syncHooksPaused) return;
    tx.on('complete', () => queueChange(name, key, 'delete'));
  });
}

// Changes are batched: a bulk write of any size (10 000+ rows) queues them with one settings read
// and one bulkAdd, outside the writing transaction (one Dexie call per row overflowed the stack).
let pendingQ = [], flushQ = null;
function queueChange(entity, entityId, op) {
  pendingQ.push({ entity, entityId, op, createdAt: now(), attempts: 0 });
  flushQ ||= setTimeout(async () => {
    const batch = pendingQ; pendingQ = []; flushQ = null;
    try {
      const mode = (await db.settings.get('storage.mode'))?.value || 'local';
      if (mode !== 'local') await db.syncQueue.bulkAdd(batch);
    } catch (e) { console.error('[sync queue]', e); }
  }, 0);
}

// Settings helpers
export async function getSetting(key, fallback) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

// Items: soft delete keeps a tombstone so the deletion can sync to other devices.
export async function softDeleteItem(id) {
  await db.items.update(id, { deleted: 1 });
}

export async function logActivity(itemId, moduleId, action, data) {
  await db.activity.add({ itemId, moduleId, action, at: now(), data });
  if (action === 'open' || action === 'play') await db.items.update(itemId, { lastOpenedAt: now() });
}

export async function linkItems(fromId, toId, relation, extra = {}) {
  const id = uid();
  await db.links.put({ id, fromId, toId, relation, createdAt: now(), ...extra });
  return id;
}

export async function relatedItems(itemId) {
  const [out, inc] = await Promise.all([
    db.links.where('fromId').equals(itemId).toArray(),
    db.links.where('toId').equals(itemId).toArray(),
  ]);
  const ids = [...out.map(l => l.toId), ...inc.map(l => l.fromId)];
  const items = await db.items.bulkGet(ids);
  return [...out.map((l, i) => ({ link: l, item: items[i], dir: 'out' })),
          ...inc.map((l, i) => ({ link: l, item: items[out.length + i], dir: 'in' }))]
    .filter(r => r.item && !r.item.deleted);
}

// Full backup as plain JSON (blobs excluded — they are files, not data).
export async function exportAll({ includeActivity = true } = {}) {
  const tables = ['items', 'files', 'links', 'collections', 'modules', 'settings', 'themes', 'progress', 'devices',
    'tracks', 'albums', 'artists', 'plays', 'eqPresets', 'lyrics'];
  if (includeActivity) tables.push('activity');
  const data = {};
  for (const t of tables) data[t] = await db.table(t).toArray();
  return { format: 'my-hub-backup', schema: db.verno, exportedAt: new Date().toISOString(), data };
}

// mode: 'merge' keeps newer record by updatedAt; 'replace' wipes tables first.
export async function importAll(backup, { mode = 'merge' } = {}) {
  if (!backup || backup.format !== 'my-hub-backup') throw new Error('Tệp không phải bản sao lưu My Hub.');
  const tables = Object.keys(backup.data).filter(t => db.tables.some(x => x.name === t));
  let count = 0;
  // Imported records keep their own updatedAt/rev; the whole DB is marked for a full sync instead.
  await withoutSyncHooks(() => db.transaction('rw', tables.map(t => db.table(t)), async () => {
    for (const t of tables) {
      const table = db.table(t);
      const rows = backup.data[t] || [];
      if (mode === 'replace') await table.clear();
      if (mode === 'merge' && table.schema.primKey.name !== 'seq') {
        const keys = rows.map(r => r[table.schema.primKey.keyPath]);
        const existing = await table.bulkGet(keys);
        const newer = rows.filter((r, i) => !existing[i] || (r.updatedAt || 0) >= (existing[i].updatedAt || 0));
        await table.bulkPut(newer);
        count += newer.length;
      } else {
        await table.bulkPut(rows);
        count += rows.length;
      }
    }
  }));
  await setSetting('sync.fullPushNeeded', true);
  return count;
}
