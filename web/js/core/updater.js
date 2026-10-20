// Update system.
// Two layers, both driven from App Manager:
//   1. Shell (index.html, core JS, CSS): classic Service Worker update. A new sw.js
//      installs in the background, waits, and takes over when the user taps "Cập nhật".
//   2. Modules: each module has its own version in version.json. Updating one module
//      caches only its files (cache "hub-mod-<id>-<version>") and reloads that module,
//      no full app reinstall. Old module caches are deleted.
// Works the same inside the APK (Bubblewrap/TWA runs the PWA in Chrome with its SW).
import { APP_VERSION, VERSION_URL } from '../config.js';
import { db, getSetting, setSetting, now } from './db.js';
import { bus } from './bus.js';
import { MANIFESTS, forgetLoaded, loadModule } from './registry.js';

export const cmpVer = (a = '0', b = '0') => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 4; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

let registration = null;
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
  const res = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('Không đọc được version.json (' + res.status + ')');
  const remote = await res.json();
  const rows = await db.modules.toArray();
  const updates = [];
  if (cmpVer(remote.app, APP_VERSION) > 0) {
    updates.push({ kind: 'shell', id: 'shell', name: 'Lõi ứng dụng', from: APP_VERSION, to: remote.app, changelog: remote.changelog || [] });
  }
  for (const [id, info] of Object.entries(remote.modules || {})) {
    const row = rows.find(r => r.id === id);
    const known = MANIFESTS.some(m => m.id === id);
    if (!row?.installedVersion) continue; // planned/uninstalled modules are not "updates"
    if (cmpVer(info.version, row.installedVersion) > 0) {
      updates.push({ kind: known ? 'module' : 'new-module', id, name: info.name || id, from: row.installedVersion, to: info.version, files: info.files || [], changelog: info.changelog || [], minApp: info.minApp });
    }
  }
  await setSetting('update.lastCheck', now());
  await setSetting('update.remote', remote);
  bus.emit('update:checked', updates);
  return { remote, updates };
}

export async function applyModuleUpdate(u) {
  if (u.minApp && cmpVer(APP_VERSION, u.minApp) < 0) throw new Error(`Cần cập nhật lõi ứng dụng lên ${u.minApp} trước.`);
  const r = await askSW({ type: 'CACHE_MODULE', id: u.id, version: u.to, files: u.files });
  if (!r.ok) throw new Error('Không tải được tệp module: ' + r.error);
  await db.modules.update(u.id, { installedVersion: u.to, updatedAt: now(), previousVersion: u.from });
  forgetLoaded(u.id);
  const mod = await loadModule(u.id);
  if (mod.migrate) await mod.migrate({ from: u.from, to: u.to, db });
  bus.emit('module:updated', u);
}

export async function applyShellUpdate() {
  if (!registration) throw new Error('Service Worker chưa hoạt động trong môi trường này.');
  if (!registration.waiting) await registration.update();
  if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  else throw new Error('Bản mới đang tải, hãy thử lại sau ít phút.');
}

export async function rollbackModule(id) {
  const row = await db.modules.get(id);
  if (!row?.previousVersion) throw new Error('Không có phiên bản trước để quay lại.');
  await db.modules.update(id, { installedVersion: row.previousVersion, previousVersion: row.installedVersion });
  forgetLoaded(id);
  bus.emit('module:updated', { id, to: row.previousVersion });
}

// Called on start and every 6h while the app is open. Honors the user's policy.
export async function autoCheck() {
  const policy = await getSetting('update.policy', 'ask');   // auto | ask | manual
  if (policy === 'manual' || !navigator.onLine) return;
  const last = await getSetting('update.lastCheck', 0);
  if (now() - last < 6 * 3600e3) return;
  try {
    const { updates } = await checkForUpdates();
    if (policy === 'auto') for (const u of updates.filter(u => u.kind === 'module')) await applyModuleUpdate(u);
  } catch (e) { console.warn('[updater]', e.message); }
}
