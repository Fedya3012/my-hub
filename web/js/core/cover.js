// Quick View for the cover screen (Galaxy Z Flip Flex Window) and other tiny windows: while
// <body data-posture="cover"> the normal shell is hidden and this shows one card at a time, big buttons, swipe
// sideways between cards. Rules: docs/FOLDABLE.md.
// Any app adds cards from its service.js (loaded at start, unlike index.js):
//   extend('cover.cards', async (ctx) => ({ id, app, icon, title, sub, percent, order, actions: [{ label, icon, primary, full, run }] }))
// full: true switches to the normal app on this screen first (the action opens a page). Ids are unique: an item card
// uses 'continue-<itemId>' so it replaces Library's generic "Tiếp tục" card for that item.
// Return null to show nothing, or an array for several cards. Call bus.emit('cover:refresh') when the data changes;
// cards are rebuilt only then (and on progress/sync/update events), never on a timer.
import { bus } from './bus.js';
import { db, getSetting } from './db.js';
import { extend, extensions } from './extensions.js';
import { icon } from './icons.js';
import { esc, fmtAgo } from './ui.js';
import { debounce } from './perf.js';
import { currentPosture } from './posture.js';
import { byId } from './registry.js';
import { APP_VERSION } from '../config.js';

let el = null, ctx = null, cards = [], full = false;

function ensure() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'cover';
  el.className = 'cover-view';
  el.setAttribute('aria-label', 'Xem nhanh');
  el.innerHTML = `<div class="cv-strip" role="list"></div><div class="cv-foot"><div class="cv-dots"></div>
    <button type="button" class="cv-full">${icon('grid')}<span>Giao diện đầy đủ</span></button></div>`;
  el.querySelector('.cv-full').onclick = () => setFull(true);
  const strip = el.querySelector('.cv-strip');
  strip.addEventListener('scroll', debounce(() => dots(Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth))), 60), { passive: true });
  strip.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const [ci, ai] = b.dataset.act.split(':').map(Number);
    const a = cards[ci]?.actions?.[ai];
    if (!a) return;
    b.disabled = true;
    if (a.full) setFull(true);   // the action opens a page: show the normal app on this screen
    try { await a.run?.(ctx); } catch (err) { ctx?.toast?.(err.message || String(err), 'error'); }
    b.disabled = false;
    refresh();
  });
  document.body.appendChild(el);
  return el;
}

// "Giao diện đầy đủ": the normal app on the cover screen, with a round button back to Quick View.
function setFull(v) {
  full = v;
  document.body.classList.toggle('cover-full', v);
  if (!v) refresh();
}

function dots(i) {
  const d = el?.querySelector('.cv-dots');
  if (!d) return;
  d.innerHTML = cards.length > 1 ? cards.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('') : '';
}

