// Update system.
// Two layers, both driven from App Manager:
//   1. Shell (index.html, core JS, CSS): classic Service Worker update. A new sw.js
//      installs in the background, waits, and takes over when the user taps "Cập nhật".
//   2. Modules: each module has its own version in version.json. Updating one module
//      caches only its files (cache "hub-mod-<id>-<version>") and reloads that module,
//      no full app reinstall. Old module caches are deleted.
// The Windows (Electron) and Android (Capacitor) apps carry every file inside the installer:
// there a module cannot update on its own, the whole app updates (Windows: built-in updater,
// Android: Obtainium), so only the app version is compared.
import { APP_VERSION, VERSION_URL } from '../config.js';
import { db, getSetting, setSetting, now } from './db.js';
import { bus } from './bus.js';
import { MANIFESTS, byId, cmpVer, forgetLoaded, loadModule } from './registry.js';

export { cmpVer };

let registration = null;
const DESKTOP_VERSION_URL = 'https://raw.githubusercontent.com/Fedya3012/my-hub/main/web/version.json';
// 'windows' | 'android' | null (browser / installed PWA)
export const nativeApp = () => window.hubDesktop ? 'windows' : window.Capacitor?.isNativePlatform?.() ? 'android' : null;

// version.json changelogs mix plain strings and { version, date, notes } groups.
// Returns groups; string entries are gathered into one group without a version.
// With `after`, groups whose version is not newer than it are dropped.
export function changelogGroups(list = [], after = null) {
  const groups = [], loose = [];
  for (const c of list) {
    if (typeof c === 'string') loose.push(c);
    else if (c && Array.isArray(c.notes)) groups.push({ version: c.version || '', date: c.date || '', notes: c.notes });
  }
  const out = after ? groups.filter(g => !g.version || cmpVer(g.version, after) > 0) : groups;
  // Old plain-string notes have no version: once versioned groups exist they are history, not news.
  if (loose.length && !(after && groups.length)) out.push({ version: '', date: '', notes: loose });
  return out;
}

// Updates found by the last check and not applied yet (App Manager shows them when it opens).
export let pendingUpdates = [];

export const swState = { supported: 'serviceWorker' in navigator, active: false, waiting: false, error: null };

export async function registerSW() {
  // The Android app (Capacitor) ships its files inside the APK; new versions arrive as a new
  // APK through Obtainium, so there is no Service Worker there.
  if (window.Capacitor?.isNativePlatform?.()) { swState.supported = false; swState.error = 'Ứng dụng Android: bản mới cài qua Obtainium.'; return; }
  if (!swState.supported) return;
  try {
    registration = await navigator.serviceWorker.register('sw.js');
    swState.active = !!registration.active;
    if (registration.waiting) markWaiting();
    registration.addEventListener('updatefound', () => {
      const w = registration.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) markWaiting();
      });
    });
    // Reload only when a new worker replaces an old one. On the very first visit the worker
    // claims the page without any change in code, and a reload would cut off first-run work.
    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return; reloading = true; location.reload();
    });
  } catch (e) {
    swState.supported = false;
    swState.error = e.message;
  }
}

function markWaiting() {
  swState.waiting = true;
  bus.emit('update:shell-ready');
}

function askSW(msg) {
  const ctrl = navigator.serviceWorker?.controller;
  if (!ctrl) return Promise.resolve({ ok: true, noSW: true });
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = e => resolve(e.data);
    ctrl.postMessage(msg, [ch.port2]);
    setTimeout(() => resolve({ ok: false, error: 'timeout' }), 30000);
  });
}

