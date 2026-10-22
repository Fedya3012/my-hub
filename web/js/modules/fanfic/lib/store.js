// Xưởng Viết data layer. A fanfic = one `items` row (type 'fanfic', moduleId 'fanfic': what the Library shows)
// + one `fanfics` row (key = itemId) + its chapters/scenes in `ficChapters`. Fandom, character and relationship
// ids come from normalised names so every device produces the same ids (like Books authors/series).
// Every write emits bus 'fanfic:changed' (Xưởng Viết pages refresh) and 'item:changed' (Library, Books refresh).
import { db, uid, now, logActivity, softDeleteItem } from '../../../core/db.js';
import { bus } from '../../../core/bus.js';
import { thisDevice } from '../../../core/device.js';
import { cached, cmpVi } from '../../../core/perf.js';
import { HUB_STATUS } from './vocab.js';
import { countWords, mdToHtml, today } from './text.js';

export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
export const fandomId = (name) => 'fd:' + slug(name);
export const characterId = (fd, name) => `ch:${String(fd || 'fd:x').slice(3)}:${slug(name)}`;
export const relationshipId = (fd, name) => `rl:${String(fd || 'fd:x').slice(3)}:${slug(name.split(/\s*[/&]\s*/).sort().join('-'))}${name.includes('&') ? '-p' : ''}`;
export const splitList = (s) => (Array.isArray(s) ? s : String(s || '').split(/\s*[,;\n]\s*/)).map(x => String(x).trim()).filter(Boolean);

export const changed = (ids = []) => { snapshot.invalidate(); bus.emit('fanfic:changed', { ids }); bus.emit('item:changed', { ids, source: 'fanfic' }); };

// ── Snapshot: every fanfic joined with its fandoms, tags, chapter stats and reading progress ──
export const snapshot = cached(async () => {
  const [items, fics, chapters, fandoms, tags, series, prog] = await Promise.all([
    db.items.where('type').equals('fanfic').toArray().then(r => r.filter(i => !i.deleted)),
    db.fanfics.toArray(),
    db.ficChapters.toArray().then(r => r.filter(c => !c.deleted)),
    db.fandoms.toArray().then(r => r.filter(f => !f.deleted)),
    db.ficTags.toArray().then(r => r.filter(t => !t.deleted)),
    db.collections.where('kind').equals('fic-series').toArray().then(r => r.filter(c => !c.deleted)),
    db.progress.where('moduleId').equals('fanfic').toArray(),
  ]);
  const ficBy = new Map(fics.map(f => [f.itemId, f]));
  const F = new Map(fandoms.map(f => [f.id, f])), T = new Map(tags.map(t => [t.id, t])), S = new Map(series.map(s => [s.id, s]));
  const P = new Map(prog.map(p => [p.itemId, p]));
  const C = new Map();
  for (const c of chapters) { if (!C.has(c.fanficId)) C.set(c.fanficId, []); C.get(c.fanficId).push(c); }
  const list = [];
  for (const item of items) {
    const fic = ficBy.get(item.id);
    if (!fic || fic.deleted) continue;
    list.push(view(item, fic, (C.get(item.id) || []).sort(byOrder), { F, T, S, P }));
  }
  const byId = new Map(list.map(v => [v.id, v]));
  const byFandom = new Map();
  for (const v of list) for (const id of v.fic.fandomIds || []) { if (!byFandom.has(id)) byFandom.set(id, []); byFandom.get(id).push(v); }
  const fandomList = fandoms.map(f => ({ ...f, works: byFandom.get(f.id) || [] })).sort((a, b) => cmpVi(a.name, b.name));
  return { list, byId, fandoms: F, fandomList, tags: T, series: S };
});
bus.on('sync:done', () => snapshot.invalidate());
bus.on('progress:pulled', () => snapshot.invalidate());
bus.on('progress:changed', () => snapshot.invalidate());
bus.on('item:changed', (e) => { if (e?.source !== 'fanfic') snapshot.invalidate(); });

export const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

