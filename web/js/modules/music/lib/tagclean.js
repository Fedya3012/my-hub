// Tag clean-up tools for the tag editor: trim, letter case, "feat." splitting, mojibake repair
// (UTF-8 / Windows-1258 Vietnamese read as Latin-1 / CP1252), junk + URL stripping, numbers
// and fields from file names / folder patterns. Pure functions, no DOM.

export const trim = (s) => s == null ? s : String(s).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'feat.', 'ft.', 'với', 'và', 'của']);
export function titleCase(s) {
  if (!s) return s;
  return String(s).toLocaleLowerCase('vi').replace(/(^|[\s([{"'“‘/-])(\p{L})/gu, (m, p, c) => p + c.toLocaleUpperCase('vi'))
    .split(' ').map((w, i, a) => i && i < a.length - 1 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w).join(' ')
    .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii)\b/g, (x) => x.toUpperCase());
}
export const sentenceCase = (s) => !s ? s : String(s).toLocaleLowerCase('vi').replace(/^(\P{L}*)(\p{L})/u, (m, p, c) => p + c.toLocaleUpperCase('vi'));
export const upper = (s) => s && String(s).toLocaleUpperCase('vi');
export const lower = (s) => s && String(s).toLocaleLowerCase('vi');

// "Song (feat. B & C)" -> { title: 'Song', featured: ['B', 'C'] }
const FEAT = /\s*[([]?\s*(?:feat\.?|ft\.?|featuring|with|cùng)\s+([^)\]]+?)\s*[)\]]?\s*$/i;
export function splitFeat(title, artist) {
  const m = FEAT.exec(title || '');
  let feat = [];
  let t = title;
  if (m && /feat|ft|featuring/i.test(m[0])) { t = title.slice(0, m.index).trim(); feat = m[1].split(/\s*(?:,|&|;|\sx\s|\sand\s|\svà\s)\s*/i).filter(Boolean); }
  // "A feat. B" inside the artist field -> "A; B"
  const arts = String(artist || '').split(/\s*(?:;|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s)\s*/i).map(x => x.trim()).filter(Boolean);
  for (const f of feat) if (!arts.some(a => a.toLowerCase() === f.toLowerCase())) arts.push(f);
  return { title: t, artist: arts.join('; ') };
}

// ── Mojibake ────────────────────────────────────────────────────
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
function toBytes(s) {
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 256) out.push(c); else if (CP1252[c] != null) out.push(CP1252[c]); else return null;
  }
  return new Uint8Array(out);
}
const VI = /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/giu;
const BAD = /[ÃÂÆÐÕÞ\u0080-\u009f¤¦¨¯´¸¹¼½¾ð\uFFFD]/g;
// Vietnamese letters outside Latin-1 (ư ơ đ ă ạ ả ấ…) can never come out of a Latin-1 mis-decoding,
// so they weigh most; Latin-1 look-alikes (á, ê, ý…) count a little; typical garbage counts against.
export const score = (s) => (String(s).match(VI) || []).reduce((n, ch) => n + (ch.codePointAt(0) > 0xff ? 3 : 1), 0) - (String(s).match(BAD)?.length || 0) * 3;
const dec = (enc, b) => { try { return new TextDecoder(enc, { fatal: enc === 'utf-8' }).decode(b); } catch { return null; } };

// Best-scoring re-decoding of a garbled string, or the string itself.
export function fixMojibake(s) {
  if (!s || /^[\x00-\x7f]*$/.test(s)) return s;
  const b = toBytes(String(s));
  if (!b) return s;
  const cands = [dec('utf-8', b), dec('windows-1258', b)?.normalize('NFC')].filter(Boolean);
  let best = s, bs = score(s);
  for (const c of cands) { const sc = score(c); if (sc > bs) { best = c; bs = sc; } }
  return best;
}
export const looksGarbled = (s) => !!s && fixMojibake(s) !== s;

// ── Junk ────────────────────────────────────────────────────────
const JUNK = [
  /\s*[[(][^\])]*\.(?:com|net|org|vn|info|biz)[^\])]*[\])]/gi,

  /[[({]\s*(?:mp3|320\s?kbps|128\s?kbps|lossless|flac|official(?: music)? video|audio|lyrics?|mv|hd|hq|4k|free download|download)\s*[\])}]/gi,
  /\s[-–|]\s*(?:nhaccuatui|zing ?mp3|chiasenhac|youtube|soundcloud)\b.*$/gi,
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|vn|info|biz)(?:\/\S*)?\b/gi,
];
export function stripJunk(s) {
  if (!s) return s;
  let out = String(s);
  for (const r of JUNK) out = out.replace(r, ' ');
  return trim(out.replace(/\(\s*\)|\[\s*\]/g, '').replace(/[\s_-]+$/g, '').replace(/^[\s_-]+/, ''));
}

