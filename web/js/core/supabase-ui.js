// Sign-in dialog for My Hub accounts (email + password). Resolves true when a session now exists.
import { supa } from './supabase.js';
import { storage } from './storage/index.js';
import { getSetting, setSetting } from './db.js';
import { h, modal, toast, confirmBox, esc } from './ui.js';

const MIN_PASSWORD = 10;

export async function supabaseDialog() {
  const body = h(`<div class="stack">
      <label class="field">Email<input type="email" name="email" autocomplete="email" required></label>
      <label class="field">Mật khẩu (ít nhất ${MIN_PASSWORD} ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt)<input type="password" name="password" autocomplete="current-password" minlength="${MIN_PASSWORD}" required></label>
      <p class="hint">Tạo tài khoản rồi bấm link trong email xác nhận, sau đó đăng nhập. Tệp nhạc và sách không đưa lên tài khoản này.</p>
    </div>`);
  const fields = () => ({ email: body.querySelector('[name=email]').value.trim(), password: body.querySelector('[name=password]').value });

  for (;;) {
    const act = await modal({
      title: 'Tài khoản My Hub',
      body,
      actions: [
        { label: 'Huỷ', value: null },
        { label: 'Tạo tài khoản', value: 'up' },
        { label: 'Đăng nhập', value: 'in', kind: 'primary' },
      ],
    });
    if (!act) return false;
    const { email, password } = fields();
    if (!email || password.length < MIN_PASSWORD) { toast(`Nhập email và mật khẩu ít nhất ${MIN_PASSWORD} ký tự.`, 'warn'); continue; }
    try {
      if (act === 'in') { await supa.signIn(email, password); return true; }
      const { needsConfirm } = await supa.signUp(email, password);
      if (needsConfirm) {
        await modal({
          title: 'Kiểm tra email',
          body: `<p>Đã gửi email xác nhận tới <b>${esc(email)}</b>. Bấm link trong email, rồi quay lại đây và đăng nhập.</p>`,
          actions: [{ label: 'Đã hiểu', value: true, kind: 'primary' }],
        });
        return false;
      }
      return true;
    } catch (e) {
      toast(e.message, 'error');   // the form keeps what was typed; try again
    }
  }
}

// After signing in: this device's library and the account's library may differ. Asks what to do
// (merge is the default), then switches the device to the account and syncs. Returns the choice.
export async function afterSupabaseSignIn() {
  if (!supa.signedIn) return 'later';
  const uid = supa.userId;
  const lastUid = await getSetting('account.supaLastUid', null);
  let remote = false, local = false;
  try { [remote, local] = [await storage.remoteHasData('supabase'), await storage.hasLocalData()]; }
  catch (e) { toast(e.message, 'error'); return 'later'; }
  let choice = 'merge';
  if (remote && local && lastUid !== uid) {
    choice = await modal({
      title: 'Máy này đã có dữ liệu',
      body: `<div class="stack"><p>Thư viện trên máy này và tài khoản <b>${esc(supa.email)}</b> đều đã có dữ liệu. Bạn muốn làm gì?</p>
        <ul class="acct-choices">
          <li><b>Gộp</b> (khuyên dùng): giữ cả hai, mục nào sửa sau cùng thì thắng.</li>
          <li><b>Dùng dữ liệu của tài khoản</b>: thay thư viện trên máy này bằng bản trong tài khoản. Những gì chỉ có trên máy này sẽ mất.</li>
          <li><b>Để sau</b>: vẫn đăng nhập nhưng chưa đồng bộ máy này.</li></ul></div>`,
      actions: [{ label: 'Để sau', value: 'later' }, { label: 'Dùng dữ liệu của tài khoản', value: 'replace', kind: 'danger-ghost' }, { label: 'Gộp', value: 'merge', kind: 'primary' }],
    }) || 'later';
  }
  if (choice === 'later') return 'later';
  if (choice === 'replace' && !(await confirmBox('Thay dữ liệu trên máy này?', 'Thư viện trên máy này sẽ được thay bằng dữ liệu trong tài khoản. Những mục chỉ có trên máy này sẽ bị xoá.', 'Thay dữ liệu'))) return afterSupabaseSignIn();
  await storage.setMode('supabase');
  await setSetting('account.supaLastUid', uid);
  try {
    if (choice === 'replace') await storage.replaceLocal();
    else await storage.mergeLocal();
  } catch (e) { toast(e.message, 'error'); return choice; }
  storage.sync().then((r) => {
    if (r?.skipped === 'offline') toast('Đang offline, sẽ đồng bộ khi có mạng', 'warn');
  }).catch(e => toast('Đồng bộ lỗi: ' + e.message, 'error'));
  return choice;
}
