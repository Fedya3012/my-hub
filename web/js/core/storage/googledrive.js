// Google Drive adapter (Drive API v3). Library + progress + uploaded files live in the hidden app data folder
// (appDataFolder: only My Hub sees it); folder sync reads the user's own Drive folders (drive.readonly).
// Sign-in is OAuth with PKCE for a Google "Desktop app" client and the loopback redirect http://127.0.0.1:
// after allowing access the browser lands on an unreachable page whose address contains ?code=…; the user pastes
// that address into My Hub (same flow as OneDrive). Needs a free Google Cloud OAuth client (docs/STORAGE.md).
//   hub-db.json / hub-live.json : library + progress (Drive has no If-Match: the file's `version` is compared first)
//   f-<fileId>-<name>           : files; over 5 MB they go up through a resumable session in 8 MB parts
// Token calls go through the shell (Windows/Android) where the app has one.
import { http } from './http.js';
import { getCloud, clouds } from './clouds.js';

const err = (message, code) => Object.assign(new Error(message), { code });
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REDIRECT = 'http://127.0.0.1';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3/files';
const UP = 'https://www.googleapis.com/upload/drive/v3/files';
const SIMPLE = 5 * 1024 * 1024, PART = 32 * 256 * 1024;   // resumable parts must be multiples of 256 KiB
const FOLDER = 'application/vnd.google-apps.folder';
const seen = new Map();        // snapshot name → { norm, version } of what this device last read or wrote
const ids = new Map();         // app data file name → Drive file id
const dirs = new Map();        // My Drive path → folder id
const norm = (d) => JSON.stringify({ ...d, at: undefined });
const safe = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').replace(/[^\w.\-]+/g, '_').slice(0, 80);
export const fileKey = (row) => `f-${row.id}-${safe(row.name || 'file')}`;
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function startAuth(clientId) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const url = `${AUTH}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent(SCOPE)}&code_challenge=${challenge}&code_challenge_method=S256&access_type=offline&prompt=consent`;
  return { url, verifier };
}
// `pasted` is the address of the unreachable page (http://127.0.0.1/?code=…) or just the code.
export const codeFrom = (pasted) => { const s = String(pasted || '').trim(); const m = s.match(/[?&]code=([^&\s#]+)/); return m ? decodeURIComponent(m[1]) : s; };
const form = (o) => new URLSearchParams(o).toString();
async function tokenCall(body) {
  const r = await http(TOKEN, { method: 'POST', viaShell: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) });
  return { r, j: JSON.parse(await r.text() || '{}') };
}
export async function finishAuth(clientId, secret, pasted, verifier) {
  const { r, j } = await tokenCall({ client_id: clientId, client_secret: secret, grant_type: 'authorization_code', code: codeFrom(pasted), redirect_uri: REDIRECT, code_verifier: verifier });
  if (!r.ok) throw err(j.error_description || 'Mã Google không đúng hoặc đã hết hạn, lấy mã mới.', 'bad_token');
  if (!j.refresh_token) throw err('Google không trả về quyền dùng lâu dài. Vào myaccount.google.com/permissions gỡ My Hub rồi kết nối lại.', 'bad_token');
  clouds.set('googledrive', { clientId, secret, access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  ids.clear(); dirs.clear();
}

// One-tap sign-in with the app's own Web client: Google's account chooser, once; the code it returns is swapped
// (PKCE + the client secret) for a refresh token, so the app stays signed in. Where it opens:
//   web: a popup that lands on oauth-google.html, which posts the answer back;
//   Windows: the system browser, oauth-google.html on localhost hands it to the shell (hub:google);
//   Android: the system browser (Google refuses WebViews), oauth-google.html on GitHub Pages sends it back to the
//   app as com.myhub.app://oauth?… (OAuthPlugin).
export async function signInWeb(clientId, secret, pagesRedirect) {
  const OA = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.OAuth : null;
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const redirect = OA ? pagesRedirect : new URL('oauth-google.html', document.baseURI).href;
  const url = `${AUTH}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=${encodeURIComponent('select_account consent')}&include_granted_scopes=true&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
  const query = await new Promise((resolve, reject) => {
    const offs = [];
    const stop = () => { offs.forEach(f => f()); clearTimeout(timer); };
    const got = (q) => {
      const p = new URLSearchParams(String(q || '').replace(/^.*?[?#]/, ''));
      if (p.get('state') !== state) return;
      stop(); resolve(p);
    };
    const onMsg = (e) => { if (e.origin === location.origin && e.data?.type === 'hub-google') got(e.data.query); };
    addEventListener('message', onMsg); offs.push(() => removeEventListener('message', onMsg));
    const off = window.hubDesktop?.onGoogle?.(got); if (off) offs.push(off);
    if (OA) OA.addListener('result', (r) => got(r.url)).then(h => offs.push(() => h.remove()));
    const timer = setTimeout(() => { stop(); reject(err('Hết thời gian chờ đăng nhập Google, thử lại.', 'timeout')); }, 10 * 60 * 1000);
    if (OA) OA.open({ url }).catch(e => { stop(); reject(e); });
    else window.open(url, 'hub-google', 'popup,width=500,height=650');
  });
  if (query.get('error')) throw err(query.get('error') === 'access_denied' ? 'Bạn chưa cho phép My Hub truy cập Google Drive.' : 'Google báo lỗi: ' + query.get('error'), 'bad_token');
  const { r, j } = await tokenCall({ client_id: clientId, client_secret: secret, grant_type: 'authorization_code', code: query.get('code') || '', redirect_uri: redirect, code_verifier: verifier });
  if (!r.ok) throw err(j.error_description || 'Google không nhận mã đăng nhập, thử lại.', 'bad_token');
  if (!j.refresh_token) throw err('Google không trả về quyền dùng lâu dài. Vào myaccount.google.com/permissions gỡ My Hub rồi đăng nhập lại.', 'bad_token');
  clouds.set('googledrive', { clientId, secret, access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  ids.clear(); dirs.clear();
  return true;
}

// Android: Google Play services signs in (GoogleAuthPlugin, Android OAuth client matched by package + SHA-1),
// no secret and no refresh token; a fresh access token is asked for silently whenever the last one expires.
const nativeAuth = () => (window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.GoogleAuth) || null;
export const nativeSignInAvailable = () => !!nativeAuth();
const NATIVE_TTL = 50 * 60 * 1000;   // the API does not say; Google access tokens last an hour

export async function signInNative() {
  const r = await nativeAuth().authorize({ interactive: true });
  clouds.set('googledrive', { native: true, access: r.accessToken, expires: Date.now() + NATIVE_TTL });
}

async function nativeToken(c) {
  try {
    const r = await nativeAuth().authorize({ interactive: false });
    clouds.set('googledrive', { ...c, access: r.accessToken, expires: Date.now() + NATIVE_TTL });
    return r.accessToken;
  } catch (e) {
    if (e?.code === 'consent') { clouds.set('googledrive', null); throw err('Google đã thu hồi quyền truy cập, hãy kết nối lại.', 'reconnect'); }
    throw err('Google Drive tạm thời không phản hồi, sẽ thử lại.', 'offline');
  }
}

const signedIn = (c) => !!(c?.refresh || (c?.native && nativeAuth()));

async function token() {
  const c = getCloud('googledrive');
  if (!signedIn(c)) throw err('Chưa kết nối Google Drive.', 'signed_out');
  if (c.access && Date.now() < c.expires) return c.access;
  if (c.native) return nativeToken(c);
  const { r, j } = await tokenCall({ client_id: c.clientId, client_secret: c.secret, grant_type: 'refresh_token', refresh_token: c.refresh });
  // Only a refused refresh token (400/401) means the access was revoked; a server hiccup (429/5xx) is retried later.
  if (!r.ok && r.status !== 400 && r.status !== 401) throw err(`Google Drive tạm thời không phản hồi (${r.status}), sẽ thử lại.`, 'offline');
  if (!r.ok) { clouds.set('googledrive', { ...c, access: null, refresh: null }); throw err('Google đã thu hồi quyền truy cập, hãy kết nối lại.', 'reconnect'); }
  clouds.set('googledrive', { ...c, access: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

async function api(url, { method = 'GET', headers = {}, body, signal, onProgress } = {}) {
  const r = await http(url, { method, signal, body, onProgress, headers: { Authorization: 'Bearer ' + await token(), ...headers } });
  if (r.status === 429) throw err('Google Drive tạm giới hạn số lần gọi, thử lại sau ít phút.', 'rate');
  return r;
}
const bad = async (r, what) => { let m = ''; try { m = (await r.text()).slice(0, 200); } catch { /* ignore */ } return err(`Google Drive lỗi ${r.status} khi ${what}${m ? ': ' + m : ''}`, 'googledrive'); };
const json = async (r) => JSON.parse(await r.text() || '{}');

// Metadata of a file in the app data folder by name (null when absent).
async function appFile(name, { signal } = {}) {
  const url = `${API}?spaces=appDataFolder&fields=files(id,version,size)&pageSize=1&q=${encodeURIComponent(`name='${q(name)}' and 'appDataFolder' in parents and trashed=false`)}`;
  const r = await api(url, { signal });
  if (!r.ok) throw await bad(r, `tìm ${name}`);
  const f = (await json(r)).files?.[0] || null;
  if (f) ids.set(name, f.id); else ids.delete(name);
  return f;
}
const appId = async (name, opts) => ids.get(name) || (await appFile(name, opts))?.id || null;

// Create (POST, parent appDataFolder) or replace (PATCH) a small file in one multipart request.
async function writeSmall(name, id, blob, { signal } = {}) {
  const boundary = 'hub' + Math.random().toString(36).slice(2);
  const meta = id ? {} : { name, parents: ['appDataFolder'] };
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
  const r = await api(`${UP}${id ? '/' + id : ''}?uploadType=multipart&fields=id,version`, { method: id ? 'PATCH' : 'POST', signal, body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } });
  if (!r.ok) throw await bad(r, `ghi ${name}`);
  const j = await json(r);
  ids.set(name, j.id);
  return j;
}

// My Drive folder path ('Nhạc/Album') → folder id; '' = the root.
async function dirId(path) {
  if (!path) return 'root';
  if (dirs.has(path)) return dirs.get(path);
  const cut = path.lastIndexOf('/');
  const parent = await dirId(cut < 0 ? '' : path.slice(0, cut));
  const name = path.slice(cut + 1);
  const r = await api(`${API}?fields=files(id)&pageSize=1&q=${encodeURIComponent(`name='${q(name)}' and '${parent}' in parents and mimeType='${FOLDER}' and trashed=false`)}`);
  if (!r.ok) throw await bad(r, 'mở thư mục');
  const id = (await json(r)).files?.[0]?.id;
  if (!id) throw err('Thư mục không còn trên Google Drive: ' + path, 'missing');
  dirs.set(path, id);
  return id;
}
async function pathId(path) {
  const cut = path.lastIndexOf('/');
  const parent = await dirId(cut < 0 ? '' : path.slice(0, cut));
  const r = await api(`${API}?fields=files(id)&pageSize=1&q=${encodeURIComponent(`name='${q(path.slice(cut + 1))}' and '${parent}' in parents and trashed=false`)}`);
  if (!r.ok) throw await bad(r, 'tìm tệp');
  const id = (await json(r)).files?.[0]?.id;
  if (!id) throw err('Tệp không còn trên Google Drive.', 'missing');
  return id;
}
async function download(id, { signal, onProgress } = {}) {
  const r = await api(`${API}/${id}?alt=media`, { signal, onProgress });
  if (r.status === 404) throw err('Tệp không còn trên Google Drive.', 'missing');
  if (!r.ok) throw await bad(r, 'tải tệp về');
  return r;
}

export const googledrive = {
  id: 'googledrive', label: 'Google Drive', files: true,
  fileKey,
  configured: () => true,
  connected: () => signedIn(getCloud('googledrive')),
  linked: () => signedIn(getCloud('googledrive')),
  async available() { return this.connected() && navigator.onLine; },

  async readSnapshot(name = 'hub-db.json', { signal, onProgress } = {}) {
    const f = await appFile(name, { signal });
    if (!f) { seen.delete(name); return { id: null, data: null }; }
    const text = await (await download(f.id, { signal })).text();
    onProgress?.(text.length, text.length);
    const data = JSON.parse(text);
    seen.set(name, { norm: norm(data), version: f.version });
    return { id: f.version || 'unknown', data };
  },

  async writeSnapshot(rid, data, name = 'hub-db.json', { signal, onProgress } = {}) {
    if (rid && seen.get(name)?.norm === norm(data)) { onProgress?.(1, 1); return { id: rid }; }
    // No conditional writes on Drive: compare the version we read with the one there now.
    const now = await appFile(name, { signal });
    if ((rid && rid !== 'unknown' && now && now.version !== rid) || (!rid && now)) throw err('Một máy khác vừa cập nhật dữ liệu, sẽ đồng bộ lại ngay.', 'conflict');
    const j = await writeSmall(name, now?.id, new Blob([JSON.stringify(data)], { type: 'application/json' }), { signal });
    seen.set(name, { norm: norm(data), version: j.version });
    onProgress?.(1, 1);
    return { id: j.version || 'unknown' };
  },

  async deleteAll() {
    let n = 0;
    for (const name of ['hub-db.json', 'hub-live.json']) {
      const id = await appId(name);
      if (id) { const r = await api(`${API}/${id}`, { method: 'DELETE' }); if (r.ok || r.status === 404) n++; else throw await bad(r, `xoá ${name}`); }
      ids.delete(name); seen.delete(name);
    }
    return n;
  },

  async putFile(key, blob, { signal, onProgress } = {}) {
    const id = await appId(key, { signal });
    if (blob.size <= SIMPLE) { await writeSmall(key, id, blob, { signal }); onProgress?.(blob.size, blob.size); return; }
    const s = await api(`${UP}${id ? '/' + id : ''}?uploadType=resumable&fields=id`, { method: id ? 'PATCH' : 'POST', signal,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream', 'X-Upload-Content-Length': String(blob.size) },
      body: JSON.stringify(id ? {} : { name: key, parents: ['appDataFolder'] }) });
    if (!s.ok) throw await bad(s, 'tải tệp lên');
    const url = s.header('location');
    for (let off = 0; off < blob.size; off += PART) {
      if (signal?.aborted) throw Object.assign(new Error('Đã huỷ'), { name: 'AbortError' });
      const part = blob.slice(off, off + PART), end = off + part.size - 1;
      const r = await http(url, { method: 'PUT', signal, body: part, headers: { 'Content-Range': `bytes ${off}-${end}/${blob.size}` } });   // session URL: no token
      if (!r.ok && r.status !== 308) throw await bad(r, 'tải tệp lên');
      if (r.ok) ids.set(key, (await json(r)).id);
      onProgress?.(end + 1, blob.size);
    }
  },
  async getFile(key, opts = {}) {
    const id = await appId(key, opts);
    if (!id) throw err('Tệp không còn trên Google Drive.', 'missing');
    return (await download(id, opts)).blob();
  },
  async removeFile(key) {
    const id = await appId(key);
    if (!id) return;
    const r = await api(`${API}/${id}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw await bad(r, 'xoá tệp');
    ids.delete(key);
  },

  // Folder picking: the user's own Drive (My Drive). sub = path under it ('' = the top). Google Docs and
  // other non-binary files are skipped (they have no size and cannot be downloaded as media).
  async listDir(sub = '') {
    const parent = await dirId(sub);
    const out = [];
    let page = '';
    do {
      const r = await api(`${API}?fields=nextPageToken,files(id,name,mimeType,size)&pageSize=1000&q=${encodeURIComponent(`'${parent}' in parents and trashed=false`)}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
      if (r.status === 404) throw err('Thư mục không còn trên Google Drive: ' + (sub || '/'), 'missing');
      if (!r.ok) throw await bad(r, 'mở thư mục');
      const j = await json(r);
      for (const e of j.files || []) {
        const isDir = e.mimeType === FOLDER;
        if (!isDir && e.mimeType.startsWith('application/vnd.google-apps')) continue;
        const path = (sub ? sub + '/' : '') + e.name;
        if (isDir) dirs.set(path, e.id);
        out.push({ name: e.name, path, isDir, size: +e.size || 0 });
      }
      page = j.nextPageToken || '';
    } while (page);
    return out.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'vi'));
  },
  async getPath(path, opts = {}) { return (await download(await pathId(path), opts)).blob(); },
  // Drive needs an Authorization header, which <audio> cannot send: the app's service worker answers a local
  // address (__gdrive/<id>?t=<token>) by fetching the file from Drive with the header, Range requests included,
  // so the song streams without being copied. The token never leaves the device. No service worker: null (download).
  async streamUrl(path) {
    if (!navigator.serviceWorker?.controller) return null;
    const id = await pathId(path);
    return new URL('__gdrive/' + encodeURIComponent(id) + '?t=' + encodeURIComponent(await token()), document.baseURI).href;
  },
};
