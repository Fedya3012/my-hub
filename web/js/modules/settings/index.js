// Settings: storage mode (Local / GitHub account), theme, backup & restore.
import { db, getSetting, setSetting, exportAll, importAll } from '../../core/db.js';
import { MODES, isDrive } from '../../core/storage/index.js';
import { tasks } from '../../core/tasks.js';
import { allThemes, currentTheme, applyTheme, saveCurrentAsTheme, exportTheme, importTheme, deleteTheme } from '../../core/theme.js';
import { thisDevice, renameDevice } from '../../core/device.js';
import { icon } from '../../core/icons.js';
import { account } from '../../core/account.js';
import { accountSummary, afterSignIn } from '../../core/account-ui.js';
import { esc, h, modal, confirmBox, saveJson, pickJson, fmtBytes, fmtAgo } from '../../core/ui.js';
import { skinSectionHtml, bindSkins } from '../../core/skin-ui.js';
import { paramsSectionHtml, bindParams } from '../../core/params-ui.js';
import { bus } from '../../core/bus.js';
import { progress } from '../../core/progress.js';
import { listModules } from '../../core/registry.js';
import { LANGS, lang, setLang } from '../../core/i18n.js';

let root, ctx, offs = [];

let sub = '';
export async function mount(el, context, rest = '') {
  root = el; ctx = context; sub = rest;
  // Before the first await: leaving during the first render still removes them in unmount().
  offs.push(ctx.bus.on('sync:done', render));
  offs.push(ctx.bus.on('account:changed', (e) => { if (e.reason !== 'refresh') render(); }));
  await render();
}
export function unmount() { offs.forEach(f => f()); offs = []; dropPage(); paramsOff?.(); paramsOff = null; }
// Listeners of the folders sub page: replaced on each of its renders (they used to pile up in offs).
let pageOffs = [];
const dropPage = () => { pageOffs.forEach(f => f()); pageOffs = []; };
let paramsOff = null;

