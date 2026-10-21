// Music data layer: import, the in-memory library index (tracks + albums + artists +
// play counts), playlists (normal and smart), links to books/fanfic/podcasts, history.
// Tables: see docs/MUSIC.md. Music items stay in `items` so the Library shows them.
import { db, uid, now, logActivity, softDeleteItem, getSetting, setSetting } from '../../../core/db.js';
import { storage } from '../../../core/storage/index.js';
import { bus } from '../../../core/bus.js';
import { thisDevice } from '../../../core/device.js';
import { readAudioMeta } from './meta.js';
import { makeThumb, palette, forgetUrl, collageRef } from './art.js';
import { isHiRes } from './format.js';
import { prefs } from './prefs.js';
import { cmpVi, cmpViNum } from '../../../core/perf.js';

// ── Ids & names ─────────────────────────────────────────────────
export const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
function hash36(s) {
  // FNV-1a 52-bit: stable across devices so the same album gets the same id everywhere.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (c * 31), 2246822519) >>> 0;
  }
  return (h1.toString(36) + (h2 & 0xfffff).toString(36));
}
export const UNKNOWN_ARTIST = 'Nghệ sĩ không rõ';
export const UNKNOWN_ALBUM = 'Album không rõ';
export const artistIdOf = (name) => 'ar-' + hash36(norm(name || UNKNOWN_ARTIST));
export const albumIdOf = (albumArtist, album) => 'al-' + hash36(norm(albumArtist || UNKNOWN_ARTIST) + '\u0001' + norm(album || UNKNOWN_ALBUM));

// "A feat. B; C" -> ['A', 'B', 'C']
export function splitArtists(s) {
  return String(s || '').split(/\s*(?:;|\s\/\s|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s)\s*/i).map(x => x.trim()).filter(Boolean);
}

// Max without spreading (a group can hold any number of tracks; spread overflows the stack).
const maxOf = (list, f) => { let m = 0; for (const x of list) { const v = f(x) || 0; if (v > m) m = v; } return m; };

// ── Library index (memory) ──────────────────────────────────────
let lib = null, building = null, gen = 0;

// A build that started before a change must not be cached (or handed out) afterwards.
export function invalidate() { gen++; lib = null; building = null; bus.emit('music:changed'); }

