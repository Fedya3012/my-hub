// Where a track's lyrics come from, in priority order:
//   1. user-saved (edited / synced in the app)       source 'user'
//   2. sidecar file next to the song (.lrc/.ttml/.srt) source 'lrc' | 'ttml' | 'srt'
//   3. embedded tag (SYLT, then USLT / LYRICS / ©lyr)   source 'tag'
//   4. LRCLIB (https://lrclib.net), only with the online toggle on, cached in db.lyrics as 'lrclib'
// Rows 1–3 are written by the library scan / editor into db.lyrics; when several exist the scan
// keeps the first one it finds and the user's own text always wins. Online lookups never block
// offline playback: they are skipped when offline, time out after 8 s and misses are remembered.
// Row: { itemId, text, trText?, offset?, source, updatedAt }
import { db, getSetting, setSetting } from '../../../core/db.js';
import { prefs } from './prefs.js';
import { parseLyrics, toLrc, toModel, isLrc, lyricsKind } from './lyrics.js';
import { bus } from '../../../core/bus.js';

export const SOURCE_LABEL = { user: 'Bạn nhập', lrc: 'Tệp .lrc', ttml: 'Tệp .ttml', srt: 'Tệp .srt', tag: 'Thẻ trong tệp', lrclib: 'LRCLIB (trực tuyến)' };
const API = 'https://lrclib.net/api';
const MISS_TTL = 7 * 864e5;
const lyPrefs = () => prefs().lyrics || {};

export async function getLyricsRow(id) { return id ? db.lyrics.get(id) : null; }

// Save (merge) a lyrics row; empty text deletes it. Writes into the file's tags when a tag writer
// exists (lib/tagwriter.js exporting writeLyrics(track, text)); otherwise only db.lyrics.
export async function saveLyrics(track, patch) {
  const id = track.id || track.itemId;
  const old = await db.lyrics.get(id);
  if ('text' in patch && !patch.text?.trim()) { if (old) await db.lyrics.delete(id); bus.emit('music:lyrics', { id }); return null; }
  const { toTags, ...rest } = patch;
  const row = { ...(old || {}), ...rest, itemId: id };
  if (old) { const { itemId, ...mods } = row; await db.lyrics.update(id, mods); } else await db.lyrics.put(row);
  bus.emit('music:lyrics', { id });
  if (patch.text && toTags) {
    try {
      const tw = await import('./tagwriter.js');
      if (tw.writeLyrics) {
        // Tags hold LRC (USLT / LYRICS): TTML / SRT are converted, keeping word timing.
        let text = patch.text;
        if (!isLrc(text) && lyricsKind(text) !== 'plain') text = toLrc(toModel(parseLyrics(text)));
        const r = await tw.writeLyrics(track, text);
        if (r?.written) return 'tags';
      }
    } catch (e) { console.warn('[lyrics] tag write failed', e); }
  }
  return 'db';
}

async function misses() { return getSetting('music.lyricsMiss', {}); }
async function markMiss(id) {
  const m = await misses();
  const t = Date.now();
  for (const k of Object.keys(m)) if (t - m[k] > MISS_TTL) delete m[k];
  m[id] = t;
  await setSetting('music.lyricsMiss', m);
}

const canOnline = () => !!lyPrefs().online && (typeof navigator === 'undefined' || navigator.onLine !== false);

async function getJson(url) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}

const firstArtist = (t) => String(t.artist || '').split(/\s*(?:;|,|&|feat\.?|ft\.)\s*/i)[0];

// Exact match by title / artist / album / duration (LRCLIB allows ±2 s).
export async function fetchLrclib(t) {
  const q = new URLSearchParams({ track_name: t.title || '', artist_name: firstArtist(t), album_name: t.album || '' });
  if (t.duration) q.set('duration', Math.round(t.duration));
  let r = await getJson(`${API}/get?${q}`);
  if (!r) { q.delete('album_name'); r = await getJson(`${API}/get?${q}`); }
  return r;
}

// Free-text search for the manual picker: -> [{ id, trackName, artistName, albumName, duration, syncedLyrics, plainLyrics, instrumental }]
export async function searchLrclib(query, t = null) {
  const q = query ? new URLSearchParams({ q: query }) : new URLSearchParams({ track_name: t?.title || '', artist_name: firstArtist(t || {}) });
  const r = await getJson(`${API}/search?${q}`);
  const list = Array.isArray(r) ? r : [];
  if (t?.duration) list.sort((a, b) => Math.abs((a.duration || 0) - t.duration) - Math.abs((b.duration || 0) - t.duration) || (!!b.syncedLyrics - !!a.syncedLyrics));
  return list;
}

const rowFromLrclib = (r) => r && !r.instrumental && (r.syncedLyrics || r.plainLyrics) ? { text: r.syncedLyrics || r.plainLyrics, source: 'lrclib', lrclibId: r.id } : null;

// Lyrics for a track: the stored row, else (online toggle on) an LRCLIB lookup cached for next time.
// When the stored row is plain text and LRCLIB has a synced version, `preferSynced` upgrades it.
export async function loadLyrics(t, { allowOnline = true } = {}) {
  const row = await db.lyrics.get(t.id);
  const plainOnly = row && row.source !== 'user' && !/\[\d+:\d+|<tt[\s>]|-->/.test(row.text || '');
  if (row && !(plainOnly && lyPrefs().preferSynced)) return row;
  if (!allowOnline || !canOnline() || !t.title) return row || null;
  const m = await misses();
  if (m[t.id] && Date.now() - m[t.id] < MISS_TTL) return row || null;
  try {
    const got = rowFromLrclib(await fetchLrclib(t));
    if (!got || (row && !/\[\d+:\d+/.test(got.text))) { await markMiss(t.id); return row || null; }
    await saveLyrics(t, { ...got, offset: row?.offset || 0 });
    return db.lyrics.get(t.id);
  } catch { return row || null; }   // offline / timeout / CORS: keep what we have
}

export { rowFromLrclib };
