// Writes tags back into audio files, in the browser:
//   MP3  -> a fresh ID3v2.4 tag (UTF-8), unmanaged frames of the old v2.3/v2.4 tag are kept, ID3v1 dropped
//   FLAC -> new VORBIS_COMMENT + PICTURE blocks, other comments and blocks (STREAMINFO, SEEKTABLE,
//           CUESHEET, APPLICATION) kept, 4 KB padding
// Other formats (M4A/ALAC/AAC, Ogg/Opus, WAV, AIFF, DSD, WavPack, APE) keep their edits in the
// library database only (synced everywhere); their bytes are never touched.
//
// tags: { title, artist, album, albumArtist, composer, label, releaseType, trackNo, trackTotal, discNo,
//         discTotal, year, genres[], comment, bpm, isrc, rg: { trackGain, trackPeak, albumGain, albumPeak }, lyrics }
// pictures: [{ mime, data: Uint8Array, type: 3 }] (front cover first) or null = keep the file's own.
import { db } from '../../../core/db.js';
import { storage } from '../../../core/storage/index.js';

export const WRITABLE = { MP3: 'ID3v2.4', FLAC: 'Vorbis comment + PICTURE' };
export const formatOf = (t) => {
  const c = t?.tech?.container?.toLowerCase?.() || '', k = t?.tech?.codec;
  if (k === 'MP3') return 'MP3';
  if (k === 'FLAC' && (c === 'flac' || !c)) return 'FLAC';
  return null;
};
export const canWrite = (t) => !!formatOf(t);

const enc = new TextEncoder();
const syncsafe = (n) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const ss = (b, o) => (b[o] & 0x7f) << 21 | (b[o + 1] & 0x7f) << 14 | (b[o + 2] & 0x7f) << 7 | (b[o + 3] & 0x7f);
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
function cat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const pair = (n, t) => n ? String(n) + (t ? '/' + t : '') : '';
const gain = (v) => v == null || v === '' ? null : `${(+v >= 0 ? '+' : '')}${(+v).toFixed(2)} dB`;
const peak = (v) => v == null || v === '' ? null : (+v).toFixed(6);

// ── ID3v2.4 ─────────────────────────────────────────────────────
const MANAGED = new Set(['TIT2', 'TPE1', 'TALB', 'TPE2', 'TCOM', 'TPUB', 'TRCK', 'TPOS', 'TDRC', 'TYER', 'TDAT', 'TCON', 'COMM', 'TBPM', 'TSRC', 'USLT', 'APIC', 'TXXX']);
const TXXX_MANAGED = /^(REPLAYGAIN_(TRACK|ALBUM)_(GAIN|PEAK)|MusicBrainz Album Type|RELEASETYPE)$/i;

function frame(id, body) { return cat([enc.encode(id), new Uint8Array([...syncsafe(body.length), 0, 0]), body]); }
const textFrame = (id, ...vals) => frame(id, cat([new Uint8Array([3]), enc.encode(vals.filter(v => v != null && v !== '').map(String).join('\0'))]));
const txxx = (desc, val) => frame('TXXX', cat([new Uint8Array([3]), enc.encode(desc), new Uint8Array([0]), enc.encode(String(val))]));
const comm = (id, text) => frame(id, cat([new Uint8Array([3]), enc.encode('eng'), new Uint8Array([0]), enc.encode(String(text))]));
const apic = (p) => frame('APIC', cat([new Uint8Array([0]), enc.encode(p.mime || 'image/jpeg'), new Uint8Array([0, p.type ?? 3, 0]), p.data]));