export function view(item, fic, chapters, { F, T, S, P }) {
  const tops = chapters.filter(c => !c.parentId);
  const words = chapters.reduce((a, c) => a + (c.words || 0), 0);
  const p = P.get(item.id) || null;
  const pubChapters = tops.filter(c => c.pubAt);
  const dirty = fic.published ? chapters.some(c => (c.editedAt || 0) > (c.pubAt || 0)) : false;
  return {
    id: item.id, item, fic, title: item.title, chapters, tops,
    fandoms: (fic.fandomIds || []).map(id => F.get(id)).filter(Boolean),
    characters: (fic.characterIds || []).map(id => T.get(id)).filter(Boolean),
    relationships: (fic.relationshipIds || []).map(id => T.get(id)).filter(Boolean),
    series: fic.seriesId ? S.get(fic.seriesId) || null : null,
    tags: item.tags || [], status: fic.status || 'draft', audience: fic.audience || 'nr', origin: fic.origin || 'mine',
    words, chapterCount: tops.length, planned: fic.plannedChapters || null, published: !!fic.published, pubCount: pubChapters.length, dirty,
    progress: p, readPercent: Math.round(p?.percent || 0), favorite: !!item.favorite,
    editedAt: Math.max(fic.editedAt || 0, ...chapters.map(c => c.editedAt || 0)) || item.updatedAt || item.createdAt,
  };
}

export async function get(id) { return (await snapshot()).byId.get(id) || null; }

// ── Fandoms, characters, relationships ──
export async function ensureFandoms(names, extra = {}) {
  const ids = [];
  for (const name of splitList(names)) {
    const id = fandomId(name);
    if (!(await db.fandoms.get(id))) await db.fandoms.put({ id, name, kind: extra.kind || 'other', aliases: [], bookIds: [], bookSeriesIds: [], description: '', createdAt: now(), deleted: 0 });
    else if ((await db.fandoms.get(id)).deleted) await db.fandoms.update(id, { deleted: 0 });
    ids.push(id);
  }
  return [...new Set(ids)];
}
export async function updateFandom(id, patch) { await db.fandoms.update(id, patch); changed(); }
export async function removeFandom(id) {
  await db.fandoms.update(id, { deleted: 1 });
  for (const f of await db.fanfics.where('fandomIds').equals(id).toArray()) await db.fanfics.update(f.itemId, { fandomIds: f.fandomIds.filter(x => x !== id) });
  changed();
}
// Link a Books item (or a Books series) as the canon of a fandom: shows both ways (fandom page, book page).
export async function linkCanon(fdId, { bookId, seriesId }, on = true) {
  const f = await db.fandoms.get(fdId);
  if (!f) return;
  const edit = (arr, v) => v ? (on ? [...new Set([...(arr || []), v])] : (arr || []).filter(x => x !== v)) : (arr || []);
  await db.fandoms.update(fdId, { bookIds: edit(f.bookIds, bookId), bookSeriesIds: edit(f.bookSeriesIds, seriesId) });
  changed();
}
// Fandoms whose canon is this Books item (directly or through its series).
export async function fandomsOfBook(bookId, seriesId) {
  const a = await db.fandoms.where('bookIds').equals(bookId).toArray();
  const b = seriesId ? await db.fandoms.where('bookSeriesIds').equals(seriesId).toArray() : [];
  const m = new Map([...a, ...b].filter(f => !f.deleted).map(f => [f.id, f]));
  return [...m.values()];
}

// kind 'character' | 'relationship'; names like "Harry Potter", "Harry Potter/Draco Malfoy", "Hermione & Ginny".
export async function ensureTags(kind, names, fdId) {
  const ids = [];
  for (const name of splitList(names)) {
    const id = kind === 'character' ? characterId(fdId, name) : relationshipId(fdId, name);
    if (!(await db.ficTags.get(id))) await db.ficTags.put({ id, kind, fandomId: fdId || null, name, romantic: kind === 'relationship' ? !name.includes('&') : undefined, createdAt: now(), deleted: 0 });
    ids.push(id);
  }
  return [...new Set(ids)];
}

