// Online metadata: Open Library + Google Books (both free, no key, CORS-enabled).
// lookup({ isbn }) or lookup({ title, author }) -> candidates
//   [{ source, title, authors, isbn, pages, published, publisher, description, genres, language, coverUrl }]
// Not here, on purpose: Goodreads has no public API any more (use its CSV export → Nhập);
// PHASE 2: Comic Vine needs an API key and blocks browser requests (needs a small proxy).
const OL = 'https://openlibrary.org';
const GB = 'https://www.googleapis.com/books/v1/volumes';
// Tiki (Vietnamese bookshop) has the best data for Vietnamese books, but searches by title only (no ISBN field).
// Its API allows no CORS: the Windows / Android apps call it through the shell (core/storage/http.js).
const TIKI = 'https://tiki.vn/api/v2/products';

async function getJson(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${new URL(url).host}: ${r.status}`);
  return r.json();
}
const cleanIsbn = (s) => String(s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
export const validIsbn = (s) => { const x = cleanIsbn(s); return x.length === 13 || x.length === 10 ? x : ''; };

export function isbn10to13(s) {
  const x = cleanIsbn(s);
  if (x.length !== 10) return x;
  const core = '978' + x.slice(0, 9);
  const sum = [...core].reduce((a, d, i) => a + (+d) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - sum % 10) % 10);
}

async function openLibrary({ isbn, title, author }, signal) {
  if (isbn) {
    const j = await getJson(`${OL}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, signal);
    const d = j[`ISBN:${isbn}`];
    if (!d) return [];
    return [{
      source: 'Open Library', title: d.title + (d.subtitle ? ': ' + d.subtitle : ''), authors: (d.authors || []).map(a => a.name),
      isbn, pages: d.number_of_pages || 0, published: d.publish_date || '', publisher: (d.publishers || []).map(p => p.name).join(', '),
      description: typeof d.notes === 'string' ? d.notes : d.notes?.value || '', genres: (d.subjects || []).slice(0, 8).map(s => s.name),
      coverUrl: d.cover?.large || d.cover?.medium || '', url: d.url || '',
    }];
  }
  const q = new URLSearchParams({ limit: '8', fields: 'key,title,subtitle,author_name,first_publish_year,isbn,number_of_pages_median,subject,cover_i,language,publisher' });
  if (title) q.set('title', title);
  if (author) q.set('author', author);
  const j = await getJson(`${OL}/search.json?${q}`, signal);
  return (j.docs || []).map(d => ({
    source: 'Open Library', title: d.title + (d.subtitle ? ': ' + d.subtitle : ''), authors: d.author_name || [],
    isbn: (d.isbn || []).find(x => x.length === 13) || (d.isbn || [])[0] || '', pages: d.number_of_pages_median || 0,
    published: d.first_publish_year ? String(d.first_publish_year) : '', publisher: (d.publisher || [])[0] || '',
    genres: (d.subject || []).slice(0, 8), language: (d.language || [])[0] || '',
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '', url: OL + d.key,
  }));
}

async function googleBooks({ isbn, title, author }, signal) {
  const q = isbn ? `isbn:${isbn}` : [title && `intitle:${title}`, author && `inauthor:${author}`].filter(Boolean).join('+');
  if (!q) return [];
  const j = await getJson(`${GB}?q=${encodeURIComponent(q)}&maxResults=8&printType=books`, signal);
  return (j.items || []).map(({ volumeInfo: v = {}, id }) => {
    const ids = v.industryIdentifiers || [];
    const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '';
    return {
      source: 'Google Books', title: v.title + (v.subtitle ? ': ' + v.subtitle : ''), authors: v.authors || [],
      isbn: ids.find(i => i.type === 'ISBN_13')?.identifier || ids.find(i => i.type === 'ISBN_10')?.identifier || '',
      pages: v.pageCount || 0, published: v.publishedDate || '', publisher: v.publisher || '', description: v.description || '',
      genres: v.categories || [], language: v.language || '',
      coverUrl: img.replace(/^http:/, 'https:').replace('&edge=curl', ''), url: v.infoLink || `https://books.google.com/books?id=${id}`,
    };
  });
}