export async function library() {
  if (lib) return lib;
  if (building) return building;
  const g = gen;
  const job = building = (async () => {
    await adoptOrphans();
    const [tracks, items, albums, artists, plays, cols, artRows, contains] = await Promise.all([
      db.tracks.toArray(), db.items.where('type').anyOf('music', 'podcast').toArray(),
      db.albums.toArray(), db.artists.toArray(), db.plays.toArray(),
      db.collections.where('moduleId').equals('music').toArray(),
      db.files.where('role').anyOf('artwork', 'artwork-thumb').toArray(),
      db.links.where('relation').equals('contains').toArray(),
    ]);
    // Custom artwork chosen by the user: files with itemId '<kind>:<id>' (thumb preferred).
    const ART = new Map();
    for (const f of artRows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
      const cur = ART.get(f.itemId);
      if (!cur || f.role === 'artwork-thumb' || (cur.role !== 'artwork-thumb' && (f.createdAt || 0) >= (cur.createdAt || 0))) ART.set(f.itemId, f);
    }
    const custom = (kind, id) => ART.get(kind + ':' + id)?.id || null;
    const artMode = prefs().art || {};
    const itemMap = new Map(items.map(i => [i.id, i]));
    const counts = new Map();
    for (const p of plays) {
      if (p.skip) continue; // skips are kept for statistics, they are not listens
      const c = counts.get(p.itemId) || { n: 0, last: 0 };
      c.n++; c.last = Math.max(c.last, p.at);
      counts.set(p.itemId, c);
    }
    const rule = prefs().hiResRule;
    const T = new Map();
    for (const t of tracks) {
      const item = itemMap.get(t.itemId);
      if (!item || item.deleted || t.deleted) continue;
      const c = counts.get(t.itemId);
      T.set(t.itemId, {
        ...t, id: t.itemId, item, type: item.type,
        title: item.title, favorite: item.favorite || 0, rating: item.rating || 0,
        plays: c?.n || 0, lastPlayed: c?.last || 0, hiResNow: t.tech ? isHiRes(t.tech, rule) : false,
      });
    }
    const A = new Map(albums.filter(a => !a.deleted).map(a => [a.id, { ...a, tracks: [] }]));
    const R = new Map(artists.filter(a => !a.deleted).map(a => [a.id, { ...a, tracks: [], albums: new Set() }]));
    for (const t of T.values()) {
      const al = A.get(t.albumId);
      if (al) al.tracks.push(t);
      for (const id of new Set([...(t.artistIds || []), t.albumArtistId].filter(Boolean))) {
        const ar = R.get(id);
        if (!ar) continue;
        if (t.artistIds?.includes(id)) ar.tracks.push(t);
        if (al) ar.albums.add(al.id);
      }
    }
    for (const al of A.values()) {
      al.tracks.sort((a, b) => (a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 999) - (b.trackNo || 999) || cmpVi(a.title, b.title));
      al.duration = al.tracks.reduce((s, t) => s + (t.duration || 0), 0);
      al.hiRes = al.tracks.some(t => t.hiResNow);
      al.addedAt = maxOf(al.tracks, t => t.addedAt || 0);
      al.plays = al.tracks.reduce((s, t) => s + t.plays, 0);
      al.lastPlayed = maxOf(al.tracks, t => t.lastPlayed);
      al.formats = [...new Set(al.tracks.map(t => t.tech && t.tech.codecLabel).filter(Boolean))];
      al.cover = al.thumbFileId || al.coverFileId || al.tracks.find(t => t.coverFileId)?.coverFileId || custom('album', al.id);
    }
    for (const [id, al] of A) if (!al.tracks.length) A.delete(id);
    for (const al of A.values()) {
      al.kind = releaseKind(al);
      al.count = al.tracks.length;
      al.label = mostCommon(al.tracks.map(t => t.label));
    }
    for (const ar of R.values()) {
      ar.albums = [...ar.albums].map(id => A.get(id)).filter(Boolean);
      const covers = ar.albums.map(al => al.cover).filter(Boolean);
      ar.cover = custom('artist', ar.id) || ar.imageFileId || (artMode.artist === 'collage' ? collageRef(covers) : mostCommon(ar.tracks.map(t => A.get(t.albumId)?.cover)) || covers[0]) || null;
      // Their own releases (as album artist) split by kind, plus albums they only appear on.
      const own = ar.albums.filter(al => al.artistId === ar.id);
      ar.fullAlbums = own.filter(al => al.kind === 'album' || al.kind === 'compilation' || al.kind === 'live');
      ar.singles = own.filter(al => al.kind === 'single' || al.kind === 'ep');
      ar.appearsOn = ar.albums.filter(al => al.artistId !== ar.id);
      ar.duration = ar.tracks.reduce((s, t) => s + (t.duration || 0), 0);
      ar.plays = ar.tracks.reduce((s, t) => s + t.plays, 0);
      ar.addedAt = maxOf(ar.tracks, t => t.addedAt || 0);
      ar.title = ar.name;
      ar.count = ar.tracks.length;
      ar.albumCount = ar.albums.length;
    }
    for (const [id, ar] of R) if (!ar.tracks.length && !ar.albums.length) R.delete(id);
    // Album artists: whoever is credited on the album itself (compilations stay together).
    const AA = new Map();
    for (const al of A.values()) {
      const id = al.artistId || artistIdOf(al.artist);
      if (!AA.has(id)) AA.set(id, { id, name: R.get(id)?.name || al.artist || UNKNOWN_ARTIST, albums: [], tracks: [] });
      const x = AA.get(id); x.albums.push(al); x.tracks.push(...al.tracks);
    }
    for (const x of AA.values()) { finishGroup(x); x.cover = custom('albumartist', x.id) || custom('artist', x.id) || R.get(x.id)?.cover || x.cover; }
    // Years, record labels, composers: groups of tracks (and the albums they come from).
    const group = (key, nameOf) => {
      const M = new Map();
      for (const t of T.values()) for (const raw of key(t)) {
        const id = String(raw);
        if (!M.has(id)) M.set(id, { id, name: nameOf ? nameOf(raw) : String(raw), tracks: [], albums: new Set() });
        const g = M.get(id); g.tracks.push(t); if (A.get(t.albumId)) g.albums.add(A.get(t.albumId));
      }
      for (const g of M.values()) { g.albums = [...g.albums]; finishGroup(g); }
      return M;
    };
    const art = (M, kind) => { for (const g of M.values()) g.cover = custom(kind, g.id) || (artMode.groups === 'single' ? g.albums[0]?.cover : collageRef(g.albums.map(a => a.cover))) || g.cover || null; };
    const Y = group((t) => [t.year || A.get(t.albumId)?.year || 0], (y) => y ? String(y) : 'Không rõ năm');
    for (const y of Y.values()) { y.year = +y.id || 0; y.decade = y.year ? Math.floor(y.year / 10) * 10 : 0; }
    const LB = group((t) => { const l = t.label || A.get(t.albumId)?.label; return l ? [norm(l)] : []; });
    for (const g of LB.values()) g.name = g.tracks.find(t => t.label)?.label || g.name;
    const CP = group((t) => splitArtists(t.composer || '').map(norm).filter(Boolean));
    for (const g of CP.values()) g.name = splitArtists(g.tracks[0].composer).find(n => norm(n) === g.id) || g.name;
    const G = new Map();
    for (const t of T.values()) for (const g of (t.genres?.length ? t.genres : ['Chưa phân loại'])) {
      if (!G.has(g)) G.set(g, { id: g, name: g, tracks: [] });
      G.get(g).tracks.push(t);
    }
    for (const g of G.values()) { g.albums = [...new Set(g.tracks.map(t => A.get(t.albumId)).filter(Boolean))]; finishGroup(g); }
    art(Y, 'year'); art(LB, 'label'); art(CP, 'composer'); art(G, 'genre');
    const trackCover = (t) => t?.coverFileId || A.get(t?.albumId)?.cover || custom('folder', t?.folder || '') || null;
    // Playlists: own picture, else a 2×2 collage of their tracks' covers.
    const members = new Map();
    for (const l of contains.sort((a, b) => (a.order || 0) - (b.order || 0))) { if (!members.has(l.fromId)) members.set(l.fromId, []); members.get(l.fromId).push(l.toId); }
    const pls = cols.filter(c => !c.deleted && (c.kind === 'playlist' || c.kind === 'smart')).map(p => ({ ...p }));
    const coverFromTracks = (list) => collageRef(list.map(trackCover));
    for (const p of pls) {
      const list = p.kind === 'smart' ? stableSmart(p.rules, [...T.values()]) : (members.get(p.id) || []).map(id => T.get(id)).filter(Boolean);
      p.cover = custom('playlist', p.id) || coverFromTracks(list);
      p.count = list.length;
    }
    const smartCover = (s) => custom('playlist', s.id) || coverFromTracks(stableSmart(s.rules, [...T.values()]));
    // Folders: own picture, else collage of the album covers inside (recursively).
    // One pass over the tracks fills up to 4 covers for every folder and its ancestors (built on first use).
    let folderIdx = null;
    const folderCovers = new Map();
    const folderCover = (path) => {
      if (folderCovers.has(path)) return folderCovers.get(path);
      if (!folderIdx) {
        folderIdx = new Map();
        const add = (k, c) => { let a = folderIdx.get(k); if (!a) folderIdx.set(k, a = []); if (a.length < 4 && !a.includes(c)) a.push(c); };
        for (const t of T.values()) {
          const c = trackCover(t); if (!c) continue;
          const f = t.folder || ''; add('', c);
          if (!f) continue;
          let i = -1;
          while ((i = f.indexOf('/', i + 1)) !== -1) add(f.slice(0, i), c);
          add(f, c);
        }
      }
      const c = custom('folder', path) || collageRef(folderIdx.get(path) || []);
      folderCovers.set(path, c);
      return c;
    };
    // Virtual tracks (folder-first browsing): playable by id, but never listed in the library.
    Object.setPrototypeOf(T, VMap.prototype);
    const built = {
      tracks: T, albums: A, artists: R, genres: G, albumArtists: AA, years: Y, labels: LB, composers: CP,
      playlists: pls, smartCover, folderCover, custom,
      coverOf: (t) => t?.virtual ? t.cover || null : trackCover(t),
      fullCoverOf: (t) => t?.coverFileId || A.get(t?.albumId)?.coverFileId || null,
    };
    if (g === gen) lib = built;
    return built;
  })().finally(() => { if (building === job) building = null; });
  return job;
}

