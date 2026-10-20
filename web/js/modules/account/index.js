// Account page (#account): the Google account. Setup guide when no Google Client ID is
// configured, "Đăng nhập bằng Google" when signed out, profile + sync + devices + security when
// signed in. Sync, devices and cloud deletion live in core/storage/index.js.
import { account } from '../../core/account.js';
import { db, getSetting } from '../../core/db.js';
import { tasks } from '../../core/tasks.js';
import { thisDevice, renameDevice } from '../../core/device.js';
import { icon } from '../../core/icons.js';
import { esc, confirmBox, fmtAgo, fmtBytes } from '../../core/ui.js';
import { avatar, formDialog, afterSignIn, signInFlow, wipeLocal, GOOGLE_LOGO } from '../../core/account-ui.js';

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
  if (!account.configured()) return renderSetup();
  if (account.signedIn) return renderSignedIn();
  return renderSignedOut();
}

const page = (eyebrow, title, body) => `<section class="page acct">
  <header class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div></header>
  ${noticeHtml()}${body}</section>`;

async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="task-spin"></i>Đang xử lý…';
  try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}

// ── Not configured: setup guide ────────────────────────────────
function renderSetup() {
  const site = location.origin;
  const copy = (v) => `<div class="acct-copy"><code>${esc(v)}</code><button class="btn small" data-copy="${esc(v)}">Sao chép</button></div>`;
  root.innerHTML = page('Đồng bộ giữa các máy', 'Tài khoản Google', `
    <div class="notice">${icon('info')}<p><b>Đăng nhập Google chưa được bật cho bản cài đặt này.</b> App vẫn chạy đầy đủ ở chế độ <b>Trên máy</b>. Làm các bước dưới đây một lần (miễn phí, khoảng 10 phút) để đăng nhập bằng Google và đồng bộ thư viện, tiến độ và tệp giữa máy tính và điện thoại qua Google Drive của bạn.</p></div>
    <ol class="acct-steps">
      <li><b>Tạo project Google Cloud</b><p>Vào <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> → <i>New project</i>, đặt tên (ví dụ “My Hub”) → <i>Create</i>, rồi chọn project đó ở thanh trên cùng.</p></li>
      <li><b>Bật Google Drive API</b><p><i>APIs &amp; Services → Library</i>, tìm <b>Google Drive API</b> → <i>Enable</i>.</p></li>
      <li><b>Màn hình đồng ý OAuth</b><p><i>APIs &amp; Services → OAuth consent screen</i> (hoặc <i>Google Auth Platform → Branding</i>): loại <b>External</b>, điền tên app, email hỗ trợ, email liên hệ. Ở <i>Data access / Scopes</i> thêm <code>.../auth/drive.appdata</code>, <code>.../auth/drive.file</code>, <code>openid</code>, <code>email</code>, <code>profile</code> (đều không nhạy cảm, không cần Google duyệt). Ở <i>Audience / Test users</i> thêm Gmail của bạn, hoặc bấm <i>Publish app</i> để ai cũng đăng nhập được.</p></li>
      <li><b>Tạo Client ID loại Web</b><p><i>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</i>, chọn <b>Web application</b>. Trong <i>Authorized JavaScript origins</i> thêm địa chỉ app đã đăng (chỉ phần gốc, không có đường dẫn) và địa chỉ chạy thử:</p>
        ${copy(site)}${site.startsWith('http://localhost') ? '' : copy('http://localhost:8080')}
        <p class="hint">Ví dụ <code>https://ten-ban.github.io</code>. Không cần <i>redirect URI</i>. Thay đổi có thể mất vài phút mới có hiệu lực.</p></li>
      <li><b>Dán Client ID vào app</b><p>Sao chép <i>Client ID</i> (dạng <code>1234…apps.googleusercontent.com</code>) vào <code>js/config.js</code>, rồi đăng lại app:</p>
        <pre class="acct-code">export const GOOGLE_CLIENT_ID = '1234-abc.apps.googleusercontent.com';</pre></li>
      <li><b>Đăng nhập trên từng máy</b><p>Mở lại trang này, bấm <i>Đăng nhập bằng Google</i>, rồi đăng nhập cùng tài khoản trên điện thoại. Thư viện, tiến độ nghe/đọc và tệp sẽ tự đồng bộ.</p></li>
    </ol>
    <div class="panel acct-security-note">${icon('shield')}<p>Client ID là công khai theo thiết kế, không có mật khẩu hay khoá bí mật nào trong app. My Hub chỉ thấy thư mục ẩn của chính nó và các tệp nó tạo trên Drive, không đọc được phần còn lại của Drive. Chi tiết trong <code>docs/ACCOUNT.md</code>.</p></div>
    <div class="row-actions"><a class="btn" href="#settings">${icon('settings')}Cài đặt lưu trữ</a></div>`);
  root.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); ctx.toast('Đã sao chép'); } catch { ctx.toast('Hãy chọn và sao chép thủ công', 'warn'); }
  });
}

