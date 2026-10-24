// Books data layer. A book = one `items` row (type 'book', moduleId 'books': what the Library
// shows, filters and counts) + one `books` row (key = itemId) with the book detail. Authors and
// series ids come from the normalised name so every device produces the same ids.
// Every write emits bus 'books:changed' (Books pages refresh) and 'item:changed' (Library refresh).
import { db, uid, now, logActivity, softDeleteItem } from '../../../core/db.js';
import { bus } from '../../../core/bus.js';
import { thisDevice } from '../../../core/device.js';
import { storage } from '../../../core/storage/index.js';
import { cached, cmpVi } from '../../../core/perf.js';
import { formatOf } from './formats.js';

export const STATUSES = {
  want: 'Muốn đọc',
  reading: 'Đang đọc',
  finished: 'Đã đọc',
  onhold: 'Tạm dừng',
  dnf: 'Bỏ dở',
};
// Library-wide status (core/content-types.js STATUS) that matches each reading status.
const HUB_STATUS = { want: 'new', reading: 'in-progress', onhold: 'in-progress', finished: 'done', dnf: 'done' };
const FROM_HUB = { new: 'want', 'in-progress': 'reading', done: 'finished' };

// StoryGraph-style vocabularies (free text is allowed too: these are the suggestions).
export const MOODS = {
  adventurous: 'Phiêu lưu', challenging: 'Thử thách', dark: 'U tối', emotional: 'Cảm xúc', funny: 'Hài hước',
  hopeful: 'Hy vọng', informative: 'Bổ ích', inspiring: 'Truyền cảm hứng', lighthearted: 'Nhẹ nhàng',
  mysterious: 'Bí ẩn', reflective: 'Suy ngẫm', relaxing: 'Thư giãn', sad: 'Buồn', tense: 'Căng thẳng',
};
export const PACES = { slow: 'Chậm', medium: 'Vừa', fast: 'Nhanh' };
export const DNF_REASONS = ['Chán, không cuốn', 'Văn phong không hợp', 'Nội dung khó chịu', 'Quá dài', 'Không có thời gian', 'Đọc lại sau'];
export const COLORS = { yellow: '#f5d142', green: '#7fd47f', blue: '#7ab8f5', pink: '#f59ac1', purple: '#b99af5', orange: '#f5ad6b' };

export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
export const authorId = (name) => 'au:' + slug(name);
export const seriesId = (name) => 'se:' + slug(name);
// "Nguyễn Nhật Ánh" -> sort key "anh nguyen nhat" (last word first, as library catalogues do).
export const authorSort = (name) => { const p = fold(name).split(/\s+/); return p.length > 1 ? [p.pop(), ...p].join(' ') : p[0] || ''; };
export const splitNames = (s) => (Array.isArray(s) ? s : String(s || '').split(/\s*[;&,]\s*|\s+(?:and|và)\s+/)).map(x => String(x).trim()).filter(Boolean);

export const changed = (ids = []) => { snapshot.invalidate(); bus.emit('books:changed', { ids }); bus.emit('item:changed', { ids, source: 'books' }); };