const stableSmart = (rules, all) => rules?.rules ? evalSmart({ ...rules, sort: rules.sort === 'random' ? 'title' : rules.sort }, all) : [];

// ── Virtual tracks (folder-first mode) ──────────────────────────
// Files browsed straight from a folder handle, never imported. They live in memory only:
// L.tracks.get(id) finds them (so the player can play them) but listing the library skips them.
const virtual = new Map();   // id -> track
class VMap extends Map {
  get(k) { return super.get(k) ?? virtual.get(k); }
  has(k) { return super.has(k) || virtual.has(k); }
}
export function registerVirtual(tracks) {
  for (const t of tracks) virtual.set(t.id, t);   // no cap: a queue may hold any number of browsed files
}
export const isVirtual = (id) => String(id || '').startsWith('vt:');
export const virtualTrack = (id) => virtual.get(id);

bus.on('sync:done', invalidate);
bus.on('item:changed', invalidate);

// Music items created outside this module (Library "Thêm tệp", samples) get a track row.
async function adoptOrphans() {
  const items = await db.items.where('type').anyOf('music', 'podcast').filter(i => !i.deleted).toArray();
  const have = new Set(await db.tracks.toCollection().primaryKeys());
  for (const item of items.filter(i => !have.has(i.id))) {
    const file = await db.files.where('itemId').equals(item.id).filter(f => f.role === 'main').first();
    if (!file) continue; // nothing to play yet; adopted once a file is attached
    let meta = null;
    if (file) { try { meta = await readAudioMeta(await storage.open(file), { name: file.name }); } catch { /* cloud file offline */ } }
    const [artist, album] = (item.subtitle || '').split(' · ');
    // Podcast subtitles read "Show · Episode": the show is both artist and album.
    const podcast = item.type === 'podcast';
    await saveTrack(item, meta, { artist, album: podcast ? artist : album?.replace(/ OST$/, ' (OST)'), file, sample: item.meta?.sample });
  }
}

