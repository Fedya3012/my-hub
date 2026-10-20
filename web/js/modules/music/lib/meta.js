// Audio metadata reader: container/codec info, tags, ReplayGain, lyrics and cover art.
//
// Pure browser module. Works on File/Blob through small slices (Blob.slice + arrayBuffer),
// so a 200 MB file only touches its headers, tag blocks and the last few KB.
// Never throws: malformed input returns whatever was read plus `warnings`.
//
//   const meta = await readAudioMeta(file, { name: file.name });

const MAX_TAG = 64 * 1024 * 1024; // cap for any single tag/atom we load into memory

const GENRES = ('Blues|Classic Rock|Country|Dance|Disco|Funk|Grunge|Hip-Hop|Jazz|Metal|New Age|Oldies|Other|Pop|R&B|Rap|Reggae|Rock|Techno|Industrial|' +
  'Alternative|Ska|Death Metal|Pranks|Soundtrack|Euro-Techno|Ambient|Trip-Hop|Vocal|Jazz+Funk|Fusion|Trance|Classical|Instrumental|Acid|House|' +
  'Game|Sound Clip|Gospel|Noise|Alternative Rock|Bass|Soul|Punk|Space|Meditative|Instrumental Pop|Instrumental Rock|Ethnic|Gothic|Darkwave|' +
  'Techno-Industrial|Electronic|Pop-Folk|Eurodance|Dream|Southern Rock|Comedy|Cult|Gangsta|Top 40|Christian Rap|Pop/Funk|Jungle|Native American|' +
  'Cabaret|New Wave|Psychedelic|Rave|Showtunes|Trailer|Lo-Fi|Tribal|Acid Punk|Acid Jazz|Polka|Retro|Musical|Rock & Roll|Hard Rock|Folk|Folk-Rock|' +
  'National Folk|Swing|Fast Fusion|Bebop|Latin|Revival|Celtic|Bluegrass|Avantgarde|Gothic Rock|Progressive Rock|Psychedelic Rock|Symphonic Rock|' +
  'Slow Rock|Big Band|Chorus|Easy Listening|Acoustic|Humour|Speech|Chanson|Opera|Chamber Music|Sonata|Symphony|Booty Bass|Primus|Porn Groove|' +
  'Satire|Slow Jam|Club|Tango|Samba|Folklore|Ballad|Power Ballad|Rhythmic Soul|Freestyle|Duet|Punk Rock|Drum Solo|A Cappella|Euro-House|' +
  'Dance Hall|Goa|Drum & Bass|Club-House|Hardcore|Terror|Indie|Britpop|Punk|Polsk Punk|Beat|Christian Gangsta Rap|Heavy Metal|Black Metal|' +
  'Crossover|Contemporary Christian|Christian Rock|Merengue|Salsa|Thrash Metal|Anime|J-Pop|Synthpop|Abstract|Art Rock|Baroque|Bhangra|Big Beat|' +
  'Breakbeat|Chillout|Downtempo|Dub|EBM|Eclectic|Electro|Electroclash|Emo|Experimental|Garage|Global|IDM|Illbient|Industro-Goth|Jam Band|' +
  'Krautrock|Leftfield|Lounge|Math Rock|New Romantic|Nu-Breakz|Post-Punk|Post-Rock|Psytrance|Shoegaze|Space Rock|Trop Rock|World Music|' +
  'Neoclassical|Audiobook|Audio Theatre|Neue Deutsche Welle|Podcast|Indie Rock|G-Funk|Dubstep|Garage Rock|Psybient').split('|');

// ---------- byte helpers ----------

const dec = {
  latin1: new TextDecoder('latin1'),
  utf8: new TextDecoder('utf-8'),
  le: new TextDecoder('utf-16le'),
  be: new TextDecoder('utf-16be'),
};

async function read(blob, off, len) {
  off = Math.max(0, off);
  const end = Math.min(blob.size, off + len);
  if (end <= off) return new Uint8Array(0);
  return new Uint8Array(await blob.slice(off, end).arrayBuffer());
}
const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
const ascii = (b, o = 0, n = b.length - o) => dec.latin1.decode(b.subarray(o, o + n));
const utf8 = (b, o = 0, n = b.length - o) => dec.utf8.decode(b.subarray(o, o + n));
const u64 = (dv, o, le) => Number(dv.getBigUint64(o, le));
const syncsafe = (b, o) => (b[o] & 0x7f) << 21 | (b[o + 1] & 0x7f) << 14 | (b[o + 2] & 0x7f) << 7 | (b[o + 3] & 0x7f);
const clean = s => (s ?? '').replace(/\0+$/, '').replace(/﻿/g, '').trim();