// ── Snapshot (everything the pages need, joined once, cached until the next change) ──
export const snapshot = cached(async () => {
  const [items, books, authors, series, shelves, prog] = await Promise.all([
    // Fanfics published from Xưởng Viết are read here too: they have a books row with format 'fanfic' (docs/FANFIC.md).
    db.items.where('type').anyOf('book', 'fanfic').toArray().then(r => r.filter(i => !i.deleted)),   // no Dexie .filter(): a cursor is ~5x slower
    db.books.toArray(), db.authors.toArray(), db.series.toArray(),
    db.collections.where('moduleId').equals('books').toArray().then(r => r.filter(c => !c.deleted)),
    db.progress.where('moduleId').anyOf('books', 'fanfic').toArray(),
  ]);
  // Only the books' own files (the files table also holds every music track).
  const files = items.length ? await db.files.where('itemId').anyOf(items.map(i => i.id)).toArray() : [];
  const bookBy = new Map(books.map(b => [b.itemId, b]));
  const A = new Map(authors.filter(a => !a.deleted).map(a => [a.id, a]));
  const S = new Map(series.filter(s => !s.deleted).map(s => [s.id, s]));
  const P = new Map(prog.map(p => [p.itemId, p]));
  const F = new Map();
  for (const f of files) { if (!F.has(f.itemId)) F.set(f.itemId, []); F.get(f.itemId).push(f); }
  const list = [];
  for (const item of items) {
    const book = bookBy.get(item.id);
    if (!book || book.deleted) continue;
    list.push(view(item, book, { A, S, P, F }));
  }
  const byId = new Map(list.map(v => [v.id, v]));
  // Group once (filtering the whole list per author was authors × books).
  const byAuthor = new Map(), bySeries = new Map();
  const push = (M, k, v) => { let a = M.get(k); if (!a) M.set(k, a = []); a.push(v); };
  for (const v of list) {
    for (const id of new Set(v.book.authorIds || [])) push(byAuthor, id, v);
    if (v.book.seriesId) push(bySeries, v.book.seriesId, v);
  }
  const authorsList = [...A.values()].filter(a => byAuthor.has(a.id)).map(a => ({ ...a, books: byAuthor.get(a.id) })).sort((x, y) => cmpVi(x.sort || x.name, y.sort || y.name));
  const seriesList = [...S.values()].filter(s => bySeries.has(s.id)).map(s => ({ ...s, books: bySeries.get(s.id).sort((x, y) => (x.book.seriesIndex ?? 1e9) - (y.book.seriesIndex ?? 1e9)) })).sort((x, y) => cmpVi(x.name, y.name));
  return { list, byId, authors: A, series: S, authorsList, seriesList, shelves: shelves.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || cmpVi(a.name, b.name)) };
});
bus.on('progress:pulled', () => snapshot.invalidate());
bus.on('progress:changed', (p) => { if (p?.moduleId === 'books') snapshot.invalidate(); });
bus.on('sync:done', () => snapshot.invalidate());
bus.on('item:changed', (e) => { if (e?.source !== 'books') snapshot.invalidate(); });
bus.on('fanfic:changed', () => snapshot.invalidate());

// One joined object per book, used by every page.
export function view(item, book, { A, S, P, F }) {
  const files = F.get(item.id) || [];
  // A fanfic has no file: the reader builds it from Xưởng Viết's published chapters (virtual main file).
  const main = item.type === 'fanfic' ? { id: 'fanfic:' + item.id, virtual: 'fanfic', name: item.title + '.fanfic' } : book.parts?.length ? { id: 'volume:' + item.id, virtual: 'volume', name: item.title + '.volume' }
    : files.find(f => f.role === 'main') || null;
  const cover = files.find(f => f.role === 'cover') || null;
  const p = P.get(item.id) || null;
  const authors = (book.authorIds || []).map(id => A.get(id)?.name).filter(Boolean);
  return {
    id: item.id, item, book, title: item.title, authors,
    series: book.seriesId ? S.get(book.seriesId)?.name || '' : '', seriesIndex: book.seriesIndex ?? null,
    status: book.status || 'want', rating: book.rating || 0, format: book.format || (main ? formatOf(main.name) : book.physical ? 'paper' : ''),
    main, cover, files, progress: p, percent: book.status === 'finished' ? 100 : Math.round(p?.percent || book.manualPercent || 0),
    pages: book.pages || 0, favorite: !!item.favorite, tags: item.tags || [], fanfic: item.type === 'fanfic',
    parts: book.parts || null, partOf: book.partOf || null,
  };
}

export async function get(id) { return (await snapshot()).byId.get(id) || null; }

// ── Authors / series ─────────────────────────────────────────────
export async function ensureAuthors(names) {
  const ids = [];
  for (const name of splitNames(names)) {
    const id = authorId(name);
    if (!(await db.authors.get(id))) await db.authors.put({ id, name, sort: authorSort(name), createdAt: now(), deleted: 0 });
    ids.push(id);
  }
  return [...new Set(ids)];
}
export async function ensureSeries(name) {
  if (!String(name || '').trim()) return null;
  const id = seriesId(name);
  if (!(await db.series.get(id))) await db.series.put({ id, name: String(name).trim(), createdAt: now(), deleted: 0 });
  return id;
}
export async function updateAuthor(id, patch) {
  if (patch.name) patch.sort = authorSort(patch.name);
  await db.authors.update(id, patch);
  if (patch.name) for (const b of await db.books.where('authorIds').equals(id).toArray()) {
    const names = (await db.authors.bulkGet(b.authorIds || [])).filter(Boolean).map(a => a.name);
    await db.items.update(b.itemId, { subtitle: names.join(', ') });
  }
  changed();
}
export async function updateSeries(id, patch) { await db.series.update(id, patch); changed(); }

