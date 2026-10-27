// App bootstrap: database, theme, modules, navigation, updates.
import './core/csp.js';   // Content Security Policy first, before any other module adds content
import './core/atob-guard.js';   // tolerant atob with a traceable error
import './core/i18n.js';   // interface language: must run before anything renders
import { APP_NAME, APP_VERSION } from './config.js';
import { tasks } from './core/tasks.js';   // progress tray: loaded first so any task shows at once
import { db, getSetting } from './core/db.js';
import { bus } from './core/bus.js';
import { icon } from './core/icons.js';
import { esc, toast, h } from './core/ui.js';
import { storage } from './core/storage/index.js';
import { folderSources } from './core/storage/folders.js';
import { applyTheme } from './core/theme.js';
import { syncModuleRows, listModules, loadModule, loadService, isEnabled, byId } from './core/registry.js';
import { registerSW, autoCheck } from './core/updater.js';
import { seedIfEmpty } from './core/seed.js';
import { thisDevice } from './core/device.js';
import { account } from './core/account.js';
import { badge as accountBadge } from './core/account-ui.js';
import { params, services as sharedServices } from './core/params.js';
import { initCoreParams } from './core/params-core.js';

const ctx = { db, bus, storage, tasks, toast, go, params, services: sharedServices, appName: APP_NAME, appVersion: APP_VERSION };
let current = null; // { id, mod }

function go(route) {
  if (location.hash.slice(1) === route) render();
  else location.hash = route;
}

// Routes may have a sub-path: #music/album/<id> belongs to the module whose route is 'music'.
const routeHead = () => (location.hash.slice(1) || 'library').split('/')[0];
const routeRest = () => { const r = location.hash.slice(1).split('/').slice(1).join('/'); try { return decodeURIComponent(r); } catch { return r; } };   // a stray % must not break navigation

const OWN_TABS = ['music', 'podcasts', 'books', 'fanfic'];   // apps with their own phone bottom tabs

async function renderNav() {
  const all = (await listModules()).filter(m => m.route && m.status !== 'planned' && (m.core || m.state.enabled));
  const mods = all.filter(m => m.nav !== false);
  const route = routeHead();
  const links = mods.map(m => `<a href="#${m.route}" class="nav-link${m.route === route ? ' active' : ''}" ${m.route === route ? 'aria-current="page"' : ''}>
      ${icon(m.icon)}<span>${esc(m.name)}</span></a>`).join('');
  document.getElementById('nav-links').innerHTML = links;
  // Phone bottom bar (one-handed): the first apps in nav order; ☰ in the app bar opens the full list. Music and Books
  // keep their own bottom tabs, so the bar hides on them.
  const tab = (m) => `<a href="#${m.route}" class="${m.route === route ? 'active' : ''}" ${m.route === route ? 'aria-current="page"' : ''}>${icon(m.icon)}<span>${esc(m.name)}</span></a>`;
  document.getElementById('tabbar').innerHTML = mods.slice(0, 5).map(tab).join('');
  document.body.classList.toggle('own-tabs', OWN_TABS.includes(route));
  const here = all.find(m => m.route === route);   // pages outside the menu (Tài khoản) still name themselves
  const title = document.getElementById('appbar-title');
  if (title && here) title.textContent = here.name;
}