// ── Signed out ─────────────────────────────────────────────────
function renderSignedOut() {
  root.innerHTML = page('Đồng bộ giữa các máy', 'Tài khoản Google', `
    <div class="acct-auth">
      <div class="panel acct-card acct-center">
        <span class="acct-big-ic">${GOOGLE_LOGO}</span>
        <h2>Đăng nhập bằng Google</h2>
        <p class="muted">Dùng tài khoản Google của bạn. Dữ liệu được lưu trong Google Drive của chính bạn, trong một thư mục ẩn chỉ My Hub đọc được.</p>
        <p class="form-err" role="alert" hidden></p>
        <button class="btn primary block acct-google" data-act="google">${GOOGLE_LOGO}Đăng nhập bằng Google</button>
        <p class="hint">${navigator.onLine ? 'Một cửa sổ Google sẽ mở ra để chọn tài khoản và cho phép truy cập Drive.' : 'Đang offline: cần có mạng để đăng nhập.'}</p>
      </div>
      <aside class="acct-why">
        <h2>Một tài khoản, mọi thiết bị</h2>
        <ul>
          <li>${icon('refresh')}<span><b>Thư viện đồng bộ</b> giữa máy tính, điện thoại và bản APK.</span></li>
          <li>${icon('play')}<span><b>Nghe, đọc tiếp đúng chỗ</b>: dừng trên Windows, mở điện thoại là tiếp tục.</span></li>
          <li>${icon('cloud')}<span><b>Tệp được sao lưu</b> vào Google Drive của bạn, mở trên máy khác khi cần.</span></li>
          <li>${icon('device')}<span><b>Vẫn chạy offline</b>: mọi thay đổi được lưu trên máy rồi gửi đi khi có mạng.</span></li>
        </ul>
        <p class="hint">Không muốn đăng nhập? App vẫn dùng đầy đủ ở chế độ Trên máy. <a href="#settings">Cài đặt lưu trữ</a></p>
      </aside>
    </div>`);
  root.querySelector('[data-act=google]').onclick = async (e) => {
    const errEl = root.querySelector('.form-err');
    errEl.hidden = true;
    try { await busy(e.currentTarget, () => signInFlow()); }
    catch (err) { if (root.isConnected && errEl.isConnected) { errEl.textContent = err.message; errEl.hidden = false; } else ctx.toast(err.message, 'error'); }
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
  const driveFiles = await db.files.filter(f => !!f.locations?.gdrive).toArray();
  const on = st.mode !== 'local';
  const reconnect = account.needsReconnect;
  const running = tasks.all().find(t => t.id === ctx.storage.taskId && t.state === 'running');
  const syncState = !on ? ['warn', 'Chưa bật trên máy này'] : !navigator.onLine ? ['warn', 'Offline'] : reconnect ? ['warn', 'Cần kết nối lại']
    : st.pending ? ['warn', `${st.pending} thay đổi chờ gửi`] : ['ok', 'Đã đồng bộ'];

  root.innerHTML = page('Tài khoản Google', `Xin chào, ${esc(account.displayName(u))}`, `
    ${reconnect && navigator.onLine ? `<div class="notice warn">${icon('info')}<p><b>Phiên Google đã hết hạn trên máy này</b> (Google cấp quyền theo từng giờ). Bấm một lần để tiếp tục đồng bộ, không cần nhập lại mật khẩu.</p><button class="btn primary" data-act="reconnect">${GOOGLE_LOGO}Kết nối lại</button></div>` : ''}
    ${!on ? `<div class="notice">${icon('refresh')}<p><b>Máy này chưa đồng bộ với tài khoản.</b> Bật để thư viện, tiến độ và tệp trên máy này đi cùng tài khoản Google. Hiện đang dùng chế độ “Trên máy”.</p><button class="btn primary" data-act="enable">Bật đồng bộ</button></div>` : ''}
    <div class="acct-grid">
      <section class="panel acct-profile" aria-labelledby="h-profile">
        <div class="acct-hero">${avatar(u, 'lg')}<div class="acct-hero-t"><h2 id="h-profile">${esc(account.displayName(u))}</h2><span class="muted">${esc(u?.email || '')}</span>
          <span class="acct-pills"><span class="pill">${GOOGLE_LOGO}Google</span><span class="pill">Đăng nhập ${fmtAgo(account.signedInAt)}</span></span></div></div>
        <dl class="kv">
          <dt>Lưu dữ liệu ở</dt><dd>Google Drive của ${esc(u?.email || 'bạn')} · thư mục ẩn của app + thư mục “My Hub”</dd>
          <dt>Chế độ trên máy này</dt><dd>${esc(ctx.storage.MODES?.[st.mode]?.label || { local: 'Chỉ trên máy', gdrive: 'Tài khoản Google', hybrid: 'Kết hợp' }[st.mode])}<a class="btn small" href="#settings">Đổi</a></dd>
        </dl>
      </section>

      <section class="panel acct-sync" aria-labelledby="h-sync">
        <h2 class="panel-title" id="h-sync">${icon('refresh')}Đồng bộ <span class="pill ${syncState[0]}">${syncState[1]}</span></h2>
        <dl class="kv">
          <dt>Lần đồng bộ cuối</dt><dd>${on ? fmtAgo(st.lastSync) : '—'}</dd>
          <dt>Tiến độ nghe/đọc</dt><dd>${on ? `Gửi vài giây sau mỗi lần dừng · ${fmtAgo(liveAt)}` : '—'}</dd>
          <dt>Tệp trên Drive</dt><dd class="num">${driveFiles.length} tệp · ${fmtBytes(driveFiles.reduce((s, f) => s + (f.locations.gdrive.size || f.size || 0), 0))}</dd>
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
        <h2 class="panel-title" id="h-sec">${icon('shield')}Đăng xuất & dữ liệu trên Drive</h2>
        <div class="acct-actions">
          <button class="btn" data-act="signout">${icon('logout')}Đăng xuất</button>
          <button class="btn" data-act="signout-all" ${on ? '' : 'disabled'}>${icon('logout')}Đăng xuất mọi thiết bị</button>
        </div>
        <p class="hint">Đăng xuất không xoá thư viện trên máy; app chuyển về chế độ Trên máy.</p>
        <div class="acct-danger">
          <div><b>Xoá dữ liệu trên Google Drive</b><p class="hint">Xoá thư mục ẩn của My Hub (thư viện, tiến độ, thiết bị) và mọi tệp app đã tải lên Drive, rồi ngắt kết nối. Thư viện trên máy này vẫn còn. Không thể hoàn tác.</p></div>
          <button class="btn danger-ghost" data-act="delete">${icon('trash')}Xoá dữ liệu trên Drive</button>
        </div>
      </section>
    </div>`);
  if (running) setProgress(running);
  wireSignedIn(me);
}

function wireSignedIn(me) {
  const on = (act, fn) => root.querySelector(`[data-act="${act}"]`)?.addEventListener('click', fn);
  on('enable', () => afterSignIn());
  on('reconnect', async (e) => {
    try { await busy(e.currentTarget, () => account.reconnect()); ctx.toast('Đã kết nối lại'); ctx.storage.syncSoon(300); }
    catch (err) { ctx.toast(err.message, 'error'); }
  });
  on('sync', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      if (!account.tokenValid()) await account.reconnect();   // inside the click: the popup is allowed
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
    extra: `<label class="check"><input type="checkbox" name="revoke"> Thu hồi quyền của My Hub với Google Drive (các máy khác sẽ phải bấm “Kết nối lại”)</label>
      <label class="check"><input type="checkbox" name="wipe"> Xoá luôn thư viện và tệp trên máy này</label>`,
    onSubmit: async (v) => {
      if ((await ctx.storage.mode()) !== 'local' && navigator.onLine && account.tokenValid()) await ctx.storage.sync({ quiet: true }).catch(() => {});
      await account.signOut({ revoke: !!v.revoke });
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
      else await account.reconnect();
      await ctx.storage.signOutEverywhere();
      ctx.toast('Đã đăng xuất mọi thiết bị');
    } catch (err) { ctx.toast(err.message, 'error'); }
  });
  on('delete', () => {
    const email = account.email;
    formDialog({
      title: 'Xoá dữ liệu My Hub trên Google Drive?', submit: 'Xoá vĩnh viễn', kind: 'danger',
      intro: `Thư mục ẩn của My Hub và mọi tệp app đã tải lên Drive của <b>${esc(email)}</b> sẽ bị xoá; các máy khác không còn gì để đồng bộ. Tệp chỉ nằm trên Drive (chưa có bản trên máy này) sẽ mất. Không thể hoàn tác.`,
      fields: [{ name: 'confirm', label: 'Gõ XOÁ để xác nhận', autocomplete: 'off', placeholder: 'XOÁ' }],
      extra: '<label class="check"><input type="checkbox" name="signout" checked> Đăng xuất khỏi máy này sau khi xoá</label>',
      onSubmit: async (v) => {
        const typed = String(v.confirm || '').trim().toUpperCase();
        if (typed !== 'XOÁ' && typed !== 'XOA') throw new Error('Gõ đúng chữ XOÁ để xác nhận.');
        if (!navigator.onLine) throw new Error('Cần có mạng để xoá dữ liệu trên Drive.');
        if (!account.tokenValid()) await account.reconnect();
        const n = await ctx.storage.deleteCloudData();
        if (n < 0) throw new Error('Đã huỷ. Một phần dữ liệu có thể đã bị xoá.');
        if (v.signout) await account.signOut();
        else await ctx.storage.setMode('local');
        return n;
      },
    }).then((n) => {
      if (n == null || n === false) return;
      notice = { kind: 'ok', text: `Đã xoá ${n} tệp của My Hub trên Google Drive. Thư viện trên máy này vẫn dùng được ở chế độ Trên máy.` };
      render();
    });
  });
}