// ── Fanfics ──
const ITEM_KEYS = ['title', 'tags', 'favorite'];

export async function createFanfic(data = {}, { quiet = false } = {}) {
  const id = data.id || uid();
  const fandomIds = await ensureFandoms(data.fandoms || []);
  const fd = fandomIds[0];
  const characterIds = await ensureTags('character', data.characters || [], fd);
  const relationshipIds = await ensureTags('relationship', data.relationships || [], fd);
  const status = data.status || 'draft';
  const item = {
    id, type: 'fanfic', moduleId: 'fanfic', title: data.title || 'Truyện chưa đặt tên', subtitle: data.author || '',
    tags: splitList(data.tags || []), status: HUB_STATUS[status], favorite: data.favorite ? 1 : 0, deleted: 0, rating: 0,
    createdAt: now(), meta: { published: 0 },
  };
  const fic = {
    itemId: id, origin: data.origin || 'mine', author: data.author || '', sourceUrl: data.sourceUrl || '', language: data.language || 'vi',
    fandomIds, characterIds, relationshipIds, audience: data.audience || 'nr', warnings: data.warnings || [], categories: data.categories || [],
    status, summary: data.summary || '', notesStart: data.notesStart || '', notesEnd: data.notesEnd || '',
    seriesId: data.seriesId || null, seriesIndex: data.seriesIndex ?? null, plannedChapters: data.plannedChapters || null,
    goal: { total: 0, daily: 0, perChapter: 0, deadline: null, ...(data.goal || {}) }, published: 0, publishedAt: null,
    stats: data.stats || {}, editedAt: now(), createdAt: now(), deleted: 0,
  };
  await db.transaction('rw', db.items, db.fanfics, async () => { await db.items.put(item); await db.fanfics.put(fic); });
  await logActivity(id, 'fanfic', 'create').catch(() => {});
  if (!data.noChapter && !data.chapters) await addChapter(id, { title: 'Chương 1' }, { quiet: true });
  for (const c of data.chapters || []) await addChapter(id, c, { quiet: true });
  if (!quiet) changed([id]);
  return id;
}

export async function updateFanfic(id, patch) {
  const fic = await db.fanfics.get(id);
  if (!fic) return;
  const itemPatch = {}, ficPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'fandoms') ficPatch.fandomIds = await ensureFandoms(v);
    else if (k === 'characters') ficPatch.characterIds = await ensureTags('character', v, (ficPatch.fandomIds || fic.fandomIds || [])[0]);
    else if (k === 'relationships') ficPatch.relationshipIds = await ensureTags('relationship', v, (ficPatch.fandomIds || fic.fandomIds || [])[0]);
    else if (k === 'tags') itemPatch.tags = splitList(v);
    else if (ITEM_KEYS.includes(k)) itemPatch[k] = k === 'favorite' ? (v ? 1 : 0) : v;
    else if (k === 'author') { ficPatch.author = v; itemPatch.subtitle = v; }
    else ficPatch[k] = v;
  }
  if ('status' in patch) itemPatch.status = HUB_STATUS[patch.status];
  await db.transaction('rw', db.items, db.fanfics, async () => {
    if (Object.keys(itemPatch).length) await db.items.update(id, itemPatch);
    if (Object.keys(ficPatch).length) await db.fanfics.update(id, ficPatch);
  });
  // A published fanfic keeps its Books row in step (title, author, tags show in Books).
  if (fic.published && ('title' in patch || 'author' in patch)) await syncBooksRow(id);
  changed([id]);
}

export async function removeFanfics(ids) {
  for (const id of ids) {
    await softDeleteItem(id);
    await db.fanfics.update(id, { deleted: 1 });
    await db.ficChapters.where('fanficId').equals(id).modify({ deleted: 1 });
    await db.ficNotes.where('fanficId').equals(id).modify({ deleted: 1 });
    if (await db.books.get(id)) await db.books.update(id, { deleted: 1 });
  }
  changed(ids);
}

