// Account page (#account): the GitHub account. Sign-in card when signed out, profile + sync + devices
// + security when signed in. Sync, devices and cloud deletion live in core/storage/index.js.
import { account } from '../../core/account.js';
import { db, getSetting } from '../../core/db.js';
import { tasks } from '../../core/tasks.js';
import { thisDevice, renameDevice } from '../../core/device.js';
import { icon } from '../../core/icons.js';
import { esc, confirmBox, fmtAgo, fmtBytes } from '../../core/ui.js';
import { avatar, formDialog, afterSignIn, signInGitHubFlow, githubDialog, wipeLocal, GITHUB_LOGO } from '../../core/account-ui.js';

let root, ctx, offs = [];
let notice = null;            // { kind: 'ok' | 'warn' | 'error', text } shown once at the top

export async function mount(el, context) {
  root = el; ctx = context;
  await render();
  let t = 0;
  const soon = () => { clearTimeout(t); t = setTimeout(render, 120); };
  offs.push(ctx.bus.on('account:changed', (e) => { if (e.reason !== 'refresh') soon(); }));
  offs.push(ctx.bus.on('sync:done', soon), ctx.bus.on('sync:cancelled', soon), ctx.bus.on('storage:mode', soon), ctx.bus.on('sync:error', soon));
  offs.push(ctx.bus.on('sync:start', () => setProgress({ state: 'running', done: 0, percent: 0, detail: 'Đang bắt đầu…' })));
  offs.push(ctx.bus.on('tasks:changed', (list) => { const tk = list.find(x => x.id === ctx.storage.taskId); if (tk) setProgress(tk); }));
  const onNet = () => soon();
  window.addEventListener('online', onNet); window.addEventListener('offline', onNet);
  offs.push(() => { window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet); clearTimeout(t); });
}
export function unmount() { offs.forEach(f => f()); offs = []; }

function setProgress(tk) {
  const box = root?.querySelector('[data-f="sync-progress"]');
  if (!box) return;
  box.hidden = tk.state !== 'running';
  const p = tk.percent ?? (tk.unit === 'percent' ? tk.done : null);
  box.querySelector('.bar i').style.width = (p ?? 0) + '%';
  box.querySelector('.acct-prog-t').textContent = [tk.label, tk.detail].filter(Boolean).join(' · ');
  box.querySelector('.num').textContent = p != null ? Math.floor(p) + '%' : '';
}

function noticeHtml() {
  if (!notice) return '';
  const n = notice; notice = null;
  return `<div class="notice acct-notice ${n.kind}" role="status">${icon(n.kind === 'ok' ? 'check' : 'info')}<p>${esc(n.text)}</p></div>`;
}

async function render() {
  if (!root) return;
  if (account.signedIn) await renderSignedIn(); else renderSignedOut();
  await addDriveCard();
}

// Dropbox / OneDrive: sign-in buttons on this page too (same flow as Settings → Lưu trữ).
const DRIVES = [['dropbox', 'Dropbox', 'Đăng nhập bằng mã, cần App key của một app Dropbox miễn phí.'], ['onedrive', 'OneDrive', 'Đăng nhập bằng mã, cần Client ID của một app Microsoft miễn phí.']];
async function addDriveCard() {
  const sec = root?.querySelector('.page');
  if (!sec) return;
  const cur = await ctx.storage.mode();
  sec.querySelector('.acct-drives')?.remove();
  sec.insertAdjacentHTML('beforeend', `<section class="panel acct-drives" style="margin-top:20px">
    <h2 class="section-title">${icon('cloud')}Đồng bộ qua ổ đám mây (cả tệp nhạc/sách)</h2>
    <p class="muted">Ngoài GitHub, bạn có thể đồng bộ thư viện, tiến độ và cả tệp nhạc/sách qua Dropbox hoặc OneDrive.</p>
    <div class="row-actions" style="flex-wrap:wrap">${DRIVES.map(([id, label, tip]) => `<button class="btn ${cur === id ? 'primary' : ''}" data-drive="${id}" title="${esc(tip)}">${icon('cloud')}${cur === id ? label + ' · đang dùng (đổi tài khoản)' : 'Kết nối ' + label}</button>`).join('')}</div>
    <p class="hint">${DRIVES.map(([, l, tip]) => `<b>${l}</b>: ${esc(tip)}`).join(' · ')}</p></section>`);
  sec.querySelectorAll('[data-drive]').forEach(b => b.onclick = async () => {
    const { useDrive } = await import('../../core/storage/cloud-ui.js');
    await useDrive(b.dataset.drive, { reconnect: true });
    render();
  });
}

