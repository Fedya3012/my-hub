// WebDAV adapter (also FileJump, Nextcloud, Synology, Koofr, pCloud…). Only GET / PUT / DELETE are used,
// in ONE folder that must already exist (no PROPFIND / MKCOL: the Android HTTP plugin cannot send them).
//   hub-db.json, hub-live.json  : library snapshot and progress channel (If-Match on the ETag = no lost updates)
//   f-<fileId>-<name>           : music / book files, uploaded after they are added, fetched when missing
import { http } from './http.js';
import { getCloud, clouds } from './clouds.js';

const err = (message, code) => Object.assign(new Error(message), { code });
const seen = new Map();
const norm = (d) => JSON.stringify({ ...d, at: undefined });

export const PRESETS = {
  webdav: { label: 'WebDAV', hint: 'Nextcloud, Synology, Koofr, pCloud, Box… hoặc máy chủ WebDAV của bạn.', urlHint: 'https://máy-chủ/remote.php/dav/files/ten/MyHub/' },
  filejump: { label: 'FileJump', hint: 'FileJump hỗ trợ WebDAV. Lấy địa chỉ máy chủ WebDAV trong trang hướng dẫn của FileJump và đăng nhập bằng tài khoản FileJump.', urlHint: 'Dán địa chỉ WebDAV của FileJump', help: 'https://filejump.com/kb/webdav-setup' },
};

export const normUrl = (u) => { u = String(u || '').trim(); if (!/^https?:\/\//i.test(u)) throw err('Địa chỉ phải bắt đầu bằng https:// (hoặc http://).', 'bad_config'); return u.endsWith('/') ? u : u + '/'; };
const auth = (c) => 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(`${c.user}:${c.pass}`)));
const safe = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/[^\w.\-]+/g, '_').slice(0, 80);
export const fileKey = (row) => `f-${row.id}-${safe(row.name || 'file')}`;

export function webdavAdapter(id) {
  const cfg = () => getCloud(id);
  const req = async (name, { method = 'GET', headers = {}, body, signal, onProgress } = {}) => {
    const c = cfg();
    if (!c?.url) throw err('Chưa kết nối ' + PRESETS[id].label + '.', 'signed_out');
    const r = await http(c.url + encodeURIComponent(name), { method, signal, body, onProgress, viaShell: true, headers: { Authorization: auth(c), ...headers } });
    if (r.status === 401 || r.status === 403) throw err('Máy chủ từ chối tên đăng nhập hoặc mật khẩu (nhiều dịch vụ cần mật khẩu ứng dụng).', 'reconnect');
    return r;
  };
  const fail = (r, what) => err(`${PRESETS[id].label} lỗi ${r.status} khi ${what}.`, 'webdav');
  const tag = (r) => r.header('etag') || r.header('last-modified') || 'nolock';

  return {
    id, label: PRESETS[id].label, files: true,
    fileKey,
    configured: () => true,
    connected: () => !!cfg()?.url,
    linked: () => !!cfg()?.url,
    async available() { return this.connected() && navigator.onLine; },

    // Checks address, folder and credentials by writing and deleting a tiny file.
    async test(c) {
      const save = cfg(); clouds.set(id, c);
      try {
        const w = await req('.my-hub-check', { method: 'PUT', body: 'ok' });
        if (w.status === 404 || w.status === 409) throw err('Không tìm thấy thư mục. Tạo thư mục trên máy chủ trước rồi dán địa chỉ của nó.', 'bad_config');
        if (!w.ok) throw fail(w, 'ghi thử');
        await req('.my-hub-check', { method: 'DELETE' }).catch(() => {});
      } finally { clouds.set(id, save); }
    },

    async readSnapshot(name = 'hub-db.json', { signal, onProgress } = {}) {
      const r = await req(name, { signal });
      if (r.status === 404) { seen.delete(name); return { id: null, data: null }; }
      if (!r.ok) throw fail(r, `đọc ${name}`);
      const text = await r.text();
      onProgress?.(text.length, text.length);
      const data = JSON.parse(text);
      seen.set(name, norm(data));
      return { id: tag(r), data };
    },

    async writeSnapshot(rid, data, name = 'hub-db.json', { signal, onProgress } = {}) {
      if (rid && seen.get(name) === norm(data)) { onProgress?.(1, 1); return { id: rid }; }
      const lock = !rid ? { 'If-None-Match': '*' } : rid === 'nolock' ? {} : /^"|^W\//.test(rid) ? { 'If-Match': rid } : {};
      const r = await req(name, { method: 'PUT', signal, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', ...lock } });
      if (r.status === 412) throw err('Một máy khác vừa cập nhật dữ liệu, sẽ đồng bộ lại ngay.', 'conflict');
      if (!r.ok) throw fail(r, `ghi ${name}`);
      seen.set(name, norm(data));
      onProgress?.(1, 1);
      return { id: r.header('etag') || 'nolock' };
    },

    async deleteAll() {
      let n = 0;
      for (const name of ['hub-db.json', 'hub-live.json']) {
        const r = await req(name, { method: 'DELETE' });
        if (r.ok) n++; else if (r.status !== 404) throw fail(r, `xoá ${name}`);
        seen.delete(name);
      }
      return n;
    },

    async putFile(key, blob, { signal, onProgress } = {}) {
      const r = await req(key, { method: 'PUT', body: blob, signal, headers: { 'Content-Type': blob.type || 'application/octet-stream' }, onProgress });
      if (!r.ok) throw fail(r, 'tải tệp lên');
      onProgress?.(blob.size, blob.size);
    },
    async getFile(key, { signal, onProgress } = {}) {
      const r = await req(key, { signal, onProgress });
      if (r.status === 404) throw err('Tệp không còn trên ' + PRESETS[id].label + '.', 'missing');
      if (!r.ok) throw fail(r, 'tải tệp về');
      return r.blob();
    },
    async removeFile(key) { const r = await req(key, { method: 'DELETE' }); if (!r.ok && r.status !== 404) throw fail(r, 'xoá tệp'); },
  };
}
