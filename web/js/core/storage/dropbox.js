// Dropbox adapter. Sign-in is OAuth with PKCE and NO redirect: Dropbox shows a code that the user pastes
// into My Hub, so it works the same in the browser, the Windows app and the Android app. It needs a
// (free) Dropbox app of "App folder" type; its App key is typed in once (or set in config.js).
//   hub-db.json / hub-live.json : library + progress (rev = no lost updates)
//   /f-<fileId>-<name>          : files; uploaded in 8 MB sessions, so any size works
// Everything lives in Dropbox/Apps/<your app name>/, which is all the app can see.
import { http } from './http.js';
import { getCloud, clouds } from './clouds.js';

const err = (message, code) => Object.assign(new Error(message), { code });
const API = 'https://api.dropboxapi.com/2', CONTENT = 'https://content.dropboxapi.com/2';
const CHUNK = 8 * 1024 * 1024;
const seen = new Map();
const norm = (d) => JSON.stringify({ ...d, at: undefined });
const safe = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/[^\w.\-]+/g, '_').slice(0, 80);
export const fileKey = (row) => `f-${row.id}-${safe(row.name || 'file')}`;
// Header values must stay ASCII: escape everything else the way Dropbox expects.
const arg = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function startAuth(appKey) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const url = `https://www.dropbox.com/oauth2/authorize?client_id=${encodeURIComponent(appKey)}&response_type=code&token_access_type=offline&code_challenge=${challenge}&code_challenge_method=S256`;
  return { url, verifier };
}
export async function finishAuth(appKey, code, verifier) {
  const r = await http('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: code.trim(), grant_type: 'authorization_code', code_verifier: verifier, client_id: appKey }).toString() });
  const j = JSON.parse(await r.text() || '{}');
  if (!r.ok) throw err(j.error_description || 'Mã Dropbox không đúng hoặc đã hết hạn, lấy mã mới.', 'bad_token');
  clouds.set('dropbox', { appKey, access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
}

async function token() {
  const c = getCloud('dropbox');
  if (!c?.refresh) throw err('Chưa kết nối Dropbox.', 'signed_out');
  if (c.access && Date.now() < c.expires) return c.access;
  const r = await http('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.appKey }).toString() });
  const j = JSON.parse(await r.text() || '{}');
  if (!r.ok) { clouds.set('dropbox', { ...c, access: null, refresh: null }); throw err('Dropbox đã thu hồi quyền truy cập, hãy kết nối lại.', 'reconnect'); }
  clouds.set('dropbox', { ...c, access: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

async function rpc(path, body, { signal } = {}) {
  const r = await http(API + path, { method: 'POST', signal, headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 429) throw err('Dropbox tạm giới hạn số lần gọi, thử lại sau ít phút.', 'rate');
  return r;
}
async function up(path, args, body, { signal } = {}) {
  const r = await http(CONTENT + path, { method: 'POST', signal, body, headers: { Authorization: 'Bearer ' + await token(), 'Dropbox-API-Arg': arg(args), 'Content-Type': 'application/octet-stream' } });
  if (r.status === 429) throw err('Dropbox tạm giới hạn số lần gọi, thử lại sau ít phút.', 'rate');
  return r;
}
const bad = async (r, what) => { let m = ''; try { m = (await r.text()).slice(0, 200); } catch { /* ignore */ } return err(`Dropbox lỗi ${r.status} khi ${what}${m ? ': ' + m : ''}`, 'dropbox'); };
const isConflict = async (r) => r.status === 409 && /conflict/.test(await r.text().catch(() => ''));
const notFound = async (r) => r.status === 409 && /not_found/.test(await r.text().catch(() => ''));

export const dropbox = {
  id: 'dropbox', label: 'Dropbox', files: true,
  fileKey,
  configured: () => true,
  connected: () => !!getCloud('dropbox')?.refresh,
  linked: () => !!getCloud('dropbox')?.refresh,
  async available() { return this.connected() && navigator.onLine; },

  async readSnapshot(name = 'hub-db.json', { signal, onProgress } = {}) {
    const r = await http(CONTENT + '/files/download', { method: 'POST', signal, headers: { Authorization: 'Bearer ' + await token(), 'Dropbox-API-Arg': arg({ path: '/' + name }) } });
    if (r.status === 409) { const t = await r.text(); if (/not_found/.test(t)) { seen.delete(name); return { id: null, data: null }; } throw err('Dropbox lỗi: ' + t.slice(0, 200), 'dropbox'); }
    if (r.status === 429) throw err('Dropbox tạm giới hạn số lần gọi, thử lại sau ít phút.', 'rate');
    if (!r.ok) throw await bad(r, `đọc ${name}`);
    const text = await r.text();
    onProgress?.(text.length, text.length);
    const data = JSON.parse(text);
    seen.set(name, norm(data));
    let rev = null; try { rev = JSON.parse(r.header('dropbox-api-result') || '{}').rev; } catch { /* ignore */ }
    return { id: rev || 'unknown', data };
  },

  async writeSnapshot(rid, data, name = 'hub-db.json', { signal, onProgress } = {}) {
    if (rid && seen.get(name) === norm(data)) { onProgress?.(1, 1); return { id: rid }; }
    const mode = rid && rid !== 'unknown' ? { '.tag': 'update', update: rid } : rid === 'unknown' ? 'overwrite' : 'add';
    const r = await up('/files/upload', { path: '/' + name, mode, autorename: false, mute: true }, JSON.stringify(data), { signal });
    if (await isConflict(r)) throw err('Một máy khác vừa cập nhật dữ liệu, sẽ đồng bộ lại ngay.', 'conflict');
    if (!r.ok) throw await bad(r, `ghi ${name}`);
    const j = JSON.parse(await r.text());
    seen.set(name, norm(data));
    onProgress?.(1, 1);
    return { id: j.rev };
  },

  async deleteAll() {
    let n = 0;
    for (const name of ['hub-db.json', 'hub-live.json']) {
      const r = await rpc('/files/delete_v2', { path: '/' + name });
      if (r.ok) n++; else if (!(await notFound(r))) throw await bad(r, `xoá ${name}`);
      seen.delete(name);
    }
    return n;
  },

  async putFile(key, blob, { signal, onProgress } = {}) {
    const path = '/' + key, commit = { path, mode: 'overwrite', autorename: false, mute: true };
    if (blob.size <= CHUNK) {
      const r = await up('/files/upload', commit, blob, { signal });
      if (!r.ok) throw await bad(r, 'tải tệp lên');
      onProgress?.(blob.size, blob.size);
      return;
    }
    let off = 0, sid = null;
    while (off < blob.size) {
      if (signal?.aborted) throw Object.assign(new Error('Đã huỷ'), { name: 'AbortError' });
      const part = blob.slice(off, off + CHUNK), last = off + part.size >= blob.size;
      let r;
      if (!sid) r = await up('/files/upload_session/start', { close: false }, part, { signal });
      else if (!last) r = await up('/files/upload_session/append_v2', { cursor: { session_id: sid, offset: off }, close: false }, part, { signal });
      else r = await up('/files/upload_session/finish', { cursor: { session_id: sid, offset: off }, commit }, part, { signal });
      if (!r.ok) throw await bad(r, 'tải tệp lên');
      if (!sid) sid = JSON.parse(await r.text()).session_id;
      off += part.size;
      onProgress?.(off, blob.size);
    }
  },
  async getFile(key, { signal, onProgress } = {}) {
    const r = await http(CONTENT + '/files/download', { method: 'POST', signal, onProgress, headers: { Authorization: 'Bearer ' + await token(), 'Dropbox-API-Arg': arg({ path: '/' + key }) } });
    if (r.status === 409) throw err('Tệp không còn trên Dropbox.', 'missing');
    if (!r.ok) throw await bad(r, 'tải tệp về');
    return r.blob();
  },
  async removeFile(key) { const r = await rpc('/files/delete_v2', { path: '/' + key }); if (!r.ok && !(await notFound(r))) throw await bad(r, 'xoá tệp'); },
};
