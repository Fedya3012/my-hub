// App Manager: modules (version, enable/disable, order), updates, install/APK status.
import { db, getSetting, setSetting } from '../../core/db.js';
import { listModules } from '../../core/registry.js';
import { CONTENT_TYPES } from '../../core/content-types.js';
import { swState, checkForUpdates, applyModuleUpdate, applyShellUpdate, rollbackModule } from '../../core/updater.js';
import { icon } from '../../core/icons.js';
import { cleanDataAction } from '../../core/storage/cleanup.js';
import { esc, fmtAgo, toast, confirmBox } from '../../core/ui.js';

let root, ctx, updates = [], offs = [];

const POLICIES = { auto: 'Tự động cập nhật module', ask: 'Hỏi trước khi cập nhật', manual: 'Chỉ khi tôi bấm kiểm tra' };

function displayMode() {
  if (document.referrer.startsWith('android-app://')) return { label: 'Ứng dụng Android (APK/TWA)', apk: true };
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return { label: 'Đã cài như ứng dụng', apk: false };
  if (window.top !== window.self) return { label: 'Bản xem thử nhúng', apk: false, embedded: true };
  return { label: 'Trình duyệt', apk: false };
}

export async function mount(el, context) {
  root = el; ctx = context;
  await render();
  offs.push(ctx.bus.on('module:updated', render));
  offs.push(ctx.bus.on('update:shell-ready', render));
}
export function unmount() { offs.forEach(f => f()); offs = []; }

async function render() {
  const [mods, policy, lastCheck, counts] = await Promise.all([
    listModules(), getSetting('update.policy', 'ask'), getSetting('update.lastCheck', 0), itemCounts(),
  ]);
  const dm = displayMode();
  const active = mods.filter(m => m.status !== 'planned');
  root.innerHTML = `
  <section class="page am">
    <header class="page-head">
      <div><p class="eyebrow">Hệ thống</p><h1>Quản lý ứng dụng</h1></div>
      <div class="head-actions"><button class="btn primary" data-act="check">${icon('refresh')}<span>Kiểm tra cập nhật</span></button></div>
    </header>

    <div class="sys-grid">
      <div class="panel">
        <h2 class="panel-title">${icon('apps')}Phiên bản</h2>
        <dl class="kv">
          <dt>Ứng dụng</dt><dd><code>${esc(ctx.appName)} ${esc(ctx.appVersion)}</code></dd>
          <dt>Module đang chạy</dt><dd class="num">${active.length} / ${mods.length}</dd>
          <dt>Kiểm tra lần cuối</dt><dd>${fmtAgo(lastCheck)}</dd>
          <dt>Chính sách</dt><dd><select id="am-policy" aria-label="Chính sách cập nhật">${Object.entries(POLICIES).map(([k, v]) => `<option value="${k}" ${k === policy ? 'selected' : ''}>${v}</option>`).join('')}</select></dd>
        </dl>
      </div>
      <div class="panel">
        <h2 class="panel-title">${icon('device')}Cài đặt & ngoại tuyến</h2>
        <dl class="kv">
          <dt>Đang chạy dưới dạng</dt><dd>${dm.label}</dd>
          <dt>Service Worker</dt><dd>${swState.active ? '<span class="pill ok">Đang hoạt động</span>' : swState.supported ? '<span class="pill">Đang khởi tạo</span>' : `<span class="pill warn">Không khả dụng${dm.embedded ? ' ở bản xem thử' : ''}</span>`}</dd>
          <dt>Dùng offline</dt><dd>${swState.active ? 'Có' : 'Khi chạy từ máy chủ HTTPS'}</dd>
          <dt>Đóng gói APK</dt><dd>${dm.apk ? '<span class="pill ok">Đang chạy trong APK</span>' : 'Sẵn sàng cho PWABuilder / Bubblewrap'}</dd>
        </dl>
      </div>
    </div>

    <section id="am-updates">${renderUpdates()}</section>

    <h2 class="section-title">${icon('grid')}Module</h2>
    <ul class="mod-list">${mods.map((m, i) => modRow(m, i, mods.length, counts)).join('')}</ul>
    <p class="hint">Thêm module mới: tạo thư mục <code>js/modules/&lt;id&gt;/</code> có <code>manifest.js</code> và <code>index.js</code>, khai báo trong <code>js/core/registry.js</code> và <code>version.json</code>. Xem docs/MODULES.md.</p>
  </section>`;

  root.querySelector('[data-act="check"]').onclick = check;
  root.querySelector('#am-policy').onchange = async (e) => { await setSetting('update.policy', e.target.value); ctx.toast('Đã lưu chính sách cập nhật'); };
  root.querySelectorAll('[data-clean]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await cleanDataAction(b.dataset.clean, b.dataset.name); } finally { b.disabled = false; }
  });
  root.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => toggle(b.dataset.toggle));
  root.querySelectorAll('[data-move]').forEach(b => b.onclick = () => move(b.dataset.move, +b.dataset.dir, mods));
  root.querySelectorAll('[data-rollback]').forEach(b => b.onclick = async () => {
    try { await rollbackModule(b.dataset.rollback); ctx.toast('Đã quay lại phiên bản trước'); } catch (e) { ctx.toast(e.message, 'error'); }
  });
  bindUpdateButtons();
}

