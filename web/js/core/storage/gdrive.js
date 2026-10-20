// Google Drive adapter (REST v3 + Google Identity Services token flow).
// - Database snapshot lives in the hidden appDataFolder (user never sees it, can't break it).
// - Content files live in a visible "My Hub" folder (drive.file scope: the app only
//   sees files it created or the user picked).
// - Sign-in and the access token belong to the Google account (js/core/account.js).
// Works in the browser, installed PWA and the Bubblewrap/TWA APK (runs in Chrome).
import { DRIVE_FOLDER_NAME } from '../../config.js';
import { getSetting, setSetting } from '../db.js';
import { abortError } from '../tasks.js';
import { account } from '../account.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
let token = null;          // { access_token } of the current request (from account.accessToken)

async function authFetch(url, opts = {}) {
  await ensureToken();
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token.access_token}` } });
  if (res.status === 401) { account.invalidateToken(); throw new Error('Phiên Google hết hạn, hãy kết nối lại.'); }
  if (!res.ok) throw new Error(`Google Drive lỗi ${res.status}: ${await res.text()}`);
  return res;
}

// Uploads go through XMLHttpRequest: fetch() cannot report how many bytes have been sent.
// onProgress(sentBytes, totalBytes); signal (AbortSignal) cancels the request.
function xhr(method, url, { headers = {}, body = null, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const x = new XMLHttpRequest();
    x.open(method, url);
    x.setRequestHeader('Authorization', `Bearer ${token.access_token}`);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    if (onProgress) x.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : 0);
    const stop = () => x.abort();
    signal?.addEventListener('abort', stop, { once: true });
    const done = (fn) => (v) => { signal?.removeEventListener('abort', stop); fn(v); };
    x.onload = done(() => {
      if (x.status === 401) { account.invalidateToken(); return reject(new Error('Phiên Google hết hạn, hãy kết nối lại.')); }
      if (x.status !== 308 && (x.status < 200 || x.status >= 300)) return reject(new Error(`Google Drive lỗi ${x.status}: ${x.responseText}`));
      resolve(x);
    });
    x.onerror = done(() => reject(new Error('Mất kết nối khi tải lên Google Drive.')));
    x.ontimeout = x.onerror;
    x.onabort = done(() => reject(abortError()));
    x.send(body);
  });
}

async function ensureToken() {
  token = { access_token: await account.accessToken() };
}

// Read a response body chunk by chunk to report bytes received. total: known size (Content-Length
// may be missing or compressed), falls back to Content-Length.
async function readBody(res, { total = 0, onProgress } = {}) {
  const type = res.headers.get('Content-Type') || '';
  if (!res.body?.getReader || !onProgress) return res.blob();
  total = total || +res.headers.get('Content-Length') || 0;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.byteLength;
    onProgress(got, Math.max(total, got));
  }
  return new Blob(parts, { type });
}

async function multipartUpload({ name, parents, mimeType, blob, fileId }, { onProgress, signal } = {}) {
  await ensureToken();
  const meta = fileId ? { name } : { name, parents, mimeType };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  body.append('file', blob);
  const url = fileId
    ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id,md5Checksum,modifiedTime,size`
    : `${UPLOAD}/files?uploadType=multipart&fields=id,md5Checksum,modifiedTime,size`;
  // The multipart body is a bit bigger than the file (metadata + boundaries): scale to the file size.
  const prog = onProgress && ((sent, total) => onProgress(Math.min(blob.size, total ? sent / total * blob.size : sent), blob.size));
  const x = await xhr(fileId ? 'PATCH' : 'POST', url, { body, onProgress: prog, signal });
  return JSON.parse(x.responseText);
}

// Resumable upload for big media (> 5 MB), chunked so phones don't run out of memory.
async function resumableUpload({ name, parents, mimeType, blob }, { onProgress, signal } = {}) {
  const init = await authFetch(`${UPLOAD}/files?uploadType=resumable&fields=id,md5Checksum,modifiedTime,size`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': mimeType || 'application/octet-stream' },
    body: JSON.stringify({ name, parents, mimeType }),
  });
  const session = init.headers.get('Location');
  if (!session) throw new Error('Google Drive không mở được phiên tải lên.');
  const CHUNK = 8 * 256 * 1024;
  let offset = 0, x = null;
  onProgress?.(0, blob.size);
  let retries = 0;
  while (offset < blob.size) {
    const end = Math.min(offset + CHUNK, blob.size);
    await ensureToken();
    const from = offset;
    try {
      x = await xhr('PUT', session, {
        headers: { 'Content-Range': `bytes ${from}-${end - 1}/${blob.size}` },
        body: blob.slice(from, end), signal,
        onProgress: onProgress && ((sent) => onProgress(Math.min(end, from + sent), blob.size)),
      });
      offset = end; retries = 0;
    } catch (e) {
      // Network hiccup / 5xx: ask Drive how much it already has and resume from there (any file size).
      if (e?.name === 'AbortError' || /hết hạn/.test(e.message) || ++retries > 8) throw e;
      await new Promise(r => setTimeout(r, Math.min(30000, 1000 * 2 ** retries)));
      if (!navigator.onLine) await new Promise(r => addEventListener('online', r, { once: true }));
      await ensureToken();
      const st = await xhr('PUT', session, { headers: { 'Content-Range': `bytes */${blob.size}` }, signal }).catch(() => null);
      if (st && st.status !== 308) { x = st; offset = blob.size; break; }
      const range = st?.getResponseHeader('Range');
      offset = range ? +range.split('-')[1] + 1 : 0;
    }
    onProgress?.(offset, blob.size);
  }
  if (!x || x.status === 308) throw new Error('Tải lên Drive bị gián đoạn.');
  return JSON.parse(x.responseText);
}

