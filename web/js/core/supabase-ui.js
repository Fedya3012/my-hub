// Sign-in dialog for My Hub accounts (email + password). Resolves true when a session now exists.
import { supa } from './supabase.js';
import { h, modal, toast } from './ui.js';

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
          body: `<p>Đã gửi email xác nhận tới <b>${email}</b>. Bấm link trong email, rồi quay lại đây và đăng nhập.</p>`,
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