// ── Release kinds (album / EP / single) ────────────────────────
// From the MusicBrainz "release type" tag when present, else from the title ("… - Single",
// "(EP)") and finally from size: up to 3 tracks under 20 min is a single, up to 7 under 32 min an EP.
export const KIND_LABEL = { album: 'Album', ep: 'EP', single: 'Single', compilation: 'Tuyển tập', live: 'Live' };
function releaseKind(al) {
  const tagged = mostCommon(al.tracks.map(t => t.releaseType));
  if (tagged && KIND_LABEL[tagged]) return tagged;
  if (/[-–(\[]\s*single\s*[)\]]?$/i.test(al.title)) return 'single';
  if (/(^|[\s(\[-])ep\s*[)\]]?$/i.test(al.title)) return 'ep';
  if (/various artists|nhiều nghệ sĩ/i.test(al.artist || '')) return 'compilation';
  const n = al.tracks.length, d = al.duration || 0;
  if (n <= 3 && d < 20 * 60) return 'single';
  if (n <= 7 && d < 32 * 60) return 'ep';
  return 'album';
}
function mostCommon(arr) {
  const m = new Map();
  for (const v of arr) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
function finishGroup(g) {
  g.title = g.name;
  g.albums.sort((a, b) => (b.year || 0) - (a.year || 0) || cmpVi(a.title, b.title));
  g.cover = g.albums[0]?.cover;
  g.duration = g.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  g.plays = g.tracks.reduce((s, t) => s + t.plays, 0);
  g.addedAt = maxOf(g.tracks, t => t.addedAt || 0);
  g.count = g.tracks.length;
  g.albumCount = g.albums.length;
}

// ── Import ──────────────────────────────────────────────────────
const AUDIO_EXT = /\.(mp3|flac|m4a|m4b|mp4|aac|alac|ogg|oga|opus|wav|wave|aif|aiff|aifc|wv|ape|dsf|dff|wma)$/i;
const FOLDER_VIDEO = /^(canvas|background|bg|video|loop)\.(mp4|m4v|webm|mov)$/i;
const IMG_NAMES = /^(cover|folder|front|album|albumart)\.(jpe?g|png|webp)$/i;
const dirOf = (f) => (f.webkitRelativePath || f.relPath || '').split('/').slice(0, -1).join('/');
const base = (n) => n.replace(/\.[^.]+$/, '');

// files: File[] (from <input multiple> or a folder picker), or [{ handle, relPath }] to link without copying.
export async function importFiles(files, { onProgress, sample = false, kind = 'music', signal, remote = null } = {}) {
  const list = [];
  for (const f of files) {
    const file = f.handle ? Object.assign(await f.handle.getFile(), { relPath: f.relPath }) : f;
    list.push({ file, handle: f.handle || null });
  }
  // Videos to play behind the lyrics: "<song name>.mp4" next to the song, or canvas/background.mp4 for the whole folder.
  const key = (f) => dirOf(f) + '/' + base(f.name).toLowerCase();
  const audioKeys = new Set(list.filter(x => AUDIO_EXT.test(x.file.name) && !isVideoFile(x.file)).map(x => key(x.file)));
  const vids = list.filter(x => isVideoFile(x.file) && (FOLDER_VIDEO.test(x.file.name) || audioKeys.has(key(x.file))));
  const trackVids = new Map(vids.filter(x => !FOLDER_VIDEO.test(x.file.name)).map(x => [key(x.file), x.file]));
  const folderVids = new Map(vids.filter(x => FOLDER_VIDEO.test(x.file.name)).map(x => [dirOf(x.file), x.file]));
  const companion = new Set(vids.map(x => x.file));
  const audio = list.filter(x => !companion.has(x.file) && (AUDIO_EXT.test(x.file.name) || x.file.type.startsWith('audio/')));
  // Sidecar lyrics: .lrc preferred over .ttml over .srt (lyrics.js detects the format from the text).
  const LYR_RANK = { lrc: 3, ttml: 2, srt: 1 };
  const lrc = new Map();
  for (const x of list) {
    const ext = (/\.(lrc|ttml|srt)$/i.exec(x.file.name) || [])[1]?.toLowerCase();
    if (!ext) continue;
    const k = dirOf(x.file) + '/' + base(x.file.name).toLowerCase(), cur = lrc.get(k);
    if (!cur || LYR_RANK[ext] > cur.rank) lrc.set(k, { file: x.file, rank: LYR_RANK[ext] });
  }
  for (const [k, v] of lrc) lrc.set(k, v.file);
  const imgs = new Map(list.filter(x => IMG_NAMES.test(x.file.name)).map(x => [dirOf(x.file), x.file]));
  const existing = new Set((await db.tracks.toArray()).filter(t => !t.deleted).map(t => t.fileName + '|' + t.size));
  const res = { added: 0, skipped: 0, failed: [] };
  for (let i = 0; i < audio.length; i++) {
    if (signal?.aborted) { res.cancelled = true; break; }
    const { file, handle } = audio[i];
    onProgress?.(i, audio.length, file.name);
    if (existing.has(file.name + '|' + file.size)) { res.skipped++; continue; }
    try {
      const meta = await readAudioMeta(file, { name: file.name });
      const t = meta.tags || {};
      const item = {
        id: uid(), type: kind, moduleId: 'music', title: t.title || base(file.name).replace(/^\d+[\s.-]+/, '').replace(/_/g, ' '),
        subtitle: '', tags: [], status: 'new', favorite: 0, deleted: 0, rating: 0, createdAt: now(),
        meta: { originalName: file.name, ...(sample ? { sample: true } : {}) },
      };
      await db.items.add(item);
      const fileRow = await storage.addFile(item.id, handle ? { handle } : file, { role: 'main', name: file.name, ...(remote ? { remote: { key: remote(file) } } : {}) });
      const lrcFile = lrc.get(dirOf(file) + '/' + base(file.name).toLowerCase());
      const folderImg = imgs.get(dirOf(file));
      const track = await saveTrack(item, meta, { file: fileRow, folder: dirOf(file), lrcText: lrcFile ? await lrcFile.text() : null, folderImg, sample });
      const tv = trackVids.get(key(file)), fv = folderVids.get(dirOf(file));
      if (tv) await setBgVideo('track', item.id, tv);
      else if (fv && !(await db.albums.get(track.albumId))?.bgVideoFileId) await setBgVideo('album', track.albumId, fv);
      await logActivity(item.id, 'music', 'import');
      existing.add(file.name + '|' + file.size);
      res.added++;
    } catch (e) { console.error(e); res.failed.push(`${file.name}: ${e.message}`); }
  }
  onProgress?.(audio.length, audio.length, '');
  invalidate();
  return res;
}

// Create/refresh the track, album and artist rows for an item.
async function saveTrack(item, meta, { file, folder = '', lrcText, folderImg, artist, album, sample } = {}) {
  const tg = meta?.tags || {};
  const artistName = tg.artist || artist || UNKNOWN_ARTIST;
  const artists = splitArtists(artistName);
  const albumArtist = tg.albumArtist || artists[0] || UNKNOWN_ARTIST;
  const albumTitle = tg.album || album || UNKNOWN_ALBUM;
  const albumId = albumIdOf(albumArtist, albumTitle);
  const S = sample ? { sample: 1 } : {};
  const tech = meta && meta.codec !== 'unknown' ? {
    container: meta.container, codec: meta.codec, codecLabel: meta.codecLabel, lossless: !!meta.lossless, floatPCM: !!meta.floatPCM,
    bitDepth: meta.bitDepth, sampleRate: meta.sampleRate, dsdRate: meta.dsdRate, channels: meta.channels,
    bitrate: meta.bitrate, vbr: meta.vbr, encoder: meta.encoder, size: file?.size, mime: file?.mime,
  } : null;
  // Artists + album rows (created once; ids are deterministic).
  for (const name of new Set([...artists, albumArtist])) {
    const id = artistIdOf(name);
    if (!(await db.artists.get(id))) await db.artists.put({ id, name, sortName: name.replace(/^(the|a)\s+/i, ''), createdAt: now(), deleted: 0, ...S });
  }
  let al = await db.albums.get(albumId);
  if (!al || al.deleted) {
    al = { id: albumId, title: albumTitle, artist: albumArtist, artistId: artistIdOf(albumArtist), year: +(tg.year || 0) || null,
      genres: tg.genre || [], createdAt: now(), deleted: 0, rg: null, ...S };
    await db.albums.put(al);
  }
  const rg = meta?.replayGain;
  if (rg?.albumGain != null && !al.rg) await db.albums.update(albumId, { rg: { gain: rg.albumGain, peak: rg.albumPeak } });
  // Cover: embedded picture, else folder.jpg, stored once per album (+ a thumbnail + colours).
  const pic = meta?.picture ? new Blob([meta.picture.data], { type: meta.picture.mime || 'image/jpeg' }) : folderImg || null;
  let coverFileId = null;
  if (pic && !al.coverFileId) await setAlbumCover(albumId, pic);
  else if (pic && al.coverFileId && meta?.picture && al.coverSize && Math.abs(al.coverSize - pic.size) > 2048) {
    // Track has its own, different artwork (singles, compilations).
    coverFileId = (await storage.addFile(item.id, pic, { role: 'cover', name: 'cover.jpg' })).id;
  }
  const track = {
    itemId: item.id, albumId, artistId: artistIdOf(artists[0] || albumArtist), artistIds: artists.map(artistIdOf),
    albumArtistId: artistIdOf(albumArtist), artist: artistName, album: albumTitle, albumArtist,
    trackNo: +tg.trackNo || null, trackTotal: +tg.trackTotal || null, discNo: +tg.discNo || null, discTotal: +tg.discTotal || null,
    year: +(tg.year || String(tg.date || '').slice(0, 4)) || al.year || null, genres: tg.genre || [], composer: tg.composer || null,
    comment: tg.comment || null, bpm: +tg.bpm || null, isrc: tg.isrc || null, label: tg.label || null, releaseType: tg.releaseType || null,
    duration: meta?.duration || item.meta?.duration || null,
    tech, codec: tech?.codec || '', lossless: tech?.lossless ? 1 : 0, hiRes: isHiRes(tech) ? 1 : 0,
    rg: rg && (rg.trackGain != null || rg.albumGain != null) ? { ...rg, source: 'tag' } : null,
    folder, fileName: file?.name || null, size: file?.size || null, fileId: file?.id || null, coverFileId,
    addedAt: item.createdAt || now(), deleted: 0, warnings: meta?.warnings?.length ? meta.warnings : undefined, ...S,
  };
  await db.tracks.put(track);
  await db.items.update(item.id, {
    subtitle: [artistName, albumTitle !== UNKNOWN_ALBUM ? albumTitle : ''].filter(Boolean).join(' · '),
    tags: [...new Set([...(item.tags || []), ...track.genres.map(g => g.toLowerCase())])],
    meta: { ...(item.meta || {}), duration: track.duration, format: tech ? tech.codecLabel : null, hiRes: track.hiRes },
  });
  const text = lrcText || meta?.lyrics?.text;
  if (text && !(await db.lyrics.get(item.id))) await db.lyrics.put({ itemId: item.id, text, source: lrcText ? 'lrc' : 'tag', ...S });
  return track;
}

export async function setAlbumCover(albumId, blob) {
  const al = await db.albums.get(albumId);
  for (const id of [al?.coverFileId, al?.thumbFileId]) if (id) { const f = await db.files.get(id); if (f) await storage.removeFile(f, { everywhere: true }).catch(() => {}); forgetUrl(id); }
  const cover = await storage.addFile(albumId, blob, { role: 'cover', name: 'cover' + (blob.type === 'image/png' ? '.png' : '.jpg') });
  let thumbId = null, colors = null;
  try { const th = await makeThumb(blob); if (th) thumbId = (await storage.addFile(albumId, th, { role: 'thumb', name: 'thumb.webp' })).id; } catch { /* decode failed */ }
  try { colors = await palette(blob); } catch { /* ignore */ }
  await db.albums.update(albumId, { coverFileId: cover.id, thumbFileId: thumbId, coverSize: blob.size, colors });
  invalidate();
}

// ── Editing ─────────────────────────────────────────────────────
// patch: { title, artist, album, albumArtist, trackNo, discNo, year, genres, composer, comment }
export async function editTracks(ids, patch) {
  patch = { ...patch };
  const lyricsText = 'lyrics' in patch ? patch.lyrics : undefined;
  delete patch.lyrics;
  for (const id of ids) {
    if (lyricsText !== undefined) await setLyrics(id, lyricsText);
    const t = await db.tracks.get(id), item = await db.items.get(id);
    if (!t || !item) continue;
    const n = { ...t, ...patch };
    const artists = splitArtists(n.artist || UNKNOWN_ARTIST);
    const albumArtist = n.albumArtist || artists[0];
    for (const name of new Set([...artists, albumArtist])) {
      const aid = artistIdOf(name);
      if (!(await db.artists.get(aid))) await db.artists.put({ id: aid, name, sortName: name, createdAt: now(), deleted: 0 });
    }
    n.artistIds = artists.map(artistIdOf); n.artistId = n.artistIds[0]; n.albumArtistId = artistIdOf(albumArtist); n.albumArtist = albumArtist;
    const newAlbum = albumIdOf(albumArtist, n.album);
    if (newAlbum !== t.albumId) {
      const old = await db.albums.get(t.albumId);
      if (!(await db.albums.get(newAlbum))) {
        await db.albums.put({ id: newAlbum, title: n.album, artist: albumArtist, artistId: n.albumArtistId, year: n.year, genres: n.genres || [],
          coverFileId: old?.coverFileId || null, thumbFileId: old?.thumbFileId || null, colors: old?.colors || null, createdAt: now(), deleted: 0 });
      }
      n.albumId = newAlbum;
    }
    n.edited = { ...(t.edited || {}), ...Object.fromEntries(Object.keys(patch).map(k => [k, 1])) };
    delete n.id;
    await db.tracks.put(n);
    await db.items.update(id, { title: n.title ?? item.title, subtitle: [n.artist, n.album].filter(Boolean).join(' · ') });
  }
  invalidate();
}

export async function setFavorite(id, on) { await db.items.update(id, { favorite: on ? 1 : 0 }); invalidate(); }
export async function setRating(id, r) { await db.items.update(id, { rating: r }); invalidate(); }

export async function deleteTracks(ids, { removeFiles = true } = {}) {
  for (const id of ids) {
    if (removeFiles) for (const f of await db.files.where('itemId').equals(id).toArray()) await storage.removeFile(f, { everywhere: false }).catch(() => {});
    await db.tracks.update(id, { deleted: 1 });
    await softDeleteItem(id);
  }
  invalidate();
}

// ── Lyrics ──────────────────────────────────────────────────────
export const getLyrics = (id) => db.lyrics.get(id);
export async function setLyrics(id, text) {
  if (text?.trim()) await db.lyrics.put({ itemId: id, text, source: 'user' }); else await db.lyrics.delete(id);
}

// ── Background video behind the lyrics (Noctis style) ───────────
// A looping, muted clip per track, per album, or one default for everything.
// Track wins over album, album over the default. Track/album videos sync like any file;
// the default is a per-device choice (settings 'music.bgVideoDefault').
export const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv)$/i;
export const isVideoFile = (f) => f && (f.type?.startsWith('video/') || VIDEO_EXT.test(f.name || ''));

