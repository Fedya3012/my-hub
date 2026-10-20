// GitHub adapter: the library snapshot (hub-db.json) and the progress channel (hub-live.json) live as
// two JSON files in a private repo "my-hub-data" of the signed-in user (Contents API, personal access
// token). readSnapshot/writeSnapshot of hub-db.json and hub-live.json; there is no file upload: music
// and books stay on the device, only data syncs. Sign-in and the token belong to js/core/account.js.
import { account } from '../account.js';

const API = 'https://api.github.com';
export const REPO = 'my-hub-data';
const seen = new Map();      // file name → remote content without "at", to skip writes that change nothing

const err = (message, code) => Object.assign(new Error(message), { code });

async function gh(path, { method = 'GET', body, accept = 'application/vnd.github+json', signal } = {}) {
  const token = await account.accessToken();
  let res;
  try {
    res = await fetch(API + path, {
      method, signal, cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { if (e?.name === 'AbortError') throw e; throw err('Không kết nối được GitHub.', 'offline'); }
  if (res.status === 401) { account.invalidateToken(); throw err('Token GitHub hết hiệu lực, hãy nhập token mới.', 'reconnect'); }
  return res;
}
const fail = async (res, what) => {
  const j = await res.json().catch(() => ({}));
  if (res.status === 403 && /rate limit/i.test(j.message || '')) return err('GitHub tạm giới hạn số lần gọi, thử lại sau ít phút.', 'rate');
  return err(`GitHub lỗi ${res.status} khi ${what}${j.message ? ': ' + j.message : ''}`, 'github');
};

const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (b64) => {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};
const norm = (data) => JSON.stringify({ ...data, at: undefined });

let repoReady = null;        // 'owner/name' once checked this session

export const github = {
  id: 'github',
  label: 'GitHub',

  configured() { return true; },
  connected() { return account.provider === 'github' && account.signedIn && account.tokenValid(); },
  linked() { return account.provider === 'github' && account.signedIn; },
  async available() { return this.connected() && navigator.onLine; },

  // The private repo that holds the data; created on first use (needs the "repo" token scope).
  async ensureRepo() {
    const owner = account.user?.login;
    if (!owner) throw err('Chưa đăng nhập GitHub.', 'signed_out');
    const full = `${owner}/${REPO}`;
    if (repoReady === full) return full;
    const r = await gh(`/repos/${full}`);
    if (r.status === 404) {
      const c = await gh('/user/repos', { method: 'POST', body: { name: REPO, private: true, auto_init: true, description: 'My Hub: dữ liệu đồng bộ (thư viện, tiến độ)' } });
      if (c.status === 403 || c.status === 404) throw err(`Token chưa đủ quyền để tạo kho riêng tư. Tạo thủ công một kho PRIVATE tên “${REPO}” trên GitHub rồi thử lại, hoặc dùng token có quyền “repo”.`, 'scope');
      if (!c.ok && c.status !== 422) throw await fail(c, 'tạo kho dữ liệu');
    } else if (!r.ok) throw await fail(r, 'mở kho dữ liệu');
    else if (!(await r.json()).private) throw err(`Kho “${REPO}” đang công khai. Đổi sang Private trong GitHub (Settings → Danger Zone) trước khi đồng bộ.`, 'public');
    repoReady = full;
    return full;
  },

  // → { id: sha | null, data }
  async readSnapshot(name = 'hub-db.json', { signal, onProgress } = {}) {
    const repo = await this.ensureRepo();
    const r = await gh(`/repos/${repo}/contents/${name}`, { signal });
    if (r.status === 404) { seen.delete(name); return { id: null, data: null }; }
    if (!r.ok) throw await fail(r, `đọc ${name}`);
    const meta = await r.json();
    let text;
    if (meta.content && meta.encoding === 'base64') text = b64decode(meta.content);
    else {   // over 1 MB the JSON answer has no content: ask for the raw file
      const raw = await gh(`/repos/${repo}/contents/${name}`, { accept: 'application/vnd.github.raw+json', signal });
      if (!raw.ok) throw await fail(raw, `đọc ${name}`);
      text = await raw.text();
    }
    onProgress?.(text.length, text.length);
    const data = JSON.parse(text);
    seen.set(name, norm(data));
    return { id: meta.sha, data };
  },

  async writeSnapshot(id, data, name = 'hub-db.json', { signal, onProgress } = {}) {
    if (id && seen.get(name) === norm(data)) { onProgress?.(1, 1); return { id }; }   // nothing changed: no new commit
    const repo = await this.ensureRepo();
    const r = await gh(`/repos/${repo}/contents/${name}`, {
      method: 'PUT', signal,
      body: { message: `sync ${name}`, content: b64encode(JSON.stringify(data)), ...(id ? { sha: id } : {}) },
    });
    if (r.status === 409 || r.status === 422) throw err('Một máy khác vừa cập nhật dữ liệu, sẽ đồng bộ lại ngay.', 'conflict');
    if (!r.ok) throw await fail(r, `ghi ${name}`);
    const j = await r.json();
    seen.set(name, norm(data));
    onProgress?.(1, 1);
    return { id: j.content?.sha };
  },

  // Delete the data files (the repo itself stays; deleting it needs another token scope).
  async deleteAll() {
    let n = 0;
    for (const name of ['hub-db.json', 'hub-live.json']) {
      const cur = await this.readSnapshot(name).catch(() => ({ id: null }));
      if (!cur.id) continue;
      const repo = await this.ensureRepo();
      const r = await gh(`/repos/${repo}/contents/${name}`, { method: 'DELETE', body: { message: `delete ${name}`, sha: cur.id } });
      if (!r.ok && r.status !== 404) throw await fail(r, `xoá ${name}`);
      seen.delete(name); n++;
    }
    return n;
  },
};