// ── Books ────────────────────────────────────────────────────────
// Fields that live on the item (shared with the Library) vs on the book row.
const ITEM_KEYS = ['title', 'tags', 'favorite'];

export async function createBook(data = {}, { file = null, quiet = false } = {}) {
  const id = data.id || uid();
  const authorIds = await ensureAuthors(data.authors || []);
  const sid = await ensureSeries(data.series);
  const status = data.status || 'want';
  const item = {
    id, type: 'book', moduleId: 'books', title: data.title || 'Không tên', subtitle: splitNames(data.authors || []).join(', '),
    tags: data.tags || [], status: HUB_STATUS[status], favorite: data.favorite ? 1 : 0, deleted: 0, rating: data.rating || 0,
    createdAt: data.addedAt || now(), meta: { pages: data.pages || null, format: data.format || null },
  };
  const book = {
    itemId: id, authorIds, seriesId: sid, seriesIndex: data.seriesIndex ?? null, status,
    rating: data.rating || 0, isbn: data.isbn || '', identifiers: data.identifiers || {},
    publisher: data.publisher || '', published: data.published || '', language: data.language || '', description: data.description || '',
    pages: data.pages || 0, words: data.words || 0, format: data.format || '', physical: data.physical ? 1 : 0, coverUrl: data.coverUrl || '',
    genres: data.genres || [], moods: data.moods || [], pace: data.pace || '', cw: data.cw || [], shelfIds: data.shelfIds || [],
    review: data.review || '', notes: data.notes || '', dnfReason: data.dnfReason || '', custom: data.custom || {},
    reads: data.reads || [], readCount: data.readCount || (status === 'finished' ? 1 : 0),
    addedAt: data.addedAt || now(), startedAt: data.startedAt || (status === 'reading' ? now() : null), finishedAt: data.finishedAt || null,
    source: data.source || '', deleted: 0,
  };
  await db.transaction('rw', db.items, db.books, async () => { await db.items.put(item); await db.books.put(book); });
  if (file) await logActivity(id, 'books', 'import');
  if (!quiet) changed([id]);
  return id;
}

export async function updateBook(id, patch) {
  const book = await db.books.get(id);
  if (!book) return;
  const itemPatch = {}, bookPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'authors') { bookPatch.authorIds = await ensureAuthors(v); itemPatch.subtitle = splitNames(v).join(', '); }
    else if (k === 'series') bookPatch.seriesId = await ensureSeries(v);
    else if (k === 'status') continue;
    else if (ITEM_KEYS.includes(k)) itemPatch[k] = k === 'favorite' ? (v ? 1 : 0) : v;
    else bookPatch[k] = v;
  }
  if ('rating' in patch) itemPatch.rating = patch.rating;
  if ('pages' in patch || 'format' in patch) {
    const item = await db.items.get(id);
    itemPatch.meta = { ...(item?.meta || {}), ...('pages' in patch ? { pages: patch.pages } : {}), ...('format' in patch ? { format: patch.format } : {}) };
  }
  if ('status' in patch && patch.status !== book.status) { Object.assign(bookPatch, statusPatch(book, patch.status, patch)); itemPatch.status = HUB_STATUS[patch.status]; }
  await db.transaction('rw', db.items, db.books, async () => {
    if (Object.keys(itemPatch).length) await db.items.update(id, itemPatch);
    if (Object.keys(bookPatch).length) await db.books.update(id, bookPatch);
  });
  if (patch.status === 'finished' && patch.status !== book.status) await logActivity(id, 'books', 'finish');
  changed([id]);
}