function cardHtml(c, ci) {
  const acts = (c.actions || []).slice(0, 3);
  return `<article class="cv-card" role="listitem">
    <header class="cv-app">${icon(c.icon || 'grid')}<span>${esc(c.app)}</span></header>
    <h2 class="cv-title">${esc(c.title)}</h2>
    ${c.sub ? `<p class="cv-sub">${esc(c.sub)}</p>` : ''}
    ${c.percent != null ? `<div class="cv-bar"><i style="width:${Math.max(0, Math.min(100, c.percent))}%"></i></div>` : ''}
    <div class="cv-actions">${acts.map((a, ai) => `<button type="button" class="cv-btn${a.primary ? ' primary' : ''}" data-act="${ci}:${ai}" aria-label="${esc(a.label)}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`).join('')}</div>
  </article>`;
}

async function build() {
  const out = [];
  for (const fn of extensions('cover.cards')) {
    try { const r = await fn(ctx); if (r) out.push(...(Array.isArray(r) ? r : [r])); }
    catch (e) { console.warn('[cover]', e); }
  }
  // Same id from two providers (e.g. Books' own card and Library's "Tiếp tục" for that book): the lower order wins.
  out.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  const seen = new Set();
  return out.filter(c => !c.id || (!seen.has(c.id) && seen.add(c.id)));
}

// Flex Window widget (APK only, CoverWidgetProvider.java): the first two cards with a route, written only when they
// change (percent in 5% steps, so playback does not rewrite it every few seconds). Runs whatever the posture, since the widget shows while the phone is closed.
const NativeP = () => window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.Posture;
let widgetLast = '';
async function syncWidget(list) {
  const P = NativeP();
  if (!P?.setCoverWidget) return;
  const rows = list.filter(c => c.route && c.widget !== false).slice(0, 2)
    .map(c => ({ app: c.app, title: c.title, sub: c.sub || '', route: c.route, ...(c.percent != null ? { percent: Math.round(c.percent / 5) * 5 } : {}) }));
  const json = JSON.stringify(rows);
  if (json === widgetLast) return;
  widgetLast = json;
  try { await P.setCoverWidget({ rows }); } catch { /* older APK */ }
}

const refresh = debounce(async () => {
  const onCover = currentPosture() === 'cover' && !full && !document.hidden;
  if (!onCover && !NativeP()) return;
  const list = await build();
  syncWidget(list);
  if (!onCover) return;
  ensure();
  cards = list;
  const strip = el.querySelector('.cv-strip');
  strip.innerHTML = cards.length ? cards.map(cardHtml).join('')
    : `<article class="cv-card" role="listitem"><header class="cv-app">${icon('library')}<span>Thư viện</span></header>
       <h2 class="cv-title">Chưa có gì đang dở</h2><p class="cv-sub">Mở máy để xem toàn bộ Thư viện.</p></article>`;
  dots(Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth)));
}, 250);

// Built-in cards of the core apps: Library ("Tiếp tục") and App Manager (updates and sync).
function coreCards() {
  extend('cover.cards', async (c) => {
    const rows = (await db.progress.toArray()).filter(p => p.state !== 'finished' && (p.percent || 0) < 98)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 2);
    const out = [];
    for (const p of rows) {
      const item = await db.items.get(p.itemId);
      if (!item || item.deletedAt) continue;
      out.push({
        id: 'continue-' + item.id, app: 'Thư viện', icon: 'clock', order: 30,
        route: byId(item.moduleId)?.openRoute?.(item) || byId(item.moduleId)?.route || 'library',
        title: item.title, sub: `${p.label || ''} · ${fmtAgo(p.updatedAt)}`, percent: p.percent || 0,
        actions: [{ label: 'Mở', icon: 'play', primary: true, full: true, run: () => bus.emit('item:open', { item }) }],
      });
    }
    return out;
  });
  extend('cover.cards', async (c) => {
    const remote = await getSetting('update.remote', null);
    const newer = remote?.app && remote.app !== APP_VERSION ? remote.app : null;
    const mode = await getSetting('storage.mode', 'local');
    const last = await getSetting('sync.lastAt', 0);
    const actions = [];
    if (mode !== 'local') actions.push({ label: 'Đồng bộ ngay', icon: 'refresh', primary: true, run: () => c.storage.syncSoon(0) });
    if (!newer) actions.push({ label: 'Kiểm tra cập nhật', icon: 'refresh', primary: mode === 'local', run: async () => { await (await import('./updater.js')).checkForUpdates(); } });
    if (newer) actions.push({ label: 'Xem bản mới', icon: 'download', full: true, run: () => c.go('apps') });
    return {
      id: 'system', app: 'Quản lý ứng dụng', icon: 'apps', order: 90, route: 'apps', widget: false,
      title: newer ? `Có bản mới ${newer}` : `My Hub ${APP_VERSION}`,
      sub: mode === 'local' ? 'Lưu trên máy này' : last ? `Đồng bộ ${fmtAgo(last)}` : 'Chưa đồng bộ lần nào',
      actions,
    };
  });
}

export function initCover(context) {
  ctx = context;
  coreCards();
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'cv-back'; back.setAttribute('aria-label', 'Xem nhanh');
  back.innerHTML = icon('grid');
  back.onclick = () => setFull(false);
  document.body.appendChild(back);
  bus.on('posture:change', ({ posture }) => { if (posture !== 'cover') setFull(false); refresh(); });
  for (const ev of ['cover:refresh', 'progress:changed', 'progress:pulled', 'sync:done', 'update:checked', 'item:changed'])
    bus.on(ev, () => refresh());
  document.addEventListener('visibilitychange', () => refresh());
  refresh();
  // A tap on the widget opens the app at that row's page.
  const P = NativeP();
  if (P?.takeRoute) {
    const goTo = (r) => { if (r?.route != null) { setFull(true); ctx.go(r.route || 'library'); } };
    P.takeRoute().then(goTo).catch(() => {});
    P.addListener('route', goTo);
  }
}