export async function duplicateFanfic(id) {
  const v = await get(id);
  if (!v) return null;
  const nid = uid();
  await db.items.put({ ...v.item, id: nid, title: v.title + ' (bản sao)', createdAt: now(), rev: 0, meta: { published: 0 } });
  await db.fanfics.put({ ...v.fic, itemId: nid, published: 0, publishedAt: null, rev: 0, createdAt: now() });
  const map = new Map(v.chapters.map(c => [c.id, uid()]));
  await db.ficChapters.bulkPut(v.chapters.map(c => ({ ...c, id: map.get(c.id), fanficId: nid, parentId: c.parentId ? map.get(c.parentId) : null, pubAt: null, pubBody: '', pubTitle: '', rev: 0 })));
  changed([nid]);
  return nid;
}

// ── Chapters and scenes (binder) ──
export const chaptersOf = async (fanficId) => (await db.ficChapters.where('fanficId').equals(fanficId).toArray()).filter(c => !c.deleted).sort(byOrder);

export async function addChapter(fanficId, data = {}, { after = null, parentId = null, quiet = false } = {}) {
  const all = await chaptersOf(fanficId);
  const sibs = all.filter(c => (c.parentId || null) === (parentId || null));
  let order;
  if (after) { const i = sibs.findIndex(c => c.id === after); const a = sibs[i], b = sibs[i + 1]; order = b ? (a.order + b.order) / 2 : (a?.order ?? 0) + 1; }
  else order = (sibs.at(-1)?.order ?? 0) + 1;
  const id = uid();
  const body = data.body || '';
  await db.ficChapters.put({
    id, fanficId, parentId: parentId || null, kind: parentId ? 'scene' : 'chapter', order,
    title: data.title ?? (parentId ? 'Cảnh mới' : `Chương ${sibs.length + 1}`), body, words: countWords(body),
    synopsis: data.synopsis || '', status: data.status || 'draft', label: data.label || '', goal: data.goal || 0,
    notesStart: data.notesStart || '', notesEnd: data.notesEnd || '', pubTitle: '', pubBody: '', pubAt: null,
    createdAt: now(), editedAt: now(), deleted: 0,
  });
  await db.fanfics.update(fanficId, { editedAt: now() });
  if (!quiet) changed([fanficId]);
  return id;
}

// Save while typing: counts words, logs today's written words (net) for goals and streaks.
export async function saveChapter(id, patch) {
  const c = await db.ficChapters.get(id);
  if (!c) return null;
  const out = { ...patch, editedAt: now() };
  if ('body' in patch) {
    out.words = countWords(patch.body);
    const delta = out.words - (c.words || 0);
    if (delta) await logWords(c.fanficId, delta);
  }
  await db.ficChapters.update(id, out);
  await db.fanfics.update(c.fanficId, { editedAt: now(), lastChapterId: id });
  snapshot.invalidate();
  bus.emit('fanfic:saved', { id, fanficId: c.fanficId });
  return out;
}
export async function updateChapter(id, patch) { const c = await db.ficChapters.get(id); await db.ficChapters.update(id, patch); changed([c?.fanficId]); }

export async function removeChapter(id) {
  const c = await db.ficChapters.get(id);
  if (!c) return;
  await db.ficChapters.update(id, { deleted: 1 });
  await db.ficChapters.where('parentId').equals(id).modify({ deleted: 1 });
  changed([c.fanficId]);
}

// Drag and drop in the binder: put `id` before `beforeId` (or at the end) under `parentId`.
export async function moveChapter(id, { parentId = null, beforeId = null }) {
  const c = await db.ficChapters.get(id);
  const sibs = (await chaptersOf(c.fanficId)).filter(x => (x.parentId || null) === (parentId || null) && x.id !== id);
  let order;
  if (beforeId) { const i = sibs.findIndex(x => x.id === beforeId); const b = sibs[i], a = sibs[i - 1]; order = a ? (a.order + b.order) / 2 : b.order - 1; }
  else order = (sibs.at(-1)?.order ?? 0) + 1;
  await db.ficChapters.update(id, { order, parentId: parentId || null, kind: parentId ? 'scene' : 'chapter' });
  changed([c.fanficId]);
}

