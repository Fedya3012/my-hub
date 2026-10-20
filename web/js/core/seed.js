// Sample-data cleanup (the app no longer seeds any content).
import { db, getSetting, setSetting, withoutSyncHooks } from './db.js';
import { storage } from './storage/index.js';

// No sample data ships with the app. Installs that still hold samples from older builds get
// them removed once, on first start.
export async function seedIfEmpty() {
  if (await getSetting('samples.purged', false)) return false;
  try { await removeSamples(); } catch (e) { console.warn('[seed]', e.message); }
  await setSetting('samples.purged', true);
  return false;
}

export async function removeSamples() {
  const ids = (await db.items.toArray()).filter(i => i.meta?.sample).map(i => i.id);
  const owners = new Set([...ids, ...(await db.albums.filter(a => a.sample).primaryKeys())]);
  for (const f of await db.files.filter(f => owners.has(f.itemId)).toArray()) await storage.removeFile(f, { everywhere: false }).catch(() => {});
  await withoutSyncHooks(async () => {
    await db.items.bulkDelete(ids);
    await db.links.filter(l => l.sample).delete();
    await db.collections.filter(c => c.sample).delete();
    await db.activity.where('itemId').anyOf(ids).delete();
    await db.progress.where('itemId').anyOf(ids).delete();
    await db.devices.filter(d => d.sample).delete();
    // Music demo (tracks, albums, playlists… added by the Music module) carries `sample: 1` too.
    for (const t of ['tracks', 'albums', 'artists', 'plays', 'lyrics']) await db.table(t).filter(r => r.sample).delete();
  });
  return ids.length;
}