export async function bgVideoFor(t) {
  if (!t) return null;
  const L = await library();
  t = L.tracks.get(t.id) || t; // the player may hold an older copy
  const al = L.albums.get(t.albumId);
  return t.bgVideoFileId || al?.bgVideoFileId || (await getSetting('music.bgVideoDefault', null));
}

export async function bgVideoScopeOf(t) {
  const L = await library();
  t = L.tracks.get(t?.id) || t;
  if (t?.bgVideoFileId) return 'track';
  if (L.albums.get(t?.albumId)?.bgVideoFileId) return 'album';
  return (await getSetting('music.bgVideoDefault', null)) ? 'default' : null;
}

async function dropFile(fileId) {
  if (!fileId) return;
  const f = await db.files.get(fileId);
  if (f) await storage.removeFile(f, { everywhere: true }).catch(() => {});
  forgetUrl(fileId);
}

// scope: 'track' (id = track itemId) | 'album' (id = albumId) | 'default'
export async function setBgVideo(scope, id, file) {
  if (!isVideoFile(file)) throw new Error('Tệp này không phải video (MP4, WebM, MOV).');
  const owner = scope === 'default' ? 'music:bgvideo' : id;
  const old = scope === 'track' ? (await db.tracks.get(id))?.bgVideoFileId
    : scope === 'album' ? (await db.albums.get(id))?.bgVideoFileId
    : await getSetting('music.bgVideoDefault', null);
  const row = await storage.addFile(owner, file, { role: 'bgvideo', name: file.name });
  if (scope === 'track') await db.tracks.update(id, { bgVideoFileId: row.id });
  else if (scope === 'album') await db.albums.update(id, { bgVideoFileId: row.id });
  else await setSetting('music.bgVideoDefault', row.id);
  await dropFile(old);
  invalidate();
  return row.id;
}

