// Account = the user's Google account ("Tài khoản Google"). One sign-in gives both the identity
// (name, email, avatar) and the Drive access used for sync (js/core/storage/gdrive.js).
//
//   account.init();                          // at boot: restores the cached session (offline too)
//   account.signedIn / account.user / account.email / account.uid
//   await account.signIn();                  // Google popup (Google Identity Services token client)
//   const token = await account.accessToken();   // valid Drive token, re-requested silently
//   bus.on('account:changed', ({ user, signedIn, reason }) => …)
//
// Session: profile + signedInAt + the short-lived access token (1 h) are cached in localStorage,
// so a reload keeps the user signed in and works offline. When the token has expired, a silent
// re-request (prompt '' + login_hint) gets a new one without the account chooser. Browsers only
// allow its popup during a click, so an expired session shows "Kết nối lại" (one click) instead
// of failing. localStorage is never part of the JSON backup.
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '../config.js';
import { bus } from './bus.js';

const LS = 'myhub.google.session';
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.appdata', 'https://www.googleapis.com/auth/drive.file'];
const EARLY = 60_000;           // treat a token as expired this long before it really is

let sess = null;                // { user: { sub, email, name, picture }, signedInAt, token: { access_token, expires_at } | null }
let tokenClient = null, pending = null;

const read = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } };
const write = (s) => { try { s ? localStorage.setItem(LS, JSON.stringify(s)) : localStorage.removeItem(LS); } catch { /* private mode: memory only */ } };
const emit = (reason) => bus.emit('account:changed', { user: account.user, signedIn: !!sess, reason });
const err = (message, code) => Object.assign(new Error(message), { code });

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!navigator.onLine) return Promise.reject(err('Không có kết nối mạng.', 'offline'));
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(err('Không tải được Google Sign-In (đang offline hoặc bị chặn?).', 'offline')); };
    document.head.appendChild(s);
  });
}

// One token request at a time. prompt: '' = silent when already granted, 'select_account' =
// account chooser, 'consent' = consent screen again.
async function requestToken({ prompt = '', hint } = {}) {
  if (!GOOGLE_CLIENT_ID) throw err('Chưa cấu hình Google Client ID (js/config.js).', 'not_configured');
  if (pending) return pending;
  await loadGis();
  pending = new Promise((resolve, reject) => {
    const o = google.accounts.oauth2;
    tokenClient = tokenClient || o.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPES, include_granted_scopes: true, callback: () => {} });
    tokenClient.callback = (r) => {
      if (r.error) return reject(err(r.error === 'access_denied' ? 'Bạn đã từ chối quyền truy cập.' : 'Google từ chối: ' + (r.error_description || r.error), r.error));
      if (o.hasGrantedAllScopes && !o.hasGrantedAllScopes(r, ...DRIVE_SCOPES)) {
        return reject(err('Cần cho phép My Hub lưu dữ liệu trên Google Drive (đánh dấu cả hai ô quyền Drive) để đồng bộ.', 'scope_missing'));
      }
      resolve({ access_token: r.access_token, expires_at: Date.now() + (+r.expires_in || 3600) * 1000 });
    };
    tokenClient.error_callback = (e) => reject(err(e?.type === 'popup_closed' ? 'Đã đóng cửa sổ đăng nhập Google.'
      : e?.type === 'popup_failed_to_open' ? 'Trình duyệt chặn cửa sổ Google. Cho phép cửa sổ bật lên rồi thử lại.' : 'Không đăng nhập được Google.', e?.type || 'popup'));
    tokenClient.requestAccessToken({ prompt, ...(hint ? { login_hint: hint } : {}) });
  }).finally(() => { pending = null; });
  return pending;
}

async function fetchProfile(accessToken) {
  const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw err(`Không đọc được hồ sơ Google (${res.status}).`, 'userinfo');
  const p = await res.json();
  return { sub: String(p.sub || ''), email: p.email || '', name: p.name || p.given_name || '', picture: p.picture || '' };
}

export const account = {
  provider: 'google',
  configured() { return !!GOOGLE_CLIENT_ID; },

  get signedIn() { return !!sess; },
  get user() { return sess?.user || null; },
  get uid() { return sess?.user?.sub || null; },
  get email() { return sess?.user?.email || ''; },
  get signedInAt() { return sess?.signedInAt || 0; },
  // Signed in, but the token expired and renewing it needs a click ("Kết nối lại").
  get needsReconnect() { return !!sess && !this.tokenValid(); },
  tokenValid() { return !!sess?.token && Date.now() < sess.token.expires_at - EARLY; },

  displayName(u = this.user) { return u?.name || (u?.email || '').split('@')[0] || 'Bạn'; },

  init() {
    sess = read();
    window.addEventListener('storage', (e) => {        // another tab signed in / out / renewed
      if (e.key !== LS) return;
      const was = this.uid; sess = read();
      emit(was !== this.uid ? 'other-tab' : 'refresh');
    });
  },

  // Interactive sign-in (call it from a click): Google account chooser + consent.
  async signIn() {
    const t = await requestToken({ prompt: 'select_account' });
    const user = await fetchProfile(t.access_token);
    const same = sess?.user?.sub === user.sub;
    sess = { user, signedInAt: Date.now(), token: t };   // fresh: older remote sign-out requests no longer apply
    write(sess); emit(same ? 'reconnect' : 'signin');
    return user;
  },
  // Same account again without the chooser (the 1 h token expired). Works silently inside a click.
  async reconnect() {
    if (!sess) return this.signIn();
    const t = await requestToken({ prompt: '', hint: sess.user?.email });
    sess = { ...sess, token: t };
    write(sess); emit('reconnect');
    fetchProfile(t.access_token).then(u => { if (sess && u.sub === sess.user.sub) { sess = { ...sess, user: u }; write(sess); emit('user'); } }).catch(() => {});
    return sess.user;
  },

  // A valid access token; renewed silently when expired. Throws code 'reconnect' when that needs a click.
  async accessToken() {
    if (!sess) throw err('Bạn chưa đăng nhập Google.', 'signed_out');
    if (this.tokenValid()) return sess.token.access_token;
    try { await this.reconnect(); }
    catch (e) {
      if (e.code === 'offline') throw e;
      emit('needs-reconnect');
      throw err('Phiên Google đã hết hạn. Bấm "Kết nối lại" trong trang Tài khoản.', 'reconnect');
    }
    return sess.token.access_token;
  },
  // A request came back 401: the token was revoked or expired early.
  invalidateToken() { if (sess?.token) { sess = { ...sess, token: null }; write(sess); emit('needs-reconnect'); } },

  // revoke: also withdraw My Hub's access at Google (other devices then have to sign in again
  // once their current token expires, at most 1 h).
  async signOut({ reason = 'signout', revoke = false } = {}) {
    const tok = sess?.token?.access_token;
    sess = null; write(null);
    if (revoke && tok && window.google?.accounts?.oauth2) { try { google.accounts.oauth2.revoke(tok, () => {}); } catch { /* ignore */ } }
    emit(reason);
  },
};