const page = (eyebrow, title, body) => `<section class="page acct">
  <header class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div></header>
  ${noticeHtml()}${body}</section>`;

async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="task-spin"></i>Đang xử lý…';
  try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}

// ── Signed out ─────────────────────────────────────────────────
function renderSignedOut() {
  root.innerHTML = page('Đồng bộ giữa các máy', 'Đăng nhập', `
    <div class="acct-auth">
      <div class="panel acct-card acct-center">
        <span class="acct-big-ic">${GITHUB_LOGO}</span>
        <h2>Đăng nhập bằng GitHub</h2>
        <p class="muted">Dán một token GitHub của bạn. Thư viện và tiến độ nghe/đọc lưu trong một kho <b>riêng tư</b> trên GitHub của chính bạn; tệp nhạc/sách ở lại trên từng máy. Dùng được trên cả Windows và Android.</p>
        <p class="form-err" role="alert" hidden data-e="github"></p>
        <button class="btn primary block" data-act="github">${GITHUB_LOGO}Đăng nhập bằng GitHub</button>
        <p class="hint">${navigator.onLine ? 'Không cần cài thêm gì, chỉ cần tạo token một lần.' : 'Đang offline: cần có mạng để đăng nhập.'}</p>
      </div>
    </div>
    <aside class="acct-why">
      <h2>Một tài khoản, mọi thiết bị</h2>
      <ul>
        <li>${icon('refresh')}<span><b>Thư viện đồng bộ</b> giữa máy tính, điện thoại và bản APK.</span></li>
        <li>${icon('play')}<span><b>Nghe, đọc tiếp đúng chỗ</b>: dừng trên Windows, mở điện thoại là tiếp tục.</span></li>
        <li>${icon('cloud')}<span><b>Tệp nhạc/sách ở lại trên máy</b>: chỉ thư viện và tiến độ được đồng bộ.</span></li>
        <li>${icon('device')}<span><b>Vẫn chạy offline</b>: mọi thay đổi được lưu trên máy rồi gửi đi khi có mạng.</span></li>
      </ul>
      <p class="hint">Không muốn đăng nhập? App vẫn dùng đầy đủ ở chế độ Trên máy. <a href="#settings">Cài đặt lưu trữ</a></p>
    </aside>`);
  const showErr = (which, err) => {
    const errEl = root.querySelector(`[data-e="${which}"]`);
    if (root.isConnected && errEl?.isConnected) { errEl.textContent = err.message; errEl.hidden = false; } else ctx.toast(err.message, 'error');
  };
  root.querySelector('[data-act=github]').onclick = async (e) => {
    root.querySelector('[data-e=github]').hidden = true;
    try { await busy(e.currentTarget, () => signInGitHubFlow()); } catch (err) { showErr('github', err); }
  };
}