// Old frames worth keeping (PRIV, UFID, other TXXX, SYLT…), returned as v2.4 frames.
function oldFrames(b, keepPics) {
  const out = [];
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return out;
  const ver = b[3], flags = b[5], size = ss(b, 6);
  if (ver < 3 || ver > 4 || flags & 0x80) return out;
  let o = 10;
  if (flags & 0x40) o += ver === 4 ? ss(b, 10) : ((b[10] << 24 | b[11] << 16 | b[12] << 8 | b[13]) >>> 0) + 4;
  const end = Math.min(b.length, 10 + size);
  while (o + 10 <= end) {
    const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver === 4 ? ss(b, o + 4) : (b[o + 4] << 24 | b[o + 5] << 16 | b[o + 6] << 8 | b[o + 7]) >>> 0;
    const fl = b[o + 9];
    const body = b.subarray(o + 10, o + 10 + len);
    o += 10 + len;
    if (fl & 0x0f || (ver === 3 && fl & 0xe0)) continue; // compressed/encrypted/grouped: drop
    if (id === 'APIC' && keepPics) { out.push(frame(id, body)); continue; }
    if (MANAGED.has(id)) {
      if (id !== 'TXXX') continue;
      const e = body[0], wide = e === 1 || e === 2;
      let i = 1; while (i < body.length && (wide ? body[i] || body[i + 1] : body[i])) i += wide ? 2 : 1;
      const desc = new TextDecoder(e === 3 ? 'utf-8' : wide ? 'utf-16' : 'latin1').decode(body.subarray(1, i));
      if (TXXX_MANAGED.test(desc)) continue;
    }
    if (ver === 3 && /^(TYER|TDAT|TIME|TRDA|TORY|TSIZ|EQUA|RVAD|IPLS)$/.test(id)) continue; // not in v2.4
    out.push(frame(id, body));
  }
  return out;
}

export function buildID3(tags, pictures, old = new Uint8Array(0)) {
  const T = tags, F = [];
  const add = (id, ...v) => { if (v.some(x => x != null && x !== '')) F.push(textFrame(id, ...v)); };
  add('TIT2', T.title); add('TPE1', ...splitList(T.artist)); add('TALB', T.album); add('TPE2', T.albumArtist);
  add('TCOM', ...splitList(T.composer)); add('TPUB', T.label);
  add('TRCK', pair(T.trackNo, T.trackTotal)); add('TPOS', pair(T.discNo, T.discTotal));
  add('TDRC', T.date || (T.year ? String(T.year) : '')); add('TCON', ...(T.genres || []));
  add('TBPM', T.bpm ? String(Math.round(T.bpm)) : ''); add('TSRC', T.isrc);
  if (T.comment) F.push(comm('COMM', T.comment));
  if (T.releaseType) F.push(txxx('MusicBrainz Album Type', T.releaseType));
  const rg = T.rg || {};
  if (gain(rg.trackGain)) F.push(txxx('REPLAYGAIN_TRACK_GAIN', gain(rg.trackGain)));
  if (peak(rg.trackPeak)) F.push(txxx('REPLAYGAIN_TRACK_PEAK', peak(rg.trackPeak)));
  if (gain(rg.albumGain)) F.push(txxx('REPLAYGAIN_ALBUM_GAIN', gain(rg.albumGain)));
  if (peak(rg.albumPeak)) F.push(txxx('REPLAYGAIN_ALBUM_PEAK', peak(rg.albumPeak)));
  if (T.lyrics) F.push(comm('USLT', T.lyrics));
  if (pictures) for (const p of pictures) F.push(apic(p));
  F.push(...oldFrames(old, !pictures));
  const body = cat([...F, new Uint8Array(2048)]); // padding
  return cat([new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, ...syncsafe(body.length)]), body]);
}
const splitList = (s) => String(s || '').split(/\s*;\s*/).filter(Boolean);

async function writeMP3(blob, tags, pictures) {
  const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
  let start = 0, old = new Uint8Array(0);
  for (let i = 0; i < 4; i++) {
    const h = i === 0 ? head : new Uint8Array(await blob.slice(start, start + 10).arrayBuffer());
    if (h[0] !== 0x49 || h[1] !== 0x44 || h[2] !== 0x33) break;
    const size = 10 + ss(h, 6) + (h[5] & 0x10 ? 10 : 0);
    if (i === 0) old = new Uint8Array(await blob.slice(0, size).arrayBuffer());
    start += size;
  }
  let end = blob.size;
  const tail = new Uint8Array(await blob.slice(Math.max(0, end - 128), end).arrayBuffer());
  if (tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47) end -= 128; // ID3v1
  return new Blob([buildID3(tags, pictures, old), blob.slice(start, end)], { type: 'audio/mpeg' });
}

// ── FLAC ────────────────────────────────────────────────────────
const VORBIS_MANAGED = new Set(['TITLE', 'ARTIST', 'ALBUM', 'ALBUMARTIST', 'ALBUM ARTIST', 'COMPOSER', 'LABEL', 'ORGANIZATION', 'PUBLISHER', 'TRACKNUMBER', 'TRACKTOTAL', 'TOTALTRACKS',
  'DISCNUMBER', 'DISCTOTAL', 'TOTALDISCS', 'DATE', 'YEAR', 'GENRE', 'COMMENT', 'DESCRIPTION', 'BPM', 'ISRC', 'RELEASETYPE', 'MUSICBRAINZ_ALBUMTYPE', 'LYRICS', 'UNSYNCEDLYRICS',
  'REPLAYGAIN_TRACK_GAIN', 'REPLAYGAIN_TRACK_PEAK', 'REPLAYGAIN_ALBUM_GAIN', 'REPLAYGAIN_ALBUM_PEAK', 'METADATA_BLOCK_PICTURE']);