// Compare what is installed with version.json on the server.
export async function checkForUpdates() {
  // The Windows and Android apps serve their own bundled files, so their version.json is always the installed one: ask GitHub.
  const native = nativeApp();
  const res = await fetch((native ? DESKTOP_VERSION_URL : VERSION_URL) + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('Không đọc được version.json (' + res.status + ')');
  const remote = await res.json();
  const rows = await db.modules.toArray();
  const updates = [];
  if (cmpVer(remote.app, APP_VERSION) > 0) {
    updates.push({ kind: 'shell', id: 'shell', name: 'Lõi ứng dụng', from: APP_VERSION, to: remote.app, changelog: remote.changelog || [] });
  }
  if (!native) for (const [id, info] of Object.entries(remote.modules || {})) {
    const row = rows.find(r => r.id === id);
    const known = MANIFESTS.some(m => m.id === id);
    if (!row?.installedVersion) continue; // planned/uninstalled modules are not "updates"
    if (cmpVer(info.version, row.installedVersion) > 0) {
      updates.push({ kind: known ? 'module' : 'new-module', id, name: info.name || id, from: row.installedVersion, to: info.version, files: info.files || [], changelog: info.changelog || [], minApp: info.minApp });
    }
  }
  await setSetting('update.lastCheck', now());
  await setSetting('update.remote', remote);
  pendingUpdates = updates;
  bus.emit('update:checked', updates);
  return { remote, updates };
}

export async function applyModuleUpdate(u) {
  if (u.minApp && cmpVer(APP_VERSION, u.minApp) < 0) throw new Error(`Cần cập nhật lõi ứng dụng lên ${u.minApp} trước.`);
  if (nativeApp()) throw new Error('Trong ứng dụng Windows/Android, module được cập nhật cùng bản app mới.');
  const r = await askSW({ type: 'CACHE_MODULE', id: u.id, version: u.to, keep: u.from, files: u.files });
  if (!r.ok) throw new Error('Không tải được tệp module: ' + r.error);
  if (r.noSW) throw new Error('Service Worker chưa hoạt động nên chưa tải được bản mới của module. Hãy tải lại trang rồi thử lại.');
  await db.modules.update(u.id, { installedVersion: u.to, updatedAt: now(), previousVersion: u.from });
  forgetLoaded(u.id);
  // The new files load from the new version's cache, so the version is set first; a failed migration
  // puts the old version back, so it runs again on the next try instead of being skipped for good.
  try {
    const mod = await loadModule(u.id);
    if (mod.migrate) await mod.migrate({ from: u.from, to: u.to, db });
  } catch (e) {
    await db.modules.update(u.id, { installedVersion: u.from, previousVersion: undefined });
    forgetLoaded(u.id);
    throw e;
  }
  pendingUpdates = pendingUpdates.filter(x => x.id !== u.id);
  bus.emit('module:updated', u);
}

// Returns a message to show when the update continues outside this page (Windows, Android);
// in the browser the page reloads once the new Service Worker takes over.
export async function applyShellUpdate(to) {
  if (window.hubDesktop) {   // Windows: download the new installer (progress/restart dialog come from the shell)
    const r = await window.hubDesktop.installUpdate();
    if (r.portable) return 'Bản portable không tự cập nhật: đã mở trang tải, hãy tải bản mới.';
    if (r.available) return `Đang tải bản ${r.version} ở nền. Xong sẽ hỏi khởi động lại.`;
    throw new Error('Chưa thấy bản cài mới trên GitHub (có thể đang build), thử lại sau vài phút.');
  }
  if (nativeApp() === 'android') return `Mở Obtainium để cài bản ${to || 'mới'} (Obtainium lấy APK từ GitHub Releases).`;
  if (!registration) throw new Error('Service Worker chưa hoạt động trong môi trường này.');
  if (!registration.waiting) await registration.update();
  if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  else throw new Error('Bản mới đang tải, hãy thử lại sau ít phút.');
}

export async function rollbackModule(id) {
  const row = await db.modules.get(id);
  if (!row?.previousVersion) throw new Error('Không có phiên bản trước để quay lại.');
  // The old files must still be in the module's cache, or the "rollback" would keep running the new code.
  const kept = 'caches' in window && await caches.has(`hub-mod-${id}-${row.previousVersion}`);
  if (!kept) throw new Error(`Không còn tệp của v${row.previousVersion} trên máy này nên không quay lại được.`);
  await db.modules.update(id, { installedVersion: row.previousVersion, previousVersion: row.installedVersion });
  forgetLoaded(id);
  bus.emit('module:updated', { id, name: byId(id)?.name, to: row.previousVersion, rollback: true });
}

// Called on start and every 6h while the app is open. Honors the user's policy.
export async function autoCheck() {
  const policy = await getSetting('update.policy', 'ask');   // auto | ask | manual
  if (policy === 'manual' || !navigator.onLine) return;
  const last = await getSetting('update.lastCheck', 0);
  if (now() - last < 6 * 3600e3) return;
  try {
    const { updates } = await checkForUpdates();
    if (policy === 'auto') {
      for (const u of updates.filter(u => u.kind === 'module')) {
        try { await applyModuleUpdate(u); } catch (e) { console.warn('[updater]', u.id, e.message); }
      }
    }
    if (pendingUpdates.length) bus.emit('update:available', pendingUpdates);
  } catch (e) { console.warn('[updater]', e.message); }
}