// ── Signed in ──────────────────────────────────────────────────
async function renderSignedIn() {
  const u = account.user;
  const st = await ctx.storage.status();
  const me = await thisDevice();
  const liveAt = await getSetting('sync.liveAt', null);
  const devices = (await db.devices.orderBy('lastSeenAt').reverse().toArray()).filter(d => !d.sample);
  devices.sort((a, b) => (b.id === me.id) - (a.id === me.id));
  const states = await Promise.all(devices.map(d => ctx.storage.deviceState(d)));
  const on = st.mode !== 'local';
  const reconnect = account.needsReconnect;
  const cloudName = 'GitHub';
  const running = tasks.all().find(t => t.id === ctx.storage.taskId && t.state === 'running');
  const syncState = !on ? ['warn', 'Chưa bật trên máy này'] : !navigator.onLine ? ['warn', 'Offline'] : reconnect ? ['warn', 'Cần kết nối lại']
    : st.pending ? ['warn', `${st.pending} thay đổi chờ gửi`] : ['ok', 'Đã đồng bộ'];

  root.innerHTML = page('Tài khoản GitHub', `Xin chào, ${esc(account.displayName(u))}`, `
    ${reconnect && navigator.onLine ? `<div class="notice warn">${icon('info')}<p><b>Token GitHub không còn hiệu lực trên máy này.</b> Tạo token mới và dán lại để tiếp tục đồng bộ.</p><button class="btn primary" data-act="reconnect">Nhập token mới</button></div>` : ''}
    ${!on ? `<div class="notice">${icon('refresh')}<p><b>Máy này chưa đồng bộ với tài khoản.</b> Bật để thư viện, tiến độ và tệp trên máy này đi cùng tài khoản GitHub. Hiện đang dùng chế độ “Trên máy”.</p><button class="btn primary" data-act="enable">Bật đồng bộ</button></div>` : ''}
    <div class="acct-grid">
      <section class="panel acct-profile" aria-labelledby="h-profile">
        <div class="acct-hero">${avatar(u, 'lg')}<div class="acct-hero-t"><h2 id="h-profile">${esc(account.displayName(u))}</h2><span class="muted">${esc(u?.email || '')}</span>
          <span class="acct-pills"><span class="pill">${GITHUB_LOGO}GitHub</span><span class="pill">Đăng nhập ${fmtAgo(account.signedInAt)}</span></span></div></div>
        <dl class="kv">
          <dt>Lưu dữ liệu ở</dt><dd>Kho riêng tư <code>${esc(u?.login || '')}/my-hub-data</code> trên GitHub · thư viện và tiến độ (tệp ở lại trên máy)</dd>
          <dt>Chế độ trên máy này</dt><dd>${esc(ctx.storage.MODES?.[st.mode]?.label || st.mode)}<a class="btn small" href="#settings">Đổi</a></dd>
        </dl>
      </section>

      <section class="panel acct-sync" aria-labelledby="h-sync">
        <h2 class="panel-title" id="h-sync">${icon('refresh')}Đồng bộ <span class="pill ${syncState[0]}">${syncState[1]}</span></h2>
        <dl class="kv">
          <dt>Lần đồng bộ cuối</dt><dd>${on ? fmtAgo(st.lastSync) : '—'}</dd>
          <dt>Tiến độ nghe/đọc</dt><dd>${on ? `Gửi vài giây sau mỗi lần dừng · ${fmtAgo(liveAt)}` : '—'}</dd>
          <dt>Máy này lưu tệp bằng</dt><dd>${st.backend === 'opfs' ? 'OPFS' : 'IndexedDB'}${st.usage ? ` · <span class="num">${fmtBytes(st.usage.usage)}</span>` : ''}</dd>
        </dl>
        <div class="acct-progress" data-f="sync-progress" ${running ? '' : 'hidden'} aria-live="polite">
          <div class="acct-prog-row"><span class="acct-prog-t"></span><span class="num"></span></div><span class="bar lg"><i style="width:0%"></i></span></div>
        <div class="row-actions">
          <button class="btn primary" data-act="sync" ${on ? '' : 'disabled'}>${icon('refresh')}Đồng bộ ngay</button>
          <a class="btn" href="#settings">${icon('database')}Cài đặt lưu trữ</a>
        </div>
      </section>

      <section class="panel acct-devices" aria-labelledby="h-dev">
        <h2 class="panel-title" id="h-dev">${icon('device')}Thiết bị</h2>
        <ul class="devices">${devices.map((d, i) => `<li>
          <span class="mod-icon">${icon(d.platform === 'android' || d.platform === 'ios' ? 'device' : 'apps')}</span>
          <span class="dev-main"><strong>${esc(d.name || 'Thiết bị')}</strong>${d.id === me.id ? ' <span class="pill s-core">Máy này</span>' : states[i] === 'signed-out' ? ' <span class="pill">Đã đăng xuất</span>' : ''}<span class="muted">Hoạt động ${fmtAgo(d.lastSeenAt)}</span></span>
          ${d.id === me.id ? '<button class="btn small" data-act="rename">Đổi tên</button>' : states[i] === 'signed-out' ? '' : `<button class="btn small" data-signout="${esc(d.id)}" data-name="${esc(d.name || '')}" ${on ? '' : 'disabled'}>Đăng xuất</button>`}</li>`).join('')}</ul>
        <p class="hint">${on ? 'Các máy đồng bộ với tài khoản này. "Đăng xuất" một máy có hiệu lực khi máy đó có mạng và đồng bộ lần tới; dữ liệu trên máy đó không bị xoá.' : 'Bật đồng bộ để thấy các máy khác dùng tài khoản này.'}</p>
      </section>

      <section class="panel acct-security" aria-labelledby="h-sec">
        <h2 class="panel-title" id="h-sec">${icon('shield')}Đăng xuất & dữ liệu trên ${cloudName}</h2>
        <div class="acct-actions">
          <button class="btn" data-act="signout">${icon('logout')}Đăng xuất</button>
          <button class="btn" data-act="signout-all" ${on ? '' : 'disabled'}>${icon('logout')}Đăng xuất mọi thiết bị</button>
        </div>
        <p class="hint">Đăng xuất không xoá thư viện trên máy; app chuyển về chế độ Trên máy.</p>
        <div class="acct-danger">
          <div><b>Xoá dữ liệu trên ${cloudName}</b><p class="hint">Xoá hai tệp dữ liệu (thư viện, tiến độ, thiết bị) trong kho my-hub-data, rồi ngắt kết nối. Kho vẫn còn, bạn có thể tự xoá trên GitHub. Thư viện trên máy này vẫn còn. Không thể hoàn tác.</p></div>
          <button class="btn danger-ghost" data-act="delete">${icon('trash')}Xoá dữ liệu trên ${cloudName}</button>
        </div>
      </section>
    </div>`);
  if (running) setProgress(running);
  wireSignedIn(me);
}

