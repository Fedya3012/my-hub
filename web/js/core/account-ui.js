// Account UI pieces used outside the account page: the sidebar badge, the Settings summary,
// form dialogs that stay open on errors, and turning sync on after signing in with GitHub
// (with the "this device already has data" choice). The account page is js/modules/account/index.js.
import { account } from './account.js';
import { storage } from './storage/index.js';
import { github } from './storage/github.js';
import { db, getSetting, setSetting } from './db.js';
import { bus } from './bus.js';
import { icon, registerIcons } from './icons.js';
import { esc, h, modal, confirmBox, toast } from './ui.js';

registerIcons({
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.6v.2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
});

export const GITHUB_LOGO = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>`;

// Messages from the sync backend (signed out from another device…).
bus.on('account:notice', ({ kind, message }) => toast(message, kind || 'info'));

// Profile photo, with the initial underneath (shown offline or when the photo fails).
export function avatar(u = account.user, cls = '') {
  const name = account.displayName(u);
  const ch = (name.trim()[0] || '?').toUpperCase();
  const img = u?.picture && navigator.onLine
    ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="acct-avatar ${cls}" aria-hidden="true">${esc(ch)}${img}</span>`;
}

const MODE_LABEL = { local: 'Trên máy', github: 'Tài khoản GitHub', dropbox: 'Dropbox', webdav: 'WebDAV', onedrive: 'OneDrive', pcloud: 'pCloud' };

// Sidebar footer badge. s = storage.status(). Always links to the account page.
export function badge(s) {
  if (s.cloud?.drive) {   // Dropbox / OneDrive / WebDAV / pCloud
    const state = !s.cloud.connected ? 'Bấm để kết nối lại' : !navigator.onLine ? 'Offline · đồng bộ khi có mạng' : s.pending ? `${s.pending} chờ đồng bộ` : 'Đã đồng bộ';
    return { href: '#settings', title: `${MODE_LABEL[s.mode]} · ${state}`, html: `${icon('cloud')}<span class="acct-badge-t"><b>${esc(MODE_LABEL[s.mode])}</b><small>${esc(state)}</small></span>` };
  }
  if (account.signedIn) {
    const state = s.mode === 'local' ? 'Chưa bật đồng bộ'
      : !navigator.onLine ? 'Offline · đồng bộ khi có mạng'
      : account.needsReconnect ? 'Bấm để kết nối lại'
      : s.pending ? `${s.pending} chờ đồng bộ` : 'Đã đồng bộ';
    return {
      href: '#account',
      title: `${account.email} · ${state}`,
      html: `${avatar(account.user, 'sm')}<span class="acct-badge-t"><b>${esc(account.displayName())}</b><small>${esc(state)}</small></span>`,
    };
  }
  const label = MODE_LABEL[s.mode] || s.mode;
  return {
    href: '#account',
    title: 'Chế độ lưu trữ: ' + label + (account.configured() ? ' · Đăng nhập để đồng bộ giữa các máy' : ''),
    html: `${icon(s.mode === 'local' ? 'device' : 'cloud')}<span class="acct-badge-t"><b>${esc(label)}${s.pending ? ` · ${s.pending} chờ` : ''}</b><small>Đăng nhập để đồng bộ</small></span>`,
  };
}

// Block for the top of Settings.
export function accountSummary() {
  let body;
  if (account.signedIn) {
    body = `${avatar(account.user, 'md')}<span class="acct-sum-t"><strong>${esc(account.displayName())}</strong><span class="muted">${esc(account.email)}${account.needsReconnect ? ' · cần kết nối lại' : ''}</span></span>`;
  } else {
    body = `<span class="mod-icon">${icon('user')}</span><span class="acct-sum-t"><strong>Đăng nhập để đồng bộ</strong><span class="muted">Bằng GitHub (dán token), hoặc kết nối Dropbox, OneDrive, WebDAV, pCloud (đồng bộ cả tệp nhạc/sách).</span></span>`;
  }
  return `<section class="set-block" id="set-account">
      <h2 class="section-title">${icon('user')}${account.signedIn ? 'Tài khoản GitHub' : 'Tài khoản'}</h2>
      <a class="panel acct-summary" href="#account">${body}<span class="acct-sum-go">${icon('arrow')}</span></a>
    </section>`;
}

// Dialog with a real <form>: stays open and shows the error when onSubmit throws.
// fields: [{ name, label, type, value, autocomplete, placeholder, hint }]
export function formDialog({ title, intro = '', fields = [], extra = '', submit = 'Lưu', kind = 'primary', onSubmit, onRender }) {
  return new Promise((resolve) => {
    const el = h(`<div class="modal-wrap" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <form class="modal acct-dialog" novalidate>
        <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('x')}</button></header>
        <div class="modal-body stack">
          ${intro ? `<p class="muted">${intro}</p>` : ''}
          ${fields.map(f => `<label>${esc(f.label)}<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>${f.hint ? `<small class="muted">${esc(f.hint)}</small>` : ''}</label>`).join('')}
          ${extra}
          <p class="form-err" role="alert" hidden></p>
        </div>
        <footer><button type="button" class="btn" data-close>Huỷ</button><button type="submit" class="btn ${kind}">${esc(submit)}</button></footer>
      </form></div>`);
    const form = el.querySelector('form'), errEl = el.querySelector('.form-err'), btn = form.querySelector('[type=submit]');
    const close = (v) => { el.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => close(null));
    el.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Đã sao chép'); } catch { toast('Hãy chọn và sao chép thủ công', 'warn'); }
    });
    el.addEventListener('click', (e) => { if (e.target === el) close(null); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      form.querySelectorAll('input[type=checkbox]').forEach(c => { values[c.name] = c.checked; });
      btn.disabled = true; errEl.hidden = true;
      const label = btn.textContent; btn.textContent = 'Đang xử lý…';
      try { const r = await onSubmit(values, form); close(r ?? true); }
      catch (err) { errEl.textContent = err.message; errEl.hidden = false; btn.disabled = false; btn.textContent = label; }
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    onRender?.(form);
    (form.querySelector('input') || btn).focus();
  });
}