// Phone navigation drawer: ☰ button, swipe from the left edge, tap outside / Esc / pick a page to close.
function initDrawer() {
  const body = document.body, btn = document.getElementById('nav-toggle'), mq = matchMedia('(max-width: 860px)');
  const set = (open) => { open = open && mq.matches; body.classList.toggle('nav-open', open); btn?.setAttribute('aria-expanded', String(open)); };
  btn?.addEventListener('click', () => set(!body.classList.contains('nav-open')));
  // "Ứng dụng" buttons in bottom bars (core tab bar, Music, Books) open the drawer within thumb reach.
  document.addEventListener('click', (e) => { if (e.target.closest('[data-open-nav]')) { e.preventDefault(); set(true); } });
  document.getElementById('nav-scrim')?.addEventListener('click', () => set(false));
  document.getElementById('nav-links')?.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  document.querySelector('.sidebar-foot')?.addEventListener('click', () => set(false));
  window.addEventListener('hashchange', () => set(false));
  mq.addEventListener?.('change', () => set(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  let t = null;
  document.addEventListener('touchstart', (e) => {
    const p = e.touches[0], open = body.classList.contains('nav-open');
    t = (e.touches.length === 1 && mq.matches && (open || (p.clientX < 22 && !body.classList.contains('mnp-open')))) ? { x: p.clientX, y: p.clientY, open } : null;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!t) return;
    const p = e.touches[0], dx = p.clientX - t.x, dy = p.clientY - t.y;
    if (Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > 14) { t = null; return; }
    if (!t.open && dx > 56) { set(true); t = null; } else if (t.open && dx < -56) { set(false); t = null; }
  }, { passive: true });
  document.addEventListener('touchend', () => { t = null; }, { passive: true });
}

async function renderStorageBadge() {
  const s = await storage.status();
  const el = document.getElementById('storage-badge');
  const names = { local: 'Trên máy', dropbox: 'Dropbox', onedrive: 'OneDrive', googledrive: 'Google Drive' };
  const folders = (await folderSources().catch(() => [])).map(k => names[k] || k).join(' + ');
  const b = accountBadge(s, folders);   // core/account-ui.js: account name + sync state, or the storage mode
  el.innerHTML = b.html;
  el.title = b.title;
  el.href = b.href;
}

// Each navigation gets a number: a render overtaken by a newer one (two quick taps) stops at its next await,
// so two modules are never mounted into the page at once.
let renderSeq = 0;
async function render() {
  const my = ++renderSeq;
  const route = routeHead();
  const all = await listModules();
  let m = all.find(x => x.route === route);
  if (!m || m.status === 'planned' || !(await isEnabled(m.id))) {
    m = byId('library');
    // Unknown or disabled route: show the address of the page actually opened, so the title and menu match it.
    if (route !== m.route) history.replaceState(null, '', '#' + m.route);
  }
  if (my !== renderSeq) return;
  // Same module, new sub-path: let it navigate in place (keeps state) when it can.
  if (current?.id === m.id && current.mod.navigate) { await current.mod.navigate(routeRest(), ctx); return; }
  const view = document.getElementById('view');
  try { current?.mod?.unmount?.(); } catch (e) { console.error(e); }
  view.innerHTML = '';
  view.dataset.module = m.id;
  let mod;
  try { mod = await loadModule(m.id); }
  catch (e) { console.error(e); if (my === renderSeq) view.replaceChildren(h(`<div class="empty"><h2>Không mở được ${esc(m.name)}</h2><p>${esc(e.message)}</p></div>`)); return; }
  if (my !== renderSeq) return;
  current = { id: m.id, mod };
  try { await mod.mount(view, ctx, routeRest()); }
  catch (e) { console.error(e); if (my === renderSeq) view.appendChild(h(`<div class="empty"><h2>${esc(m.name)} gặp lỗi</h2><p>${esc(e.message)}</p></div>`)); }
  if (my !== renderSeq) return;
  view.focus({ preventScroll: true });
  await renderNav();
}

// Background services of enabled modules (manifest.service). Started once; a module that is
// disabled or updated gets stop() and, if still enabled, a fresh start().
const services = new Map();
async function startServices() {
  for (const m of await listModules()) {
    if (!m.service) continue;
    const on = await isEnabled(m.id);
    const v = m.state.installedVersion || m.version;
    const run = services.get(m.id);
    if (run && (!on || run.v !== v)) { try { await run.svc.stop?.(); } catch (e) { console.error(e); } services.delete(m.id); }
    if (on && !services.has(m.id)) {
      try { const svc = await loadService(m.id); await svc.start(ctx); services.set(m.id, { svc, v }); }
      catch (e) { console.error('[service]', m.id, e); }
    }
  }
}

const isQuota = (e) => e?.name === 'QuotaExceededError' || /quota|storage.*full|disk.*full/i.test(String(e?.message || e));
// Non-essential start-up work must never stop the app opening, least of all a full disk.
let storageFull = false;
async function safe(fn, label) {
  try { return await fn(); }
  catch (e) { console.warn('boot:' + label, e); if (isQuota(e)) storageFull = true; }
}

async function showStorageFull(err) {
  let est = null;
  try { est = await navigator.storage?.estimate?.(); } catch { /* ignore */ }
  const mb = (b) => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(0) + ' MB';
  const view = document.getElementById('view');
  const box = h(`<div class="empty storage-full"><h2>Bộ nhớ của trình duyệt đã đầy</h2>
    <p>Không ghi thêm được dữ liệu (${esc(err?.name || 'QuotaExceededError')}).${est?.quota ? ` Đang dùng ${mb(est.usage || 0)} trên ${mb(est.quota)}.` : ''} App không tự đặt giới hạn nào; hạn mức này do trình duyệt đặt cho trang. Giải phóng chỗ rồi thử lại:</p>
    <div class="row-actions" style="flex-wrap:wrap;justify-content:center">
      <button class="btn primary" data-a="cache">Xoá bộ đệm (an toàn)</button>
      <button class="btn" data-a="retry">Thử lại</button>
      <button class="btn danger" data-a="all">Xoá toàn bộ dữ liệu app</button></div>
    <p class="muted" data-msg></p></div>`);
  view.replaceChildren(box);
  const say = (s) => { box.querySelector('[data-msg]').textContent = s; };
  box.querySelector('[data-a="cache"]').onclick = async () => {
    try { for (const k of await caches.keys()) if (!/^hub-(shell|mod)/.test(k)) await caches.delete(k); } catch { /* ignore */ }
    try { await db.open(); await db.blobs?.clear?.(); } catch { /* ignore */ }
    try { const root = await navigator.storage.getDirectory(); for await (const [n] of root.entries()) if (/decode|cache|thumb/i.test(n)) await root.removeEntry(n, { recursive: true }); } catch { /* ignore */ }
    say('Đã xoá bộ đệm. Đang tải lại…'); setTimeout(() => location.reload(), 600);
  };
  box.querySelector('[data-a="retry"]').onclick = () => location.reload();
  box.querySelector('[data-a="all"]').onclick = async () => {
    if (!confirm('Xoá TOÀN BỘ dữ liệu của app trên máy này (thư viện, cài đặt, tệp đã lưu)? Dữ liệu đã đồng bộ lên GitHub vẫn còn.')) return;
    try { db.close(); } catch { /* ignore */ }
    try { await new Promise((ok) => { const r = indexedDB.deleteDatabase(db.name); r.onsuccess = r.onerror = r.onblocked = ok; }); } catch { /* ignore */ }
    try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignore */ }
    try { const root = await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await root.removeEntry(n, { recursive: true }); } catch { /* ignore */ }
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
    location.reload();
  };
}