function wireSignedIn(me) {
  const renew = () => githubDialog();   // paste a new token
  const on = (act, fn) => root.querySelector(`[data-act="${act}"]`)?.addEventListener('click', fn);
  on('enable', () => afterSignIn());
  on('reconnect', async (e) => {
    try { await busy(e.currentTarget, () => renew()); ctx.toast('Đã kết nối lại'); ctx.storage.syncSoon(300); }
    catch (err) { ctx.toast(err.message, 'error'); }
  });
  on('sync', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      if (!account.tokenValid()) await renew();   
      const r = await ctx.storage.sync();
      if (r?.skipped === 'offline') ctx.toast('Đang offline, sẽ đồng bộ khi có mạng', 'warn');
      else if (r?.skipped) ctx.toast('Chưa thể đồng bộ: ' + r.skipped, 'warn');
      else if (r && !r.cancelled && !r.pulled && !r.uploaded && !r.signedOut) ctx.toast('Đã đồng bộ, không có thay đổi mới');
    } catch (err) { ctx.toast(err.message, 'error'); }
    finally { if (b.isConnected) b.disabled = false; render(); }
  });
  on('rename', () => formDialog({
    title: 'Tên thiết bị', fields: [{ name: 'name', label: 'Tên hiển thị trên các máy khác', value: me.name }],
    onSubmit: async (v) => { if (!v.name.trim()) throw new Error('Nhập tên thiết bị.'); await renameDevice(v.name.trim()); ctx.storage.syncLiveSoon?.(0); },
  }).then(ok => ok && render()));
  root.querySelectorAll('[data-signout]').forEach(b => b.onclick = async () => {
    if (!(await confirmBox(`Đăng xuất "${b.dataset.name}"?`, 'Máy đó sẽ tự đăng xuất lần tới khi có mạng và đồng bộ. Dữ liệu trên máy đó không bị xoá.', 'Đăng xuất máy đó', 'primary'))) return;
    try { await ctx.storage.signOutDevice(b.dataset.signout); ctx.toast('Đã gửi yêu cầu đăng xuất'); render(); }
    catch (err) { ctx.toast(err.message, 'error'); }
  });
  on('signout', () => formDialog({
    title: 'Đăng xuất khỏi máy này?', submit: 'Đăng xuất', kind: 'primary',
    intro: 'Thay đổi chưa gửi sẽ được đồng bộ lần cuối nếu có mạng. Sau đó app dùng chế độ Trên máy.',
    extra: `<label class="check"><input type="checkbox" name="wipe"> Xoá luôn thư viện và tệp trên máy này</label>`,
    onSubmit: async (v) => {
      if ((await ctx.storage.mode()) !== 'local' && navigator.onLine && account.tokenValid()) await ctx.storage.sync({ quiet: true }).catch(() => {});
      await account.signOut();
      return v.wipe ? 'wipe' : 'keep';
    },
  }).then(async (r) => {
    if (!r) return;
    if (r === 'wipe') await wipeLocal(tasks);
    ctx.toast('Đã đăng xuất');
  }));
  on('signout-all', async () => {
    if (!(await confirmBox('Đăng xuất mọi thiết bị?', 'Mọi máy đang dùng tài khoản này (kể cả máy này) sẽ đăng xuất lần tới khi có mạng. Dữ liệu trên các máy vẫn còn; đăng nhập lại để đồng bộ tiếp.', 'Đăng xuất tất cả'))) return;
    try {
      if (account.tokenValid()) await ctx.storage.sync({ quiet: true }).catch(() => {});
      else await renew();
      await ctx.storage.signOutEverywhere();
      ctx.toast('Đã đăng xuất mọi thiết bị');
    } catch (err) { ctx.toast(err.message, 'error'); }
  });
  on('delete', () => {
    const email = account.email;
    formDialog({
      title: 'Xoá dữ liệu My Hub trên GitHub?', submit: 'Xoá vĩnh viễn', kind: 'danger',
      intro: `Hai tệp dữ liệu của My Hub trong kho <code>my-hub-data</code> của <b>${esc(email)}</b> sẽ bị xoá; các máy khác không còn gì để đồng bộ. Thư viện trên các máy vẫn còn.`,
      fields: [{ name: 'confirm', label: 'Gõ XOÁ để xác nhận', autocomplete: 'off', placeholder: 'XOÁ' }],
      extra: '<label class="check"><input type="checkbox" name="signout" checked> Đăng xuất khỏi máy này sau khi xoá</label>',
      onSubmit: async (v) => {
        const typed = String(v.confirm || '').trim().toUpperCase();
        if (typed !== 'XOÁ' && typed !== 'XOA') throw new Error('Gõ đúng chữ XOÁ để xác nhận.');
        if (!navigator.onLine) throw new Error('Cần có mạng để xoá dữ liệu trên GitHub.');
        if (!account.tokenValid()) await renew();
        const n = await ctx.storage.deleteCloudData();
        if (n < 0) throw new Error('Đã huỷ. Một phần dữ liệu có thể đã bị xoá.');
        if (v.signout) await account.signOut();
        else await ctx.storage.setMode('local');
        return n;
      },
    }).then((n) => {
      if (n == null || n === false) return;
      notice = { kind: 'ok', text: `Đã xoá ${n} tệp của My Hub trên GitHub. Thư viện trên máy này vẫn dùng được ở chế độ Trên máy.` };
      render();
    });
  });
}
