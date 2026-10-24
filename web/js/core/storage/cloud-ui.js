// Connecting a cloud drive (Dropbox, OneDrive): the sign-in dialogs and what happens to this
// device's library (merge / use the drive's copy), then the first sync. Used by Settings.
import { storage, drives } from './index.js';
import { startAuth, finishAuth } from './dropbox.js';
import * as od from './onedrive.js';
import * as gd from './googledrive.js';
import { getCloud, clouds } from './clouds.js';
import { nativeShell } from './http.js';
import { DROPBOX_APP_KEY, ONEDRIVE_CLIENT_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../../config.js';
import { formDialog } from '../account-ui.js';
import { setSetting } from '../db.js';
import { esc, modal, confirmBox, toast } from '../ui.js';

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

async function onedriveDialog() {
  const cur = getCloud('onedrive') || {};
  let auth = null;
  return formDialog({
    title: 'Kết nối OneDrive',
    intro: `1) Nhập <b>Client ID</b> của app Microsoft (cách tạo trong docs/STORAGE.md: khoảng 5 phút, miễn phí). 2) Bấm <b>Mở Microsoft để cấp quyền</b> và cho phép. 3) Trình duyệt chuyển sang một trang trắng: <b>sao chép toàn bộ địa chỉ</b> của trang đó (có đoạn <code>?code=…</code>) và dán vào ô bên dưới. App chỉ thấy thư mục riêng <code>Apps/…</code> của nó.${nativeShell() ? '' : '<br><b>Trình duyệt</b> có thể bị Microsoft chặn bước đổi mã (CORS); app Windows và Android thì không.'}`,
    fields: [
      { name: 'clientId', label: 'Client ID', value: cur.clientId || ONEDRIVE_CLIENT_ID, autocomplete: 'off' },
      { name: 'code', label: 'Địa chỉ trang trắng (hoặc mã)', autocomplete: 'off', placeholder: 'https://login.microsoftonline.com/common/oauth2/nativeclient?code=…' },
    ],
    extra: '<button type="button" class="btn" data-open>Mở Microsoft để cấp quyền</button>',
    submit: 'Kết nối',
    onRender: (form) => {
      form.querySelector('[data-open]').onclick = async () => {
        const key = form.elements.clientId.value.trim();
        if (!key) { toast('Nhập Client ID trước', 'warn'); return; }
        auth = await od.startAuth(key);
        window.open(auth.url, '_blank', 'noopener');
      };
    },
    onSubmit: async (v) => {
      if (!navigator.onLine) throw new Error('Đang offline: cần có mạng để kết nối.');
      if (!auth) throw new Error('Bấm “Mở Microsoft để cấp quyền” trước, rồi dán địa chỉ trang trắng vào đây.');
      if (!v.code.trim()) throw new Error('Dán địa chỉ trang trắng vào ô bên trên.');
      await od.finishAuth(v.clientId.trim(), v.code, auth.verifier);
      await drives.onedrive.readSnapshot('hub-live.json');   // proves the token and the app folder work
    },
  });
}

async function googleDialog() {
  const cur = getCloud('googledrive') || {};
  let auth = null;
  return formDialog({
    title: 'Kết nối Google Drive',
    intro: `1) Nhập <b>Client ID</b> và <b>Client secret</b> của OAuth client loại <i>Desktop app</i> (cách tạo trong docs/STORAGE.md: khoảng 5 phút, miễn phí). 2) Bấm <b>Mở Google để cấp quyền</b> và cho phép. 3) Trình duyệt chuyển tới một trang <b>không mở được</b> (127.0.0.1): <b>sao chép toàn bộ địa chỉ</b> của trang đó (có đoạn <code>?code=…</code>) và dán vào ô bên dưới. Thư viện nằm trong thư mục ẩn riêng của app; thư mục đồng bộ chỉ được đọc, không bị sửa.`,
    fields: [
      { name: 'clientId', label: 'Client ID', value: cur.clientId || GOOGLE_CLIENT_ID, autocomplete: 'off' },
      { name: 'secret', label: 'Client secret', value: cur.secret || GOOGLE_CLIENT_SECRET, autocomplete: 'off' },
      { name: 'code', label: 'Địa chỉ trang không mở được (hoặc mã)', autocomplete: 'off', placeholder: 'http://127.0.0.1/?code=…' },
    ],
    extra: '<button type="button" class="btn" data-open>Mở Google để cấp quyền</button>',
    submit: 'Kết nối',
    onRender: (form) => {
      form.querySelector('[data-open]').onclick = async () => {
        const key = form.elements.clientId.value.trim();
        if (!key) { toast('Nhập Client ID trước', 'warn'); return; }
        auth = await gd.startAuth(key);
        window.open(auth.url, '_blank', 'noopener');
      };
    },
    onSubmit: async (v) => {
      if (!navigator.onLine) throw new Error('Đang offline: cần có mạng để kết nối.');
      if (!auth) throw new Error('Bấm “Mở Google để cấp quyền” trước, rồi dán địa chỉ vào đây.');
      if (!v.secret.trim()) throw new Error('Nhập Client secret.');
      if (!v.code.trim()) throw new Error('Dán địa chỉ trang không mở được vào ô bên trên.');
      await gd.finishAuth(v.clientId.trim(), v.secret.trim(), v.code, auth.verifier);
      await drives.googledrive.readSnapshot('hub-live.json');   // proves the token and the app data folder work
    },
  });
}

export const connectForm = (mode) => mode === 'dropbox' ? dropboxDialog() : mode === 'googledrive' ? googleDialog() : onedriveDialog();

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