// Chapter text as the reader sees it: chapter body, then its scenes separated by scene breaks.
export function composeMd(chapter, all, { pub = false } = {}) {
  const scenes = all.filter(s => s.parentId === chapter.id).sort(byOrder);
  const parts = [pub ? chapter.pubBody ?? '' : chapter.body, ...scenes.map(s => pub ? s.pubBody ?? '' : s.body)].filter(x => String(x || '').trim());
  return parts.join('\n\n* * *\n\n');
}

// ── Snapshots (version history) ──
export async function snapshotChapter(chapterId, { kind = 'manual', label = '' } = {}) {
  const c = await db.ficChapters.get(chapterId);
  if (!c) return null;
  const dev = await thisDevice();
  const id = uid();
  await db.ficVersions.put({ id, fanficId: c.fanficId, chapterId, kind, label, title: c.title, body: c.body, words: c.words || 0, createdAt: now(), deviceId: dev.id });
  return id;
}
export const versionsOf = async (chapterId) => (await db.ficVersions.where('chapterId').equals(chapterId).toArray()).sort((a, b) => b.createdAt - a.createdAt);
export async function restoreVersion(vid) {
  const v = await db.ficVersions.get(vid);
  if (!v) return;
  await snapshotChapter(v.chapterId, { kind: 'auto', label: 'Trước khi khôi phục' });
  await saveChapter(v.chapterId, { body: v.body, title: v.title });
  changed([v.fanficId]);
}
export async function removeVersion(vid) { await db.ficVersions.delete(vid); }

// ── Notes (characters, plot, research, world, ideas, todos) ──
export const notesOf = async (fanficId) => (await db.ficNotes.where('fanficId').equals(fanficId).toArray()).filter(n => !n.deleted).sort((a, b) => (b.pinned || 0) - (a.pinned || 0) || (a.order ?? 0) - (b.order ?? 0));
export async function saveNote(note) {
  const row = { kind: 'idea', title: '', body: '', done: 0, order: now(), createdAt: now(), deleted: 0, ...note, id: note.id || uid() };
  await db.ficNotes.put(row);
  changed([row.fanficId]);
  return row.id;
}
export async function removeNote(id) { const n = await db.ficNotes.get(id); await db.ficNotes.update(id, { deleted: 1 }); changed([n?.fanficId]); }

// ── Writing log (daily goal, streak) ──
async function logWords(fanficId, delta) {
  const dev = await thisDevice(), day = today(), id = `${day}|${fanficId}|${dev.id}`;
  const row = await db.ficWriting.get(id);
  await db.ficWriting.put({ id, fanficId, day, deviceId: dev.id, words: (row?.words || 0) + delta, createdAt: row?.createdAt || now() });
}
export async function writingDays(days = 60) {
  const from = today(new Date(Date.now() - days * 864e5));
  const rows = await db.ficWriting.where('day').aboveOrEqual(from).toArray();
  const by = new Map();
  for (const r of rows) by.set(r.day, (by.get(r.day) || 0) + Math.max(0, r.words || 0));
  return by;
}
export function streakOf(by) {
  let n = 0, d = new Date();
  if (!(by.get(today(d)) > 0)) d = new Date(Date.now() - 864e5);   // today not written yet: the streak still counts until midnight
  while (by.get(today(d)) > 0) { n++; d = new Date(d.getTime() - 864e5); }
  return n;
}