// After signing in (or "Bật đồng bộ" / choosing a cloud mode in Settings): decide what happens to
// this device's library, switch to a cloud mode and start the first sync (progress in the tray).
// → 'merge' | 'replace' | 'later' | 'same'
export async function afterSignIn() {
  if (!account.signedIn) return 'later';
  const uid = account.uid;
  const cur = await storage.mode();
  const lastUid = await getSetting('account.lastUid', null);
  const target = 'github';
  if (cur !== 'local' && lastUid === uid) {
    if (cur !== target) await storage.setMode(target);
    storage.sync().catch(e => toast(e.message, 'error'));
    return 'same';
  }

  let choice = 'merge';
  let remote = false;
  try { remote = await storage.remoteHasData(); }
  catch (e) { if (navigator.onLine) { toast(e.message, 'error'); return 'later'; } }
  if (remote && (await storage.hasLocalData())) {
    const other = lastUid && lastUid !== uid;
    choice = await modal({
      title: 'Máy này đã có dữ liệu',
      body: `<div class="stack"><p>Thư viện trên máy này${other ? ' có thể thuộc một tài khoản khác' : ''} chưa nằm trong tài khoản <b>${esc(account.email)}</b>, và tài khoản đã có dữ liệu từ máy khác. Bạn muốn làm gì?</p>
        <ul class="acct-choices">
          <li><b>Gộp</b> (khuyên dùng): giữ cả hai, mục nào sửa sau cùng thì thắng.</li>
          <li><b>Dùng dữ liệu của tài khoản</b>: thay thư viện trên máy này bằng bản trong tài khoản. Những gì chỉ có trên máy này sẽ mất.</li>
          <li><b>Để sau</b>: vẫn đăng nhập nhưng chưa đồng bộ máy này.</li></ul></div>`,
      actions: [{ label: 'Để sau', value: 'later' }, { label: 'Dùng dữ liệu của tài khoản', value: 'replace', kind: 'danger-ghost' }, { label: 'Gộp', value: 'merge', kind: 'primary' }],
    }) || 'later';
  }
  if (choice === 'later') { bus.emit('account:changed', { user: account.user, signedIn: true, reason: 'later' }); return 'later'; }
  if (choice === 'replace' && !(await confirmBox('Thay dữ liệu trên máy này?', 'Thư viện trên máy này sẽ được thay bằng dữ liệu trong tài khoản. Những mục chỉ có trên máy này sẽ bị xoá.', 'Thay dữ liệu'))) return afterSignIn();
  await storage.setMode(target);
  await setSetting('account.lastUid', uid);
  try {
    if (choice === 'replace') await storage.replaceLocal();
    else await storage.mergeLocal();
  } catch (e) { toast(e.message, 'error'); return choice; }
  storage.sync().then((r) => {
    if (r?.skipped === 'offline') toast('Đang offline, sẽ đồng bộ khi có mạng', 'warn');
  }).catch(e => toast('Đồng bộ lỗi: ' + e.message, 'error'));
  return choice;
}

// GitHub sign-in: a dialog that takes a personal access token, then turns sync on.
export const GITHUB_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=My%20Hub';
export async function githubDialog() {
  const ok = await formDialog({
    title: 'Đăng nhập bằng GitHub',
    intro: `Dán một <b>token GitHub</b> (Personal access token). Cách tạo trong 1 phút: mở <a href="${GITHUB_TOKEN_URL}" target="_blank" rel="noopener">trang tạo token</a>, chọn thời hạn (ví dụ <i>No expiration</i>), giữ ô <b>repo</b> được chọn, bấm <i>Generate token</i> rồi sao chép chuỗi bắt đầu bằng <code>ghp_</code>. My Hub sẽ tạo một kho <b>riêng tư</b> tên <code>my-hub-data</code> để lưu thư viện và tiến độ. Token chỉ lưu trên máy này.`,
    fields: [{ name: 'token', label: 'Token GitHub', type: 'password', autocomplete: 'off', placeholder: 'ghp_…' }],
    extra: `<div class="acct-copy"><code>${esc(GITHUB_TOKEN_URL)}</code><button type="button" class="btn small" data-copy="${esc(GITHUB_TOKEN_URL)}">Sao chép địa chỉ</button></div>`,
    submit: 'Đăng nhập',
    onSubmit: async (v) => {
      if (!navigator.onLine) throw new Error('Đang offline: cần có mạng để đăng nhập.');
      await account.signInGitHub(v.token);
      await github.ensureRepo();
    },
  });
  return !!ok;
}
export async function signInGitHubFlow() {
  if (!(await githubDialog())) return null;
  toast(`Chào ${account.displayName()}!`);
  return afterSignIn();
}

// Wipe this device's library (same as Settings → "Xoá toàn bộ dữ liệu"), then reload.
export async function wipeLocal(tasks) {
  const files = await db.files.toArray();
  const t = tasks.start({ label: 'Đang xoá dữ liệu trên máy', total: files.length + 1, detail: 'Xoá tệp…' });
  try {
    for (const f of files) { await storage.adapters.local.remove(f.locations?.local).catch(() => {}); t.step(1, f.name || ''); }
    t.update({ detail: 'Xoá cơ sở dữ liệu…' });
    await db.delete();
    t.finish('Đã xoá');
  } catch (e) { t.fail(e); return; }
  setTimeout(() => location.reload(), 300);
}
