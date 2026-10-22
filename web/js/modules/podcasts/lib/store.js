// Podcast data: shows, episodes, the queue, playlists and smart filters, bookmarks, search history, downloads,
// transcripts and local audio imports. Schema: core/db.js version 6 (docs/PODCASTS.md).
import { db, now, uid, logActivity } from '../../../core/db.js';
import { bus } from '../../../core/bus.js';
import { progress } from '../../../core/progress.js';
import { http, nativeShell } from '../../../core/storage/http.js';
import { fetchText, fetchJson, hash, normFeed } from './net.js';
import { parseFeed, parseTranscript, parseChapters } from './rss.js';
import { itunesEpisodes } from './online.js';
import { get } from './prefs.js';

export const MOD = 'podcasts';
export const LOCAL_SHOW = 'pc:local';
export const showIdOf = (feedUrl) => feedUrl === 'local:' ? LOCAL_SHOW : 'pc:' + hash(normFeed(feedUrl).replace(/^https?:\/\//, '').toLowerCase());
export const episodeIdOf = (showId, guid) => 'ep:' + hash(showId + '|' + guid);
const changed = (what = {}) => bus.emit('podcasts:changed', what);

// ── Shows ───────────────────────────────────────────────────────
export const show = (id) => db.pcShows.get(id);
export async function shows({ subscribed = true } = {}) {
  const all = await db.pcShows.toArray();
  return all.filter(s => !s.deleted && (!subscribed || s.subscribed));
}

// Feed → { show, episodes }. When the RSS is blocked (CORS in the browser) and the show is on iTunes, its episodes
// come from iTunes lookup instead (no chapters / transcripts then).
export async function loadFeed(feedUrl, { itunesId = null, signal } = {}) {
  feedUrl = normFeed(feedUrl);
  try {
    return parseFeed(await fetchText(feedUrl, { signal }), feedUrl);
  } catch (e) {
    if (!itunesId || e?.name === 'AbortError') throw e;
    const eps = await itunesEpisodes(itunesId, signal);
    if (!eps.length) throw e;
    return { show: { feedUrl, title: '', author: '', description: '', image: '', categories: [], persons: [], funding: [], partial: true }, episodes: eps };
  }
}

// Save a feed (and its episodes). subscribe: true adds it to Đăng ký and to the Library.
export async function saveFeed(parsed, meta = {}, { subscribe = false } = {}) {
  const feedUrl = normFeed(meta.feedUrl || parsed.show.feedUrl);
  const id = showIdOf(feedUrl);
  const old = await db.pcShows.get(id);
  const s = parsed.show;
  const row = {
    itemId: id, feedUrl, title: s.title || meta.title || old?.title || 'Podcast', author: s.author || meta.author || old?.author || '',
    description: s.description || meta.description || old?.description || '', image: s.image || meta.image || old?.image || '',
    link: s.link || old?.link || '', language: s.language || meta.language || old?.language || '',
    categories: s.categories?.length ? s.categories : meta.categories?.length ? meta.categories : old?.categories || [],
    persons: s.persons || [], funding: s.funding || [], explicit: !!s.explicit, complete: !!s.complete,
    sources: [...new Set([...(old?.sources || []), ...(meta.sources || [])])], itunesId: meta.itunesId || old?.itunesId || null, piId: meta.piId || old?.piId || null, rating: meta.rating ?? old?.rating ?? null,
    subscribed: subscribe ? 1 : old?.subscribed || 0, subscribedAt: subscribe && !old?.subscribed ? now() : old?.subscribedAt || null,
    settings: old?.settings || {}, refreshedAt: now(), lastEpisodeAt: Math.max(0, ...parsed.episodes.map(e => e.pubDate || 0)),
    createdAt: old?.createdAt || now(), deleted: 0, partial: !!s.partial,
  };
  const known = new Map((await db.pcEpisodes.where('showId').equals(id).toArray()).map(e => [e.id, e]));
  const fresh = [];
  const rows = parsed.episodes.map((e) => {
    const eid = episodeIdOf(id, e.guid);
    const prev = known.get(eid);
    const isNew = !prev && old?.subscribed && (e.pubDate || 0) > (old.lastEpisodeAt || 0);
    if (isNew) fresh.push(eid);
    return {
      ...prev, ...e, id: eid, showId: id, played: prev?.played || 0, starred: prev?.starred || 0,
      inbox: prev ? prev.inbox || 0 : isNew ? 1 : 0, createdAt: prev?.createdAt || now(), deleted: 0,
    };
  });
  await db.transaction('rw', db.pcShows, db.pcEpisodes, db.items, async () => {
    await db.pcShows.put(row);
    await db.pcEpisodes.bulkPut(rows);
    if (row.subscribed) await putItem(row, rows.length);
  });
  if (fresh.length && get('newToQueue')) await enqueue(fresh);
  changed({ showId: id });
  return { id, fresh };
}

// The Library row of a subscribed show.
async function putItem(s, count) {
  const old = await db.items.get(s.itemId);
  await db.items.put({
    ...(old || { createdAt: now(), favorite: 0, rating: 0, status: 'new' }),
    id: s.itemId, type: 'podcast', moduleId: MOD, title: s.title, subtitle: s.author, tags: s.categories.slice(0, 6), deleted: 0,
    meta: { ...(old?.meta || {}), cover: s.image, episodes: count ?? old?.meta?.episodes ?? 0, feedUrl: s.feedUrl },
  });
}

export async function subscribe(result, { signal } = {}) {
  const parsed = await loadFeed(result.feedUrl, { itunesId: result.itunesId, signal });
  const r = await saveFeed(parsed, result, { subscribe: true });
  await logActivity(r.id, MOD, 'subscribe').catch(() => {});
  return r.id;
}
// Subscribe to a show already read (preview page) without reading the feed again.
export async function subscribeCached(id) {
  const s = await db.pcShows.get(id);
  if (!s) return;
  s.subscribed = 1; s.subscribedAt = now();
  await db.pcShows.put(s);
  await putItem(s, await db.pcEpisodes.where('showId').equals(id).count());
  await logActivity(id, MOD, 'subscribe').catch(() => {});
  changed({ showId: id });
}
export async function unsubscribe(id) {
  await db.pcShows.update(id, { subscribed: 0 });
  await db.items.update(id, { deleted: 1 });
  changed({ showId: id });
}
export async function setShowSettings(id, patch) {
  const s = await db.pcShows.get(id);
  await db.pcShows.update(id, { settings: { ...(s?.settings || {}), ...patch } });
  changed({ showId: id });
}

export async function refresh(id, { signal } = {}) {
  const s = await db.pcShows.get(id);
  if (!s || s.feedUrl.startsWith('local:')) return { fresh: [] };
  return saveFeed(await loadFeed(s.feedUrl, { itunesId: s.itunesId, signal }), s);
}
// Every subscription, with a progress task. → number of new episodes.
export async function refreshAll(task) {
  const list = (await shows()).filter(s => !s.feedUrl.startsWith('local:'));
  let fresh = [];
  task?.update({ total: list.length, done: 0, unit: 'items' });
  for (const s of list) {
    task?.check();
    task?.update({ detail: s.title });
    try { fresh = fresh.concat((await refresh(s.itemId, { signal: task?.signal })).fresh); }
    catch (e) { if (e?.name === 'AbortError') throw e; console.warn('[podcasts] refresh', s.feedUrl, e); }
    task?.step();
  }
  await (await import('../../../core/db.js')).setSetting('podcasts.lastRefresh', now());
  if (fresh.length) bus.emit('podcasts:new', { ids: fresh });
  return fresh.length;
}

// ── Episodes ────────────────────────────────────────────────────
export const episode = (id) => db.pcEpisodes.get(id);
export async function episodesOf(showId) {
  const list = await db.pcEpisodes.where('showId').equals(showId).toArray();
  return list.filter(e => !e.deleted).sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0));
}
export async function withShows(eps) {
  const ids = [...new Set(eps.map(e => e.showId))];
  const ss = await db.pcShows.bulkGet(ids);
  const m = new Map(ids.map((id, i) => [id, ss[i]]));
  return eps.map(e => ({ ...e, show: m.get(e.showId) || null }));
}
// Progress rows of many episodes at once → Map id → row
export async function progressOf(ids) {
  const rows = await db.progress.bulkGet(ids);
  return new Map(ids.map((id, i) => [id, rows[i]]).filter(([, r]) => r));
}
// The pseudo-item progress.save()/track() expect for an episode.
export const progressItem = (e) => ({ id: e.id, moduleId: MOD, status: 'in-progress' });