export async function clearBgVideo(scope, id) {
  let old;
  if (scope === 'track') { old = (await db.tracks.get(id))?.bgVideoFileId; await db.tracks.update(id, { bgVideoFileId: null }); }
  else if (scope === 'album') { old = (await db.albums.get(id))?.bgVideoFileId; await db.albums.update(id, { bgVideoFileId: null }); }
  else { old = await getSetting('music.bgVideoDefault', null); await setSetting('music.bgVideoDefault', null); }
  await dropFile(old);
  invalidate();
}

// ── Playlists ───────────────────────────────────────────────────
export async function createPlaylist(name, ids = [], { kind = 'playlist', rules = null, description = '' } = {}) {
  const pl = { id: uid(), kind, moduleId: 'music', name, description, rules, createdAt: now(), deleted: 0 };
  await db.collections.put(pl);
  if (ids.length) await addToPlaylist(pl.id, ids);
  invalidate();
  return pl;
}
export async function updatePlaylist(id, patch) { await db.collections.update(id, patch); invalidate(); }
export async function deletePlaylist(id) {
  await db.collections.update(id, { deleted: 1 });
  await db.links.where('fromId').equals(id).delete();
  await db.links.where('toId').equals(id).delete();
  invalidate();
}
export async function playlistLinks(id) {
  return (await db.links.where('[fromId+relation]').equals([id, 'contains']).toArray()).sort((a, b) => (a.order || 0) - (b.order || 0));
}
export async function addToPlaylist(id, ids) {
  const cur = await playlistLinks(id);
  let order = (cur.at(-1)?.order || 0);
  await db.links.bulkPut(ids.map(toId => ({ id: uid(), fromId: id, toId, relation: 'contains', order: ++order, createdAt: now() })));
  invalidate();
}
export async function removeFromPlaylist(linkIds) { await db.links.bulkDelete(linkIds); invalidate(); }
export async function reorderPlaylist(id, linkIds) {
  await db.transaction('rw', db.links, async () => { for (let i = 0; i < linkIds.length; i++) await db.links.update(linkIds[i], { order: i + 1 }); });
  invalidate();
}

// Tracks of any playlist (smart ones are evaluated now).
export async function playlistTracks(pl) {
  const L = await library();
  if (pl.kind === 'smart') return evalSmart(pl.rules, [...L.tracks.values()]);
  return (await playlistLinks(pl.id)).map(l => ({ ...L.tracks.get(l.toId), linkId: l.id })).filter(t => t.id);
}

// ── Smart playlists ─────────────────────────────────────────────
export const SMART_FIELDS = {
  title: ['Tên bài', 'text'], artist: ['Nghệ sĩ', 'text'], album: ['Album', 'text'], genre: ['Thể loại', 'text'],
  year: ['Năm', 'num'], codec: ['Định dạng', 'codec'], bitDepth: ['Bit depth', 'num'], sampleRate: ['Sample rate (Hz)', 'num'],
  hiRes: ['Hi-Res', 'bool'], lossless: ['Lossless', 'bool'], favorite: ['Yêu thích', 'bool'], rating: ['Đánh giá (sao)', 'num'],
  plays: ['Số lần nghe', 'num'], lastPlayed: ['Nghe lần cuối (ngày trước)', 'days'], addedAt: ['Thêm vào (ngày trước)', 'days'],
  duration: ['Thời lượng (giây)', 'num'], folder: ['Thư mục', 'text'],
};
export const SMART_OPS = {
  text: { contains: 'chứa', is: 'là', not: 'không chứa' },
  num: { gte: '≥', lte: '≤', eq: '=' },
  codec: { is: 'là', not: 'không là' },
  bool: { is: 'là' },
  days: { within: 'trong vòng', older: 'hơn' },
};
export const SMART_SORTS = { random: 'Ngẫu nhiên', plays: 'Nghe nhiều nhất', lastPlayed: 'Nghe gần đây', addedAt: 'Mới thêm', title: 'Tên', rating: 'Đánh giá', year: 'Năm' };