// Sub page: Settings → Thư mục đồng bộ (its own page with a back link).
async function renderFolders() {
  dropPage();
  const st = await ctx.storage.status();
  const F = await import('../../core/storage/folders.js');
  const { drives } = await import('../../core/storage/index.js');
  const src = await F.folderSource();
  const srcOn = src !== 'local' && drives[src].connected();
  const card = 'background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)';
  const btn = 'min-height:44px;padding:0 18px;border-radius:var(--radius);font-size:15px;font-weight:600;font-family:inherit;cursor:pointer';
  const label = src !== 'local' ? MODES[src].label : '';
  root.innerHTML = `<section class="page" style="max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:14px">
    <div><a class="btn small" href="#settings/source" aria-label="Quay lại Thư mục đồng bộ">‹ Thư mục đồng bộ</a></div>
    <h2 class="section-title" style="margin:0">Chọn thư mục</h2>
    ${src !== 'local' ? `<div style="${card};display:flex;flex-direction:row;align-items:center;gap:12px;padding:14px">
      <span style="width:40px;height:40px;border-radius:10px;background:color-mix(in srgb, var(--accent) 14%, transparent);display:flex;align-items:center;justify-content:center;flex:none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9z"/></svg></span>
      <span style="flex:1 1 140px;min-width:0"><span style="display:block;font-size:15px;font-weight:600">${esc(label)}</span><span style="display:block;font-size:12px;color:var(--${srcOn ? 'ok' : 'warn'})">${srcOn ? 'Đã kết nối' : 'Chưa kết nối'}</span></span>
      <button type="button" data-act="sync-now" style="${btn};padding:0 14px;flex:none;border:0;background:var(--accent);color:var(--accent-fg)">Đồng bộ ngay</button></div>` : ''}
    <p class="hint" style="margin:0">Tích chọn một hoặc nhiều thư mục trên ổ. Nhạc và sách bên trong được quét, nhập vào thư viện và phát trực tiếp từ ổ, không sao chép vào app. Tệp mới tự cập nhật mỗi lần đồng bộ.</p>
    <div id="folder-picker"></div>
    <div id="fold-progress" style="${card};padding:14px;display:flex;flex-direction:column;gap:10px"></div>
    <div class="row-actions" style="display:flex;flex-direction:row;flex-wrap:wrap;gap:4px;align-items:center">
      <button type="button" class="btn" data-act="pause">Tạm dừng</button>
      <button type="button" class="btn" data-act="clean">Dọn mục đã mất tệp</button>
      <button type="button" class="btn danger-ghost" data-act="cancel-sync">Huỷ đồng bộ</button>
      <span style="flex:1"></span>
      <button type="button" class="btn primary" data-act="sync-now">Đồng bộ ngay</button>
    </div>
  </section>`;
  const m = await import('../../core/storage/folder-ui.js');
  const pick = root.querySelector('#folder-picker');
  if (src !== 'local' && !srcOn) pick.innerHTML = `<p class="hint">Chưa kết nối ${esc(label)}. Quay lại Thư mục đồng bộ để kết nối.</p>`;
  else if (src !== 'local') await m.folderPicker(pick, src, ctx.toast);
  else {
    root.querySelector('.hint').textContent = 'Chọn các thư mục trong máy. App chỉ đọc đúng những thư mục này: nhạc và sách bên trong được quét và thêm vào thư viện. Trên Windows và máy tính, tệp được đọc trực tiếp, không sao chép; trên Android, mỗi tệp mới được sao chép vào app một lần.';
    await (await import('../../core/storage/local-folders.js')).localFolderPicker(pick, ctx.toast);
  }

  // Live progress card: the scan / import task of the folder sync (also visible in the task tray).
  const prog = root.querySelector('#fold-progress');
  const pauseBtn = root.querySelector('[data-act="pause"]');
  const idle = async () => {
    const n = src === 'local' ? (await (await import('../../core/storage/local-folders.js')).localFolders()).length : (await F.folderList()).length;
    const paused = await F.folderPaused();
    pauseBtn.disabled = paused;
    // Nothing chosen yet: the picker already says so, and sync/pause/cancel have nothing to act on.
    const none = !n && !paused;
    prog.hidden = none;
    root.querySelectorAll('.row-actions [data-act]').forEach(b => { if (b.dataset.act !== 'clean') b.disabled = none || (b === pauseBtn && paused); });
    prog.innerHTML = `<div style="font-size:13px;color:var(--muted)">${paused ? '<b style="color:var(--warn)">Đã tạm dừng.</b> Bấm “Đồng bộ ngay” để tiếp tục từ chỗ đã dừng.' : n ? 'Đã chọn ' + n + ' thư mục. Bấm “Đồng bộ ngay” để quét và nhập tệp mới.' : 'Chưa chọn thư mục nào.'}</div>`;
  };
  const show = (list) => {
    const t = (list || []).find(x => x.state === 'running' && /^Đang (quét|nhập|dọn)/.test(x.label));
    if (!t) { idle(); return; }
    prog.hidden = false;
    root.querySelectorAll('.row-actions [data-act]').forEach(b => { b.disabled = false; });
    const pct = t.total ? Math.min(100, Math.round(t.done / t.total * 100)) : null;
    prog.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:14px"><span style="font-weight:600">${esc(t.label)}</span><span style="color:var(--muted)">${t.total ? t.done + ' / ' + t.total : ''}</span></div>
      <div style="height:8px;border-radius:99px;background:var(--line);overflow:hidden"><div style="width:${pct == null ? 40 : pct}%;height:100%;background:var(--accent)"></div></div>
      <div style="font-size:12px;color:var(--muted)">${esc(t.detail || '')}${pct != null ? ' · ' + pct + '%' : ''}</div>`;
  };
  idle();
  pageOffs.push(ctx.bus.on('tasks:changed', show));
  // The pickers re-render after a folder is added or removed: refresh the count and the buttons.
  const mo = new MutationObserver(debounceIdle());
  mo.observe(pick, { childList: true, subtree: true });
  pageOffs.push(() => mo.disconnect());
  function debounceIdle() { let t; return () => { clearTimeout(t); t = setTimeout(() => root.isConnected && idle(), 250); }; }

  const run = async (b, fn) => { b.disabled = true; try { await fn(); } catch (err) { if (err?.name !== 'AbortError') ctx.toast(err.message, 'error'); } finally { b.disabled = false; idle(); } };
  root.querySelectorAll('[data-act="sync-now"]').forEach(b => b.onclick = () => run(b, async () => {
    const fr = await F.syncFolders({ resume: true });
    if (await F.folderPaused()) return;   // paused or cancelled while running: those buttons report it
    if (fr?.added) ctx.toast(`Đã nhập ${fr.added} tệp từ thư mục đã chọn`);
    if (fr?.failed?.length) ctx.toast(`${fr.failed.length} tệp lỗi: ${fr.failed[0]}`, 'warn');
    if (fr?.missing?.length) ctx.toast(`Thư mục không còn trên ổ: ${fr.missing.join(', ')}. Hãy bỏ chọn hoặc chọn lại thư mục.`, 'warn');
    if (fr?.removed) ctx.toast(`Đã xoá ${fr.removed} mục có tệp gốc không còn`);
    if (fr && !fr.added && !fr.removed && !fr.skipped) ctx.toast('Đã đồng bộ, không có tệp mới');
  }));
  pauseBtn.onclick = () => run(pauseBtn, async () => {
    await F.pauseFolderSync();
    ctx.toast('Đã tạm dừng đồng bộ thư mục. Các tệp đã nhập vẫn giữ nguyên.');
  });
  root.querySelector('[data-act="cancel-sync"]').onclick = (e) => run(e.currentTarget, async () => {
    if (!(await confirmBox('Huỷ đồng bộ thư mục?', 'Dừng đồng bộ và xoá khỏi thư viện mọi bài nhạc, sách đã nhập từ các thư mục đã chọn. Tiến trình đồng bộ được đặt lại từ đầu. Tệp gốc trên ổ hoặc trong máy không bị đụng tới. Danh sách thư mục vẫn giữ, bấm “Đồng bộ ngay” để đồng bộ lại.', 'Huỷ đồng bộ'))) return;
    const r = await F.cancelFolderSync();
    ctx.toast(r.removed ? `Đã huỷ đồng bộ và xoá ${r.removed} mục đã nhập` : 'Đã huỷ đồng bộ');
  });
  root.querySelector('[data-act="clean"]').onclick = (e) => run(e.currentTarget, async () => {
    if (!(await confirmBox('Dọn mục đã mất tệp?', 'Xoá khỏi thư viện những mục mà tệp gốc đã bị xoá (trong thư mục đồng bộ hoặc trong máy). Tệp còn tồn tại không bị đụng tới.', 'Dọn'))) return;
    const r = await (await import('../../core/storage/cleanup.js')).cleanMissing('library');
    ctx.toast(r.removed ? `Đã xoá ${r.removed} mục mất tệp` : 'Không có mục nào mất tệp');
  });
}

// Re-renders (sync finished, theme picked, account changed) keep the open parameter groups and the scroll position.
async function render() {
  if (sub === 'folders') return renderFolders();
  const open = new Set([...root.querySelectorAll('details[open][data-ns]')].map(d => d.dataset.ns));
  const scroller = document.scrollingElement, top = scroller.scrollTop;
  await renderPage();
  root.querySelectorAll('details[data-ns]').forEach(d => { if (open.has(d.dataset.ns)) d.open = true; });
  if (open.size || top) scroller.scrollTop = top;
}

// Sections of the Settings page, each opened as its own sub page: [icon, title, one-line summary].
const SECS = {
  sync: ['database', 'Tài khoản đồng bộ', (st) => MODES[st.mode].label],
  source: ['library', 'Thư mục đồng bộ', (st, src) => src === 'local' ? 'Thư mục trong máy' : 'Thư mục trên ' + MODES[src].label],
  devices: ['device', 'Thiết bị dùng chung thư viện', () => 'Tên máy này, các máy đang dùng'],
  appearance: ['palette', 'Giao diện', () => 'Ngôn ngữ, skin, theme, màu nhấn, cỡ chữ'],
  params: ['grid', 'Thông số dùng chung', () => 'Thông số của từng ứng dụng, trạng thái hiện tại'],
  progress: ['clock', 'Đặt lại tiến trình', () => 'Đọc, nghe, xem: về lại từ đầu'],
  backup: ['download', 'Sao lưu & quyền riêng tư', () => 'Xuất, nhập JSON, đăng xuất khỏi máy này, xoá dữ liệu'],
};

async function renderPage() {
  const st = await ctx.storage.status();
  const themes = await allThemes();
  const cur = await currentTheme();
  const curT = themes.find(t => t.id === cur.id);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const me = await thisDevice();
  const devices = (await db.devices.orderBy('lastSeenAt').reverse().toArray());
  const liveAt = await getSetting('sync.liveAt', null);
  const conn = st.cloud.signedIn;
  const F = await import('../../core/storage/folders.js');
  const { drives } = await import('../../core/storage/index.js');
  const fsrc = await F.folderSource();

  // Items with a saved position, per app (the virtual rows such as the Music queue have a ":" in their id).
  const live = (await db.progress.toArray()).filter(p => !String(p.itemId).includes(':') && p.state !== 'reset' && (p.position > 0 || p.state === 'finished'));
  const mods = await listModules();
  const progRows = [...new Set(live.map(p => p.moduleId))].map(id => ({ id, name: mods.find(m => m.id === id)?.name || id, count: live.filter(p => p.moduleId === id).length }));

  root.innerHTML = `
  <section class="page settings">
    ${SECS[sub] ? `<div><a class="btn small" href="#settings" aria-label="Quay lại Cài đặt">‹ Cài đặt</a></div>`
      : `<header class="page-head"><div class="app-title"><p class="eyebrow">Tuỳ chỉnh</p><h1>Cài đặt</h1></div></header>
    ${accountSummary()}
    <nav class="set-index" aria-label="Các mục cài đặt">${Object.entries(SECS).map(([k, [ic, t, d]]) => `<a class="panel set-link" href="#settings/${k}">${icon(ic)}<span><strong>${t}</strong><span class="hint">${d(st, fsrc)}</span></span><span aria-hidden="true">›</span></a>`).join('')}</nav>`}

    <section class="set-block" data-sec="sync">
      <h2 class="section-title">${icon('database')}Tài khoản đồng bộ</h2>
      <p class="hint">Nơi thư viện, cài đặt và tiến độ nghe/đọc được đồng bộ giữa các máy. Tách riêng với nơi lấy thư mục nhạc và sách (mục Thư mục đồng bộ bên dưới): ví dụ đồng bộ bằng GitHub nhưng lấy nhạc từ Dropbox, hoặc dùng Dropbox cho cả hai.</p>
      <div class="mode-cards" role="radiogroup" aria-label="Tài khoản đồng bộ">
        ${Object.entries(MODES).map(([k, m]) => `
          <label class="mode-card${st.mode === k ? ' on' : ''}">
            <input type="radio" name="storage-mode" id="mode-${k}" value="${k}" ${st.mode === k ? 'checked' : ''}>
            <span class="mode-icon">${icon(k === 'local' ? 'device' : k === 'github' ? 'user' : 'cloud')}</span>
            <strong>${m.label}</strong><span>${m.hint}</span></label>`).join('')}
      </div>

      <p class="hint">Chọn một ô ở trên để kết nối: <b>Dropbox</b> và <b>OneDrive</b> sẽ mở hộp đăng nhập. Đang dùng chế độ này rồi thì bấm “Đổi tài khoản” trong bảng bên dưới.</p>
      <div class="panel">
        <dl class="kv">
          <dt>Lưu tệp trên máy bằng</dt><dd>${st.backend === 'opfs' ? 'Hệ thống tệp riêng của ứng dụng (OPFS)' : 'IndexedDB'}</dd>
          <dt>Đã dùng trên máy</dt><dd>${quotaBar(st.usage?.usage, st.usage?.quota)}</dd>
          <dt>Chống bị xoá tự động</dt><dd>${persisted ? '<span class="pill ok">Đã bật</span>' : '<button class="btn small" data-act="persist">Yêu cầu lưu trữ bền vững</button>'}</dd>
          ${st.cloud.drive ? `
          <dt>${esc(st.cloud.label)}</dt><dd><span class="pill ${st.cloud.connected ? 'ok' : 'warn'}">${st.cloud.connected ? 'Đã kết nối' : 'Chưa kết nối'}</span> <button class="btn small" data-act="reconnect">${st.cloud.connected ? 'Đổi tài khoản' : 'Kết nối'}</button></dd>
          <dt>Chờ đồng bộ</dt><dd class="num">${st.pending} thay đổi · lần cuối ${fmtAgo(st.lastSync)}</dd>
          <dt>Tệp nhạc/sách</dt><dd>Tự tải lên ${esc(st.cloud.label)} sau khi thêm; máy khác tải về khi mở lần đầu</dd>
          <dt>Tiến độ nghe/đọc</dt><dd>Đồng bộ vài giây sau mỗi lần dừng · lần cuối ${fmtAgo(liveAt)}</dd>
          ` : st.mode !== 'local' ? `
          <dt>Tài khoản GitHub</dt><dd>${!st.cloud.signedIn ? '<a class="btn small primary" href="#account">Đăng nhập</a>'
            : `<span class="pill ${st.cloud.needsReconnect ? 'warn' : 'ok'}">${st.cloud.needsReconnect ? 'Cần kết nối lại' : 'Đã đăng nhập'}</span> ${esc(account.email)} <a class="btn small" href="#account">Quản lý</a>`}</dd>
          <dt>Chờ đồng bộ</dt><dd class="num">${st.pending} thay đổi · lần cuối ${fmtAgo(st.lastSync)}</dd>
          <dt>Tiến độ nghe/đọc</dt><dd>Đồng bộ vài giây sau mỗi lần dừng · lần cuối ${fmtAgo(liveAt)}</dd>
          ` : ''}
        </dl>
        <p class="hint">My Hub không tự đặt giới hạn số bài, số tệp hay kích thước tệp. Giới hạn duy nhất là hạn mức của trình duyệt trên máy này; ứng dụng không thể nới các hạn mức đó, nhưng sẽ cảnh báo khi sắp đầy. Muốn không tốn chỗ: dùng “Thư mục đồng bộ” ở trên, hoặc “Liên kết thư mục (không sao chép)” trong Trình phát nhạc (máy tính).</p>
        ${st.mode !== 'local' ? `<div class="row-actions">
          <button class="btn" data-act="sync" ${conn ? '' : 'disabled'}>${icon('refresh')}Đồng bộ ngay</button>
          <button class="btn" data-act="unlink">Ngừng dùng ${esc(st.cloud.label)} (về Local)</button>
          <button class="btn danger-ghost" data-act="cloudwipe" ${conn ? '' : 'disabled'}>${icon('trash')}Xoá dữ liệu trên ${esc(st.cloud.label)}</button></div>` : ''}
      </div>
    </section>

    <section class="set-block" data-sec="source">
      <h2 class="section-title">${icon('library')}Thư mục đồng bộ</h2>
      <p class="hint">Nơi lấy nhạc và sách: thư mục trong máy, hoặc thư mục trên Dropbox / OneDrive. Không phụ thuộc vào tài khoản đồng bộ ở trên.</p>
      <div class="mode-cards" role="radiogroup" aria-label="Nơi lấy thư mục đồng bộ">
        ${[['local', 'Trong máy', 'Thư mục trên thiết bị này.']].concat(Object.keys(drives).filter(F.canPickFolders).map(k => [k, MODES[k].label, drives[k].connected() ? 'Đã kết nối' : 'Chưa kết nối, chọn để đăng nhập'])).map(([k, l, h]) => `
          <label class="mode-card${fsrc === k ? ' on' : ''}">
            <input type="radio" name="folder-src" value="${k}" ${fsrc === k ? 'checked' : ''}>
            <span class="mode-icon">${icon(k === 'local' ? 'device' : 'cloud')}</span>
            <strong>${esc(l)}</strong><span>${esc(h)}</span></label>`).join('')}
      </div>
      <a class="panel" href="#settings/folders" style="display:flex;flex-direction:row;align-items:center;gap:10px;text-decoration:none;color:inherit"><span style="flex:1"><strong style="display:block">Chọn thư mục, đồng bộ, tạm dừng, huỷ</strong><span class="hint">${fsrc === 'local' ? 'Thư mục trong máy' : 'Thư mục trên ' + esc(MODES[fsrc].label)}${fsrc !== 'local' && drives[fsrc].connected() ? ` · <button type="button" class="btn small" data-act="src-reconnect">Đổi tài khoản ${esc(MODES[fsrc].label)}</button>` : ''}</span></span><span aria-hidden="true">›</span></a>
    </section>

    <section class="set-block" data-sec="devices">
      <h2 class="section-title">${icon('device')}Thiết bị dùng chung thư viện</h2>
      <div class="panel">
        <ul class="devices">${devices.map(d => `<li><span class="mod-icon">${icon(d.platform === 'android' || d.platform === 'ios' ? 'device' : 'apps')}</span>
          <span class="dev-main"><strong>${esc(d.name)}</strong>${d.id === me.id ? ' <span class="pill s-core">Máy này</span>' : ''}<span class="muted">Hoạt động ${fmtAgo(d.lastSeenAt)}</span></span>
          ${d.id === me.id ? '<button class="btn small" data-act="rename">Đổi tên</button>' : ''}</li>`).join('')}</ul>
        <p class="hint">${st.mode === 'local' ? 'Kết nối GitHub, Dropbox hoặc OneDrive để tiến độ (đang nghe tới đâu, đọc tới trang nào) theo bạn sang điện thoại, máy Windows và bản APK.' : 'Dừng nhạc trên một máy, mở app trên máy khác sẽ tiếp tục đúng chỗ đó.'}</p>
      </div>
    </section>

    <section class="set-block" data-sec="appearance">
      <h2 class="section-title">${icon('palette')}Giao diện</h2>
      <div class="panel"><label>Ngôn ngữ<select id="k-lang" data-i18n="off">${LANGS.map(l => `<option value="${l.id}"${l.id === lang ? ' selected' : ''}>${l.label}</option>`).join('')}</select></label></div>
      ${await skinSectionHtml()}
      <div class="theme-grid" role="radiogroup" aria-label="Theme">
        ${themes.map(t => `<button class="theme-card${t.id === cur.id ? ' on' : ''}" role="radio" aria-checked="${t.id === cur.id}" data-theme-id="${t.id}">
          <span class="swatch ${t.base === 'auto' ? 'auto' : ''}" style="${t.base === 'auto' ? '' : `--s-bg:${t.vars['--bg']};--s-sf:${t.vars['--surface']};--s-ac:${t.vars['--accent']};--s-fg:${t.vars['--fg']}`}"><i></i><i></i><i></i></span>
          <span>${esc(t.name)}</span>${t.custom ? '<span class="pill">Của bạn</span>' : ''}</button>`).join('')}
      </div>
      <div class="panel knobs">
        <label>Màu nhấn<span class="knob-row"><input type="color" id="k-accent" value="${cur.knobs.accent || '#1d6f8f'}"><button class="btn small" data-act="accent-reset">Theo theme</button></span></label>
        <label>Bo góc <span class="num" id="k-radius-v">${cur.knobs.radius == null ? 'Theo skin' : cur.knobs.radius + 'px'}</span><input type="range" id="k-radius" min="0" max="28" step="2" value="${cur.knobs.radius ?? (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--radius')) || 12)}"></label>
        <label>Cỡ chữ <span class="num" id="k-scale-v">${Math.round(cur.knobs.scale * 100)}%</span><input type="range" id="k-scale" min="0.85" max="1.3" step="0.05" value="${cur.knobs.scale}"></label>
        <label>Mật độ<select id="k-density"><option value="comfortable" ${cur.knobs.density === 'comfortable' ? 'selected' : ''}>Thoải mái</option><option value="compact" ${cur.knobs.density === 'compact' ? 'selected' : ''}>Gọn</option></select></label>
      </div>
      <div class="row-actions">
        <button class="btn" data-act="save-theme">${icon('plus')}Lưu thành theme mới</button>
        <button class="btn" data-act="export-theme">${icon('download')}Xuất theme JSON</button>
        <button class="btn" data-act="import-theme">${icon('upload')}Nhập theme JSON</button>
        ${curT?.custom ? `<button class="btn danger-ghost" data-act="delete-theme">${icon('trash')}Xoá theme “${esc(curT.name)}”</button>` : ''}
      </div>
    </section>

    <div data-sec="params">${paramsSectionHtml()}</div>

    <section class="set-block" data-sec="progress">
      <h2 class="section-title">${icon('clock')}Đặt lại tiến trình</h2>
      <div class="panel">
        <p>Đưa vị trí đã đọc, nghe, xem về từ đầu trên mọi thiết bị. Trạng thái của sách về “Muốn đọc”. Lịch sử, thống kê, đánh dấu, ghi chú và tệp vẫn giữ nguyên.</p>
        <ul class="set-prog" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px">
          ${progRows.map(r => `<li style="display:flex;flex-direction:row;align-items:center;gap:10px"><span style="flex:1;min-width:0"><strong>${esc(r.name)}</strong><span class="hint" style="display:block">${r.count ? r.count + ' mục có tiến trình' : 'Chưa có tiến trình'}</span></span>
            <button class="btn small" data-reset-mod="${esc(r.id)}" ${r.count ? '' : 'disabled'}>Đặt lại</button></li>`).join('') || '<li class="hint">Chưa có tiến trình nào.</li>'}
        </ul>
        <div class="row-actions"><button class="btn danger-ghost" data-act="reset-all" ${progRows.some(r => r.count) ? '' : 'disabled'}>${icon('refresh')}Đặt lại tất cả ứng dụng</button></div>
      </div>
    </section>

    <section class="set-block" data-sec="backup">
      <h2 class="section-title">${icon('download')}Sao lưu dữ liệu</h2>
      <div class="panel">
        <p>Xuất toàn bộ thư viện, liên kết, bộ sưu tập, module và cài đặt thành một tệp JSON. Tệp nội dung (nhạc, sách…) không nằm trong JSON.</p>
        <div class="row-actions">
          <button class="btn primary" data-act="export">${icon('download')}Xuất JSON</button>
          <button class="btn" data-act="import">${icon('upload')}Nhập JSON</button>
          <button class="btn danger-ghost" data-act="wipe">${icon('trash')}Xoá toàn bộ dữ liệu</button>
        </div>
      </div>
      <div class="panel">
        <p><strong>Đăng xuất khỏi máy này</strong></p>
        <p class="hint">Xoá mọi thông tin đăng nhập lưu trên máy (token GitHub, Dropbox, OneDrive, ListenBrainz) và chuyển về chế độ Chỉ trên máy. Thư viện, tiến độ, ghi chú và tệp vẫn giữ nguyên. Dùng khi đưa máy cho người khác hoặc nghi lộ token. Đăng nhập lại bất cứ lúc nào.</p>
        <div class="row-actions"><button class="btn" data-act="signout-here">${icon('power')}Đăng xuất khỏi máy này</button></div>
      </div>
    </section>
  </section>`;

  // Main page = account card + index of the sections; #settings/<section> shows one section (all stay in the DOM so their handlers bind).
  root.querySelectorAll('[data-sec]').forEach(el => { el.hidden = el.dataset.sec !== sub; });
  const $ = (s) => root.querySelector(s);
  paramsOff?.(); paramsOff = bindParams(root, ctx.toast);
  const on = (act, fn) => root.querySelector(`[data-act="${act}"]`)?.addEventListener('click', fn);

  root.querySelectorAll('input[name="storage-mode"]').forEach(r => r.onchange = async () => {
    if (isDrive(r.value)) {   // Dropbox / OneDrive: connect, then asks what to do with this device's data
      const { useDrive } = await import('../../core/storage/cloud-ui.js');
      await useDrive(r.value); render();
      return;
    }
    if (r.value !== 'local') {   // needs the matching account; asks what to do with this device's data
      if (!account.signedIn) { ctx.toast('Đăng nhập GitHub để bật chế độ này', 'warn'); render(); ctx.go('account'); return; }
      await afterSignIn(); render();
      return;
    }
    await ctx.storage.setMode(r.value);
    ctx.toast('Chế độ lưu trữ: ' + MODES[r.value].label);
    render();
  });
  // Folder source: connecting a drive here only signs in to it, the sync account above stays as it is.
  root.querySelectorAll('input[name="folder-src"]').forEach(r => r.onchange = async () => {
    const k = r.value;
    if (k !== fsrc && fsrc !== 'local' && (await F.folderList()).length
      && !(await confirmBox('Đổi nơi lấy thư mục?', 'Danh sách thư mục đã chọn trên ' + MODES[fsrc].label + ' sẽ được bỏ chọn. Bài nhạc, sách đã nhập vẫn giữ trong thư viện.', 'Đổi'))) { render(); return; }
    if (k !== 'local' && !drives[k].connected()) {
      const { connectForm } = await import('../../core/storage/cloud-ui.js');
      if (!(await connectForm(k))) { render(); return; }
    }
    await F.setFolderSource(k);
    ctx.toast('Thư mục đồng bộ lấy từ: ' + (k === 'local' ? 'Trong máy' : MODES[k].label));
    render();
  });
  on('src-reconnect', async (e) => { e.preventDefault(); e.stopPropagation(); const { connectForm } = await import('../../core/storage/cloud-ui.js'); if (await connectForm(fsrc)) render(); });
  on('reconnect', async () => { const { useDrive } = await import('../../core/storage/cloud-ui.js'); await useDrive(st.mode, { reconnect: true }); render(); });
  on('persist', async () => { const ok = await ctx.storage.adapters.local.persist(); ctx.toast(ok ? 'Đã bật lưu trữ bền vững' : 'Trình duyệt chưa cho phép', ok ? 'info' : 'warn'); render(); });
  on('rename', async () => {
    const name = await modal({ title: 'Tên thiết bị', body: h(`<label>Tên hiển thị trên các máy khác<input id="dev-name" value="${esc(me.name)}"></label>`),
      actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', kind: 'primary', value: b => b.querySelector('input').value.trim() }] });
    if (name) { await renameDevice(name); render(); }
  });
  // Both show their progress in the task tray (storage.sync).
  on('sync', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await ctx.storage.sync();
      const fr = await (await import('../../core/storage/folders.js')).syncFolders().catch(err => { ctx.toast(err.message, 'error'); return null; });
      if (fr?.added) ctx.toast(`Đã nhập ${fr.added} tệp từ thư mục đã chọn`);
      if (fr?.missing?.length) ctx.toast(`Thư mục không còn trên ổ: ${fr.missing.join(', ')}. Hãy bỏ chọn hoặc chọn lại thư mục.`, 'warn');
      if (fr?.removed) ctx.toast(`Đã xoá ${fr.removed} mục có tệp gốc không còn`);
      if (r?.skipped) ctx.toast(r.skipped === 'offline' ? 'Đang offline, sẽ đồng bộ khi có mạng' : r.skipped === 'signed-out' ? 'Chưa đăng nhập' : 'Chưa kết nối được ' + st.cloud.label, 'warn');
      else if (r && !r.cancelled && !r.pulled && !r.uploaded) ctx.toast('Đã đồng bộ, không có thay đổi mới');
    } catch (err) { ctx.toast(err.message, 'error'); }
    finally { b.disabled = false; }
  });
  // Drop the cloud side: Local only again (the cloud copy stays), or also erase what My Hub stored there.
  on('unlink', async () => {
    if (!(await confirmBox('Ngừng dùng ' + st.cloud.label + '?', 'App chuyển về chế độ Local, dữ liệu trên máy giữ nguyên và bản trên đám mây không bị xoá. Bật lại bất cứ lúc nào.', 'Chuyển về Local'))) return;
    await ctx.storage.setMode('local');
    ctx.toast('Chế độ lưu trữ: ' + MODES.local.label);
    render();
  });
  on('cloudwipe', async () => {
    if (!(await confirmBox('Xoá dữ liệu trên ' + st.cloud.label + '?', st.cloud.drive ? 'Thư viện và tiến độ My Hub đã lưu trên ' + st.cloud.label + ' sẽ bị xoá (tệp nhạc/sách đã tải lên thì giữ nguyên). Dữ liệu trên máy này giữ nguyên và app chuyển về Local.' : 'Mọi thứ My Hub đã lưu trong kho my-hub-data sẽ bị xoá. Dữ liệu trên máy này giữ nguyên và app chuyển về Local.', 'Xoá'))) return;
    try { await ctx.storage.deleteCloudData(); await ctx.storage.setMode('local'); ctx.toast('Đã xoá dữ liệu trên đám mây'); }
    catch (err) { ctx.toast(err.message, 'error'); }
    render();
  });

  bindSkins(root, render);
  $('#k-lang').onchange = (e) => setLang(e.target.value);
  root.querySelectorAll('[data-theme-id]').forEach(b => b.onclick = async () => { await applyTheme(b.dataset.themeId); render(); });
  $('#k-accent').oninput = (e) => applyTheme(null, { accent: e.target.value });
  on('accent-reset', async () => { await applyTheme(null, { accent: null }); render(); });
  $('#k-radius').oninput = (e) => { $('#k-radius-v').textContent = e.target.value + 'px'; applyTheme(null, { radius: +e.target.value }); };
  $('#k-scale').oninput = (e) => { $('#k-scale-v').textContent = Math.round(e.target.value * 100) + '%'; applyTheme(null, { scale: +e.target.value }); };
  $('#k-density').onchange = (e) => applyTheme(null, { density: e.target.value });
  on('save-theme', async () => {
    const name = await modal({ title: 'Lưu theme', body: h('<label>Tên theme<input id="theme-name" value="Theme của tôi"></label>'),
      actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', kind: 'primary', value: b => b.querySelector('input').value.trim() }] });
    if (!name) return;
    const t = await saveCurrentAsTheme(name); await applyTheme(t.id); ctx.toast('Đã lưu theme'); render();
  });
  on('delete-theme', async () => {
    if (!(await confirmBox('Xoá theme “' + curT.name + '”?', 'Theme của bạn sẽ bị xoá khỏi máy này. App chuyển về theme Theo hệ thống.', 'Xoá'))) return;
    await deleteTheme(cur.id); ctx.toast('Đã xoá theme'); render();
  });
  on('export-theme', async () => saveJson(`theme-${cur.id}.json`, await exportTheme(cur.id)));
  on('import-theme', async () => {
    const json = await pickJson('Nhập theme');
    if (!json) return;
    try { await importTheme(json); ctx.toast('Đã nhập theme'); render(); } catch (e) { ctx.toast(e.message, 'error'); }
  });

  on('export', async () => {
    try {
      await tasks.run({ label: 'Đang xuất bản sao lưu', detail: 'Đọc toàn bộ dữ liệu…', delay: 300 }, async (t) => {
        const data = await exportAll();
        t.update({ detail: 'Đang tạo tệp JSON…' });
        saveJson(`my-hub-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
      });
    } catch (e) { ctx.toast(e.message, 'error'); }
  });
  on('import', async () => {
    const json = await pickJson('Nhập bản sao lưu');
    if (!json) return;
    const mode = await modal({ title: 'Cách nhập', body: '<p>Gộp: giữ bản mới hơn của mỗi mục. Thay thế: xoá dữ liệu hiện tại rồi nhập.</p>',
      actions: [{ label: 'Huỷ', value: null }, { label: 'Thay thế', value: 'replace', kind: 'danger' }, { label: 'Gộp', value: 'merge', kind: 'primary' }] });
    if (!mode) return;
    const rows = Object.values(json?.data || {}).reduce((s, r) => s + (Array.isArray(r) ? r.length : 0), 0);
    try {
      const n = await tasks.run({ label: 'Đang nhập bản sao lưu', detail: `${rows} bản ghi · ${mode === 'replace' ? 'thay thế' : 'gộp'}`, delay: 300 },
        async (t) => { const k = await importAll(json, { mode }); t.update({ detail: `Đã nhập ${k} bản ghi` }); return k; });
      bus.emit('backup:imported', { mode });
      ctx.toast(`Đã nhập ${n} bản ghi`); await applyTheme(); render();
    } catch (e) { ctx.toast(e.message, 'error'); }
  });
  root.querySelectorAll('[data-reset-mod]').forEach(b => b.onclick = async () => {
    const r = progRows.find(x => x.id === b.dataset.resetMod);
    if (!(await confirmBox(`Đặt lại tiến trình ${r.name}?`, `${r.count} mục của ${r.name} về trạng thái chưa bắt đầu, trên mọi thiết bị. Lịch sử và thống kê vẫn giữ.`, 'Đặt lại'))) return;
    const n = await progress.resetAll([r.id]);
    ctx.toast(`Đã đặt lại ${n} mục`); render();
  });
  on('reset-all', async () => {
    if (!(await confirmBox('Đặt lại tiến trình của tất cả ứng dụng?', `${progRows.reduce((a, r) => a + r.count, 0)} mục về trạng thái chưa bắt đầu, trên mọi thiết bị. Lịch sử và thống kê vẫn giữ.`, 'Đặt lại tất cả'))) return;
    const n = await progress.resetAll();
    ctx.toast(`Đã đặt lại ${n} mục`); render();
  });
  on('signout-here', async () => {
    if (!(await confirmBox('Đăng xuất khỏi máy này?', 'Mọi token đăng nhập trên máy này bị xoá và app chuyển về Chỉ trên máy. Thư viện, tiến độ và tệp vẫn giữ nguyên. Dữ liệu trên GitHub, Dropbox hoặc OneDrive không bị xoá.', 'Đăng xuất'))) return;
    await signOutHere();
    ctx.toast('Đã đăng xuất khỏi máy này. Dữ liệu vẫn giữ nguyên.');
    render();
  });
  on('wipe', async () => {
    if (!(await confirmBox('Xoá toàn bộ dữ liệu?', 'Mọi mục, liên kết, cài đặt, tệp và thông tin đăng nhập (token) trên máy này sẽ mất; app đăng xuất khỏi mọi tài khoản. Dữ liệu đã đồng bộ lên GitHub, Dropbox hoặc OneDrive không bị ảnh hưởng.', 'Xoá hết'))) return;
    const files = await db.files.toArray();
    const t = tasks.start({ label: 'Đang xoá dữ liệu', total: files.length + 1, detail: 'Xoá tệp trên máy…' });
    try {
      for (const f of files) { await ctx.storage.adapters.local.remove(f.locations?.local); t.step(1, f.name || ''); }
      t.update({ detail: 'Xoá cơ sở dữ liệu…' });
      await signOutHere();
      await db.delete();
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage unavailable */ }
      t.finish('Đã xoá');
    } catch (e) { t.fail(e); ctx.toast(e.message, 'error'); return; }
    location.reload();
  });
}

