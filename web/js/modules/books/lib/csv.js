// CSV import / export: Goodreads, StoryGraph and a generic CSV (same columns as our export).
// parseCsv(text) -> { headers, rows }. detect(headers) -> 'goodreads'|'storygraph'|'generic'.
// toRecords(rows, kind) -> book records for store.createBook / updateBook.
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return { headers: [], rows: [] };
  const headers = head.map(h => h.trim());
  return { headers, rows: body.map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

export function detect(headers) {
  if (headers.includes('Exclusive Shelf') || headers.includes('Author l-f')) return 'goodreads';
  if (headers.includes('Read Status') && headers.includes('Moods')) return 'storygraph';
  return 'generic';
}

const isbnOf = (s) => String(s || '').replace(/^="?|"$/g, '').replace(/[^0-9Xx]/g, '');
const date = (s) => { if (!s) return null; const t = Date.parse(String(s).replace(/\//g, '-')); return isNaN(t) ? null : t; };
const list = (s) => String(s || '').split(/\s*[,;|]\s*/).map(x => x.trim()).filter(Boolean);
// "The Hunger Games (The Hunger Games, #1)" -> title + series + index
function splitSeries(title) {
  const m = /^(.*?)\s*\(([^()]+?),?\s*#(\d+(?:\.\d+)?)\)\s*$/.exec(title);
  return m ? { title: m[1], series: m[2].trim(), seriesIndex: parseFloat(m[3]) } : { title };
}

const GR_STATUS = { 'to-read': 'want', 'currently-reading': 'reading', read: 'finished' };
const SG_STATUS = { 'to-read': 'want', 'currently-reading': 'reading', read: 'finished', 'did-not-finish': 'dnf', paused: 'onhold' };

export function toRecords(rows, kind) {
  if (kind === 'goodreads') return rows.map(r => {
    const status = GR_STATUS[r['Exclusive Shelf']] || 'want';
    return {
      ...splitSeries(r['Title'] || ''), authors: [r['Author'], ...list(r['Additional Authors'])].filter(Boolean),
      isbn: isbnOf(r['ISBN13']) || isbnOf(r['ISBN']), rating: +r['My Rating'] || 0, publisher: r['Publisher'] || '',
      pages: +r['Number of Pages'] || 0, published: r['Original Publication Year'] || r['Year Published'] || '',
      finishedAt: date(r['Date Read']), addedAt: date(r['Date Added']) || Date.now(), status,
      review: r['My Review'] || '', notes: r['Private Notes'] || '', readCount: +r['Read Count'] || (status === 'finished' ? 1 : 0),
      physical: /hardcover|paperback|mass market/i.test(r['Binding'] || '') ? 1 : 0, shelfNames: list(r['Bookshelves']).filter(s => !GR_STATUS[s]),
      custom: r['Book Id'] ? { goodreadsId: r['Book Id'] } : {}, source: 'goodreads',
    };
  });
  if (kind === 'storygraph') return rows.map(r => ({
    ...splitSeries(r['Title'] || ''), authors: list(r['Authors']), isbn: isbnOf(r['ISBN/UID']),
    status: SG_STATUS[r['Read Status']] || 'want', rating: +r['Star Rating'] || 0, review: r['Review'] || '',
    moods: list(r['Moods']), pace: (r['Pace'] || '').toLowerCase(), cw: list(r['Content Warnings']),
    tags: list(r['Tags']), finishedAt: date(r['Last Date Read']), addedAt: date(r['Date Added']) || Date.now(),
    readCount: +r['Read Count'] || 0, physical: /physical|paperback|hardcover/i.test(r['Format'] || '') ? 1 : 0,
    custom: r['Character- or Plot-Driven?'] ? { driven: r['Character- or Plot-Driven?'] } : {}, source: 'storygraph',
  }));
  return rows.map(r0 => {   // generic: our own export columns (case-insensitive)
    const r = Object.fromEntries(Object.entries(r0).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      title: r.title || '', authors: list(r.authors || r.author), series: r.series || '', seriesIndex: r['series index'] ? +r['series index'] : null,
      isbn: isbnOf(r.isbn), status: r.status || 'want', rating: +r.rating || 0, pages: +r.pages || 0, published: r.published || '',
      publisher: r.publisher || '', language: r.language || '', tags: list(r.tags), genres: list(r.genres), moods: list(r.moods), pace: r.pace || '',
      review: r.review || '', notes: r.notes || '', finishedAt: date(r.finished), startedAt: date(r.started), addedAt: date(r.added) || Date.now(),
      shelfNames: list(r.shelves), physical: /^(1|yes|true|có)$/i.test(r.physical || '') ? 1 : 0, source: 'csv',
    };
  });
}

const cell = (v) => { const s = Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const iso = (t) => t ? new Date(t).toISOString().slice(0, 10) : '';

// Our CSV (re-importable as 'generic').
export function exportCsv(views, shelfName = (id) => id) {
  const H = ['Title', 'Authors', 'Series', 'Series Index', 'ISBN', 'Status', 'Rating', 'Pages', 'Format', 'Published', 'Publisher', 'Language',
    'Tags', 'Genres', 'Moods', 'Pace', 'Shelves', 'Started', 'Finished', 'Added', 'Read Count', 'Physical', 'Review', 'Notes'];
  const lines = [H.join(',')];
  for (const b of views) lines.push([b.title, b.authors, b.series, b.seriesIndex ?? '', b.book.isbn, b.status, b.rating, b.pages, b.format, b.book.published,
    b.book.publisher, b.book.language, b.tags, b.book.genres, b.book.moods, b.book.pace, (b.book.shelfIds || []).map(shelfName), iso(b.book.startedAt),
    iso(b.book.finishedAt), iso(b.book.addedAt), b.book.readCount || 0, b.book.physical ? 1 : 0, b.book.review, b.book.notes].map(cell).join(','));
  return lines.join('\r\n');
}

// Goodreads-compatible CSV (importable on Goodreads / StoryGraph).
export function exportGoodreads(views) {
  const H = ['Title', 'Author', 'Additional Authors', 'ISBN13', 'My Rating', 'Publisher', 'Number of Pages', 'Year Published', 'Date Read', 'Date Added', 'Bookshelves', 'Exclusive Shelf', 'My Review', 'Private Notes', 'Read Count'];
  const shelf = { want: 'to-read', reading: 'currently-reading', finished: 'read', dnf: 'to-read', onhold: 'to-read' };
  const d = (t) => t ? new Date(t).toISOString().slice(0, 10).replace(/-/g, '/') : '';
  const lines = [H.join(',')];
  for (const b of views) lines.push([b.series ? `${b.title} (${b.series}, #${b.seriesIndex ?? 1})` : b.title, b.authors[0] || '', b.authors.slice(1),
    b.book.isbn ? `="${b.book.isbn}"` : '', Math.round(b.rating), b.book.publisher, b.pages || '', parseInt(b.book.published) || '', d(b.book.finishedAt),
    d(b.book.addedAt), b.tags, shelf[b.status], b.book.review, b.book.notes, b.book.readCount || 0].map(cell).join(','));
  return lines.join('\r\n');
}
