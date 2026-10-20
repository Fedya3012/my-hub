// Account = the user's GitHub account ("Tài khoản GitHub"): a personal access token (pasted once) that
// syncs the library + progress through a private repo (js/core/storage/github.js). Files stay on the device.
//
//   account.init();                          // at boot: restores the cached session (offline too)
//   account.signedIn / account.user / account.email / account.uid
//   await account.signInGitHub(token);       // validates the token, keeps it on this device
//   const token = await account.accessToken();
//   bus.on('account:changed', ({ user, signedIn, reason }) => …)
//
// Session: profile + signedInAt + the token are cached in localStorage, so a reload keeps the user
// signed in and works offline. A 401 from GitHub invalidates the token ("Kết nối lại" asks for a new one).
// localStorage is never part of the JSON backup. A session left by the old Google sign-in is discarded.
import { bus } from './bus.js';

const LS = 'myhub.google.session';   // key name kept so an update replaces the old session
const GH_API = 'https://api.github.com';
const FOREVER = Number.MAX_SAFE_INTEGER;   // GitHub tokens have no short expiry; a 401 invalidates them

let sess = null;                // { provider: 'github', user: { sub, login, email, name, picture }, signedInAt, token: { access_token, expires_at } | null }

const read = () => {
  try {
    const s = JSON.parse(localStorage.getItem(LS) || 'null');
    if (s && s.provider !== 'github') { localStorage.removeItem(LS); return null; }   // old Google session
    return s;
  } catch { return null; }
};
const write = (s) => { try { s ? localStorage.setItem(LS, JSON.stringify(s)) : localStorage.removeItem(LS); } catch { /* private mode: memory only */ } };
const emit = (reason) => bus.emit('account:changed', { user: account.user, signedIn: !!sess, reason });
const err = (message, code) => Object.assign(new Error(message), { code });

async function fetchGitHubUser(token) {
  let res;
  try { res = await fetch(`${GH_API}/user`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' }); }
  catch { throw err('Không kết nối được GitHub (đang offline?).', 'offline'); }
  if (res.status === 401) throw err('Token GitHub không đúng hoặc đã hết hạn.', 'bad_token');
  if (!res.ok) throw err(`GitHub trả lỗi ${res.status}.`, 'github');
  const p = await res.json();
  return { sub: 'github:' + p.id, login: p.login, email: '@' + p.login, name: p.name || p.login, picture: p.avatar_url || '' };
}

export const account = {
  get provider() { return 'github'; },
  configured() { return true; },

  get signedIn() { return !!sess; },
  get user() { return sess?.user || null; },
  get uid() { return sess?.user?.sub || null; },
  get email() { return sess?.user?.email || ''; },
  get signedInAt() { return sess?.signedInAt || 0; },
  // Signed in, but the token was rejected and needs a new one ("Kết nối lại").
  get needsReconnect() { return !!sess && !this.tokenValid(); },
  tokenValid() { return !!sess?.token && Date.now() < sess.token.expires_at; },

  displayName(u = this.user) { return u?.name || (u?.email || '').split('@')[0] || 'Bạn'; },

  init() {
    sess = read();
    window.addEventListener('storage', (e) => {        // another tab signed in / out / renewed
      if (e.key !== LS) return;
      const was = this.uid; sess = read();
      emit(was !== this.uid ? 'other-tab' : 'refresh');
    });
  },

  // Validate the pasted token, then keep it on this device (localStorage, never in the JSON backup).
  async signInGitHub(token) {
    token = String(token || '').trim();
    if (!token) throw err('Dán token GitHub vào ô nhập.', 'bad_token');
    const user = await fetchGitHubUser(token);
    const same = sess?.user?.sub === user.sub;
    sess = { provider: 'github', user, signedInAt: Date.now(), token: { access_token: token, expires_at: FOREVER } };
    write(sess); emit(same ? 'reconnect' : 'signin');
    return user;
  },
  async reconnect() {
    if (!sess?.token) throw err('Cần nhập lại token GitHub.', 'token_needed');
    sess = { ...sess, user: await fetchGitHubUser(sess.token.access_token) };
    write(sess); emit('reconnect');
    return sess.user;
  },

  // A valid token. Throws code 'reconnect' when GitHub rejected it.
  async accessToken() {
    if (!sess) throw err('Bạn chưa đăng nhập.', 'signed_out');
    if (this.tokenValid()) return sess.token.access_token;
    emit('needs-reconnect');
    throw err('Token GitHub không còn hiệu lực. Nhập token mới trong trang Tài khoản.', 'reconnect');
  },
  // A request came back 401: the token was revoked or expired.
  invalidateToken() { if (sess?.token) { sess = { ...sess, token: null }; write(sess); emit('needs-reconnect'); } },

  async signOut({ reason = 'signout' } = {}) {
    sess = null; write(null);
    emit(reason);
  },
};