// Sign out of everything on this device, keeping the data: GitHub session, drive tokens (Dropbox, OneDrive),
// the ListenBrainz token; storage back to Local so nothing tries to sync with the removed credentials.
async function signOutHere() {
  const { clouds } = await import('../../core/storage/clouds.js');
  for (const id of ['dropbox', 'onedrive']) clouds.set(id, null);
  await account.signOut({ reason: 'signout' });
  try { await (await import('../music/lib/prefs.js')).setPref('qol.lbToken', ''); } catch { /* music app off */ }
  if ((await ctx.storage.mode()) !== 'local') await ctx.storage.setMode('local');
}

// Usage vs quota with a warning when nearly full (limit null = unlimited / unknown).
function quotaBar(used, limit) {
  if (used == null) return '—';
  if (!limit) return `<span class="num">${fmtBytes(used)}</span> <span class="muted">· không giới hạn</span>`;
  const p = Math.min(100, used / limit * 100);
  const lvl = p >= 95 ? 'danger' : p >= 85 ? 'warn' : '';
  return `<span class="quota ${lvl}"><span class="quota-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}" aria-label="Đã dùng ${Math.round(p)}%"><i style="width:${p.toFixed(1)}%"></i></span>
    <span class="num">${fmtBytes(used)} / ${fmtBytes(limit)} (${Math.round(p)}%)</span>${lvl ? `<span class="pill ${lvl === 'danger' ? 'danger' : 'warn'}">${lvl === 'danger' ? 'Gần đầy: giải phóng bớt hoặc dùng liên kết thư mục' : 'Sắp đầy'}</span>` : ''}</span>`;
}