// ── Publish to the Library / Books ──
// Copies every chapter's current text into its published fields, gives the item a `books` row (format 'fanfic')
// so Books lists and reads it, and keeps a 'publish' snapshot of each chapter.
export async function publish(id, { chapterIds = null } = {}) {
  const v = await get(id);
  if (!v) return;
  const t = now();
  for (const c of v.chapters) {
    if (chapterIds && !chapterIds.includes(c.id) && !chapterIds.includes(c.parentId)) continue;
    if (c.pubAt && (c.editedAt || 0) <= c.pubAt) continue;
    await snapshotChapter(c.id, { kind: 'publish', label: 'Xuất bản' });
    await db.ficChapters.update(c.id, { pubTitle: c.title, pubBody: c.body, pubAt: t });
  }
  await db.fanfics.update(id, { published: 1, publishedAt: v.fic.publishedAt || t, updatedPubAt: t });
  await db.items.update(id, { meta: { ...(v.item.meta || {}), published: 1 } });
  await syncBooksRow(id);
  await logActivity(id, 'fanfic', 'publish').catch(() => {});
  changed([id]);
  bus.emit('books:changed', { ids: [id] });
}
export async function unpublish(id) {
  await db.fanfics.update(id, { published: 0 });
  const item = await db.items.get(id);
  await db.items.update(id, { meta: { ...(item?.meta || {}), published: 0 } });
  if (await db.books.get(id)) await db.books.update(id, { deleted: 1 });
  changed([id]);
  bus.emit('books:changed', { ids: [id] });
}

// The Books row of a published fanfic: Books owns reading status / rating there; we only set what identifies it.
async function syncBooksRow(id) {
  const [item, fic, book] = await Promise.all([db.items.get(id), db.fanfics.get(id), db.books.get(id)]);
  const author = fic.author || (fic.origin === 'mine' ? 'Tôi' : '');
  const authorIds = [];
  if (author) {
    const aid = 'au:' + slug(author);
    if (!(await db.authors.get(aid))) await db.authors.put({ id: aid, name: author, sort: fold(author), createdAt: now(), deleted: 0 });
    authorIds.push(aid);
  }
  const words = (await chaptersOf(id)).reduce((a, c) => a + (c.words || 0), 0);
  const base = { format: 'fanfic', authorIds, words, language: fic.language || '', description: fic.summary || '', fanfic: 1, deleted: 0 };
  if (book) await db.books.update(id, base);
  else await db.books.put({
    itemId: id, ...base, seriesId: null, seriesIndex: null, status: 'want', rating: 0, isbn: '', identifiers: {}, pages: 0, physical: 0,
    genres: [], moods: [], cw: [], shelfIds: [], reads: [], readCount: 0, addedAt: now(), source: 'fanfic',
  });
}

// What the Books reader opens: the published chapters as HTML (chapter notes included, AO3 style).
export async function readableBook(id) {
  const [item, fic] = await Promise.all([db.items.get(id), db.fanfics.get(id)]);
  if (!item || !fic) return null;
  const all = await chaptersOf(id);
  const tops = all.filter(c => !c.parentId && c.pubAt);
  const note = (label, md) => md?.trim() ? `<aside class="fic-note"><p><b>${label}</b></p>${mdToHtml(md)}</aside>` : '';
  const head = `${fic.summary ? note('Tóm tắt', fic.summary) : ''}${note('Lời tác giả', fic.notesStart)}`;
  const chapters = tops.map((c, i) => ({
    title: c.pubTitle || c.title || `Chương ${i + 1}`,
    html: (i === 0 ? head : '') + note('Ghi chú đầu chương', c.notesStart) + mdToHtml(composeMd(c, all, { pub: true })) + note('Ghi chú cuối chương', c.notesEnd) + (i === tops.length - 1 ? note('Lời cuối', fic.notesEnd) : ''),
  }));
  return { title: item.title, author: fic.author || '', language: fic.language || '', chapters };
}

// ── Fic series (collections kind 'fic-series') ──
export async function ensureSeries(name) {
  if (!String(name || '').trim()) return null;
  const id = 'fs:' + slug(name);
  if (!(await db.collections.get(id))) await db.collections.put({ id, kind: 'fic-series', moduleId: 'fanfic', name: String(name).trim(), createdAt: now(), deleted: 0 });
  return id;
}
