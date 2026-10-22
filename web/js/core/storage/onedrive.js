// OneDrive adapter (Microsoft Graph, app folder "Apps/<your app name>/" only). Sign-in is OAuth with PKCE and
// the Microsoft "nativeclient" redirect: after allowing access the browser lands on a blank page whose
// address contains ?code=…; the user pastes that address into My Hub. Needs a (free) Azure app registration,
// "Mobile and desktop" platform with that redirect, delegated permissions Files.ReadWrite.AppFolder + offline_access.
//   hub-db.json / hub-live.json : library + progress (If-Match on the eTag = no lost updates)
//   f-<fileId>-<name>           : files; over 4 MB they go up through an upload session in 10 MB parts
// Token calls go through the shell (no CORS for this redirect type) where the Windows/Android app has one.
import { http } from './http.js';
import { getCloud, clouds } from './clouds.js';

const err = (message, code) => Object.assign(new Error(message), { code });
const AUTHZ = 'https://login.microsoftonline.com/common/oauth2/v2.0/';
const REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const SCOPE = 'Files.ReadWrite.AppFolder offline_access';
const ROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
const SIMPLE = 4 * 1024 * 1024, PART = 32 * 320 * 1024;   // parts must be multiples of 320 KiB
const seen = new Map();
const norm = (d) => JSON.stringify({ ...d, at: undefined });
const safe = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').replace(/[^\w.\-]+/g, '_').slice(0, 80);
export const fileKey = (row) => `f-${row.id}-${safe(row.name || 'file')}`;
const encodePath = (p) => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/');
const item = (name) => `${ROOT}:/${encodePath(name)}`;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function startAuth(clientId) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const url = `${AUTHZ}authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent(SCOPE)}&code_challenge=${challenge}&code_challenge_method=S256&response_mode=query`;
  return { url, verifier };
}
// `pasted` is the address of the blank page (…nativeclient?code=…) or just the code.
export const codeFrom = (pasted) => { const s = String(pasted || '').trim(); const m = s.match(/[?&]code=([^&\s#]+)/); return m ? decodeURIComponent(m[1]) : s; };
const form = (o) => new URLSearchParams(o).toString();
async function tokenCall(body) {
  const r = await http(AUTHZ + 'token', { method: 'POST', viaShell: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) });
  return { r, j: JSON.parse(await r.text() || '{}') };
}
export async function finishAuth(clientId, pasted, verifier) {
  const { r, j } = await tokenCall({ client_id: clientId, grant_type: 'authorization_code', code: codeFrom(pasted), redirect_uri: REDIRECT, code_verifier: verifier, scope: SCOPE });
  if (!r.ok) throw err(j.error_description?.split('\r')[0] || 'Mã OneDrive không đúng hoặc đã hết hạn, lấy mã mới.', 'bad_token');
  clouds.set('onedrive', { clientId, access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
}

async function token() {
  const c = getCloud('onedrive');
  if (!c?.refresh) throw err('Chưa kết nối OneDrive.', 'signed_out');
  if (c.access && Date.now() < c.expires) return c.access;
  const { r, j } = await tokenCall({ client_id: c.clientId, grant_type: 'refresh_token', refresh_token: c.refresh, scope: SCOPE });
  // Only a refused refresh token (400/401) means the access was revoked; a server hiccup (429/5xx) is retried later.
  if (!r.ok && r.status !== 400 && r.status !== 401) throw err(`OneDrive tạm thời không phản hồi (${r.status}), sẽ thử lại.`, 'offline');
  if (!r.ok) { clouds.set('onedrive', { ...c, access: null, refresh: null }); throw err('OneDrive đã thu hồi quyền truy cập, hãy kết nối lại.', 'reconnect'); }
  clouds.set('onedrive', { ...c, access: j.access_token, refresh: j.refresh_token || c.refresh, expires: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

async function api(url, { method = 'GET', headers = {}, body, signal, onProgress } = {}) {
  const r = await http(url, { method, signal, body, onProgress, headers: { Authorization: 'Bearer ' + await token(), ...headers } });
  if (r.status === 429 || r.status === 503) throw err('OneDrive tạm giới hạn số lần gọi, thử lại sau ít phút.', 'rate');
  return r;
}
const bad = async (r, what) => { let m = ''; try { m = (await r.text()).slice(0, 200); } catch { /* ignore */ } return err(`OneDrive lỗi ${r.status} khi ${what}${m ? ': ' + m : ''}`, 'onedrive'); };
const meta = async (name, opt) => {
  const r = await api(item(name), opt);
  if (r.status === 404) return null;
  if (!r.ok) throw await bad(r, `đọc ${name}`);
  return JSON.parse(await r.text());
};

export const onedrive = {
  id: 'onedrive', label: 'OneDrive', files: true,
  fileKey,
  configured: () => true,
  connected: () => !!getCloud('onedrive')?.refresh,
  linked: () => !!getCloud('onedrive')?.refresh,
  async available() { return this.connected() && navigator.onLine; },

  async readSnapshot(name = 'hub-db.json', { signal, onProgress } = {}) {
    const m = await meta(name, { signal });
    if (!m) { seen.delete(name); return { id: null, data: null }; }
    const r = await http(m['@microsoft.graph.downloadUrl'], { signal });
    if (!r.ok) throw await bad(r, `đọc ${name}`);
    const text = await r.text();
    onProgress?.(text.length, text.length);
    const data = JSON.parse(text);
    seen.set(name, norm(data));
    return { id: m.eTag || 'unknown', data };
  },

  async writeSnapshot(rid, data, name = 'hub-db.json', { signal, onProgress } = {}) {
    if (rid && seen.get(name) === norm(data)) { onProgress?.(1, 1); return { id: rid }; }
    const lock = !rid ? { 'If-None-Match': '*' } : rid === 'unknown' ? {} : { 'If-Match': rid };
    const r = await api(item(name) + ':/content', { method: 'PUT', signal, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', ...lock } });
    if (r.status === 412 || r.status === 409) throw err('Một máy khác vừa cập nhật dữ liệu, sẽ đồng bộ lại ngay.', 'conflict');
    if (!r.ok) throw await bad(r, `ghi ${name}`);
    const j = JSON.parse(await r.text());
    seen.set(name, norm(data));
    onProgress?.(1, 1);
    return { id: j.eTag || 'unknown' };
  },

  async deleteAll() {
    let n = 0;
    for (const name of ['hub-db.json', 'hub-live.json']) {
      const r = await api(item(name), { method: 'DELETE' });
      if (r.ok) n++; else if (r.status !== 404) throw await bad(r, `xoá ${name}`);
      seen.delete(name);
    }
    return n;
  },

  async putFile(key, blob, { signal, onProgress } = {}) {
    if (blob.size <= SIMPLE) {
      const r = await api(item(key) + ':/content', { method: 'PUT', signal, body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
      if (!r.ok) throw await bad(r, 'tải tệp lên');
      onProgress?.(blob.size, blob.size);
      return;
    }
    const s = await api(item(key) + ':/createUploadSession', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) });
    if (!s.ok) throw await bad(s, 'tải tệp lên');
    const url = JSON.parse(await s.text()).uploadUrl;
    for (let off = 0; off < blob.size; off += PART) {
      if (signal?.aborted) throw Object.assign(new Error('Đã huỷ'), { name: 'AbortError' });
      const part = blob.slice(off, off + PART), end = off + part.size - 1;
      const r = await http(url, { method: 'PUT', signal, body: part, headers: { 'Content-Range': `bytes ${off}-${end}/${blob.size}` } });   // pre-authorised URL: no token
      if (!r.ok) throw await bad(r, 'tải tệp lên');
      onProgress?.(end + 1, blob.size);
    }
  },
  async getFile(key, { signal, onProgress } = {}) {
    const m = await meta(key, { signal });
    if (!m) throw err('Tệp không còn trên OneDrive.', 'missing');
    const r = await http(m['@microsoft.graph.downloadUrl'], { signal, onProgress });
    if (!r.ok) throw await bad(r, 'tải tệp về');
    return r.blob();
  },
  async removeFile(key) { const r = await api(item(key), { method: 'DELETE' }); if (!r.ok && r.status !== 404) throw await bad(r, 'xoá tệp'); },

  // Folder picking: the app folder's own folders and files. sub = path under it ('' = the top).
  async listDir(sub = '') {
    const out = [];
    let url = (sub ? item(sub) + ':' : ROOT) + '/children?$select=name,folder,size&$top=200';
    while (url) {
      const r = await api(url);
      if (r.status === 404) throw err('Thư mục không còn trên OneDrive: ' + (sub || '/'), 'missing');
      if (!r.ok) throw await bad(r, 'mở thư mục');
      const j = JSON.parse(await r.text());
      for (const e of j.value || []) out.push({ name: e.name, path: (sub ? sub + '/' : '') + e.name, isDir: !!e.folder, size: e.size || 0 });
      url = j['@odata.nextLink'] || null;
    }
    return out.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'vi'));
  },
  getPath(path, opts) { return this.getFile(path, opts); },
  // Microsoft's pre-authorised download address (about an hour): the player streams from it.
  async streamUrl(path) {
    const m = await meta(path);
    if (!m) throw err('Tệp không còn trên OneDrive.', 'missing');
    return m['@microsoft.graph.downloadUrl'];
  },
};