async function itemCounts() {
  const items = await db.items.filter(i => !i.deleted).toArray();
  const by = {};
  for (const i of items) by[i.moduleId] = (by[i.moduleId] || 0) + 1;
  return by;
}

function modRow(m, i, n, counts) {
  const s = m.state;
  const status = m.status === 'planned' ? ['planned', 'Sắp có'] : m.core ? ['core', 'Lõi'] : s.enabled ? ['on', 'Đang bật'] : ['off', 'Đã tắt'];
  const types = m.contentTypes === '*' ? 'Mọi loại nội dung' : (m.contentTypes || []).map(t => CONTENT_TYPES[t]?.label).filter(Boolean).join(', ');
  const count = counts[m.id] || 0;
  return `<li class="mod ${status[0]}">
    <span class="mod-icon">${icon(m.icon)}</span>
    <div class="mod-main">
      <div class="mod-head"><h3>${esc(m.name)}</h3><span class="pill s-${status[0]}">${status[1]}</span></div>
      <p>${esc(m.description)}</p>
      <p class="mod-meta"><code>${m.id}</code> · <span class="num">${m.status === 'planned' ? 'chưa cài' : 'v' + esc(s.installedVersion || m.version)}</span>${types ? ` · ${types}` : ''}${count && m.contentTypes !== '*' ? ` · <span class="num">${count}</span> mục trong Thư viện` : ''}</p>
    </div>
    <div class="mod-actions">
      ${s.previousVersion ? `<button class="btn small" data-rollback="${m.id}">Quay lại v${esc(s.previousVersion)}</button>` : ''}
      <div class="seg small" role="group" aria-label="Thứ tự">
        <button data-move="${m.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Lên">↑</button><button data-move="${m.id}" data-dir="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Xuống">↓</button>
      </div>
      ${!m.core && m.status !== 'planned' && s.enabled ? `<button class="btn small" data-clean="${m.id}" data-name="${esc(m.name)}" title="Xoá các mục đã mất tệp gốc">Dọn dữ liệu ${esc(m.name)}</button>` : ''}
      <button class="switch" role="switch" aria-checked="${m.core || !!s.enabled}" data-toggle="${m.id}" ${m.core || m.status === 'planned' ? 'disabled' : ''} aria-label="Bật/tắt ${esc(m.name)}"><i></i></button>
    </div></li>`;
}

function renderUpdates() {
  if (!updates.length) return '';
  return `<div class="panel updates">
    <h2 class="panel-title">${icon('download')}Có ${updates.length} bản cập nhật
      ${updates.length > 1 ? '<button class="btn small primary" data-upd-all>Cập nhật tất cả</button>' : ''}</h2>
    <ul>${updates.map((u, i) => `<li>
      <div><strong>${esc(u.name)}</strong> <span class="num muted">${esc(u.from)} → ${esc(u.to)}</span>
      ${u.changelog?.length ? `<ul class="changelog">${u.changelog.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</div>
      <button class="btn small primary" data-upd="${i}">Cập nhật</button></li>`).join('')}</ul></div>`;
}

function bindUpdateButtons() {
  root.querySelectorAll('[data-upd]').forEach(b => b.onclick = () => apply([updates[+b.dataset.upd]]));
  root.querySelector('[data-upd-all]')?.addEventListener('click', () => apply([...updates]));
}

async function apply(list) {
  for (const u of list) {
    try {
      if (u.kind === 'shell') { await applyShellUpdate(); return; } // page reloads
      await applyModuleUpdate(u);
      updates = updates.filter(x => x !== u);
    } catch (e) { ctx.toast(e.message, 'error'); }
  }
  render();
}

async function check() {
  const btn = root.querySelector('[data-act="check"]');
  btn.disabled = true;
  try {
    ({ updates } = await checkForUpdates());
    if (swState.waiting && !updates.some(u => u.kind === 'shell')) updates.unshift({ kind: 'shell', id: 'shell', name: 'Lõi ứng dụng', from: ctx.appVersion, to: 'mới', changelog: [] });
    ctx.toast(updates.length ? `Có ${updates.length} bản cập nhật` : 'Mọi thứ đã là bản mới nhất');
  } catch (e) { ctx.toast(e.message, 'error'); }
  await render();
}

async function toggle(id) {
  const row = await db.modules.get(id);
  await db.modules.update(id, { enabled: row.enabled ? 0 : 1 });
  ctx.bus.emit('module:toggled', { id, enabled: !row.enabled });
  ctx.toast(row.enabled ? 'Đã tắt module. Nội dung vẫn còn trong Thư viện.' : 'Đã bật module');
  render();
}

async function move(id, dir, mods) {
  const order = mods.map(m => m.id);
  const i = order.indexOf(id), j = i + dir;
  [order[i], order[j]] = [order[j], order[i]];
  await db.transaction('rw', db.modules, async () => {
    for (const [k, mid] of order.entries()) await db.modules.update(mid, { order: k + 1 });
  });
  ctx.bus.emit('module:toggled', {});
  render();
}
