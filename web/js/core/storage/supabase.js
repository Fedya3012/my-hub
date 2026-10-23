// Supabase adapter: the library snapshot (hub-db.json) lives in hub_data.snapshot and the progress
// channel (hub-live.json) in hub_data.live, one row per account (row-level security keeps it private).
// Same contract as github.js: readSnapshot(name) → { id, data }, writeSnapshot(id, data, name), deleteAll().
// The library itself is stored one row per record (hub_rows), so a sync sends only what changed (pullRows /
// pushRows); readSnapshot / writeSnapshot('hub-db.json') still work by assembling / splitting those rows.
// id is the row's version counter: a write only lands if the version is still the one that was read,
// otherwise another device wrote first and the caller syncs again. Music and books are never sent here.
import { supa, SUPABASE_URL, SUPABASE_KEY, supaError as err } from '../supabase.js';

async function rest(path, { method = 'GET', body, prefer, signal } = {}) {
  const token = await supa.accessToken();
  let res;
  try {
    res = await fetch(SUPABASE_URL + '/rest/v1' + path, {
      method, signal, cache: 'no-store',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) { if (e?.name === 'AbortError') throw e; throw err('Không kết nối được máy chủ tài khoản.', 'offline'); }
  if (res.status === 401) throw err('Phiên đăng nhập hết hạn, hãy đăng nhập lại.', 'signed_out');
  return res;
}
const fail = async (res, what) => {
  const j = await res.json().catch(() => ({}));
  if (res.status === 429) return err('Máy chủ tạm giới hạn số lần gọi, thử lại sau ít phút.', 'rate');
  return err(`Lỗi ${res.status} khi ${what}${j.message ? ': ' + j.message : ''}`, 'supabase');
};

// Column pair per file: the snapshot and its version, or the live channel and its version.
const cols = (name) => name === 'hub-live.json' ? { data: 'live', ver: 'live_version' } : { data: 'snapshot', ver: 'version' };

const PAGE = 1000, BATCH = 400;
const rowOf = (r) => ({ tbl: r.tbl, id: String(r.id), data: r.deleted ? null : r.data, deleted: !!r.deleted, updated_at: r.updatedAt || 0 });

export const supabase = {
  id: 'supabase',
  incremental: true,
  label: 'Tài khoản My Hub',

  configured() { return true; },
  connected() { return supa.signedIn; },
  linked() { return supa.signedIn; },
  async available() { return this.connected() && navigator.onLine; },

  // Rows written after `since` (seq), oldest first → { rows: [{ tbl, id, data, deleted, updatedAt }], seq }.
  async pullRows(since = 0, { signal, onProgress } = {}) {
    const rows = [];
    let seq = since, total = null;
    for (;;) {
      const r = await rest(`/hub_rows?select=tbl,id,data,deleted,updated_at,seq&seq=gt.${seq}&order=seq.asc&limit=${PAGE}`, { signal, prefer: total === null ? 'count=exact' : undefined });
      if (!r.ok) throw await fail(r, 'đọc dữ liệu');
      if (total === null) total = Number((r.headers.get('content-range') || '').split('/')[1]) || 0;
      const page = await r.json();
      for (const x of page) rows.push({ tbl: x.tbl, id: x.id, data: x.data, deleted: x.deleted, updatedAt: Number(x.updated_at) });
      if (page.length) seq = Number(page[page.length - 1].seq);
      onProgress?.(rows.length, total || rows.length);
      if (page.length < PAGE) break;
    }
    return { rows, seq };
  },

  // Upserts rows ({ tbl, id, data, deleted, updatedAt }); the server keeps the newer copy of each.
  async pushRows(rows, { signal, onProgress } = {}) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const r = await rest('/hub_rows?on_conflict=user_id,tbl,id', {
        method: 'POST', signal, prefer: 'resolution=merge-duplicates,return=minimal',
        body: rows.slice(i, i + BATCH).map(x => ({ user_id: supa.userId, ...rowOf(x) })),
      });
      if (!r.ok) throw await fail(r, 'ghi dữ liệu');
      onProgress?.(Math.min(rows.length, i + BATCH), rows.length);
    }
  },

  // → { id: version | null, data }. id null: this account has no row yet.
  async readSnapshot(name = 'hub-db.json', { signal, onProgress } = {}) {
    if (name === 'hub-db.json') {
      const { rows } = await this.pullRows(0, { signal, onProgress });
      if (!rows.length) return { id: null, data: null };
      const tables = {}, tombstones = {};
      for (const r of rows) {
        if (r.deleted) (tombstones[r.tbl] ||= {})[r.id] = r.updatedAt;
        else (tables[r.tbl] ||= []).push(r.data);
      }
      return { id: 1, data: { format: 'my-hub-snapshot', tables, tombstones } };
    }
    const c = cols(name);
    const r = await rest(`/hub_data?select=${c.data},${c.ver}`, { signal });
    if (!r.ok) throw await fail(r, `đọc ${name}`);
    const [row] = await r.json();
    if (!row) return { id: null, data: null };
    const text = JSON.stringify(row[c.data]);
    onProgress?.(text.length, text.length);
    return { id: Number(row[c.ver]), data: Number(row[c.ver]) === 0 ? null : row[c.data] };
  },

  async writeSnapshot(id, data, name = 'hub-db.json', { signal, onProgress } = {}) {
    if (name === 'hub-db.json') {
      const rows = [];
      for (const [tbl, list] of Object.entries(data?.tables || {})) {
        const kp = tbl === 'tracks' || tbl === 'lyrics' || tbl === 'books' || tbl === 'fanfics' || tbl === 'pcShows' ? 'itemId' : tbl === 'pcTranscripts' ? 'episodeId' : 'id';
        for (const d of list || []) rows.push({ tbl, id: d[kp], data: d, updatedAt: d.updatedAt });
      }
      for (const [tbl, m] of Object.entries(data?.tombstones || {})) for (const [rid, at] of Object.entries(m || {})) rows.push({ tbl, id: rid, deleted: true, updatedAt: +at || 0 });
      await this.pushRows(rows, { signal, onProgress });
      return { id: 1 };
    }
    const c = cols(name);
    if (id === null) {
      // First write: insert the row for this account (RLS checks user_id = auth.uid()).
      const r = await rest('/hub_data', {
        method: 'POST', signal, prefer: 'return=representation',
        body: { user_id: supa.userId, [c.data]: data, [c.ver]: 1, updated_at: new Date().toISOString() },
      });
      if (r.status === 409) throw err('Một máy khác vừa cập nhật dữ liệu, sẽ đồng bộ lại ngay.', 'conflict');
      if (!r.ok) throw await fail(r, `ghi ${name}`);
      onProgress?.(1, 1);
      return { id: 1 };
    }
    // Later writes: only if the version is still the one we read.
    const r = await rest(`/hub_data?${c.ver}=eq.${id}`, {
      method: 'PATCH', signal, prefer: 'return=representation',
      body: { [c.data]: data, [c.ver]: id + 1, updated_at: new Date().toISOString() },
    });
    if (!r.ok) throw await fail(r, `ghi ${name}`);
    const rows = await r.json();
    if (!rows.length) throw err('Một máy khác vừa cập nhật dữ liệu, sẽ đồng bộ lại ngay.', 'conflict');
    onProgress?.(1, 1);
    return { id: id + 1 };
  },

  // Empties the account's data (the account itself stays; see supa.deleteAccount for that).
  async deleteAll() {
    const del = await rest('/hub_rows?tbl=neq.', { method: 'DELETE' });
    if (!del.ok) throw await fail(del, 'xoá dữ liệu');
    const r = await rest('/hub_data', {
      method: 'PATCH', body: { snapshot: {}, version: 0, live: {}, live_version: 0 },
    });
    if (!r.ok) throw await fail(r, 'xoá dữ liệu');
    return 2;
  },
};