async function boot() {
  try { await db.open(); }
  catch (e) { if (isQuota(e)) { document.body.classList.add('ready'); return showStorageFull(e); } throw e; }
  await safe(() => syncModuleRows(), 'modules');
  await safe(() => thisDevice(), 'device');
  safe(() => account.init(), 'account');         // restore the cached GitHub session (works offline) before routing
  await safe(() => applyTheme(), 'theme');
  await safe(() => initCoreParams(), 'params');   // shared parameters (ctx.params) before any module starts
  await safe(() => seedIfEmpty(), 'seed');
  document.getElementById('app-name').textContent = APP_NAME;
  document.getElementById('app-version').textContent = 'v' + APP_VERSION;

  // Reopening My Hub returns to the page that was open last.
  try { if (!location.hash.slice(1)) { const last = localStorage.getItem('hub.lastRoute'); if (last) history.replaceState(null, '', '#' + last); } } catch { /* storage unavailable */ }
  window.addEventListener('hashchange', () => { try { localStorage.setItem('hub.lastRoute', location.hash.slice(1)); } catch { /* storage unavailable */ } });
  window.addEventListener('hashchange', render);
  bus.on('module:toggled', () => { renderNav(); startServices(); });
  bus.on('module:updated', (u) => {
    toast(u.rollback ? `Đã quay lại ${u.name || u.id} v${u.to}` : `Đã cập nhật ${u.name || u.id} lên ${u.to}`);
    // Modules split over many files (manifest.reloadOnUpdate) need a reload: the browser keeps
    // already-imported sub-files in memory. The Service Worker has the new version cached.
    if (byId(u.id)?.reloadOnUpdate) { setTimeout(() => location.reload(), 1200); return; }
    startServices();
    if (current?.id === u.id) { try { current.mod.unmount?.(); } catch (e) { console.error(e); } current = null; render(); }
  });
  bus.on('storage:mode', renderStorageBadge);
  bus.on('account:changed', (e) => { if (e.reason !== 'refresh') renderStorageBadge(); });
  window.addEventListener('online', renderStorageBadge); window.addEventListener('offline', renderStorageBadge);
  // Sync progress itself is shown by the task tray (storage.sync); the badge mirrors it.
  bus.on('sync:start', () => { const t = document.querySelector('#storage-badge small') || document.querySelector('#storage-badge b'); if (t) t.textContent = 'Đang đồng bộ…'; });
  bus.on('sync:cancelled', renderStorageBadge);
  bus.on('sync:done', (r) => { renderStorageBadge(); if (r.pulled || r.uploaded) toast(`Đồng bộ xong: nhận ${r.pulled}, tải lên ${r.uploaded}`); });
  bus.on('progress:pulled', () => toast('Đã cập nhật tiến độ từ thiết bị khác'));
  bus.on('sync:error', (e) => { renderStorageBadge(); toast('Đồng bộ lỗi: ' + e.message, 'error'); });
  bus.on('update:shell-ready', () => document.getElementById('update-banner').hidden = false);
  bus.on('update:available', () => document.getElementById('update-banner').hidden = false);
  document.getElementById('update-go').onclick = () => { document.getElementById('update-banner').hidden = true; go('apps'); };
  bus.on('item:open', async ({ item, unhandled }) => {
    if (unhandled) return;
    const ownerId = item.moduleId;
    // manifest.openRoute(item) lets a module open the item itself (Books: '#books/read/<id>').
    if (await isEnabled(ownerId)) go(byId(ownerId).openRoute?.(item) || byId(ownerId).route);
    else toast('Chưa có module để mở loại nội dung này. Xem Quản lý ứng dụng.', 'warn');
  });

  // Services (music engine restoring its queue, books catch-up) start alongside the first page
  // instead of before it: restoring a big music queue no longer delays opening the app.
  // The ☰ drawer works from the first frame: it used to be wired only after the first page finished, so a page
  // that waited on the network (Cài đặt listing Google Drive folders) left the button dead.
  safe(() => initDrawer(), 'drawer');
  const svc = safe(() => startServices(), 'services');
  await render();
  await svc;
  await safe(() => renderStorageBadge(), 'badge');
  document.body.classList.add('ready');
  if (storageFull) toast('Bộ nhớ trình duyệt gần đầy: một số thay đổi chưa lưu được. Vào Cài đặt để giải phóng chỗ.', 'warn');
  window.addEventListener('unhandledrejection', (ev) => { if (isQuota(ev.reason)) { ev.preventDefault(); toast('Bộ nhớ trình duyệt đã đầy, không lưu được. Vào Cài đặt → Tài khoản đồng bộ để giải phóng chỗ.', 'error'); } });

  await safe(() => registerSW(), 'sw');
  autoCheck();
  setInterval(autoCheck, 3600e3);
  // Sync waits 20 s so the first screens are usable first: a big library's sync is heavy.
  if (await getSetting('storage.mode', 'local') !== 'local') { storage.syncLiveSoon(0); storage.syncSoon(20000); }
}

boot().catch((e) => {
  console.error(e);
  if (isQuota(e)) { document.body.classList.add('ready'); return showStorageFull(e); }
  document.getElementById('view').appendChild(h(`<div class="empty"><h2>Không khởi động được</h2><p>${esc(e.message)}</p></div>`));
});