// ── File names ──────────────────────────────────────────────────
export const baseName = (n) => String(n || '').split('/').pop().replace(/\.[^.]+$/, '');
export function numberFromName(name) {
  const m = /^\s*(?:(\d{1,2})[-.](?=\d))?(\d{1,3})(?=[\s._)-])/.exec(baseName(name));
  return m ? { discNo: m[1] ? +m[1] : null, trackNo: +m[2] } : null;
}

// Pattern with %field% tokens, e.g. "%track% - %artist% - %title%" or "%artist%/%album%/%track%. %title%".
// The pattern is matched against the end of "folder/filename" (no extension).
export const PATTERN_FIELDS = { track: 'trackNo', disc: 'discNo', title: 'title', artist: 'artist', album: 'album', albumartist: 'albumArtist', year: 'year', genre: 'genres', composer: 'composer', skip: null };
export function fromPattern(pattern, path) {
  const keys = [];
  const rx = pattern.split(/(%\w+%)/).map(p => {
    const m = /^%(\w+)%$/.exec(p);
    if (!m) return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\?\//g, '[\\\\/]');
    const k = m[1].toLowerCase();
    keys.push(k);
    return k === 'track' || k === 'disc' || k === 'year' ? '(\\d+)' : '([^/\\\\]+?)';
  }).join('');
  const m = new RegExp('(?:^|[\\\\/])' + rx + '$', 'i').exec(String(path || '').replace(/\.[^./]+$/, ''));
  if (!m) return null;
  const out = {};
  keys.forEach((k, i) => {
    const f = PATTERN_FIELDS[k];
    if (!f) return;
    const v = trim(m[i + 1].replace(/_/g, ' '));
    out[f] = f === 'trackNo' || f === 'discNo' || f === 'year' ? +v : f === 'genres' ? [v] : v;
  });
  return out;
}

// Apply one named clean-up action to a tag patch-able object (returns changed fields only).
export const TEXT_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'composer', 'label', 'comment'];
export function cleanup(action, t) {
  const out = {};
  const each = (fn) => { for (const k of TEXT_FIELDS) { if (t[k] == null || t[k] === '') continue; const v = fn(t[k], k); if (v !== t[k]) out[k] = v; }
    if (t.genres?.length) { const g = t.genres.map(x => fn(x, 'genres')); if (g.join() !== t.genres.join()) out.genres = g; } };
  switch (action) {
    case 'trim': each(trim); break;
    case 'title': each((v, k) => k === 'comment' ? v : titleCase(v)); break;
    case 'sentence': each((v, k) => k === 'comment' ? v : sentenceCase(v)); break;
    case 'upper': each((v, k) => k === 'comment' ? v : upper(v)); break;
    case 'lower': each((v, k) => k === 'comment' ? v : lower(v)); break;
    case 'mojibake': each(fixMojibake); break;
    case 'junk': each(stripJunk); break;
    case 'feat': { const r = splitFeat(t.title, t.artist); if (r.title !== t.title) out.title = r.title; if (r.artist !== (t.artist || '')) out.artist = r.artist; break; }
    case 'number': { const n = numberFromName(t.fileName); if (n?.trackNo && n.trackNo !== t.trackNo) out.trackNo = n.trackNo; if (n?.discNo && n.discNo !== t.discNo) out.discNo = n.discNo; break; }
    case 'titleFromName': { const v = trim(baseName(t.fileName).replace(/^\s*\d{1,3}[\s._)-]+(?:-\s*)?/, '').replace(/_/g, ' ')); if (v && v !== t.title) out.title = v; break; }
  }
  return out;
}
export const CLEANUPS = {
  trim: 'Bỏ khoảng trắng thừa', title: 'Viết Hoa Mỗi Từ', sentence: 'Viết hoa chữ đầu', upper: 'VIẾT HOA HẾT', lower: 'viết thường hết',
  mojibake: 'Sửa lỗi font / mã hoá (Ã¡ → á)', junk: 'Xoá URL & rác (www…, [mp3], Official Video)', feat: 'Tách “feat.” ra nghệ sĩ',
  number: 'Số bài từ tên tệp', titleFromName: 'Tên bài từ tên tệp',
};
