// Module registry. Adding a module = create js/modules/<id>/manifest.js + index.js,
// import the manifest here, and list its files in version.json.
import appManager from '../modules/app-manager/manifest.js';
import library from '../modules/library/manifest.js';
import settings from '../modules/settings/manifest.js';
import music from '../modules/music/manifest.js';
import accountPage from '../modules/account/manifest.js';
import books from '../modules/books/manifest.js';
import fanfic from '../modules/fanfic/manifest.js';
import guides from '../modules/guides/manifest.js';
import { db, now } from './db.js';

export const cmpVer = (a = '0', b = '0') => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 4; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

export const MANIFESTS = [library, appManager, settings, music, books, fanfic, guides, accountPage];

export const byId = id => MANIFESTS.find(m => m.id === id);

// Make sure every known module has a row in db.modules (first run, or a new module shipped).
export async function syncModuleRows() {
  const rows = await db.modules.toArray();
  const have = new Set(rows.map(r => r.id));
  for (const m of MANIFESTS) {
    if (have.has(m.id)) {
      // A new app version ships every module's code with it: a row still on an older version
      // would only show a phantom "update" in App Manager.
      const row = rows.find(r => r.id === m.id);
      if (m.status !== 'planned' && row.installedVersion && cmpVer(m.version, row.installedVersion) > 0) {
        await db.modules.update(m.id, { installedVersion: m.version, previousVersion: null, updatedAt: now() });
      }
      continue;
    }
    await db.modules.put({
      id: m.id,
      installedVersion: m.status === 'planned' ? null : m.version,
      enabled: m.status === 'planned' ? 0 : 1,
      order: m.order ?? 50,
      settings: {},
      installedAt: now(),
    });
  }
}

// Manifest + DB state merged, sorted by order.
export async function listModules() {
  const rows = await db.modules.toArray();
  return MANIFESTS.map(m => ({ ...m, state: rows.find(r => r.id === m.id) || {} }))
    .sort((a, b) => (a.state.order ?? a.order) - (b.state.order ?? b.order));
}

export async function isEnabled(id) {
  const m = byId(id);
  if (!m || m.status === 'planned') return false;
  if (m.core) return true;
  return !!(await db.modules.get(id))?.enabled;
}

const loaded = new Map();

// Load a module's code. The ?v= query pins the version so the Service Worker
// serves the cached copy of exactly that version (see sw.js, updater.js).
export async function loadModule(id) {
  const m = byId(id);
  const v = (await db.modules.get(id))?.installedVersion || m.version;
  const key = id + '@' + v;
  if (!loaded.has(key)) loaded.set(key, import(`../modules/${id}/index.js?v=${v}`));
  return loaded.get(key);
}

// Optional background part of a module (manifest.service, e.g. the music engine + mini player).
// It is started once at boot and keeps running while the user moves between modules.
export async function loadService(id) {
  const m = byId(id);
  const v = (await db.modules.get(id))?.installedVersion || m.version;
  const key = id + '@' + v + ':service';
  if (!loaded.has(key)) loaded.set(key, import(`../modules/${id}/${m.service}?v=${v}`));
  return loaded.get(key);
}

export function forgetLoaded(id) {
  for (const k of loaded.keys()) if (k.startsWith(id + '@')) loaded.delete(k);
}
