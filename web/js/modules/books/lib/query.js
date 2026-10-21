// Advanced search for books (Calibre-like):
//   dune author:herbert tag:"khoa học viễn tưởng" rating:>=4 status:reading format:epub
//   series:dune pages:>300 year:2024 lang:en shelf:TBR mood:dark pace:fast genre:fantasy
//   is:fav  is:physical  is:ebook  is:unread  has:file  has:cover  has:review  has:isbn  has:notes
//   -tag:manga  (minus = NOT)   "cụm từ chính xác"   field:=exact   added:<30d   read:>2023-06-01
// Free words match title, authors, series, tags, ISBN, publisher and genres (accent-insensitive).
// Searching inside one book's text runs in the reader. PHASE 2: a library-wide full-text index.
import { fold } from './store.js';

const STATUS_ALIASES = { want: 'want', tbr: 'want', 'muon-doc': 'want', reading: 'reading', 'dang-doc': 'reading', current: 'reading',
  finished: 'finished', read: 'finished', done: 'finished', 'da-doc': 'finished', dnf: 'dnf', 'bo-do': 'dnf', onhold: 'onhold', hold: 'onhold', 'tam-dung': 'onhold' };

export function tokenize(q) {
  const out = [];
  const re = /(-)?(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/gi;
  let m;
  while ((m = re.exec(q))) {
    const [, neg, field, quoted, bare] = m;
    const value = quoted ?? bare ?? '';
    if (!field && !value) continue;
    out.push({ neg: !!neg, field: field?.toLowerCase() || '', value, exact: quoted != null });
  }
  return out;
}

// Numeric compare: ">=4", "<300", "4", "3..5"
function cmpNum(spec, n) {
  const r = /^(\d+(?:\.\d+)?)\.\.(\d+(?:\.\d+)?)$/.exec(spec);
  if (r) return n >= +r[1] && n <= +r[2];
  const m = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)$/.exec(spec);
  if (!m) return false;
  const v = +m[2];
  switch (m[1]) { case '>=': return n >= v; case '<=': return n <= v; case '>': return n > v; case '<': return n < v; default: return n === v; }
}
// Date compare: "2024", "2024-05", ">2023-06-01", "<30d" (within the last 30 days)
function cmpDate(spec, ts) {
  if (!ts) return false;
  const m = /^(>=|<=|>|<)?(.+)$/.exec(spec);
  const op = m[1], v = m[2];
  const rel = /^(\d+)([dwmy])$/.exec(v);
  if (rel) {
    const ms = { d: 864e5, w: 6048e5, m: 2592e6, y: 31536e6 }[rel[2]] * +rel[1];
    const age = Date.now() - ts;
    return op === '>' || op === '>=' ? age > ms : age <= ms;
  }
  if (!op) return new Date(ts).toISOString().startsWith(v);
  const t = Date.parse(v.length === 4 ? v + '-01-01' : v.length === 7 ? v + '-01' : v);
  switch (op) { case '>': return ts > t; case '>=': return ts >= t; case '<': return ts < t; default: return ts <= t; }
}

const has = (list, v, exact) => (list || []).some(x => exact ? fold(x) === v : fold(x).includes(v));