// Bulk edit (same patch on many books). Lists can be merged instead of replaced.
export async function bulkUpdate(ids, patch, { addTags = [], removeTags = [], addShelves = [], removeShelves = [] } = {}) {
  for (const id of ids) {
    const item = await db.items.get(id), book = await db.books.get(id);
    if (!item || !book) continue;
    const p = { ...patch };
    if (addTags.length || removeTags.length) p.tags = [...new Set([...(item.tags || []), ...addTags])].filter(t => !removeTags.includes(t));
    if (addShelves.length || removeShelves.length) p.shelfIds = [...new Set([...(book.shelfIds || []), ...addShelves])].filter(s => !removeShelves.includes(s));
    await updateBook(id, p);
  }
}

// Dates and history that go with a status change.
function statusPatch(book, status, extra = {}) {
  const t = now(), out = { status };
  if (status === 'reading') { out.startedAt = book.status === 'finished' || !book.startedAt ? t : book.startedAt; out.dnfReason = ''; }
  if (status === 'finished') {
    out.finishedAt = extra.finishedAt || t;
    out.readCount = (book.readCount || 0) + 1;
    out.reads = [...(book.reads || []), { start: book.startedAt || null, end: out.finishedAt }];
  }
  if (status === 'dnf') {
    out.dnfAt = t; out.dnfReason = extra.dnfReason ?? book.dnfReason ?? '';
    out.reads = [...(book.reads || []), { start: book.startedAt || null, end: t, dnf: 1 }];
  }
  if (status === 'want') out.startedAt = null;
  return out;
}

export async function setStatus(id, status, extra = {}) { await updateBook(id, { ...extra, status }); }

export async function removeBooks(ids, { files = true } = {}) {
  for (const id of ids) {
    const it = await db.items.get(id);
    // A volume owns no file: deleting it only frees its chapter books.
    const row = await db.books.get(id);
    if (row?.parts?.length) { await ungroupParts(row.parts, id); await softDeleteItem(id); await db.books.update(id, { deleted: 1 }); continue; }
    if (it?.type === 'fanfic') {
      await db.books.update(id, { deleted: 1 });
      await db.fanfics.update(id, { published: 0 });
      await db.items.update(id, { meta: { ...(it.meta || {}), published: 0 } });
      continue;
    }
    if (files) for (const f of await db.files.where('itemId').equals(id).toArray()) await storage.removeFile(f).catch(() => {});
    await softDeleteItem(id);
    await db.books.update(id, { deleted: 1 });
  }
  changed(ids);
}

// ── Volumes: chapter books (one uploaded file per chapter) joined into one readable book ──
async function ungroupParts(parts, volId) {
  for (const p of parts) { const r = await db.books.get(p); if (r && r.partOf === volId) await db.books.update(p, { partOf: null }); }
}
export async function createVolume(title, parts, { authors = [], series = '' } = {}) {
  const id = await createBook({ title, authors, series, format: 'volume' }, { quiet: true });
  await setVolumeParts(id, parts);
  return id;
}
export async function setVolumeParts(id, parts) {
  const old = (await db.books.get(id))?.parts || [];
  await ungroupParts(old.filter(p => !parts.includes(p)), id);
  for (const p of parts) await db.books.update(p, { partOf: id });
  await db.books.update(id, { parts });
  changed([id, ...parts, ...old]);
}
export async function ungroupVolume(id) {
  const row = await db.books.get(id);
  if (row?.parts) await ungroupParts(row.parts, id);
  await softDeleteItem(id); await db.books.update(id, { deleted: 1 });
  changed([id, ...(row?.parts || [])]);
}

// Older installs filed books under the planned 'reader' module, and the Library's own import
// creates book items without a books row: give every book item a row (run at start, cheap).
export async function ensureRows() {
  const items = (await db.items.where('type').equals('book').toArray()).filter(i => !i.deleted);
  const have = new Set(await db.books.toCollection().primaryKeys());
  let n = 0;
  for (const i of items) {
    if (i.moduleId !== 'books') await db.items.update(i.id, { moduleId: 'books' });
    if (have.has(i.id)) continue;
    const f = await db.files.where('itemId').equals(i.id).first();
    await db.books.put({ itemId: i.id, authorIds: await ensureAuthors(i.subtitle || ''), seriesId: null, status: FROM_HUB[i.status] || 'want',
      rating: i.rating || 0, format: f ? formatOf(f.name) : '', pages: i.meta?.pages || 0, genres: [], moods: [], cw: [], shelfIds: [], reads: [],
      addedAt: i.createdAt || now(), physical: f ? 0 : 1, deleted: 0, needsMeta: f ? 1 : 0 });
    n++;
  }
  if (n) changed();
  return n;
}