export const gdrive = {
  id: 'gdrive',
  label: 'Google Drive',

  configured() { return account.configured(); },
  // Signed in with a valid token (or one that can be renewed silently on the next request).
  connected() { return account.signedIn && account.tokenValid(); },
  linked() { return account.signedIn; },
  async available() { return this.connected() && navigator.onLine; },

  // Google account storage quota (bytes): { limit, usage, usageInDrive, usageInDriveTrash }. limit is
  // missing for unlimited plans. The app cannot raise it; Settings shows it with a warning near full.
  async quota() {
    const r = await (await authFetch(`${API}/about?fields=storageQuota`)).json();
    const q = r.storageQuota || {};
    return { limit: q.limit ? +q.limit : null, usage: +q.usage || 0, usageInDrive: +q.usageInDrive || 0, trash: +q.usageInDriveTrash || 0 };
  },

  // Kept for older callers: signing in / out is the account's job.
  async connect() { return account.signedIn ? account.reconnect() : account.signIn(); },
  async disconnect() { await account.signOut(); },

  async folderId() {
    let id = await getSetting('gdrive.folderId');
    if (id) return id;
    const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const found = await (await authFetch(`${API}/files?q=${q}&fields=files(id)`)).json();
    id = found.files[0]?.id;
    if (!id) {
      id = (await (await authFetch(`${API}/files`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
      })).json()).id;
    }
    await setSetting('gdrive.folderId', id);
    return id;
  },

  // Upload a content file. Returns location saved in files.locations.gdrive
  // opts: { onProgress(sentBytes, totalBytes), signal }
  async put(fileRow, blob, opts = {}) {
    const parents = [await this.folderId()];
    const args = { name: fileRow.name, parents, mimeType: fileRow.mime, blob };
    const r = blob.size > 5 * 1024 * 1024 ? await resumableUpload(args, opts) : await multipartUpload(args, opts);
    return { fileId: r.id, md5: r.md5Checksum, modifiedTime: r.modifiedTime, size: +r.size };
  },

  // Download a content file. opts: { onProgress(receivedBytes, totalBytes), signal }
  async get(loc, { onProgress, signal } = {}) {
    if (!loc?.fileId) return null;
    const res = await authFetch(`${API}/files/${loc.fileId}?alt=media`, { signal });
    return readBody(res, { total: loc.size || 0, onProgress });
  },

  async remove(loc) {
    if (loc?.fileId) await authFetch(`${API}/files/${loc.fileId}`, { method: 'DELETE' });
  },

  // ── Database snapshot in appDataFolder ──
  // name: 'hub-db.json' (full library) or 'hub-live.json' (progress + devices, small, synced often)
  // opts: { onProgress(bytes, total), signal }
  // Every file in the hidden app folder (hub-db.json, hub-live.json…).
  async listAppData() {
    const out = [];
    let page = '';
    do {
      const r = await (await authFetch(`${API}/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,size)${page ? '&pageToken=' + page : ''}`)).json();
      out.push(...(r.files || [])); page = r.nextPageToken || '';
    } while (page);
    return out;
  },
  // Every visible file this app created (drive.file only ever lists those), incl. the "My Hub" folder.
  async listOwnFiles() {
    const out = [];
    let page = '';
    do {
      const r = await (await authFetch(`${API}/files?q=${encodeURIComponent('trashed=false')}&pageSize=1000&fields=nextPageToken,files(id,name,size,mimeType)${page ? '&pageToken=' + page : ''}`)).json();
      out.push(...(r.files || [])); page = r.nextPageToken || '';
    } while (page);
    return out;
  },
  async deleteById(id) {
    try { await authFetch(`${API}/files/${id}`, { method: 'DELETE' }); }
    catch (e) { if (!/ 404/.test(e.message)) throw e; }
  },

  async readSnapshot(name = 'hub-db.json', { onProgress, signal } = {}) {
    const q = encodeURIComponent(`name='${name}'`);
    const list = await (await authFetch(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)`, { signal })).json();
    const f = list.files[0];
    if (!f) return { id: null, data: null };
    const res = await authFetch(`${API}/files/${f.id}?alt=media`, { signal });
    const data = JSON.parse(await (await readBody(res, { total: +f.size || 0, onProgress })).text());
    return { id: f.id, modifiedTime: f.modifiedTime, data };
  },

  async writeSnapshot(id, data, name = 'hub-db.json', opts = {}) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    if (id) return multipartUpload({ name, blob, fileId: id }, opts);
    return multipartUpload({ name, parents: ['appDataFolder'], mimeType: 'application/json', blob }, opts);
  },
};