// Returns (bookView) => boolean.
export function compile(q, { shelves = [] } = {}) {
  const toks = tokenize(String(q || '').trim());
  if (!toks.length) return () => true;
  const shelfBy = (v) => shelves.filter(s => fold(s.name).includes(v)).map(s => s.id);
  const tests = toks.map(({ neg, field, value, exact }) => {
    let v = fold(value); const ex = exact || v.startsWith('=');
    if (v.startsWith('=')) v = v.slice(1);
    let t;
    switch (field) {
      case '': t = (b) => fold([b.title, ...b.authors, b.series, ...b.tags, b.book.isbn, b.book.publisher, ...(b.book.genres || [])].join(' \u0001 ')).includes(v); break;
      case 'title': t = (b) => ex ? fold(b.title) === v : fold(b.title).includes(v); break;
      case 'author': case 'by': t = (b) => has(b.authors, v, ex); break;
      case 'tag': t = (b) => has(b.tags, v, ex); break;
      case 'genre': t = (b) => has(b.book.genres, v, ex); break;
      case 'series': t = (b) => ex ? fold(b.series) === v : fold(b.series).includes(v); break;
      case 'status': { const s = STATUS_ALIASES[v.replace(/\s+/g, '-')] || v; t = (b) => b.status === s; break; }
      case 'format': case 'fmt': t = (b) => b.format === v; break;
      case 'lang': case 'language': t = (b) => fold(b.book.language).startsWith(v); break;
      case 'mood': t = (b) => has(b.book.moods, v, ex); break;
      case 'pace': t = (b) => fold(b.book.pace) === v; break;
      case 'cw': t = (b) => has(b.book.cw, v, ex); break;
      case 'publisher': t = (b) => fold(b.book.publisher).includes(v); break;
      case 'isbn': t = (b) => String(b.book.isbn || '').includes(value.replace(/-/g, '')); break;
      case 'rating': case 'stars': t = (b) => cmpNum(value, b.rating); break;
      case 'pages': t = (b) => cmpNum(value, b.pages); break;
      case 'progress': t = (b) => cmpNum(value.replace('%', ''), b.percent); break;
      case 'year': case 'read': case 'finished': t = (b) => cmpDate(value, b.book.finishedAt); break;
      case 'added': t = (b) => cmpDate(value, b.book.addedAt); break;
      case 'started': t = (b) => cmpDate(value, b.book.startedAt); break;
      case 'published': t = (b) => String(b.book.published || '').startsWith(value) || cmpNum(value, parseInt(b.book.published) || 0); break;
      case 'shelf': { const ids = shelfBy(v); t = (b) => (b.book.shelfIds || []).some(s => ids.includes(s)); break; }
      case 'is': t = {
        fav: (b) => b.favorite, favorite: (b) => b.favorite, physical: (b) => !!b.book.physical, paper: (b) => !!b.book.physical,
        ebook: (b) => !!b.main, unread: (b) => b.status === 'want', comic: (b) => ['cbz', 'cbr', 'cb7'].includes(b.format),
        reread: (b) => (b.book.readCount || 0) > 1,
      }[v] || (() => false); break;
      case 'has': t = {
        file: (b) => !!b.main, cover: (b) => !!(b.cover || b.book.coverUrl), review: (b) => !!b.book.review, notes: (b) => !!b.book.notes,
        isbn: (b) => !!b.book.isbn, series: (b) => !!b.series, rating: (b) => b.rating > 0, description: (b) => !!b.book.description,
      }[v] || (() => false); break;
      default: t = (b) => fold(b.book.custom?.[field]).includes(v);   // custom column
    }
    return neg ? (b) => !t(b) : t;
  });
  return (b) => tests.every(t => t(b));
}

// Help text for the search box.
export const QUERY_HELP = [
  ['author:herbert', 'Tác giả'], ['tag:"kinh điển"', 'Thẻ (có dấu cách thì dùng ngoặc kép)'], ['rating:>=4', 'Số sao (>=, <, 3..5)'],
  ['status:reading', 'want · reading · finished · dnf · onhold'], ['format:epub', 'Định dạng'], ['series:dune', 'Bộ sách'],
  ['shelf:TBR', 'Kệ'], ['pages:>400', 'Số trang'], ['year:2025', 'Năm đọc xong'], ['added:<30d', 'Thêm trong 30 ngày'],
  ['mood:dark  pace:fast', 'Cảm xúc, nhịp đọc'], ['is:fav  is:physical  is:ebook', 'Yêu thích, sách giấy, sách điện tử'],
  ['has:review  has:isbn', 'Có nhận xét, có ISBN'], ['-tag:manga', 'Dấu trừ = loại trừ'],
];