function fieldVal(t, f) {
  switch (f) {
    case 'genre': return (t.genres || []).join(', ');
    case 'codec': return t.tech?.codec || '';
    case 'bitDepth': return t.tech?.bitDepth || 0;
    case 'sampleRate': return t.tech?.sampleRate || 0;
    case 'hiRes': return t.hiResNow ? 1 : 0;
    default: return t[f];
  }
}
export function evalSmart(rules, tracks) {
  if (!rules) return [];
  const test = (t, r) => {
    const v = fieldVal(t, r.field), type = SMART_FIELDS[r.field]?.[1];
    const x = r.value;
    if (type === 'text' || type === 'codec') {
      const a = norm(v), b = norm(x);
      return r.op === 'is' ? a === b : r.op === 'not' ? !a.includes(b) : a.includes(b);
    }
    if (type === 'bool') return !!v === (x === true || x === 1 || x === '1' || x === 'true');
    if (type === 'days') {
      if (!v) return r.op === 'older';
      const days = (Date.now() - v) / 864e5;
      return r.op === 'within' ? days <= +x : days > +x;
    }
    const n = +v || 0;
    return r.op === 'gte' ? n >= +x : r.op === 'lte' ? n <= +x : n === +x;
  };
  let out = tracks.filter(t => (rules.match === 'any' ? rules.rules.some(r => test(t, r)) : rules.rules.every(r => test(t, r))));
  const s = rules.sort || 'random';
  if (s === 'random') out = shuffle(out);
  else if (s === 'title') out.sort((a, b) => cmpVi(a.title, b.title));
  else out.sort((a, b) => (b[s] || 0) - (a[s] || 0));
  return rules.limit ? out.slice(0, +rules.limit) : out;
}

export const BUILTIN_SMART = [
  { id: 'smart:fav', name: 'Yêu thích', icon: 'heart', rules: { match: 'all', rules: [{ field: 'favorite', op: 'is', value: 1 }], sort: 'title' } },
  { id: 'smart:hires', name: 'Hi-Res', icon: 'hires', rules: { match: 'all', rules: [{ field: 'hiRes', op: 'is', value: 1 }], sort: 'title' } },
  { id: 'smart:top', name: 'Nghe nhiều nhất', icon: 'bolt', rules: { match: 'all', rules: [{ field: 'plays', op: 'gte', value: 1 }], sort: 'plays', limit: 50 } },
  { id: 'smart:new', name: 'Mới thêm', icon: 'sparkle', rules: { match: 'all', rules: [{ field: 'addedAt', op: 'within', value: 30 }], sort: 'addedAt', limit: 100 } },
  { id: 'smart:forgotten', name: 'Lâu chưa nghe', icon: 'clock', rules: { match: 'all', rules: [{ field: 'lastPlayed', op: 'older', value: 60 }], sort: 'random', limit: 50 } },
];

export function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── Links to books / fanfic / podcasts / videos ─────────────────
// A link row: { fromId: <track item | album | playlist>, toId: <item>, relation: 'soundtrack-of',
//               source: 'track'|'album'|'playlist', autoplay: 1, shuffle: 0 }
export async function linkMusic(sourceId, source, targetId, { autoplay = 1, shuffle: shuf = 0 } = {}) {
  const dup = (await db.links.where('[toId+relation]').equals([targetId, 'soundtrack-of']).toArray()).find(l => l.fromId === sourceId);
  if (dup) { await db.links.update(dup.id, { autoplay, shuffle: shuf }); return dup.id; }
  const id = uid();
  await db.links.put({ id, fromId: sourceId, toId: targetId, relation: 'soundtrack-of', source, autoplay, shuffle: shuf, createdAt: now() });
  invalidate();
  return id;
}
export async function unlinkMusic(linkId) { await db.links.delete(linkId); invalidate(); }

// Music attached to an item, resolved for display: [{ link, kind, name, cover, tracks() }]
export async function musicFor(itemId) {
  const L = await library();
  const links = await db.links.where('[toId+relation]').equals([itemId, 'soundtrack-of']).toArray();
  const out = [];
  for (const link of links) {
    if (L.tracks.has(link.fromId)) {
      const t = L.tracks.get(link.fromId);
      out.push({ link, kind: 'track', name: t.title, sub: t.artist, cover: L.coverOf(t), tracks: async () => [t] });
    } else if (L.albums.has(link.fromId)) {
      const a = L.albums.get(link.fromId);
      out.push({ link, kind: 'album', name: a.title, sub: a.artist, cover: a.cover, tracks: async () => a.tracks });
    } else {
      const pl = L.playlists.find(p => p.id === link.fromId);
      if (pl) out.push({ link, kind: 'playlist', name: pl.name, sub: 'Danh sách phát', cover: null, pl, tracks: () => playlistTracks(pl) });
    }
  }
  return out;
}

// Items a music source is linked to (shown on album / playlist pages).
export async function targetsOf(sourceId) {
  const links = await db.links.where('[fromId+relation]').equals([sourceId, 'soundtrack-of']).toArray();
  const items = await db.items.bulkGet(links.map(l => l.toId));
  return links.map((l, i) => ({ link: l, item: items[i] })).filter(x => x.item && !x.item.deleted);
}

// ── History ─────────────────────────────────────────────────────
export async function logPlay(track, { ms, completed, source }) {
  const dev = await thisDevice();
  markLogged(track.id);
  await db.plays.put({ id: uid(), itemId: track.id, at: now(), ms: Math.round(ms), completed: completed ? 1 : 0, source: source || null, deviceId: dev.id, ...(track.sample ? { sample: 1 } : {}),
    ...(track.virtual ? { title: track.title, artist: track.artist, virtual: 1 } : {}) });
  await logActivity(track.id, 'music', 'play');
  if (lib?.tracks.has(track.id)) { const t = lib.tracks.get(track.id); t.plays++; t.lastPlayed = now(); }
}

