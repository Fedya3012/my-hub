// Connecting a cloud drive (Dropbox, WebDAV, FileJump): the sign-in dialogs and what happens to this
// device's library (merge / use the drive's copy), then the first sync. Used by Settings.
import { storage, drives } from './index.js';
import { PRESETS, normUrl } from './webdav.js';
import { startAuth, finishAuth } from './dropbox.js';
import { getCloud, clouds } from './clouds.js';
import { nativeShell } from './http.js';
import { DROPBOX_APP_KEY } from '../../config.js';
import { formDialog } from '../account-ui.js';
import { setSetting } from '../db.js';
import { esc, modal, confirmBox, toast } from '../ui.js';

async function webdavDialog(id) {
  const p = PRESETS[id], cur = getCloud(id) || {};
  return formDialog({
    title: 'Kết nối ' + p.label,
    intro: `${esc(p.hint)} Tạo sẵn một <b>thư mục</b> trên máy chủ (ví dụ <code>MyHub</code>) rồi dán địa chỉ của thư mục đó. Nhiều dịch vụ yêu cầu <b>mật khẩu ứng dụng</b> thay vì mật khẩu thường. Mật khẩu chỉ lưu trên máy này.${p.help ? ` <a href="${p.help}" target="_blank" rel="noopener">Hướng dẫn WebDAV của ${esc(p.label)}</a>.` : ''}${nativeShell() ? '' : '<br><b>Trình duyệt</b> chỉ kết nối được nếu máy chủ bật CORS; app Windows và Android thì không bị giới hạn này.'}`,
    fields: [
      { name: 'url', label: 'Địa chỉ thư mục (https://…)', value: cur.url || '', placeholder: p.urlHint, autocomplete: 'off' },
      { name: 'user', label: 'Tên đăng nhập', value: cur.user || '', autocomplete: 'username' },
      { name: 'pass', label: 'Mật khẩu', type: 'password', autocomplete: 'current-password' },
    ],
    submit: 'Kết nối',
    onSubmit: async (v) => {
      if (!navigator.onLine) throw new Error('Đang offline: cần có mạng để kết nối.');
      const c = { url: normUrl(v.url), user: v.user.trim(), pass: v.pass };
      if (!c.user || !c.pass) throw new Error('Nhập tên đăng nhập và mật khẩu.');
      await drives[id].test(c);
      clouds.set(id, c);
    },
  });
}

async function dropboxDialog() {
  const cur = getCloud('dropbox') || {};
  let auth = null;
  return formDialog({
    title: 'Kết nối Dropbox',
    intro: `1) Nhập <b>App key</b> của app Dropbox (cách tạo trong docs/STORAGE.md: mất khoảng 2 phút, miễn phí). 2) Bấm <b>Mở Dropbox để cấp quyền</b>, cho phép, rồi sao chép mã Dropbox hiện ra. 3) Dán mã vào ô bên dưới. App chỉ thấy thư mục riêng <code>Apps/…</code> của nó.`,
    fields: [
      { name: 'appKey', label: 'App key', value: cur.appKey || DROPBOX_APP_KEY, autocomplete: 'off' },
      { name: 'code', label: 'Mã Dropbox', autocomplete: 'off', placeholder: 'Dán mã sau khi cấp quyền' },
    ],
    extra: '<button type="button" class="btn" data-open>Mở Dropbox để cấp quyền</button>',
    submit: 'Kết nối',
    onRender: (form) => {
      form.querySelector('[data-open]').onclick = async () => {
        const key = form.elements.appKey.value.trim();
        if (!key) { toast('Nhập App key trước', 'warn'); return; }
        auth = await startAuth(key);
        window.open(auth.url, '_blank', 'noopener');
      };
    },
    onSubmit: async (v) => {
      if (!navigator.onLine) throw new Error('Đang offline: cần có mạng để kết nối.');
      if (!auth) throw new Error('Bấm “Mở Dropbox để cấp quyền” trước, rồi dán mã vào đây.');
      if (!v.code.trim()) throw new Error('Dán mã Dropbox vào ô “Mã Dropbox”.');
      await finishAuth(v.appKey.trim(), v.code, auth.verifier);
      await drives.dropbox.readSnapshot('hub-live.json');   // proves the token and the app folder work
    },
  });
}

export const connectForm = (mode) => mode === 'dropbox' ? dropboxDialog() : webdavDialog(mode);

// Turn a drive on: connect if needed, ask what to do with this device's library when the drive already
// holds one, switch the mode and run the first sync (progress in the task tray, then the file upload).
export async function useDrive(mode, { reconnect = false } = {}) {
  const d = drives[mode];
  if (reconnect || !d.connected()) { if (!(await connectForm(mode))) return false; }
  let choice = 'merge', remote = false;
  try { remote = await storage.remoteHasData(mode); }
  catch (e) { if (navigator.onLine) { toast(e.message, 'error'); return false; } }
  if (remote && (await storage.hasLocalData()) && (await storage.mode()) !== mode) {
    choice = await modal({
      title: 'Máy này đã có dữ liệu',
      body: `<div class="stack"><p>${esc(d.label)} đã có thư viện từ một máy khác, và máy này cũng có dữ liệu riêng. Bạn muốn làm gì?</p>
        <ul class="acct-choices"><li><b>Gộp</b> (khuyên dùng): giữ cả hai, mục nào sửa sau cùng thì thắng.</li>
        <li><b>Dùng dữ liệu của ${esc(d.label)}</b>: thay thư viện trên máy này bằng bản trên đó. Những gì chỉ có trên máy này sẽ mất.</li>
        <li><b>Để sau</b>: chỉ kết nối, chưa đồng bộ máy này.</li></ul></div>`,
      actions: [{ label: 'Để sau', value: 'later' }, { label: 'Dùng dữ liệu của ' + d.label, value: 'replace', kind: 'danger-ghost' }, { label: 'Gộp', value: 'merge', kind: 'primary' }],
    }) || 'later';
    if (choice === 'replace' && !(await confirmBox('Thay dữ liệu trên máy này?', 'Thư viện trên máy này sẽ được thay bằng bản trên ' + d.label + '. Những mục chỉ có trên máy này sẽ bị xoá.', 'Thay dữ liệu'))) return useDrive(mode);
  }
  if (choice === 'later') return true;
  await storage.setMode(mode);
  await setSetting('sync.driveFor', mode);
  try { if (choice === 'replace') await storage.replaceLocal(); else await storage.mergeLocal(); }
  catch (e) { toast(e.message, 'error'); return true; }
  storage.sync().then(r => { if (r?.skipped === 'offline') toast('Đang offline, sẽ đồng bộ khi có mạng', 'warn'); }).catch(e => toast('Đồng bộ lỗi: ' + e.message, 'error'));
  return true;
}

export function disconnect(mode) { clouds.set(mode, null); }