export function vorbisComments(tags, keep = [], vendor = 'My Hub') {
  const T = tags, C = [...keep];
  const add = (k, v) => { if (v != null && v !== '') C.push(`${k}=${v}`); };
  add('TITLE', T.title); splitList(T.artist).forEach(a => add('ARTIST', a)); add('ALBUM', T.album); add('ALBUMARTIST', T.albumArtist);
  splitList(T.composer).forEach(a => add('COMPOSER', a)); add('LABEL', T.label);
  add('TRACKNUMBER', T.trackNo); add('TRACKTOTAL', T.trackTotal); add('DISCNUMBER', T.discNo); add('DISCTOTAL', T.discTotal);
  add('DATE', T.date || T.year); (T.genres || []).forEach(g => add('GENRE', g)); add('COMMENT', T.comment);
  add('BPM', T.bpm ? Math.round(T.bpm) : null); add('ISRC', T.isrc); add('RELEASETYPE', T.releaseType);
  const rg = T.rg || {};
  add('REPLAYGAIN_TRACK_GAIN', gain(rg.trackGain)); add('REPLAYGAIN_TRACK_PEAK', peak(rg.trackPeak));
  add('REPLAYGAIN_ALBUM_GAIN', gain(rg.albumGain)); add('REPLAYGAIN_ALBUM_PEAK', peak(rg.albumPeak));
  add('LYRICS', T.lyrics);
  const parts = [new Uint8Array(u32le(enc.encode(vendor).length)), enc.encode(vendor), new Uint8Array(u32le(C.length))];
  for (const c of C) { const b = enc.encode(c); parts.push(new Uint8Array(u32le(b.length)), b); }
  return cat(parts);
}

async function imgSize(p) {
  try { const bmp = await createImageBitmap(new Blob([p.data], { type: p.mime })); const r = [bmp.width, bmp.height]; bmp.close?.(); return r; } catch { return [0, 0]; }
}
export async function flacPicture(p) {
  const mime = enc.encode(p.mime || 'image/jpeg');
  const [w, h] = await imgSize(p);
  return cat([new Uint8Array([...u32(p.type ?? 3), ...u32(mime.length)]), mime, new Uint8Array([...u32(0), ...u32(w), ...u32(h), ...u32(24), ...u32(0), ...u32(p.data.length)]), p.data]);
}
const block = (type, body, last) => cat([new Uint8Array([(last ? 0x80 : 0) | type, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255]), body]);

async function writeFLAC(blob, tags, pictures) {
  // Skip a leading ID3v2 tag (some rippers add one); it is not part of FLAC.
  let start = 0;
  const h = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
  if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) start = 10 + ss(h, 6) + (h[5] & 0x10 ? 10 : 0);
  const magic = new Uint8Array(await blob.slice(start, start + 4).arrayBuffer());
  if (String.fromCharCode(...magic) !== 'fLaC') throw new Error('Không phải tệp FLAC hợp lệ');
  let o = start + 4, last = false;
  const keepBlocks = [], keepComments = [], oldPics = [];
  let vendor = 'My Hub';
  while (!last) {
    const bh = new Uint8Array(await blob.slice(o, o + 4).arrayBuffer());
    if (bh.length < 4) throw new Error('Khối metadata FLAC bị cắt');
    last = !!(bh[0] & 0x80);
    const type = bh[0] & 0x7f, len = bh[1] << 16 | bh[2] << 8 | bh[3];
    const body = new Uint8Array(await blob.slice(o + 4, o + 4 + len).arrayBuffer());
    o += 4 + len;
    if (type === 1) continue;
    if (type === 4) {
      const dv = new DataView(body.buffer);
      let p = 0; const vl = dv.getUint32(p, true); p += 4; vendor = new TextDecoder().decode(body.subarray(p, p + vl)); p += vl;
      const n = dv.getUint32(p, true); p += 4;
      for (let i = 0; i < n && p + 4 <= body.length; i++) {
        const l = dv.getUint32(p, true); p += 4;
        const s = new TextDecoder().decode(body.subarray(p, p + l)); p += l;
        const k = s.slice(0, s.indexOf('=')).toUpperCase();
        if (!VORBIS_MANAGED.has(k) && !k.startsWith('LYRICS')) keepComments.push(s);
      }
      continue;
    }
    if (type === 6) { oldPics.push(body); continue; }
    if (type === 127) throw new Error('Khối FLAC không hợp lệ');
    keepBlocks.push({ type, body });
  }
  const pics = pictures ? await Promise.all(pictures.map(flacPicture)) : oldPics;
  const blocks = [...keepBlocks.map(b => [b.type, b.body]), [4, vorbisComments(tags, keepComments, vendor)], ...pics.map(p => [6, p]), [1, new Uint8Array(4096)]];
  // STREAMINFO must come first.
  blocks.sort((a, b) => (a[0] === 0 ? -1 : 0) - (b[0] === 0 ? -1 : 0));
  const meta = blocks.map(([t, b], i) => block(t, b, i === blocks.length - 1));
  return new Blob([enc.encode('fLaC'), ...meta, blob.slice(o)], { type: 'audio/flac' });
}