function b64(s) {
  try {
    const bin = atob(s.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

function sniffMime(d) {
  if (d[0] === 0xff && d[1] === 0xd8) return 'image/jpeg';
  if (d[0] === 0x89 && d[1] === 0x50) return 'image/png';
  if (d[0] === 0x47 && d[1] === 0x49) return 'image/gif';
  if (d[0] === 0x52 && d[8] === 0x57) return 'image/webp';
  if (d[0] === 0x42 && d[1] === 0x4d) return 'image/bmp';
  return null;
}

// ---------- result state ----------

function newCtx(blob, name) {
  return {
    blob, name: name || blob.name || '', size: blob.size,
    res: {
      container: 'unknown', codec: 'unknown', codecLabel: 'unknown', lossless: false, floatPCM: false,
      bitDepth: null, sampleRate: null, dsdRate: null, channels: null, bitrate: null, vbr: null,
      duration: null, encoder: null, tags: null, replayGain: null, lyrics: null, picture: null, warnings: [],
    },
    bag: new Map(),      // NORMALISED_KEY -> [values]
    pics: [],            // { mime, data, type }
    synced: null,        // LRC from SYLT
    codecEncoder: null,  // LAME tag / stream vendor
    audioBytes: null,    // bytes of audio payload, for bitrate fallback
  };
}

const warn = (ctx, msg) => { if (!ctx.res.warnings.includes(msg)) ctx.res.warnings.push(msg); };

// Map of tag aliases (Vorbis/APE/INFO/iTunes names, upper-cased) -> canonical key.
const ALIAS = {
  'ALBUM ARTIST': 'ALBUMARTIST', ALBUM_ARTIST: 'ALBUMARTIST', 'ALBUMARTIST': 'ALBUMARTIST',
  TRACK: 'TRACKNUMBER', TOTALTRACKS: 'TRACKTOTAL', TRACKC: 'TRACKTOTAL',
  DISC: 'DISCNUMBER', DISK: 'DISCNUMBER', TOTALDISCS: 'DISCTOTAL', DISCC: 'DISCTOTAL',
  YEAR: 'DATE', ORIGINALDATE: 'ORIGINALDATE',
  ORGANIZATION: 'LABEL', PUBLISHER: 'LABEL', LABEL: 'LABEL',
  DESCRIPTION: 'COMMENT', UNSYNCEDLYRICS: 'LYRICS', 'UNSYNCED LYRICS': 'LYRICS',
  TEMPO: 'BPM', ENCODEDBY: 'ENCODEDBY', 'ENCODED-BY': 'ENCODEDBY',
  'MUSICBRAINZ ALBUM TYPE': 'RELEASETYPE', MUSICBRAINZ_ALBUMTYPE: 'RELEASETYPE', RELEASETYPE: 'RELEASETYPE', 'RELEASE TYPE': 'RELEASETYPE',
};

function put(ctx, key, val) {
  if (val == null) return;
  if (typeof val === 'string') { val = clean(val); if (!val) return; }
  key = String(key).toUpperCase().trim();
  key = ALIAS[key] || key;
  if (key.startsWith('LYRICS')) key = 'LYRICS'; // ffmpeg writes "lyrics-eng"
  const arr = ctx.bag.get(key);
  if (arr) { if (!arr.includes(val)) arr.push(val); } else ctx.bag.set(key, [val]);
}
const first = (ctx, ...keys) => { for (const k of keys) { const v = ctx.bag.get(k); if (v?.length) return v[0]; } return null; };
const has = (ctx, k) => ctx.bag.has(k);

function addPic(ctx, mime, data, type = 3) {
  if (!data?.length) return;
  mime = (mime || '').toLowerCase();
  if (mime === 'jpg') mime = 'image/jpeg';
  if (mime && !mime.includes('/')) mime = 'image/' + mime;
  ctx.pics.push({ mime: sniffMime(data) || mime || 'application/octet-stream', data, type });
}

// ---------- Vorbis comments + FLAC picture ----------

function parseVorbisComments(ctx, b, o = 0) {
  const dv = view(b);
  const vlen = dv.getUint32(o, true); o += 4;
  const vendor = utf8(b, o, vlen); o += vlen;
  if (vendor) ctx.codecEncoder ??= vendor;
  const n = dv.getUint32(o, true); o += 4;
  for (let i = 0; i < n && o + 4 <= b.length; i++) {
    const len = dv.getUint32(o, true); o += 4;
    if (o + len > b.length) { warn(ctx, 'truncated Vorbis comment'); break; }
    const s = utf8(b, o, len); o += len;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    const key = s.slice(0, eq).toUpperCase(), val = s.slice(eq + 1);
    if (key === 'METADATA_BLOCK_PICTURE') { const d = b64(val); if (d) parseFlacPicture(ctx, d); }
    else if (key === 'COVERART') { const d = b64(val); if (d) addPic(ctx, first(ctx, 'COVERARTMIME'), d); }
    else put(ctx, key, val);
  }
}

function parseFlacPicture(ctx, b) {
  try {
    const dv = view(b);
    let o = 0;
    const type = dv.getUint32(o); o += 4;
    const ml = dv.getUint32(o); o += 4;
    const mime = ascii(b, o, ml); o += ml;
    const dl = dv.getUint32(o); o += 4 + dl + 16;
    const len = dv.getUint32(o); o += 4;
    addPic(ctx, mime, b.slice(o, o + len), type);
  } catch { warn(ctx, 'bad picture block'); }
}

// ---------- ID3v2 ----------

function unsync(b) {
  const out = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0) i++;
  }
  return out.subarray(0, j);
}

function decText(b, enc) {
  if (enc === 1) {
    if (b[0] === 0xfe && b[1] === 0xff) return dec.be.decode(b.subarray(2));
    return dec.le.decode(b[0] === 0xff && b[1] === 0xfe ? b.subarray(2) : b);
  }
  if (enc === 2) return dec.be.decode(b);
  if (enc === 3) return dec.utf8.decode(b);
  return dec.latin1.decode(b);
}

// Read a terminated string starting at o; returns [text, nextOffset].
function termStr(b, o, enc) {
  const wide = enc === 1 || enc === 2;
  let e = o;
  if (wide) { while (e + 1 < b.length && (b[e] || b[e + 1])) e += 2; }
  else { while (e < b.length && b[e]) e++; }
  return [clean(decText(b.subarray(o, e), enc)), Math.min(b.length, e + (wide ? 2 : 1))];
}

const textValues = (b, enc) => clean(decText(b.subarray(1), enc)).split('\0').map(clean).filter(Boolean);

const ID3_MAP = {
  TIT2: 'TITLE', TT2: 'TITLE', TPE1: 'ARTIST', TP1: 'ARTIST', TALB: 'ALBUM', TAL: 'ALBUM',
  TPE2: 'ALBUMARTIST', TP2: 'ALBUMARTIST', TRCK: 'TRACKNUMBER', TRK: 'TRACKNUMBER',
  TPOS: 'DISCNUMBER', TPA: 'DISCNUMBER', TDRC: 'DATE', TYER: 'ID3YEAR', TYE: 'ID3YEAR', TDOR: 'ORIGINALDATE', TORY: 'ORIGINALDATE',
  TCOM: 'COMPOSER', TCM: 'COMPOSER', TBPM: 'BPM', TBP: 'BPM', TSRC: 'ISRC', TRC: 'ISRC',
  TPUB: 'LABEL', TPB: 'LABEL', TSSE: 'ENCODER', TSS: 'ENCODER', TENC: 'ENCODEDBY', TEN: 'ENCODEDBY',
  TCON: 'GENRE', TCO: 'GENRE',
};

function id3Genre(v) {
  const out = [];
  for (let s of v) {
    if (/^\d+$/.test(s)) { out.push(GENRES[+s] || s); continue; }
    let m;
    while ((m = /^\((\d+|RX|CR)\)/.exec(s))) {
      s = s.slice(m[0].length);
      if (!s) out.push(m[1] === 'RX' ? 'Remix' : m[1] === 'CR' ? 'Cover' : GENRES[+m[1]] || m[1]);
    }
    if (s) out.push(s.replace(/^\(\(/, '('));
  }
  return out;
}

const lrcTime = ms => {
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`;
};

function id3Frame(ctx, id, b, v) {
  if (!b.length) return;
  const enc = b[0];
  if (id === 'TXXX' || id === 'TXX') {
    const [desc, o] = termStr(b, 1, enc);
    const val = clean(decText(b.subarray(o), enc)).split('\0').map(clean).filter(Boolean);
    for (const x of val) put(ctx, desc, x);
  } else if (id === 'COMM' || id === 'COM') {
    const [desc, o] = termStr(b, 4, enc);
    if (/^(iTun|Songs-DB|MusicMatch)/i.test(desc)) return;
    const val = clean(decText(b.subarray(o), enc));
    put(ctx, desc ? 'COMMENT_DESC' : 'COMMENT', val); // prefer comments without description
  } else if (id === 'USLT' || id === 'ULT') {
    const [, o] = termStr(b, 4, enc);
    put(ctx, 'LYRICS', decText(b.subarray(o), enc).replace(/\0+$/, '').replace(/\r\n?/g, '\n'));
  } else if (id === 'SYLT' || id === 'SLT') {
    const fmt = b[4];
    let [, o] = termStr(b, 6, enc);
    const lines = [];
    while (o < b.length) {
      const [t, n] = termStr(b, o, enc);
      if (n + 4 > b.length) break;
      const time = view(b).getUint32(n);
      o = n + 4;
      lines.push({ time, t: t.replace(/^[\r\n]+/, '') });
    }
    if (fmt !== 2) { warn(ctx, 'SYLT uses MPEG-frame timestamps, ignored'); return; }
    if (lines.length && !ctx.synced) ctx.synced = lines.map(l => lrcTime(l.time) + l.t).join('\n');
  } else if (id === 'APIC') {
    const [mime, o1] = termStr(b, 1, 0);
    const type = b[o1];
    const [, o2] = termStr(b, o1 + 1, enc);
    addPic(ctx, mime, b.slice(o2), type);
  } else if (id === 'PIC') {
    const fmt = ascii(b, 1, 3).toLowerCase();
    const [, o] = termStr(b, 5, enc);
    addPic(ctx, fmt === 'jpg' ? 'image/jpeg' : 'image/' + fmt, b.slice(o), b[4]);
  } else if (id[0] === 'T' && ID3_MAP[id]) {
    let vals = textValues(b, enc);
    if (ID3_MAP[id] === 'GENRE') vals = id3Genre(vals);
    for (const x of vals) put(ctx, ID3_MAP[id], x);
  }
}

const validId = (b, o, n) => { for (let i = 0; i < n; i++) { const c = b[o + i]; if (!((c >= 65 && c <= 90) || (c >= 48 && c <= 57))) return false; } return true; };

// Parse a complete ID3v2 tag held in memory (b starts with "ID3").
function parseID3v2(ctx, b) {
  try {
    const ver = b[3], flags = b[5];
    let size = Math.min(syncsafe(b, 6), b.length - 10);
    let body = b.subarray(10, 10 + size);
    if (ver < 2 || ver > 4) { warn(ctx, `unsupported ID3v2.${ver}`); return; }
    if (ver < 4 && flags & 0x80) body = unsync(body); // v2.2/2.3: whole tag is unsynchronised
    let o = 0;
    if (flags & 0x40 && ver > 2) o = ver === 4 ? syncsafe(body, 0) : view(body).getUint32(0) + 4;
    const idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
    while (o + hdr <= body.length) {
      if (!body[o] || !validId(body, o, idLen)) break; // padding
      const id = ascii(body, o, idLen);
      let fsize, fl = 0;
      if (ver === 2) fsize = body[o + 3] << 16 | body[o + 4] << 8 | body[o + 5];
      else if (ver === 3) { fsize = view(body).getUint32(o + 4); fl = body[o + 9]; }
      else {
        fsize = syncsafe(body, o + 4); fl = body[o + 9];
        // Some writers put plain sizes in v2.4: prefer the one that lands on a valid frame
        const raw = view(body).getUint32(o + 4);
        if (raw !== fsize) {
          const okS = o + 10 + fsize >= body.length || validId(body, o + 10 + fsize, 4) || !body[o + 10 + fsize];
          const okR = o + 10 + raw <= body.length && (o + 10 + raw === body.length || validId(body, o + 10 + raw, 4) || !body[o + 10 + raw]);
          if (!okS && okR) fsize = raw;
        }
      }
      o += hdr;
      if (o + fsize > body.length) { warn(ctx, 'truncated ID3 frame ' + id); fsize = body.length - o; }
      let fb = body.subarray(o, o + fsize);
      o += fsize;
      if (ver === 3) {
        if (fl & 0xc0) { warn(ctx, `compressed/encrypted ID3 frame ${id} skipped`); continue; }
        if (fl & 0x20) fb = fb.subarray(1);
      } else if (ver === 4) {
        if (fl & 0x0c) { warn(ctx, `compressed/encrypted ID3 frame ${id} skipped`); continue; }
        if (fl & 0x40) fb = fb.subarray(1);
        if (fl & 0x01) fb = fb.subarray(4);
        if (fl & 0x02) fb = unsync(fb);
      }
      try { id3Frame(ctx, id, fb, ver); } catch { warn(ctx, 'bad ID3 frame ' + id); }
    }
    // TYER + TDAT -> date when no TDRC
    if (!has(ctx, 'DATE') && has(ctx, 'ID3YEAR')) put(ctx, 'DATE', first(ctx, 'ID3YEAR'));
  } catch (e) { warn(ctx, 'bad ID3v2 tag: ' + e.message); }
}

// Size of an ID3v2 tag at offset (0 when none).
function id3Size(h, o = 0) {
  if (h.length < o + 10 || h[o] !== 0x49 || h[o + 1] !== 0x44 || h[o + 2] !== 0x33) return 0;
  return 10 + syncsafe(h, o + 6) + (h[o + 5] & 0x10 ? 10 : 0);
}

async function readID3At(ctx, off) {
  const h = await read(ctx.blob, off, 10);
  const size = id3Size(h);
  if (!size) return 0;
  if (size > MAX_TAG) { warn(ctx, 'ID3 tag too large'); return size; }
  parseID3v2(ctx, await read(ctx.blob, off, size));
  return size;
}

// ---------- APEv2 / ID3v1 at end of file ----------

async function readTail(ctx) {
  const { blob, size } = ctx;
  let end = size;
  const t = await read(blob, size - 160, 160);
  if (t.length >= 128 && ascii(t, t.length - 128, 3) === 'TAG') {
    end -= 128;
    ctx.id3v1 = t.subarray(t.length - 128);
  }
  // APEv2 footer
  const f = end - 32 >= 0 ? await read(blob, end - 32, 32) : null;
  if (f && ascii(f, 0, 8) === 'APETAGEX') {
    const dv = view(f);
    const tsize = dv.getUint32(12, true), count = dv.getUint32(16, true), flags = dv.getUint32(20, true);
    const start = end - tsize;
    if (tsize > 32 && tsize < MAX_TAG && start >= 0) {
      parseAPE(ctx, await read(blob, start, tsize - 32), count);
      end = start - (flags & 0x80000000 ? 32 : 0);
    } else warn(ctx, 'bad APE tag');
  }
  return end; // end of audio payload
}

function parseAPE(ctx, b, count) {
  const dv = view(b);
  let o = 0;
  for (let i = 0; i < count && o + 8 < b.length; i++) {
    const len = dv.getUint32(o, true), flags = dv.getUint32(o + 4, true);
    let k = o + 8;
    while (k < b.length && b[k]) k++;
    const key = ascii(b, o + 8, k - o - 8);
    const val = b.subarray(k + 1, k + 1 + len);
    o = k + 1 + len;
    if (((flags >> 1) & 3) === 1) { // binary
      if (/^cover art/i.test(key)) {
        let z = 0; while (z < val.length && val[z]) z++;
        const fname = ascii(val, 0, z).toLowerCase();
        addPic(ctx, fname.endsWith('.png') ? 'image/png' : 'image/jpeg', val.slice(z + 1), /front/i.test(key) ? 3 : 0);
      }
      continue;
    }
    for (const v of utf8(val).split('\0')) put(ctx, key, v);
  }
}

function applyID3v1(ctx) {
  const b = ctx.id3v1;
  if (!b) return;
  const s = (o, n) => clean(dec.latin1.decode(b.subarray(o, o + n)).replace(/\0.*$/s, ''));
  const fill = (k, v) => { if (v && !has(ctx, k)) put(ctx, k, v); };
  fill('TITLE', s(3, 30)); fill('ARTIST', s(33, 30)); fill('ALBUM', s(63, 30)); fill('DATE', s(93, 4));
  fill('COMMENT', s(97, b[125] === 0 && b[126] ? 28 : 30));
  if (b[125] === 0 && b[126]) fill('TRACKNUMBER', String(b[126]));
  if (b[127] < GENRES.length) fill('GENRE', GENRES[b[127]]);
}

// ---------- FLAC ----------

function streamInfo(ctx, b, o = 0) {
  const r = ctx.res;
  r.sampleRate = b[o + 10] << 12 | b[o + 11] << 4 | b[o + 12] >> 4;
  r.channels = ((b[o + 12] >> 1) & 7) + 1;
  r.bitDepth = ((b[o + 12] & 1) << 4 | b[o + 13] >> 4) + 1;
  const total = (b[o + 13] & 0x0f) * 2 ** 32 + view(b).getUint32(o + 14);
  if (total && r.sampleRate) r.duration = total / r.sampleRate;
}

async function parseFLAC(ctx, start) {
  const r = ctx.res;
  Object.assign(r, { container: 'flac', codec: 'FLAC', codecLabel: 'FLAC', lossless: true });
  let o = start + 4;
  for (let i = 0; i < 1000; i++) {
    const h = await read(ctx.blob, o, 4);
    if (h.length < 4) { warn(ctx, 'truncated FLAC metadata'); break; }
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = h[1] << 16 | h[2] << 8 | h[3];
    o += 4;
    if (type === 0 || type === 4 || type === 6) {
      const b = await read(ctx.blob, o, len);
      if (b.length < len) { warn(ctx, 'truncated FLAC metadata'); break; }
      if (type === 0) streamInfo(ctx, b);
      else if (type === 4) parseVorbisComments(ctx, b);
      else parseFlacPicture(ctx, b);
    } else if (type === 127) { warn(ctx, 'invalid FLAC block'); break; }
    o += len;
    if (last) break;
  }
  ctx.audioBytes = (await readTail(ctx)) - o;
}

// ---------- MPEG audio ----------

const MP3_BR = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
MP3_BR['2-3'] = MP3_BR['2-2'];

function mpegHeader(b, o) {
  if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const vb = (b[o + 1] >> 3) & 3, lb = (b[o + 1] >> 1) & 3, bi = b[o + 2] >> 4, si = (b[o + 2] >> 2) & 3;
  if (vb === 1 || lb === 0 || bi === 0 || bi === 15 || si === 3) return null;
  const version = vb === 3 ? 1 : vb === 2 ? 2 : 2.5, layer = 4 - lb;
  const bitrate = MP3_BR[`${version === 1 ? 1 : 2}-${layer}`][bi] * 1000;
  const sampleRate = [44100, 48000, 32000][si] / (version === 1 ? 1 : version === 2 ? 2 : 4);
  const pad = (b[o + 2] >> 1) & 1, mono = (b[o + 3] >> 6) === 3;
  const spf = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;
  const len = layer === 1 ? (Math.floor(12 * bitrate / sampleRate) + pad) * 4 : Math.floor(spf / 8 * bitrate / sampleRate) + pad;
  return { version, layer, bitrate, sampleRate, mono, spf, len, channels: mono ? 1 : 2 };
}

async function parseMP3(ctx, start) {
  const r = ctx.res;
  Object.assign(r, { container: 'mp3', codec: 'MP3', codecLabel: 'MP3', lossless: false });
  const end = await readTail(ctx);
  // find first frame (verify with the following one)
  let buf = await read(ctx.blob, start, 65536), base = start, h = null, at = -1;
  for (let i = 0; i + 4 < buf.length; i++) {
    const c = mpegHeader(buf, i);
    if (!c) continue;
    const n = i + c.len;
    if (n + 4 <= buf.length && !mpegHeader(buf, n)) continue;
    h = c; at = i; break;
  }
  if (!h) { warn(ctx, 'no MPEG frame found'); applyID3v1(ctx); return; }
  if (at > 0 && start > 0) warn(ctx, `${at} junk bytes before first frame`);
  if (h.layer !== 3) r.codecLabel = r.codec = 'MP' + h.layer;
  Object.assign(r, { sampleRate: h.sampleRate, channels: h.channels, bitDepth: null });
  const audioStart = base + at;
  ctx.audioBytes = end - audioStart;
  const f = buf.subarray(at);
  const xo = 4 + (h.version === 1 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17));
  const tag = ascii(f, xo, 4);
  let frames = null, bytes = null;
  if (tag === 'Xing' || tag === 'Info') {
    const dv = view(f), fl = dv.getUint32(xo + 4);
    let p = xo + 8;
    if (fl & 1) { frames = dv.getUint32(p); p += 4; }
    if (fl & 2) { bytes = dv.getUint32(p); p += 4; }
    if (fl & 4) p += 100;
    if (fl & 8) p += 4;
    r.vbr = tag === 'Xing';
    const enc = ascii(f, p, 9).replace(/[^\x20-\x7e]/g, '').trim();
    if (/^(LAME|L3.99|GOGO|Lavc|Lavf)/.test(enc)) ctx.codecEncoder = enc;
    // the Xing frame itself carries no audio
    ctx.audioBytes -= h.len;
  } else if (ascii(f, 36, 4) === 'VBRI') {
    const dv = view(f);
    bytes = dv.getUint32(36 + 10); frames = dv.getUint32(36 + 14);
    r.vbr = true;
    ctx.audioBytes -= h.len;
  } else r.vbr = false;
  if (frames) {
    r.duration = frames * h.spf / h.sampleRate;
    r.bitrate = Math.round((bytes || ctx.audioBytes) * 8 / r.duration);
  } else {
    r.bitrate = h.bitrate;
    r.duration = ctx.audioBytes * 8 / h.bitrate;
    if (!r.vbr) r.vbr = false;
  }
  applyID3v1(ctx);
}

// ADTS AAC (raw .aac): header info, duration estimated from the first frames.
async function parseADTS(ctx) {
  const r = ctx.res, b = await read(ctx.blob, 0, 65536);
  const aot = (b[2] >> 6) + 1, fi = (b[2] >> 2) & 15;
  Object.assign(r, {
    codec: 'AAC', codecLabel: aot === 2 ? 'AAC-LC' : aot === 5 ? 'HE-AAC' : 'AAC',
    sampleRate: AAC_RATES[fi] ?? null, channels: ((b[2] & 1) << 2 | b[3] >> 6) || null,
  });
  let o = 0, n = 0;
  while (o + 7 <= b.length && b[o] === 0xff && (b[o + 1] & 0xf6) === 0xf0) {
    const len = (b[o + 3] & 3) << 11 | b[o + 4] << 3 | b[o + 5] >> 5;
    if (len < 7 || o + len > b.length) break;
    o += len; n += (b[o - len + 6] & 3) + 1;
  }
  if (n && r.sampleRate) {
    r.duration = ctx.size / (o / n) * 1024 / r.sampleRate;
    warn(ctx, 'raw ADTS stream: duration estimated');
  }
}

// ---------- MP4 ----------

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function* atoms(b, o, end) {
  const dv = view(b);
  while (o + 8 <= end) {
    let size = dv.getUint32(o), hdr = 8;
    const type = ascii(b, o + 4, 4);
    if (size === 1) { size = u64(dv, o + 8); hdr = 16; } else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) { yield { type, start: o + hdr, end, bad: true }; return; }
    yield { type, start: o + hdr, end: o + size };
    o += size;
  }
}
const child = (b, a, type, skip = 0) => { for (const c of atoms(b, a.start + skip, a.end)) if (c.type === type) return c; return null; };

// MPEG-4 descriptor: [tag, length, start]
function desc(b, o) {
  const tag = b[o++];
  let len = 0;
  for (let i = 0; i < 4; i++) { const c = b[o++]; len = len << 7 | (c & 0x7f); if (!(c & 0x80)) break; }
  return [tag, len, o];
}

function parseEsds(ctx, b, a) {
  const r = ctx.res;
  let o = a.start + 4;
  let [tag, , p] = desc(b, o);
  if (tag !== 3) return;
  const fl = b[p + 2];
  p += 3;
  if (fl & 0x80) p += 2;
  if (fl & 0x40) p += b[p] + 1;
  if (fl & 0x20) p += 2;
  [tag, , p] = desc(b, p);
  if (tag !== 4) return;
  const oti = b[p], dv = view(b);
  const avg = dv.getUint32(p + 9);
  if (avg) r.bitrate = avg;
  if (oti === 0x69 || oti === 0x6b) { Object.assign(r, { codec: 'MP3', codecLabel: 'MP3' }); return; }
  p += 13;
  let len;
  [tag, len, p] = desc(b, p);
  if (tag !== 5 || len < 2) return;
  // AudioSpecificConfig
  let bit = p * 8;
  const bits = n => { let v = 0; for (let i = 0; i < n; i++, bit++) v = v << 1 | (b[bit >> 3] >> (7 - (bit & 7)) & 1); return v; };
  let aot = bits(5);
  if (aot === 31) aot = 32 + bits(6);
  const fi = bits(4), rate = fi === 15 ? bits(24) : AAC_RATES[fi];
  const ch = bits(4);
  if (aot === 5 || aot === 29) {
    r.codecLabel = aot === 29 ? 'HE-AACv2' : 'HE-AAC';
    const efi = bits(4), ext = efi === 15 ? bits(24) : AAC_RATES[efi];
    r.sampleRate = ext && rate && ext >= rate ? ext : rate || r.sampleRate; // SBR output rate
    if (aot === 29) r.channels = 2;
  } else {
    r.codecLabel = { 1: 'AAC Main', 2: 'AAC-LC', 3: 'AAC SSR', 4: 'AAC LTP', 23: 'AAC-LD', 39: 'AAC-ELD', 42: 'xHE-AAC' }[aot] || 'AAC';
    if (rate) r.sampleRate = rate;
  }
  if (ch && aot !== 29) r.channels = ch === 7 ? 8 : ch;
}

function parseStsd(ctx, b, stsd) {
  const r = ctx.res, dv = view(b);
  const e = stsd.start + 8;
  if (e + 36 > stsd.end) return;
  const esize = dv.getUint32(e), fmt = ascii(b, e + 4, 4);
  const ver = dv.getUint16(e + 16);
  r.channels = dv.getUint16(e + 24);
  r.bitDepth = dv.getUint16(e + 26) || null;
  r.sampleRate = dv.getUint32(e + 32) >>> 16 || null;
  const entry = { start: e + 36 + (ver === 1 ? 16 : ver === 2 ? 36 : 0), end: Math.min(stsd.end, e + esize) };
  if (ver === 2) r.sampleRate = Math.round(dv.getFloat64(e + 40));
  const kid = t => { for (const c of atoms(b, entry.start, entry.end)) if (c.type === t) return c; return null; };
  if (fmt === 'mp4a') {
    Object.assign(r, { codec: 'AAC', codecLabel: 'AAC', lossless: false, bitDepth: null });
    const es = kid('esds') || (kid('wave') && child(b, kid('wave'), 'esds'));
    if (es) parseEsds(ctx, b, es);
  } else if (fmt === 'alac') {
    Object.assign(r, { codec: 'ALAC', codecLabel: 'ALAC', lossless: true });
    const c = kid('alac');
    if (c && c.end - c.start >= 28) {
      const o = c.start + 4;
      r.bitDepth = b[o + 5]; r.channels = b[o + 9];
      const sr = dv.getUint32(o + 20); // cookie avgBitRate is often bogus: bitrate comes from mdat size
      if (sr) r.sampleRate = sr;
    }
  } else if (fmt === 'fLaC') {
    Object.assign(r, { codec: 'FLAC', codecLabel: 'FLAC', lossless: true });
    const c = kid('dfLa');
    if (c && (b[c.start + 4] & 0x7f) === 0) streamInfo(ctx, b, c.start + 8);
  } else if (fmt === 'Opus') {
    Object.assign(r, { codec: 'Opus', codecLabel: 'Opus', lossless: false, bitDepth: null, sampleRate: 48000 });
    const c = kid('dOps');
    if (c) { r.channels = b[c.start + 1]; const ir = dv.getUint32(c.start + 4); if (ir) r.sampleRate = ir; }
  } else if (fmt === '.mp3') Object.assign(r, { codec: 'MP3', codecLabel: 'MP3', bitDepth: null });
  else if (fmt === 'ac-3' || fmt === 'ec-3') Object.assign(r, { codecLabel: fmt === 'ac-3' ? 'AC-3' : 'E-AC-3', bitDepth: null });
  else if (fmt === 'lpcm' || fmt === 'sowt' || fmt === 'twos' || fmt === 'in24' || fmt === 'in32' || fmt === 'fl32')
    Object.assign(r, { codec: 'PCM', codecLabel: 'PCM', lossless: true, floatPCM: fmt === 'fl32' });
  else warn(ctx, 'unknown MP4 sample entry ' + fmt);
}

const MP4_TAGS = {
  '©nam': 'TITLE', '©ART': 'ARTIST', '©alb': 'ALBUM', aART: 'ALBUMARTIST', '©day': 'DATE', '©gen': 'GENRE',
  '©wrt': 'COMPOSER', '©cmt': 'COMMENT', '©lyr': 'LYRICS', '©too': 'ENCODER', '©pub': 'LABEL', '©grp': 'GROUPING',
};

function parseIlst(ctx, b, ilst) {
  for (const it of atoms(b, ilst.start, ilst.end)) {
    let mean = '', name = '';
    for (const d of atoms(b, it.start, it.end)) {
      if (d.type === 'mean') mean = utf8(b, d.start + 4, d.end - d.start - 4);
      else if (d.type === 'name') name = utf8(b, d.start + 4, d.end - d.start - 4);
      if (d.type !== 'data') continue;
      const dv = view(b), kind = dv.getUint32(d.start) & 0xffffff, p = b.subarray(d.start + 8, d.end);
      const t = it.type;
      if (t === 'covr') addPic(ctx, kind === 14 ? 'image/png' : 'image/jpeg', p.slice(), 3);
      else if (t === 'trkn' || t === 'disk') {
        if (p.length >= 6) {
          const [n, tot] = [view(p).getUint16(2), view(p).getUint16(4)];
          const k = t === 'trkn' ? 'TRACK' : 'DISC';
          if (n) put(ctx, k + 'NUMBER', String(n));
          if (tot) put(ctx, k + 'TOTAL', String(tot));
        }
      } else if (t === 'gnre') { if (p.length >= 2) put(ctx, 'GENRE', GENRES[view(p).getUint16(0) - 1]); }
      else if (t === 'tmpo') { if (p.length >= 2) put(ctx, 'BPM', String(view(p).getUint16(0))); }
      else if (t === '----') { if (name) put(ctx, name, utf8(p)); }
      else if (MP4_TAGS[t] && (kind === 1 || kind === 0)) put(ctx, MP4_TAGS[t], utf8(p));
    }
  }
}

function parseMoov(ctx, b) {
  const r = ctx.res, dv = view(b);
  let audio = null, mvDur = null;
  for (const a of atoms(b, 0, b.length)) {
    if (a.type === 'mvhd') {
      const v = b[a.start];
      const ts = dv.getUint32(a.start + (v ? 20 : 12)), d = v ? u64(dv, a.start + 24) : dv.getUint32(a.start + 16);
      if (ts) mvDur = d / ts;
    } else if (a.type === 'trak' && !audio) {
      const mdia = child(b, a, 'mdia');
      const hdlr = mdia && child(b, mdia, 'hdlr');
      if (hdlr && ascii(b, hdlr.start + 8, 4) === 'soun') audio = mdia;
    } else if (a.type === 'udta' || a.type === 'meta') {
      const meta = a.type === 'meta' ? a : child(b, a, 'meta');
      if (meta) {
        const skip = ascii(b, meta.start + 4, 4) === 'hdlr' ? 0 : 4; // full box vs QuickTime style
        const ilst = child(b, meta, 'ilst', skip);
        if (ilst) parseIlst(ctx, b, ilst);
      }
    }
  }
  if (!audio) { warn(ctx, 'no audio track'); r.duration = mvDur; return; }
  const mdhd = child(b, audio, 'mdhd');
  if (mdhd) {
    const v = b[mdhd.start];
    const ts = dv.getUint32(mdhd.start + (v ? 20 : 12)), d = v ? u64(dv, mdhd.start + 24) : dv.getUint32(mdhd.start + 16);
    if (ts && d) r.duration = d / ts;
  }
  r.duration ??= mvDur;
  const minf = child(b, audio, 'minf'), stbl = minf && child(b, minf, 'stbl'), stsd = stbl && child(b, stbl, 'stsd');
  if (stsd) parseStsd(ctx, b, stsd); else warn(ctx, 'no stsd');
}

async function parseMP4(ctx) {
  ctx.res.container = 'mp4';
  let o = 0, mdat = 0, gotMoov = false;
  for (let i = 0; i < 10000 && o + 8 <= ctx.size; i++) {
    const h = await read(ctx.blob, o, 16), dv = view(h);
    let size = dv.getUint32(0);
    const type = ascii(h, 4, 4);
    if (size === 1) size = u64(dv, 8); else if (size === 0) size = ctx.size - o;
    if (size < 8) { warn(ctx, 'bad MP4 atom size'); break; }
    if (type === 'moov') {
      if (size > MAX_TAG) { warn(ctx, 'moov too large'); break; }
      parseMoov(ctx, (await read(ctx.blob, o, size)).subarray(8));
      gotMoov = true;
    } else if (type === 'mdat') mdat += size;
    o += size;
  }
  if (!gotMoov) warn(ctx, 'no moov atom');
  if (mdat) ctx.audioBytes = mdat;
}

// ---------- Ogg ----------

async function parseOgg(ctx) {
  const r = ctx.res, { blob } = ctx;
  r.container = 'ogg';
  const packets = [];
  let o = 0, serial = null, cur = [], curLen = 0;
  // collect the first two packets of the first logical stream
  while (packets.length < 2 && o < ctx.size) {
    const h = await read(blob, o, 27 + 255);
    if (ascii(h, 0, 4) !== 'OggS') { warn(ctx, 'lost Ogg sync'); break; }
    const dv = view(h), ser = dv.getUint32(14, true), n = h[26];
    const segs = h.subarray(27, 27 + n), bodyLen = segs.reduce((s, x) => s + x, 0);
    const body = ser === serial || serial === null ? await read(blob, o + 27 + n, bodyLen) : null;
    serial ??= ser;
    o += 27 + n + bodyLen;
    if (!body) continue;
    let p = 0;
    for (const s of segs) {
      cur.push(body.subarray(p, p + s)); curLen += s; p += s;
      if (s < 255) {
        const pk = new Uint8Array(curLen); let q = 0;
        for (const c of cur) { pk.set(c, q); q += c.length; }
        packets.push(pk); cur = []; curLen = 0;
        if (packets.length >= 2) break;
      }
    }
    if (curLen > MAX_TAG) { warn(ctx, 'Ogg header packet too large'); break; }
  }
  const [id, com] = packets;
  if (!id) return;
  let preskip = 0, rate = 0;
  if (ascii(id, 0, 8) === 'OpusHead') {
    const dv = view(id);
    preskip = dv.getUint16(10, true);
    // Opus always decodes at 48 kHz; report the original input rate when the encoder stored it
    const input = dv.getUint32(12, true);
    Object.assign(r, { codec: 'Opus', codecLabel: 'Opus', channels: id[9], sampleRate: input || 48000 });
    rate = 48000;
    if (com && ascii(com, 0, 8) === 'OpusTags') parseVorbisComments(ctx, com, 8);
  } else if (id[0] === 1 && ascii(id, 1, 6) === 'vorbis') {
    const dv = view(id);
    rate = dv.getUint32(12, true);
    const max = dv.getInt32(16, true), nom = dv.getInt32(20, true), min = dv.getInt32(24, true);
    Object.assign(r, { codec: 'Vorbis', codecLabel: 'Vorbis', channels: id[11], sampleRate: rate });
    if (nom > 0) r.bitrate = nom;
    if (max > 0 && min > 0) r.vbr = max !== min;
    if (com && com[0] === 3 && ascii(com, 1, 6) === 'vorbis') parseVorbisComments(ctx, com, 7);
  } else if (id[0] === 0x7f && ascii(id, 1, 4) === 'FLAC') {
    Object.assign(r, { codec: 'FLAC', codecLabel: 'FLAC', lossless: true });
    streamInfo(ctx, id, 13);
    rate = r.sampleRate;
    if (com && (com[0] & 0x7f) === 4) parseVorbisComments(ctx, com, 4);
  } else { warn(ctx, 'unsupported Ogg codec'); return; }
  // duration from the last page's granule position
  const tail = await read(blob, ctx.size - 65536, 65536);
  for (let i = tail.length - 27; i >= 0; i--) {
    if (tail[i] !== 0x4f || ascii(tail, i, 4) !== 'OggS') continue;
    const dv = view(tail);
    if (dv.getUint32(i + 14, true) !== serial) continue;
    const g = Number(dv.getBigInt64(i + 6, true));
    if (g < 0) continue;
    if (rate) r.duration = Math.max(0, g - preskip) / rate;
    break;
  }
  ctx.audioBytes = ctx.size - o;
}

// ---------- RIFF / WAV ----------

const INFO_MAP = { INAM: 'TITLE', IART: 'ARTIST', IPRD: 'ALBUM', ICMT: 'COMMENT', ICRD: 'DATE', IGNR: 'GENRE', ITRK: 'TRACKNUMBER', IPRT: 'TRACKNUMBER', ISFT: 'ENCODER', IMUS: 'COMPOSER', ICMP: 'COMPOSER', IPUB: 'LABEL' };

function wavFmt(ctx, b) {
  const r = ctx.res, dv = view(b);
  let tag = dv.getUint16(0, true);
  r.channels = dv.getUint16(2, true);
  r.sampleRate = dv.getUint32(4, true);
  ctx.byteRate = dv.getUint32(8, true);
  r.bitDepth = dv.getUint16(14, true) || null;
  if (tag === 0xfffe && b.length >= 26) {
    const valid = dv.getUint16(18, true);
    if (valid) r.bitDepth = valid;
    tag = dv.getUint16(24, true);
  }
  if (tag === 1) Object.assign(r, { codec: 'PCM', codecLabel: 'PCM', lossless: true });
  else if (tag === 3) Object.assign(r, { codec: 'PCM', codecLabel: 'PCM', lossless: true, floatPCM: true });
  else if (tag === 0x55) Object.assign(r, { codec: 'MP3', codecLabel: 'MP3', bitDepth: null });
  else { r.codecLabel = '0x' + tag.toString(16); warn(ctx, 'WAV format tag 0x' + tag.toString(16)); }
  if (ctx.byteRate) r.bitrate = ctx.byteRate * 8;
}

async function parseWAV(ctx, rf64) {
  const r = ctx.res;
  r.container = 'wav';
  let o = 12, ds64 = null, dataSize = null;
  for (let i = 0; i < 1000 && o + 8 <= ctx.size; i++) {
    const h = await read(ctx.blob, o, 8), id = ascii(h, 0, 4);
    let size = view(h).getUint32(4, true);
    const body = o + 8;
    if (id === 'ds64') {
      const b = await read(ctx.blob, body, 28), dv = view(b);
      ds64 = u64(dv, 8, true);
    } else if (id === 'fmt ') wavFmt(ctx, await read(ctx.blob, body, Math.min(size, 64)));
    else if (id === 'data') {
      if (size === 0xffffffff || (rf64 && ds64 != null)) size = ds64 ?? ctx.size - body;
      dataSize = Math.min(size, ctx.size - body);
      if (dataSize < size) warn(ctx, 'truncated data chunk');
    } else if (id === 'LIST') {
      const b = await read(ctx.blob, body, Math.min(size, MAX_TAG));
      if (ascii(b, 0, 4) === 'INFO') {
        const dv = view(b);
        for (let p = 4; p + 8 <= b.length;) {
          const k = ascii(b, p, 4), n = dv.getUint32(p + 4, true);
          if (INFO_MAP[k]) put(ctx, INFO_MAP[k], utf8(b, p + 8, n));
          p += 8 + n + (n & 1);
        }
      }
    } else if (id === 'id3 ' || id === 'ID3 ') await readID3At(ctx, body);
    if (size === 0xffffffff) break;
    o = body + size + (size & 1);
  }
  if (dataSize != null) {
    ctx.audioBytes = dataSize;
    if (ctx.byteRate) r.duration = dataSize / ctx.byteRate;
  } else warn(ctx, 'no data chunk');
}

// ---------- AIFF ----------

function ext80(b, o) {
  const e = ((b[o] & 0x7f) << 8 | b[o + 1]) - 16383 - 63;
  const m = view(b).getUint32(o + 2) * 2 ** 32 + view(b).getUint32(o + 6);
  return Math.round(m * 2 ** e) * (b[o] & 0x80 ? -1 : 1);
}

async function parseAIFF(ctx, aifc) {
  const r = ctx.res;
  r.container = 'aiff';
  let o = 12, frames = null;
  for (let i = 0; i < 1000 && o + 8 <= ctx.size; i++) {
    const h = await read(ctx.blob, o, 8), id = ascii(h, 0, 4), size = view(h).getUint32(4);
    const body = o + 8;
    if (id === 'COMM') {
      const b = await read(ctx.blob, body, Math.min(size, 64)), dv = view(b);
      r.channels = dv.getInt16(0); frames = dv.getUint32(2); r.bitDepth = dv.getInt16(6); r.sampleRate = ext80(b, 8);
      const comp = aifc && b.length >= 22 ? ascii(b, 18, 4) : 'NONE';
      if (/^(NONE|twos|sowt|in24|in32|raw )$/.test(comp)) Object.assign(r, { codec: 'PCM', codecLabel: 'PCM', lossless: true });
      else if (/^(fl32|FL32|fl64|FL64)$/i.test(comp)) Object.assign(r, { codec: 'PCM', codecLabel: 'PCM', lossless: true, floatPCM: true, bitDepth: comp.endsWith('64') ? 64 : 32 });
      else { r.codecLabel = comp.trim(); warn(ctx, 'AIFF-C compression ' + comp); }
    } else if (id === 'SSND') ctx.audioBytes = Math.min(size, ctx.size - body) - 8;
    else if (id === 'ID3 ' || id === 'id3 ') await readID3At(ctx, body);
    else if (id === 'NAME' || id === 'AUTH' || id === 'ANNO' || id === '(c) ') {
      const t = ascii(await read(ctx.blob, body, Math.min(size, 4096)));
      put(ctx, { NAME: 'TITLE', AUTH: 'ARTIST', ANNO: 'COMMENT', '(c) ': 'COPYRIGHT' }[id], t);
    }
    o = body + size + (size & 1);
  }
  if (frames != null && r.sampleRate) r.duration = frames / r.sampleRate;
  if (r.sampleRate && r.channels && r.bitDepth) r.bitrate = r.sampleRate * r.channels * r.bitDepth;
}

// ---------- WavPack ----------

const WV_RATES = [6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000, 192000];

async function parseWV(ctx, start) {
  const r = ctx.res;
  Object.assign(r, { container: 'wavpack', codec: 'WavPack', codecLabel: 'WavPack', lossless: true });
  const b = await read(ctx.blob, start, 4096), dv = view(b);
  const ck = dv.getUint32(4, true);
  const flags = dv.getUint32(24, true);
  const total = b[11] * 2 ** 32 + dv.getUint32(12, true);
  r.bitDepth = flags & 0x80 ? 32 : ((flags & 3) + 1) * 8;
  r.floatPCM = !!(flags & 0x80);
  r.channels = flags & 4 ? 1 : 2;
  const ri = (flags >> 23) & 15;
  r.sampleRate = WV_RATES[ri] ?? null;
  if (flags & 0x80000000) { r.codecLabel = 'WavPack DSD'; warn(ctx, 'WavPack DSD'); }
  if (flags & 8) { r.lossless = false; warn(ctx, 'WavPack hybrid mode: lossy unless a .wvc correction file is used'); }
  // metadata sub-blocks: channel info, custom sample rate
  for (let p = 32; p + 2 <= Math.min(b.length, ck + 8);) {
    const id = b[p], large = id & 0x80;
    let len = (large ? b[p + 1] | b[p + 2] << 8 | b[p + 3] << 16 : b[p + 1]) * 2;
    const d = p + (large ? 4 : 2);
    const real = len - (id & 0x40 ? 1 : 0);
    const fid = id & 0x3f;
    if (fid === 0x0d && real > 0) r.channels = b[d] || r.channels;
    else if (fid === 0x27 && real >= 3) r.sampleRate = b[d] | b[d + 1] << 8 | b[d + 2] << 16;
    p = d + len;
  }
  if (total !== 0xffffffff && total && r.sampleRate) r.duration = total / r.sampleRate;
  const end = await readTail(ctx);
  ctx.audioBytes = end - start;
  applyID3v1(ctx);
}

// ---------- DSD ----------

const dsdName = rate => { const m = Math.round(rate / 44100); return [64, 128, 256, 512].includes(m) ? 'DSD' + m : null; };

function setDSD(ctx, rate) {
  const r = ctx.res;
  r.dsdRate = dsdName(rate); // 48 kHz-family rates (DSD 3.072 MHz etc.) stay null
  Object.assign(r, { codec: 'DSD', codecLabel: r.dsdRate || 'DSD', lossless: true, bitDepth: 1, sampleRate: rate });
}

async function parseDSF(ctx) {
  const r = ctx.res;
  r.container = 'dsf';
  const b = await read(ctx.blob, 0, 92), dv = view(b);
  const metaPtr = u64(dv, 20, true);
  if (ascii(b, 28, 4) !== 'fmt ') { warn(ctx, 'bad DSF fmt chunk'); return; }
  r.channels = dv.getUint32(52, true);
  setDSD(ctx, dv.getUint32(56, true));
  const bits = dv.getUint32(60, true);
  if (bits !== 1) warn(ctx, 'DSF bits per sample ' + bits);
  const samples = u64(dv, 64, true);
  if (r.sampleRate) r.duration = samples / r.sampleRate;
  r.bitrate = r.sampleRate * r.channels;
  if (metaPtr && metaPtr < ctx.size) await readID3At(ctx, metaPtr);
}

async function parseDFF(ctx) {
  const r = ctx.res;
  r.container = 'dff';
  const end = Math.min(ctx.size, 12 + u64(view(await read(ctx.blob, 4, 8)), 0));
  let o = 16, dataBytes = null, dst = null;
  const walk = async (o, end, fn) => {
    for (let i = 0; i < 1000 && o + 12 <= end; i++) {
      const h = await read(ctx.blob, o, 12), size = u64(view(h), 4);
      await fn(ascii(h, 0, 4), o + 12, size);
      o += 12 + size + (size & 1);
    }
  };
  await walk(o, end, async (id, body, size) => {
    if (id === 'PROP') {
      await walk(body + 4, body + size, async (pid, pb, ps) => {
        const b = await read(ctx.blob, pb, Math.min(ps, 256)), dv = view(b);
        if (pid === 'FS  ') setDSD(ctx, dv.getUint32(0));
        else if (pid === 'CHNL') r.channels = dv.getUint16(0);
        else if (pid === 'CMPR' && ascii(b, 0, 4) === 'DST ') { r.codecLabel = 'DST'; dst = {}; warn(ctx, 'DST compressed DSD'); }
      });
    } else if (id === 'DSD ') dataBytes = size;
    else if (id === 'DST ') {
      dataBytes = size;
      const h = await read(ctx.blob, body, 18);
      if (ascii(h, 0, 4) === 'FRTE') { const dv = view(h); dst = { frames: dv.getUint32(12), rate: dv.getUint16(16) }; }
    } else if (id === 'ID3 ' || id === 'id3 ') await readID3At(ctx, body);
    else if (id === 'DIIN') {
      await walk(body, body + size, async (did, db, ds) => {
        if (did !== 'DITI' && did !== 'DIAR') return;
        const b = await read(ctx.blob, db, Math.min(ds, 4096)), n = view(b).getUint32(0);
        put(ctx, did === 'DITI' ? 'TITLE' : 'ARTIST', ascii(b, 4, n));
      });
    }
  });
  if (r.dsdRate) r.codecLabel = dst ? 'DST ' + r.dsdRate : r.dsdRate;
  if (dst?.frames && dst.rate) r.duration = dst.frames / dst.rate;
  else if (dataBytes && r.channels && r.sampleRate && !dst) r.duration = dataBytes * 8 / (r.channels * r.sampleRate);
  if (dataBytes) ctx.audioBytes = dataBytes;
  if (!dst && r.sampleRate && r.channels) r.bitrate = r.sampleRate * r.channels;
}

// ---------- Monkey's Audio ----------

async function parseAPEFile(ctx, start) {
  const r = ctx.res;
  Object.assign(r, { container: 'ape', codec: 'APE', codecLabel: 'APE', lossless: true });
  const b = await read(ctx.blob, start, 128), dv = view(b);
  const ver = dv.getUint16(4, true);
  let bpf, fin, frames, bits, ch, rate;
  if (ver >= 3980) {
    const h = start + dv.getUint32(8, true);
    const hb = await read(ctx.blob, h, 24), hv = view(hb);
    bpf = hv.getUint32(4, true); fin = hv.getUint32(8, true); frames = hv.getUint32(12, true);
    bits = hv.getUint16(16, true); ch = hv.getUint16(18, true); rate = hv.getUint32(20, true);
  } else {
    const level = dv.getUint16(6, true), fl = dv.getUint16(8, true);
    ch = dv.getUint16(10, true); rate = dv.getUint32(12, true);
    frames = dv.getUint32(24, true); fin = dv.getUint32(28, true);
    bits = fl & 1 ? 8 : fl & 8 ? 24 : 16;
    bpf = ver >= 3950 ? 73728 * 4 : ver >= 3900 || (ver >= 3800 && level === 4000) ? 73728 : 9216;
  }
  Object.assign(r, { bitDepth: bits || null, channels: ch || null, sampleRate: rate || null });
  if (frames && rate) r.duration = ((frames - 1) * bpf + fin) / rate;
  const end = await readTail(ctx);
  ctx.audioBytes = end - start;
  applyID3v1(ctx);
}

// ---------- tags -> result ----------

const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const dB = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const LRC_RE = /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m;

function finish(ctx) {
  const r = ctx.res;
  const s = k => first(ctx, k);
  const all = k => ctx.bag.get(k) || [];
  const pair = (k, tk) => {
    const v = s(k);
    const [n, t] = v ? String(v).split('/') : [];
    return [num(n), num(s(tk)) ?? num(t)];
  };
  const [trackNo, trackTotal] = pair('TRACKNUMBER', 'TRACKTOTAL');
  const [discNo, discTotal] = pair('DISCNUMBER', 'DISCTOTAL');
  const date = s('DATE') || s('ORIGINALDATE');
  const genre = [...new Set(all('GENRE').flatMap(g => String(g).split(/\s*;\s*/)).map(clean).filter(Boolean))];
  r.tags = {
    title: s('TITLE'), artist: all('ARTIST').join('; ') || null, album: s('ALBUM'), albumArtist: s('ALBUMARTIST'),
    trackNo, trackTotal, discNo, discTotal,
    year: date ? num(String(date).match(/\d{4}/)?.[0]) : null, date: date || null,
    genre, composer: all('COMPOSER').join('; ') || null, comment: s('COMMENT') || s('COMMENT_DESC'),
    bpm: s('BPM') ? Math.round(dB(s('BPM'))) || null : null, isrc: s('ISRC'), label: s('LABEL'),
    // album / single / ep / compilation… (MusicBrainz "release type"); may hold several, e.g. "album; live"
    releaseType: all('RELEASETYPE').flatMap(v => String(v).toLowerCase().split(/\s*[;,/]\s*/)).filter(Boolean)[0] || null,
  };

  // ReplayGain (RG tags, else Opus R128 Q7.8 relative to -23 LUFS -> +5 dB for the -18 LUFS RG reference)
  const rg = {
    trackGain: dB(s('REPLAYGAIN_TRACK_GAIN')), trackPeak: dB(s('REPLAYGAIN_TRACK_PEAK')),
    albumGain: dB(s('REPLAYGAIN_ALBUM_GAIN')), albumPeak: dB(s('REPLAYGAIN_ALBUM_PEAK')),
  };
  if (rg.trackGain == null && s('R128_TRACK_GAIN') != null) rg.trackGain = num(s('R128_TRACK_GAIN')) / 256 + 5;
  if (rg.albumGain == null && s('R128_ALBUM_GAIN') != null) rg.albumGain = num(s('R128_ALBUM_GAIN')) / 256 + 5;
  r.replayGain = Object.values(rg).some(v => v != null) ? rg : null;

  // lyrics: SYLT first, then any lyrics tag (LRC detected by [mm:ss.xx] lines)
  const lyr = s('LYRICS');
  if (ctx.synced) r.lyrics = { text: ctx.synced, synced: true };
  else if (lyr) r.lyrics = { text: String(lyr).replace(/\r\n?/g, '\n'), synced: LRC_RE.test(lyr) };

  const pic = ctx.pics.find(p => p.type === 3) || ctx.pics[0];
  r.picture = pic ? { mime: pic.mime, data: pic.data } : null;
  // Every embedded picture (front, back, artist, booklet…) for the tag editor's art picker.
  r.pictures = ctx.pics.map(p => ({ mime: p.mime, data: p.data, type: p.type }));

  r.encoder = (ctx.res.codec === 'MP3' && ctx.codecEncoder) || s('ENCODER') || ctx.codecEncoder || s('ENCODEDBY') || null;
  const bytes = ctx.audioBytes ?? ctx.size;
  if (!r.bitrate && r.duration > 0 && bytes > 0) r.bitrate = Math.round(bytes * 8 / r.duration);
  if (r.bitrate) r.bitrate = Math.round(r.bitrate);
  if (r.duration != null && !(r.duration >= 0 && Number.isFinite(r.duration))) { warn(ctx, 'bad duration'); r.duration = null; }
  if (!r.lossless && r.codec !== 'unknown') r.bitDepth = null;
  return r;
}

// ---------- entry ----------

const EXT = {
  flac: 'flac', mp3: 'mp3', mp2: 'mp3', m4a: 'mp4', m4b: 'mp4', mp4: 'mp4', alac: 'mp4', ogg: 'ogg', oga: 'ogg', opus: 'ogg',
  wav: 'wav', aif: 'aiff', aiff: 'aiff', aifc: 'aiff', wv: 'wavpack', dsf: 'dsf', dff: 'dff', ape: 'ape',
};

export async function readAudioMeta(blob, { name } = {}) {
  const ctx = newCtx(blob, name);
  try {
    const head = await read(blob, 0, 16);
    // leading ID3v2 (MP3, sometimes FLAC/APE/WavPack); there may be more than one
    let start = 0, h = head;
    for (let i = 0; i < 4 && id3Size(h); i++) {
      start += await readID3At(ctx, start);
      h = await read(blob, start, 16);
    }
    const id3 = start > 0;
    const m4 = ascii(h, 0, 4), sub = ascii(h, 8, 4);
    if (m4 === 'fLaC') await parseFLAC(ctx, start);
    else if (ascii(head, 4, 4) === 'ftyp') await parseMP4(ctx);
    else if (m4 === 'OggS') await parseOgg(ctx);
    else if ((m4 === 'RIFF' || m4 === 'RF64') && sub === 'WAVE') await parseWAV(ctx, m4 === 'RF64');
    else if (m4 === 'FORM' && (sub === 'AIFF' || sub === 'AIFC')) await parseAIFF(ctx, sub === 'AIFC');
    else if (m4 === 'wvpk') await parseWV(ctx, start);
    else if (m4 === 'DSD ' && !id3) await parseDSF(ctx);
    else if (m4 === 'FRM8') await parseDFF(ctx);
    else if (m4 === 'MAC ') await parseAPEFile(ctx, start);
    else if (!id3 && h[0] === 0xff && (h[1] & 0xf6) === 0xf0) await parseADTS(ctx);
    else if (id3 || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) || EXT[ctx.name.split('.').pop().toLowerCase()] === 'mp3') await parseMP3(ctx, start);
    else {
      const ext = EXT[ctx.name.split('.').pop().toLowerCase()];
      warn(ctx, 'unrecognised format' + (ext ? ` (extension suggests ${ext})` : ''));
      if (ext) ctx.res.container = ext;
    }
  } catch (e) {
    warn(ctx, 'read error: ' + (e?.message || e));
  }
  try { return finish(ctx); } catch (e) { warn(ctx, 'finish error: ' + e.message); return ctx.res; }
}