export async function setPlayed(id, played = true) {
  await db.pcEpisodes.update(id, { played: played ? 1 : 0, inbox: 0, playedAt: played ? now() : null });
  const e = await db.pcEpisodes.get(id);
  if (played && e) await progress.save(progressItem(e), { position: e.duration || 1, total: e.duration || 1, state: 'finished', extra: { virtual: true, showId: e.showId } });
  else if (e) await progress.save(progressItem(e), { position: 0, total: e.duration || 0, state: 'reset', extra: { virtual: true, showId: e.showId } });
  if (played) { await dequeue(id); if (get('autoDelete')) await deleteDownload(id, { quiet: true }); }
  changed({ episodeId: id });
}
export async function setStar(id, on) { await db.pcEpisodes.update(id, { starred: on ? 1 : 0 }); changed({ episodeId: id }); }
export async function clearInbox(ids) {
  ids ||= (await db.pcEpisodes.where('inbox').equals(1).primaryKeys());
  await db.transaction('rw', db.pcEpisodes, async () => { for (const id of ids) await db.pcEpisodes.update(id, { inbox: 0 }); });
  changed({});
}
export async function inbox() {
  const eps = (await db.pcEpisodes.where('inbox').equals(1).toArray()).filter(e => !e.deleted && !e.played);
  return withShows(eps.sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0)));
}