// Blob with the tags written, or throws for formats we do not write.
export async function writeTags(blob, format, tags, pictures = null) {
  if (format === 'MP3') return writeMP3(blob, tags, pictures);
  if (format === 'FLAC') return writeFLAC(blob, tags, pictures);
  throw new Error('Định dạng này chưa ghi thẻ vào tệp được; thay đổi được lưu trong thư viện.');
}

// Current library values of a track as a tag set (DB is the source of truth after edits).
export async function tagsOf(t) {
  const ly = await db.lyrics.get(t.id);
  return {
    title: t.title ?? t.item?.title, artist: t.artist, album: t.album, albumArtist: t.albumArtist, composer: t.composer, label: t.label,
    releaseType: t.releaseType, trackNo: t.trackNo, trackTotal: t.trackTotal, discNo: t.discNo, discTotal: t.discTotal, year: t.year,
    genres: t.genres || [], comment: t.comment, bpm: t.bpm, isrc: t.isrc, rg: t.rg || null, lyrics: ly?.text || null,
  };
}

const main = (id) => db.files.where('itemId').equals(id).filter(f => f.role === 'main').first();

// Picture list for a track: the chosen cover (own art, else album cover) as front cover.
async function coverPictures(t) {
  const al = t.albumId ? await db.albums.get(t.albumId) : null;
  const id = t.coverFileId || al?.coverFileId;
  if (!id) return null;
  const row = await db.files.get(id);
  if (!row) return null;
  try { const b = await storage.open(row); return [{ mime: b.type || 'image/jpeg', data: new Uint8Array(await b.arrayBuffer()), type: 3 }]; } catch { return null; }
}

// Tagged copy of a track's file (for download), without touching the stored one.
export async function exportTagged(t) {
  const file = await main(t.id);
  if (!file) throw new Error('Bài này chưa có tệp.');
  const src = await storage.open(file);
  const fmt = formatOf(t);
  if (!fmt) return { blob: src, name: file.name, written: false };
  return { blob: await writeTags(src, fmt, await tagsOf(t), await coverPictures(t)), name: file.name, written: true };
}

// Replace the stored audio file with a tagged copy (new file row; the old one is removed).
// Linked files (folder handles) become an app copy: the user's original is never written.
export async function writeIntoFile(t, override = {}) {
  const fmt = formatOf(t);
  if (!fmt) return { written: false };
  const file = await main(t.id);
  if (!file) return { written: false };
  const src = await storage.open(file);
  const out = await writeTags(src, fmt, { ...(await tagsOf(t)), ...override }, await coverPictures(t));
  const row = await storage.addFile(t.id, new File([out], file.name, { type: out.type }), { role: 'main', name: file.name, quiet: true });
  await db.tracks.update(t.id, { fileId: row.id, size: row.size, tagsWrittenAt: Date.now() });
  await storage.removeFile(file, { everywhere: true }).catch(() => {});
  return { written: true, format: fmt, size: row.size };
}

// For the lyrics editor: store the text and, for MP3/FLAC, write it into the file too.
export async function writeLyrics(track, text) {
  const t = { ...track, ...(await db.tracks.get(track.id)), id: track.id };
  if (!canWrite(t)) return { written: false };
  return writeIntoFile({ ...t, title: t.title ?? (await db.items.get(t.id))?.title }, { lyrics: text || null });
}

export function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