export async function recentPlays(limit = 30) {
  const L = await library();
  const rows = await db.plays.orderBy('at').reverse().limit(400).toArray();
  const seen = new Set(), out = [];
  for (const r of rows) {
    if (r.skip) continue; if (seen.has(r.itemId) || !L.tracks.has(r.itemId)) continue; seen.add(r.itemId); out.push(L.tracks.get(r.itemId)); if (out.length >= limit) break; }
  return out;
}

// Main audio file row of a track.
// Virtual tracks hand out a temporary URL of the file behind their folder handle.
const vUrls = new Map();
export async function mainFile(id) {
  if (isVirtual(id)) {
    const t = virtual.get(id);
    if (!t) return null;
    if (!vUrls.has(id)) {
      const f = t.file || await t.handle.getFile();
      vUrls.set(id, URL.createObjectURL(f));
      if (vUrls.size > 8) { const [k, u] = vUrls.entries().next().value; URL.revokeObjectURL(u); vUrls.delete(k); }
    }
    return { id: 'vf:' + id.slice(3), itemId: id, role: 'main', name: t.fileName, size: t.size, mime: t.tech?.mime || '', locations: { local: { kind: 'url', ref: vUrls.get(id) } } };
  }
  return db.files.where('itemId').equals(id).filter(f => f.role === 'main').first();
}

// ── Artwork for anything (artist, playlist, genre, year, label, composer, folder…) ──
// Stored as ordinary files (synced like covers): itemId '<kind>:<id>', role 'artwork' (≤ 1200 px)
// + 'artwork-thumb' (360 px). Albums use their own cover fields, tracks their coverFileId.
export const ART_KINDS = { album: 'album', track: 'bài hát', artist: 'nghệ sĩ', albumartist: 'nghệ sĩ album', playlist: 'danh sách phát', genre: 'thể loại', year: 'năm', label: 'hãng đĩa', composer: 'nhạc sĩ', folder: 'thư mục' };
export async function setArtwork(kind, id, blob) {
  if (kind === 'album') return setAlbumCover(id, blob);
  if (kind === 'track') {
    const t = await db.tracks.get(id);
    if (t?.coverFileId) await dropFile(t.coverFileId);
    const row = await storage.addFile(id, blob, { role: 'cover', name: 'cover' + (blob.type === 'image/png' ? '.png' : '.jpg'), quiet: true });
    await db.tracks.update(id, { coverFileId: row.id });
    invalidate();
    return;
  }
  await clearArtwork(kind, id, { silent: true });
  const key = kind + ':' + id;
  let full = blob;
  try { const b = await makeThumb(blob, 1200); if (b && b.size < blob.size) full = b; } catch { /* keep original */ }
  await storage.addFile(key, full, { role: 'artwork', name: 'artwork' + (full.type === 'image/png' ? '.png' : full.type === 'image/webp' ? '.webp' : '.jpg'), quiet: true });
  try { const th = await makeThumb(blob); if (th) await storage.addFile(key, th, { role: 'artwork-thumb', name: 'artwork-thumb.webp', quiet: true }); } catch { /* decode failed */ }
  invalidate();
}
export async function clearArtwork(kind, id, { silent = false } = {}) {
  if (kind === 'track') { const t = await db.tracks.get(id); if (t?.coverFileId) { await dropFile(t.coverFileId); await db.tracks.update(id, { coverFileId: null }); } }
  else if (kind === 'album') {
    const al = await db.albums.get(id);
    for (const f of [al?.coverFileId, al?.thumbFileId]) await dropFile(f);
    await db.albums.update(id, { coverFileId: null, thumbFileId: null, colors: null, coverSize: null });
  } else for (const f of await db.files.where('itemId').equals(kind + ':' + id).toArray()) await dropFile(f.id);
  if (!silent) invalidate();
}
export async function hasCustomArtwork(kind, id) {
  if (kind === 'track') return !!(await db.tracks.get(id))?.coverFileId;
  if (kind === 'album') return !!(await db.albums.get(id))?.coverFileId;
  return (await db.files.where('itemId').equals(kind + ':' + id).count()) > 0;
}

// ── Listening log for statistics: skips + time heard ────────────
// player.js records a play (logPlay) once half the track / 4 min was heard. Everything shorter
// that was started and then left is recorded here as a skip row ({ skip: 1, ms }), which
// library() ignores for play counts but the statistics page uses (skips, listening time).
let attached = false;
export function attachListenLog(player) {
  if (attached || !player?.addEventListener) return;
  attached = true;
  let cur = null; // { id, heard, logged, track }
  const flush = async () => {
    const c = cur; cur = null;
    if (!c || c.logged || c.heard < 1) return;
    const t = c.track;
    const need = Math.max(20, Math.min(240, (t.duration || 0) * 0.5));
    if (c.heard >= need) return; // counted as a play by the player
    try {
      const dev = await thisDevice();
      await db.plays.put({ id: uid(), itemId: t.id, at: now(), ms: Math.round(c.heard * 1000), completed: 0, skip: 1, deviceId: dev.id,
        ...(t.virtual ? { title: t.title, artist: t.artist, virtual: 1 } : {}) });
    } catch { /* ignore */ }
  };
  player.addEventListener('time', () => { if (cur && player.track?.id === cur.id) cur.heard = Math.max(cur.heard, player.listened || 0); });
  player.addEventListener('track', () => { const t = player.track; if (cur && t?.id === cur.id) return; flush(); if (t) cur = { id: t.id, heard: 0, track: t }; });
  addEventListener('pagehide', () => flush());
  markLogged = (id) => { if (cur?.id === id) cur.logged = true; };
}
let markLogged = () => {};
import('./player.js').then(m => attachListenLog(m.player)).catch(() => {});
