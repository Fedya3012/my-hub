// Settings: storage mode (Local / GitHub account), theme, backup & restore.
import { db, getSetting, setSetting, exportAll, importAll } from '../../core/db.js';
import { MODES, isDrive } from '../../core/storage/index.js';
import { tasks } from '../../core/tasks.js';
import { allThemes, currentTheme, applyTheme, saveCurrentAsTheme, exportTheme, importTheme } from '../../core/theme.js';
import { thisDevice, renameDevice } from '../../core/device.js';
import { icon } from '../../core/icons.js';
import { account } from '../../core/account.js';
import { accountSummary, afterSignIn } from '../../core/account-ui.js';
import { esc, h, modal, confirmBox, saveJson, pickJson, fmtBytes, fmtAgo } from '../../core/ui.js';
import { skinSectionHtml, bindSkins } from '../../core/skin-ui.js';
import { paramsSectionHtml, bindParams } from '../../core/params-ui.js';
import { bus } from '../../core/bus.js';
import { LANGS, lang, setLang } from '../../core/i18n.js';

let root, ctx, offs = [];

export async function mount(el, context) {
  root = el; ctx = context;
  await render();
  offs.push(ctx.bus.on('sync:done', render));
  offs.push(ctx.bus.on('account:changed', (e) => { if (e.reason !== 'refresh') render(); }));
}
export function unmount() { offs.forEach(f => f()); offs = []; paramsOff?.(); paramsOff = null; }
let paramsOff = null;