async function tikiJson(url, signal) {
  const { http, nativeShell } = await import('../../../core/storage/http.js');
  const r = await http(url, { signal, viaShell: nativeShell(), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`tiki.vn: ${r.status}`);
  return JSON.parse(await r.text());
}
const strip = (html) => { const d = new DOMParser().parseFromString(String(html || ''), 'text/html'); return d.body.textContent.replace(/\s+\n/g, '\n').trim(); };
export async function tiki({ title, author }, signal) {
  const q = [title, author].filter(Boolean).join(' ');
  if (!q) return [];
  const j = await tikiJson(`${TIKI}?limit=8&q=${encodeURIComponent(q)}`, signal);
  // Only books (Tiki also sells bookmarks, covers…); details for the first few: author, publisher, pages, description.
  const hits = (j.data || []).filter(p => /sách|book|truyện/i.test(p.primary_category_path || p.primary_category_name || '') || p.brand_name).slice(0, 5);
  const out = await Promise.all(hits.map(async (p) => {
    let d = {};
    try { d = await tikiJson(`${TIKI}/${p.id}`, signal); } catch {}
    const spec = {};
    for (const g of d.specifications || []) for (const a of g.attributes || []) spec[a.name] = a.value;
    const authors = (d.authors || []).map(a => a.name).filter(Boolean);
    return {
      source: 'Tiki', title: String(d.name || p.name || '').replace(/^Sách\s+/i, ''), authors: authors.length ? authors : (p.brand_name && !/^oem$/i.test(p.brand_name) ? [p.brand_name] : []),
      isbn: '', pages: +spec['Số trang'] || 0, published: String(spec['Ngày xuất bản'] || '').slice(0, 10),
      publisher: spec['Nhà xuất bản'] || spec['Công ty phát hành'] || '', description: strip(d.description).slice(0, 4000),
      genres: [], language: 'vi', coverUrl: d.images?.[0]?.base_url || p.thumbnail_url || '', url: 'https://tiki.vn/' + (p.url_path || ''),
    };
  }));
  return out.filter(c => c.title);
}

// Both sources in parallel; a source that fails (offline, rate limit) is skipped.
export async function lookup({ isbn = '', title = '', author = '' } = {}, { signal } = {}) {
  isbn = validIsbn(isbn);
  if (isbn.length === 10) isbn = isbn10to13(isbn);
  const args = { isbn, title: isbn ? '' : title, author: isbn ? '' : author };
  const res = await Promise.allSettled([openLibrary(args, signal), googleBooks(args, signal), args.title ? tiki(args, signal) : Promise.resolve([])]);
  let out = res.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  // Vietnamese titles: Tiki first (Open Library / Google Books rarely have Vietnamese editions).
  if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(args.title + args.author)) out = [...out.filter(c => c.source === 'Tiki'), ...out.filter(c => c.source !== 'Tiki')];
  if (!out.length && res.every(r => r.status === 'rejected')) throw res[0].reason;
  return out;
}

// Merge candidates for one book into a single best record (first non-empty value wins; longest description).
export function merge(cands) {
  const pick = (k) => cands.map(c => c[k]).find(v => Array.isArray(v) ? v.length : v);
  return {
    title: pick('title'), authors: pick('authors') || [], isbn: pick('isbn'), pages: pick('pages'), published: pick('published'),
    publisher: pick('publisher'), language: pick('language'), genres: pick('genres') || [], coverUrl: pick('coverUrl'),
    description: cands.map(c => c.description || '').sort((a, b) => b.length - a.length)[0] || '',
  };
}

// Cover image as a Blob (null if the host refuses cross-origin reads; the URL is kept then).
export async function fetchCover(url, signal) {
  if (!url) return null;
  try { const r = await fetch(url, { signal }); if (!r.ok) return null; const b = await r.blob(); return b.size > 1000 && b.type.startsWith('image/') ? b : null; }
  catch { return null; }
}