// Episodes the user stopped in the middle, newest first ("Nghe tiếp").
export async function continueListening(limit = 12) {
  const rows = (await db.progress.where('moduleId').equals(MOD).toArray())
    .filter(r => r.state !== 'finished' && r.state !== 'reset' && r.position > 5 && !r.itemId.startsWith('podcasts:'))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  const eps = await db.pcEpisodes.bulkGet(rows.map(r => r.itemId));
  return withShows(eps.map((e, i) => e && !e.deleted && !e.played ? { ...e, progress: rows[i] } : null).filter(Boolean));
}

// Newest episodes from subscriptions ("Tập mới").
export async function latest(limit = 20) {
  const subs = await shows();
  const ids = new Set(subs.map(s => s.itemId));
  const eps = (await db.pcEpisodes.orderBy('pubDate').reverse().limit(400).toArray()).filter(e => ids.has(e.showId) && !e.deleted);
  return withShows(eps.slice(0, limit));
}

// ── Queue (Hàng chờ) and playlists ──────────────────────────────
const QUEUE = 'up-next';
export async function queue() { return (await db.pcPlaylists.get(QUEUE))?.episodeIds || []; }
async function setQueue(ids) {
  const old = await db.pcPlaylists.get(QUEUE);
  await db.pcPlaylists.put({ ...(old || { createdAt: now(), name: 'Hàng chờ' }), id: QUEUE, kind: 'queue', episodeIds: [...new Set(ids)], deleted: 0 });
  bus.emit('podcasts:queue');
}
export async function enqueue(ids, { next = false } = {}) {
  ids = [].concat(ids);
  const q = (await queue()).filter(id => !ids.includes(id));
  await setQueue(next ? [...ids, ...q] : [...q, ...ids]);
}
export async function dequeue(id) { const q = await queue(); if (q.includes(id)) await setQueue(q.filter(x => x !== id)); }
export async function moveInQueue(id, to) { const q = (await queue()).filter(x => x !== id); q.splice(Math.max(0, to), 0, id); await setQueue(q); }
export const clearQueue = () => setQueue([]);
export async function queueEpisodes() { const ids = await queue(); return withShows((await db.pcEpisodes.bulkGet(ids)).filter(Boolean)); }