async function render() {
  const st = await ctx.storage.status();
  const themes = await allThemes();
  const cur = await currentTheme();
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const me = await thisDevice();
  const devices = (await db.devices.orderBy('lastSeenAt').reverse().toArray());
  const liveAt = await getSetting('sync.liveAt', null);
  const conn = st.cloud.signedIn;

  root.innerHTML = `
  <section class="page settings">
    <header class="page-head"><div><p class="eyebrow">Tuỳ chỉnh</p><h1>Cài đặt</h1></div></header>

    ${accountSummary()}

    <section class="set-block">
      <h2 class="section-title">${icon('database')}Lưu trữ & đồng bộ</h2>
      <div class="mode-cards" role="radiogroup" aria-label="Chế độ lưu trữ">
        ${Object.entries(MODES).map(([k, m]) => `
          <label class="mode-card${st.mode === k ? ' on' : ''}">
            <input type="radio" name="storage-mode" id="mode-${k}" value="${k}" ${st.mode === k ? 'checked' : ''}>
            <span class="mode-icon">${icon(k === 'local' ? 'device' : k === 'github' ? 'user' : 'cloud')}</span>
            <strong>${m.label}</strong><span>${m.hint}</span></label>`).join('')}
      </div>

      <p class="hint">Chọn một ô ở trên để kết nối: <b>Dropbox</b>, <b>OneDrive</b>, <b>WebDAV</b> và <b>pCloud</b> sẽ mở hộp đăng nhập. Đang dùng chế độ này rồi thì bấm “Đổi tài khoản” ở dưới.</p>
      <div class="row-actions" style="flex-wrap:wrap">${['dropbox', 'onedrive', 'webdav', 'pcloud'].map(k => `<button class="btn ${st.mode === k ? 'primary' : ''}" data-connect="${k}">${icon('cloud')}${st.mode === k ? MODES[k].label + ' · đổi tài khoản' : 'Kết nối ' + MODES[k].label}</button>`).join('')}</div>
      ${isDrive(st.mode) ? `<div class="panel" id="folder-block">
        <h3 class="section-title">Thư mục đồng bộ</h3>
        <p class="hint">Chọn một hoặc nhiều thư mục trên ổ. Mọi tệp nhạc và sách trong đó (kể cả thư mục con) được nhập vào thư viện khi đồng bộ. Trên Android, chọn thư mục chưa được hỗ trợ.</p>
        <div id="folder-picker"></div>
      </div>` : ''}
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
        <p class="hint">My Hub không tự đặt giới hạn số bài, số tệp hay kích thước tệp. Giới hạn duy nhất là hạn mức của trình duyệt trên máy này ; ứng dụng không thể nới các hạn mức đó, nhưng sẽ cảnh báo khi sắp đầy. Muốn không tốn chỗ: dùng “Liên kết thư mục (không sao chép)” trong Nhạc (máy tính).</p>
        ${st.mode !== 'local' ? `<div class="row-actions">
          <button class="btn" data-act="sync" ${conn ? '' : 'disabled'}>${icon('refresh')}Đồng bộ ngay</button>
          <button class="btn" data-act="unlink">Ngừng dùng ${esc(st.cloud.label)} (về Local)</button>
          <button class="btn danger-ghost" data-act="cloudwipe" ${conn ? '' : 'disabled'}>${icon('trash')}Xoá dữ liệu trên ${esc(st.cloud.label)}</button></div>` : ''}
      </div>
    </section>

    <section class="set-block">
      <h2 class="section-title">${icon('device')}Thiết bị dùng chung thư viện</h2>
      <div class="panel">
        <ul class="devices">${devices.map(d => `<li><span class="mod-icon">${icon(d.platform === 'android' || d.platform === 'ios' ? 'device' : 'apps')}</span>
          <span class="dev-main"><strong>${esc(d.name)}</strong>${d.id === me.id ? ' <span class="pill s-core">Máy này</span>' : ''}<span class="muted">Hoạt động ${fmtAgo(d.lastSeenAt)}</span></span>
          ${d.id === me.id ? '<button class="btn small" data-act="rename">Đổi tên</button>' : ''}</li>`).join('')}</ul>
        <p class="hint">${st.mode === 'local' ? 'Đăng nhập GitHub (chế độ Tài khoản GitHub) để tiến độ (đang nghe tới đâu, đọc tới trang nào) theo bạn sang điện thoại, máy Windows và bản APK.' : 'Dừng nhạc trên một máy, mở app trên máy khác sẽ tiếp tục đúng chỗ đó.'}</p>
      </div>
    </section>

    <section class="set-block">
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
      </div>
    </section>

    ${paramsSectionHtml()}

    <section class="set-block">
      <h2 class="section-title">${icon('download')}Sao lưu dữ liệu</h2>
      <div class="panel">
        <p>Xuất toàn bộ thư viện, liên kết, bộ sưu tập, module và cài đặt thành một tệp JSON. Tệp nội dung (nhạc, sách…) không nằm trong JSON.</p>
        <div class="row-actions">
          <button class="btn primary" data-act="export">${icon('download')}Xuất JSON</button>
          <button class="btn" data-act="import">${icon('upload')}Nhập JSON</button>
          <button class="btn danger-ghost" data-act="wipe">${icon('trash')}Xoá toàn bộ dữ liệu</button>
        </div>
      </div>
    </section>
  </section>`;

  const $ = (s) => root.querySelector(s);
  paramsOff?.(); paramsOff = bindParams(root, ctx.toast);
  const on = (act, fn) => root.querySelector(`[data-act="${act}"]`)?.addEventListener('click', fn);

  if (isDrive(st.mode) && root.querySelector('#folder-picker')) {
    import('../../core/storage/folder-ui.js').then(m => m.folderPicker(root.querySelector('#folder-picker'), st.mode, ctx.toast)).catch(() => {});
  }
  root.querySelectorAll('input[name="storage-mode"]').forEach(r => r.onchange = async () => {
    if (isDrive(r.value)) {   // Dropbox / OneDrive / WebDAV / pCloud: connect, then asks what to do with this device's data
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
  root.querySelectorAll('[data-connect]').forEach(b => b.onclick = async () => { const { useDrive } = await import('../../core/storage/cloud-ui.js'); await useDrive(b.dataset.connect, { reconnect: true }); render(); });
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
  on('wipe', async () => {
    if (!(await confirmBox('Xoá toàn bộ dữ liệu?', 'Mọi mục, liên kết, cài đặt và tệp lưu trên máy này sẽ mất. Dữ liệu đã đồng bộ lên GitHub không bị ảnh hưởng.', 'Xoá hết'))) return;
    const files = await db.files.toArray();
    const t = tasks.start({ label: 'Đang xoá dữ liệu', total: files.length + 1, detail: 'Xoá tệp trên máy…' });
    try {
      for (const f of files) { await ctx.storage.adapters.local.remove(f.locations?.local); t.step(1, f.name || ''); }
      t.update({ detail: 'Xoá cơ sở dữ liệu…' });
      await db.delete();
      t.finish('Đã xoá');
    } catch (e) { t.fail(e); ctx.toast(e.message, 'error'); return; }
    location.reload();
  });
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