// ── Shelves, smart shelves (saved searches), virtual libraries ───
// kind: 'book-shelf' (hand-picked), 'book-smart' (query), 'book-library' (query that scopes every page).
export async function createShelf(name, kind = 'book-shelf', { query = '' } = {}) {
  const id = uid();
  await db.collections.put({ id, kind, moduleId: 'books', name, query, order: now(), deleted: 0, createdAt: now() });
  changed();
  return id;
}
export async function updateShelf(id, patch) { await db.collections.update(id, patch); changed(); }
export async function deleteShelf(id) {
  await db.collections.update(id, { deleted: 1 });
  for (const b of await db.books.where('shelfIds').equals(id).toArray()) await db.books.update(b.itemId, { shelfIds: b.shelfIds.filter(s => s !== id) });
  changed();
}
export async function toggleShelf(ids, shelfId, on) {
  for (const id of ids) {
    const b = await db.books.get(id);
    if (!b) continue;
    const set = new Set(b.shelfIds || []);
    if (on ?? !set.has(shelfId)) set.add(shelfId); else set.delete(shelfId);
    await db.books.update(id, { shelfIds: [...set] });
  }
  changed(ids);
}
// Default shelves on first use (renameable / removable).
export async function ensureDefaultShelves() {
  if (await db.collections.where('moduleId').equals('books').count()) return;
  for (const [name, kind, query] of [['Yêu thích', 'book-smart', 'is:fav'], ['TBR', 'book-shelf', ''], ['Đọc lại', 'book-shelf', ''], ['5 sao', 'book-smart', 'rating:>=5']])
    await createShelf(name, kind, { query });
}

// ── Annotations (highlight | underline | note | bookmark) ────────
export const annotations = {
  list: (itemId) => db.annotations.where('itemId').equals(itemId).filter(a => !a.deleted).toArray().then(r => r.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0) || a.createdAt - b.createdAt)),
  all: () => db.annotations.toArray().then(r => r.filter(a => !a.deleted)),
  async add(row) { const a = { id: uid(), createdAt: now(), deleted: 0, color: 'yellow', ...row }; await db.annotations.put(a); bus.emit('books:annotations', { itemId: a.itemId }); return a; },
  async update(id, patch) { await db.annotations.update(id, patch); const a = await db.annotations.get(id); bus.emit('books:annotations', { itemId: a?.itemId }); },
  async remove(id) { const a = await db.annotations.get(id); await db.annotations.update(id, { deleted: 1 }); bus.emit('books:annotations', { itemId: a?.itemId }); },
};

// ── Reading sessions ─────────────────────────────────────────────
// { itemId, start, end, seconds (active), from, to (percent), pages, words, source: 'reader'|'timer'|'manual' }
export async function saveSession(row) {
  const dev = await thisDevice();
  const s = { id: row.id || uid(), deviceId: dev.id, ...row };
  await db.readingSessions.put(s);
  bus.emit('books:session', s);
  return s;
}
export const sessionsOf = (itemId) => db.readingSessions.where('itemId').equals(itemId).toArray().then(r => r.sort((a, b) => b.start - a.start));
export const allSessions = () => db.readingSessions.toArray();
export async function removeSession(id) { await db.readingSessions.delete(id); bus.emit('books:session', { id }); }

// ── Goals & challenges ───────────────────────────────────────────
// { id, year, month?, kind: 'books'|'pages'|'hours', target, label?, query? (challenge: only books matching it count) }
export const goals = {
  list: () => db.readingGoals.toArray(),
  async put(g) { const row = { id: g.id || uid(), createdAt: now(), ...g }; await db.readingGoals.put(row); bus.emit('books:changed', {}); return row; },
  async remove(id) { await db.readingGoals.delete(id); bus.emit('books:changed', {}); },
};