// Smart filters: built-in ones plus the user's own (pcPlaylists kind 'smart').
//   rules: { state: 'unplayed'|'inprogress'|'played'|'', downloaded, starred, showIds: [], days, minMin, maxMin, sort: 'new'|'old'|'short'|'long' }
export const BUILTIN_FILTERS = [
  { id: 'f-unplayed', name: 'Chưa nghe', icon: 'pc-inbox', rules: { state: 'unplayed', days: 60 } },
  { id: 'f-progress', name: 'Đang nghe dở', icon: 'pc-play', rules: { state: 'inprogress' } },
  { id: 'f-downloaded', name: 'Đã tải về', icon: 'download', rules: { downloaded: 1 } },
  { id: 'f-starred', name: 'Đã gắn sao', icon: 'pc-star', rules: { starred: 1 } },
  { id: 'f-short', name: 'Tập ngắn (< 20 phút)', icon: 'pc-speed', rules: { state: 'unplayed', maxMin: 20 } },
  { id: 'f-played', name: 'Đã nghe xong', icon: 'pc-check', rules: { state: 'played' } },
];
export async function playlists() { return (await db.pcPlaylists.toArray()).filter(p => !p.deleted && p.kind !== 'queue'); }
export async function savePlaylist(p) {
  const row = { createdAt: now(), episodeIds: [], kind: 'list', ...p, id: p.id || uid(), deleted: 0 };
  await db.pcPlaylists.put(row); changed({}); return row.id;
}
export async function deletePlaylist(id) { await db.pcPlaylists.update(id, { deleted: 1 }); changed({}); }
export async function addToPlaylist(pid, ids) {
  const p = await db.pcPlaylists.get(pid);
  await db.pcPlaylists.update(pid, { episodeIds: [...new Set([...(p.episodeIds || []), ...[].concat(ids)])] }); changed({});
}

export async function runFilter(rules = {}, { limit = 300 } = {}) {
  const subs = new Set((await shows({ subscribed: false })).map(s => s.itemId));
  let eps = (await db.pcEpisodes.toArray()).filter(e => !e.deleted && subs.has(e.showId));
  if (rules.showIds?.length) eps = eps.filter(e => rules.showIds.includes(e.showId));
  const prog = await progressOf(eps.map(e => e.id));
  const dl = new Set(await db.pcDownloads.toCollection().primaryKeys());
  const st = (e) => e.played || prog.get(e.id)?.state === 'finished' ? 'played' : (prog.get(e.id)?.position > 5 && prog.get(e.id)?.state !== 'reset') ? 'inprogress' : 'unplayed';
  if (rules.state) eps = eps.filter(e => st(e) === rules.state);
  if (rules.downloaded) eps = eps.filter(e => dl.has(e.id));
  if (rules.starred) eps = eps.filter(e => e.starred);
  if (rules.days) eps = eps.filter(e => (e.pubDate || 0) > Date.now() - rules.days * 864e5);
  if (rules.minMin) eps = eps.filter(e => (e.duration || 0) >= rules.minMin * 60);
  if (rules.maxMin) eps = eps.filter(e => e.duration && e.duration <= rules.maxMin * 60);
  const sorts = { new: (a, b) => (b.pubDate || 0) - (a.pubDate || 0), old: (a, b) => (a.pubDate || 0) - (b.pubDate || 0), short: (a, b) => (a.duration || 0) - (b.duration || 0), long: (a, b) => (b.duration || 0) - (a.duration || 0) };
  eps.sort(sorts[rules.sort] || sorts.new);
  return withShows(eps.slice(0, limit));
}

// ── Bookmarks ───────────────────────────────────────────────────
export async function addBookmark(e, at, note = '') {
  const id = uid();
  await db.pcBookmarks.put({ id, episodeId: e.id, showId: e.showId, at, note, createdAt: now(), deleted: 0 });
  changed({ episodeId: e.id }); return id;
}
export async function bookmarks(episodeId) {
  const list = episodeId ? await db.pcBookmarks.where('episodeId').equals(episodeId).toArray() : await db.pcBookmarks.toArray();
  return list.filter(b => !b.deleted).sort((a, b) => episodeId ? a.at - b.at : b.createdAt - a.createdAt);
}
export async function deleteBookmark(id) { await db.pcBookmarks.update(id, { deleted: 1 }); changed({}); }

