// My Hub account (email + password) on Supabase. Plain fetch to the Auth and REST endpoints, no SDK.
// The publishable key is public by design: row-level security on hub_data is what keeps one user's
// data away from another. The session (access + refresh token) lives in localStorage; every
// read and write of it is wrapped, so a blocked storage just means "signed out".
import { bus } from './bus.js';

export const SUPABASE_URL = 'https://lxyrelwykdkbrpnbvfcn.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_SrmSR45pepQ5R-BSf3zHnA_Zj2skyOv';
const LS = 'myhub.supabase.session';
const SKEW = 60 * 1000;   // refresh a little before the token expires

const err = (message, code) => Object.assign(new Error(message), { code });

let sess = null;
try { sess = JSON.parse(localStorage.getItem(LS) || 'null'); } catch { sess = null; }

function save(next) {
  sess = next;
  try { next ? localStorage.setItem(LS, JSON.stringify(next)) : localStorage.removeItem(LS); } catch { /* blocked: stays in memory */ }
  bus.emit('supabase:changed', { signedIn: !!sess, email: sess?.user?.email || '' });
}

// Supabase answers errors with error_description, msg or message depending on the endpoint.
const MSG = {
  'Invalid login credentials': 'Email hoặc mật khẩu không đúng.',
  'Email not confirmed': 'Email chưa được xác nhận. Hãy bấm link trong email xác nhận rồi đăng nhập lại.',
  'User already registered': 'Email này đã có tài khoản. Hãy đăng nhập.',
  'Password should be at least': 'Mật khẩu chưa đủ mạnh: cần ít nhất 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.',
  'Password should contain': 'Mật khẩu chưa đủ mạnh: cần ít nhất 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.',
  'For security purposes, you can only request this after': 'Vừa gửi yêu cầu, hãy đợi một lát rồi thử lại.',
};
async function call(path, { method = 'POST', body, token, signal } = {}) {
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, {
      method, signal, cache: 'no-store',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) { if (e?.name === 'AbortError') throw e; throw err('Không kết nối được máy chủ tài khoản.', 'offline'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = j.error_description || j.msg || j.message || j.error || '';
    const hit = Object.keys(MSG).find(k => raw.startsWith(k));
    throw err(hit ? MSG[hit] : (raw || `Lỗi ${res.status} từ máy chủ tài khoản.`), res.status === 429 ? 'rate' : 'auth');
  }
  return j;
}

// Keeps the session fields the app needs; the raw response is not stored.
function fromTokenResponse(j) {
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000,
    user: { id: j.user?.id, email: j.user?.email || '' },
  };
}

export const supa = {
  get signedIn() { return !!sess?.access_token && !!sess?.refresh_token; },
  get email() { return sess?.user?.email || ''; },
  get userId() { return sess?.user?.id || ''; },

  // Creates the account. With "Confirm email" on, Supabase sends the link and returns no session yet:
  // → { needsConfirm: true }. Otherwise the session starts at once.
  async signUp(email, password) {
    const j = await call('/auth/v1/signup', { body: { email, password } });
    if (j.access_token) { save(fromTokenResponse(j)); return { needsConfirm: false }; }
    return { needsConfirm: true };
  },

  async signIn(email, password) {
    const j = await call('/auth/v1/token?grant_type=password', { body: { email, password } });
    save(fromTokenResponse(j));
  },

  // Returns a token that is valid for at least another minute; refreshes it when needed.
  async accessToken() {
    if (!this.signedIn) throw err('Chưa đăng nhập tài khoản My Hub.', 'signed_out');
    if (sess.expires_at - SKEW > Date.now()) return sess.access_token;
    try {
      const j = await call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: sess.refresh_token } });
      save(fromTokenResponse(j));
      return sess.access_token;
    } catch (e) {
      if (e.code === 'offline') throw e;
      save(null);   // the refresh token was rejected: the user has to sign in again
      throw err('Phiên đăng nhập hết hạn, hãy đăng nhập lại.', 'signed_out');
    }
  },

  async signOut() {
    const token = sess?.access_token;
    save(null);
    if (token) await call('/auth/v1/logout', { token }).catch(() => {});
  },

  // Deletes the account and its data on the server (delete_my_account), then signs out here.
  // Data on this device and on GitHub / Dropbox / OneDrive stays.
  async deleteAccount() {
    const token = await this.accessToken();
    await call('/rest/v1/rpc/delete_my_account', { token });
    save(null);
  },

  async resetPassword(email) {
    await call('/auth/v1/recover', { body: { email } });
  },
};

export { err as supaError };