// ── Search history and suggestions ──────────────────────────────
export async function rememberSearch(q) {
  q = q.trim(); if (!q) return;
  const id = 'q:' + q.toLowerCase();
  const old = await db.pcSearches.get(id);
  await db.pcSearches.put({ id, q, at: now(), count: (old?.count || 0) + 1 });
}
export async function searchHistory(limit = 12) { return (await db.pcSearches.orderBy('at').reverse().limit(limit).toArray()); }
export const clearSearchHistory = () => db.pcSearches.clear();
// Suggestions from what you listen to: categories and hosts of your subscriptions (weighted by listening),
// plus past searches matching what is typed.
export async function suggestions(prefix = '') {
  const p = prefix.trim().toLowerCase();
  const hist = (await db.pcSearches.toArray()).sort((a, b) => (b.count || 1) * 2 + b.at / 1e12 - ((a.count || 1) * 2 + a.at / 1e12)).map(h => h.q);
  const subs = await shows();
  const w = new Map();
  const plays = await db.progress.where('moduleId').equals(MOD).toArray();
  const eps = await db.pcEpisodes.bulkGet(plays.map(r => r.itemId));
  const byShow = new Map();
  eps.forEach(e => e && byShow.set(e.showId, (byShow.get(e.showId) || 0) + 1));
  for (const s of subs) {
    const k = 1 + (byShow.get(s.itemId) || 0);
    for (const c of s.categories || []) w.set(c, (w.get(c) || 0) + k);
    for (const pr of s.persons || []) if (pr.name) w.set(pr.name, (w.get(pr.name) || 0) + k / 2);
  }
  const topics = [...w.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const all = [...new Set([...hist, ...topics])];
  return (p ? all.filter(x => x.toLowerCase().includes(p) && x.toLowerCase() !== p) : all).slice(0, 10);
}

// ── Downloads (this device only) ────────────────────────────────
const blobKey = (id) => 'pc-dl:' + id;
export const isDownloaded = async (id) => !!(await db.pcDownloads.get(id));
export async function downloadedBlob(id) { return (await db.blobs.get(blobKey(id)))?.blob || null; }
export async function download(e, task) {
  if (await isDownloaded(e.id)) return;
  task?.update({ label: 'Tải tập podcast', detail: e.title, unit: 'bytes', total: e.size || 0 });
  const r = await http(e.url, { viaShell: nativeShell(), signal: task?.signal, onProgress: (d, t) => task?.update({ done: d, total: t }) });
  if (!r.ok) throw new Error(`Không tải được (lỗi ${r.status})`);
  const blob = await r.blob();
  await db.blobs.put({ id: blobKey(e.id), blob });
  await db.pcDownloads.put({ episodeId: e.id, showId: e.showId, at: now(), size: blob.size, mime: blob.type });
  changed({ episodeId: e.id });
}
export async function deleteDownload(id, { quiet = false } = {}) {
  if (id.startsWith('ep:') && (await db.pcEpisodes.get(id))?.showId === LOCAL_SHOW) return;   // imported files live only here
  await db.blobs.delete(blobKey(id)); await db.pcDownloads.delete(id);
  if (!quiet) changed({ episodeId: id });
}
export async function downloads() {
  const rows = await db.pcDownloads.toArray();
  const eps = await db.pcEpisodes.bulkGet(rows.map(r => r.episodeId));
  return withShows(eps.map((e, i) => e && { ...e, download: rows[i] }).filter(Boolean));
}

// Auto-download: new episodes of shows with auto-download on (or all, from Cài đặt), only on Wi-Fi / while charging
// when asked; keeps at most N per show and removes played ones.
export async function canAutoDownload() {
  const c = navigator.connection;
  if (get('autoDownloadWifi') && c?.type && !['wifi', 'ethernet', 'unknown'].includes(c.type)) return false;
  if (get('autoDownloadWifi') && c?.saveData) return false;
  if (get('autoDownloadCharging')) { try { const b = await navigator.getBattery?.(); if (b && !b.charging) return false; } catch { /* unknown → allow */ } }
  return navigator.onLine !== false;
}
export async function autoDownload(tasks) {
  if (!(await canAutoDownload())) return 0;
  const subs = (await shows()).filter(s => s.settings?.autoDownload ?? get('autoDownload'));
  let n = 0;
  for (const s of subs) {
    const keep = s.settings?.keep || get('keepDownloads') || 5;
    const eps = (await episodesOf(s.itemId)).filter(e => !e.played).slice(0, keep);
    for (const e of eps) {
      if (await isDownloaded(e.id)) continue;
      try { await tasks.run({ label: 'Tự tải tập mới', detail: e.title, unit: 'bytes', cancellable: true }, (t) => download(e, t)); n++; }
      catch (err) { if (err?.name === 'AbortError') return n; console.warn('[podcasts] auto-download', err); }
    }
  }
  return n;
}

// ── Local audio / audiobooks ────────────────────────────────────
export async function importFiles(files, task) {
  const audio = [...files].filter(f => /^audio\//.test(f.type) || /\.(mp3|m4a|m4b|aac|ogg|opus|wav|flac)$/i.test(f.name));
  if (!audio.length) return 0;
  if (!(await db.pcShows.get(LOCAL_SHOW))) {
    await saveFeed({ show: { title: 'Tệp âm thanh của tôi', author: 'Trên máy này', description: 'Podcast, sách nói và bản ghi âm bạn tự thêm.', categories: ['Tệp cá nhân'], persons: [] }, episodes: [] }, { feedUrl: 'local:' }, { subscribe: true });
  }
  task?.update({ total: audio.length, done: 0, unit: 'items' });
  for (const f of audio) {
    task?.check();
    task?.update({ detail: f.name });
    const guid = f.name + '|' + f.size;
    const id = episodeIdOf(LOCAL_SHOW, guid);
    const duration = await new Promise((res) => { const a = new Audio(); a.preload = 'metadata'; const u = URL.createObjectURL(f); a.src = u; a.onloadedmetadata = () => { res(Math.round(a.duration) || 0); URL.revokeObjectURL(u); }; a.onerror = () => { res(0); URL.revokeObjectURL(u); }; });
    await db.blobs.put({ id: blobKey(id), blob: f });
    await db.pcDownloads.put({ episodeId: id, showId: LOCAL_SHOW, at: now(), size: f.size, mime: f.type });
    await db.pcEpisodes.put({ id, showId: LOCAL_SHOW, guid, title: f.name.replace(/\.[^.]+$/, ''), description: '', url: '', mime: f.type, size: f.size, pubDate: f.lastModified || now(), duration, chapters: [], transcripts: [], persons: [], played: 0, inbox: 0, starred: 0, local: 1, audiobook: /\.m4b$/i.test(f.name), createdAt: now(), deleted: 0 });
    task?.step();
  }
  const count = (await episodesOf(LOCAL_SHOW)).length;
  await db.items.update(LOCAL_SHOW, { 'meta.episodes': count });
  changed({ showId: LOCAL_SHOW });
  return audio.length;
}

// ── Chapters and transcripts ────────────────────────────────────
export async function chapters(e) {
  if (e.chapters?.length) return e.chapters;
  if (!e.chaptersUrl) return [];
  try {
    const list = parseChapters(await fetchJson(e.chaptersUrl));
    if (list.length) await db.pcEpisodes.update(e.id, { chapters: list });
    return list;
  } catch (err) { console.warn('[podcasts] chapters', err); return []; }
}
export async function transcript(e) {
  const saved = await db.pcTranscripts.get(e.id);
  if (saved) return saved;
  const t = e.transcripts?.[0];
  if (!t) return null;
  const cues = parseTranscript(await fetchText(t.url), t.type);
  if (!cues.length) return null;
  const row = { episodeId: e.id, showId: e.showId, source: 'feed', lang: t.lang, cues, createdAt: now() };
  await db.pcTranscripts.put(row);
  return row;
}
export async function saveTranscript(e, cues, source = 'ai') {
  const row = { episodeId: e.id, showId: e.showId, source, cues, createdAt: now() };
  await db.pcTranscripts.put(row); changed({ episodeId: e.id }); return row;
}

// ── Stats ───────────────────────────────────────────────────────
export async function stats() {
  const rows = (await db.progress.where('moduleId').equals(MOD).toArray()).filter(r => !r.itemId.startsWith('podcasts:'));
  const listened = rows.reduce((a, r) => a + Math.min(r.position || 0, r.total || r.position || 0), 0);
  const saved = (await db.settings.get('podcasts.timeSaved'))?.value || 0;
  return { listened, finished: rows.filter(r => r.state === 'finished').length, started: rows.length, saved, shows: (await shows()).length };
}
