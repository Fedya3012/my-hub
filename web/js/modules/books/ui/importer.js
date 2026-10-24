// Adding books: files (any number, folders walked recursively), linked folders (desktop, no copy),
// paper books by ISBN / barcode, Goodreads / StoryGraph / CSV / JSON import, bulk online metadata.
// Every long job reports to the task tray (progress + cancel).
import { db } from '../../../core/db.js';
import { icon } from '../../../core/icons.js';
import { esc, h, toast } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import { storage } from '../../../core/storage/index.js';
import * as store from '../lib/store.js';
import { extractMeta, isBookFile, formatOf, ACCEPT, asNamedFile } from '../lib/formats.js';
import { lookup, merge, fetchCover, validIsbn } from '../lib/online.js';
import { parseCsv, detect, toRecords } from '../lib/csv.js';
import { setCover, sheet } from './common.js';

// ── Files ────────────────────────────────────────────────────────
// files: File[] (relPath kept for folders) or [{ handle, name, size, relPath }] for linked files.
export async function importFiles(files, { remote = null, localFolder = null } = {}) {
  const list = files.filter(f => isBookFile(f));
  const skipped = files.length - list.length;
  if (!list.length) { toast(files.length ? 'Không có tệp sách nào (EPUB, PDF, MOBI, AZW3, FB2, CBZ, TXT…)' : 'Chưa chọn tệp', 'warn'); return []; }
  storage.persistOnce().catch(() => {});
  // Duplicates: same name + size as a book file already in the library.
  // A match whose bytes are not on this device (book synced from another device) gets this file attached.
  const existing = new Map((await db.files.where('role').equals('main').toArray()).map(f => [f.name + '|' + f.size, f]));
  const total = list.reduce((s, f) => s + (f.size || 0), 0);
  const task = tasks.start({ label: `Đang thêm ${list.length} sách`, unit: 'bytes', total, cancellable: true, delay: total < 3e6 ? 300 : 0 });
  const added = [];
  let base = 0, dup = 0;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (task.cancelled) break;
    task.update({ detail: `${f.name} (${i + 1}/${list.length})`, done: base });
    const same = existing.get(f.name + '|' + f.size);
    if (same) {
      const here = await storage.open(same).then(() => true, () => false);
      if (!here) {
        try {
          const blob = f.handle ? await f.handle.getFile() : f;
          const loc = f.handle ? await storage.adapters.local.link(same.id, f.handle) : await storage.adapters.local.put(same.id, blob, { signal: task.signal });
          await db.files.update(same.id, { locations: { ...(same.locations || {}), local: loc } });
          added.push(same.itemId);
        } catch (e) { toast(`${f.name}: ${e.message}`, 'error'); }
      } else dup++;
      await repairCover(same.itemId, f).catch(() => {});
      base += f.size || 0; continue;
    }
    let id = null;
    try {
      const file = f.handle ? await f.handle.getFile() : f;
      const meta = await extractMeta(asNamedFile(file, f.name), { signal: task.signal });
      const folder = f.relPath?.includes('/') ? f.relPath.split('/').slice(0, -1) : [];
      const { coverBlob, ...data } = meta;
      id = await store.createBook({ ...data, tags: folder.length ? [folder[folder.length - 1]] : [], relPath: f.relPath || '' }, { file: true, quiet: true });
      await storage.addFile(id, f.handle ? { handle: f.handle } : file, { role: 'main', name: f.name, signal: task.signal, ...(remote ? { remote: { key: remote(f), drive: remote.drive } } : {}), ...(localFolder ? { localFolder } : {}),
        onProgress: ({ done, total: n }) => task.update({ done: base + (n ? done / n : 1) * (f.size || 0) }) });
      if (coverBlob) await setCover(id, coverBlob);
      added.push(id);
    } catch (e) {
      if (id) await store.removeBooks([id]).catch(() => {});
      if (e?.name === 'AbortError' || task.cancelled) break;
      toast(`${f.name}: ${e.message}`, 'error');
    }
    base += f.size || 0;
    task.update({ done: base });
  }
  task.finish(`Đã thêm ${added.length}/${list.length}`);
  store.changed(added);
  toast(`Đã thêm ${added.length} sách${dup ? ` · bỏ qua ${dup} trùng` : ''}${skipped ? ` · ${skipped} tệp không phải sách` : ''}`);
  return added;
}

export function pickFiles({ folder = false } = {}) {
  return new Promise((resolve) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
    if (folder) inp.webkitdirectory = true; else inp.accept = ACCEPT;
    inp.onchange = () => resolve([...inp.files].map(f => { if (f.webkitRelativePath) try { Object.defineProperty(f, 'relPath', { value: f.webkitRelativePath }); } catch { /* read-only */ } return f; }));
    inp.click();
  });
}

// Desktop Chrome/Edge: link a folder without copying (files stay where they are, read on open).
export const canLinkFolder = () => 'showDirectoryPicker' in window && !window.Capacitor?.isNativePlatform?.();
export async function linkFolder() {
  const dir = await window.showDirectoryPicker({ mode: 'read' }).catch(() => null);
  if (!dir) return [];
  const out = [];
  const task = tasks.start({ label: 'Đang quét thư mục', detail: dir.name, cancellable: true });
  const walk = async (d, prefix) => {
    for await (const [name, hnd] of d.entries()) {
      if (task.cancelled) return;
      if (hnd.kind === 'directory') await walk(hnd, prefix + name + '/');
      else if (formatOf(name)) { const f = await hnd.getFile(); out.push({ handle: hnd, name, size: f.size, relPath: prefix + name }); task.update({ detail: `${out.length} sách · ${prefix}` }); }
    }
  };
  await walk(dir, dir.name + '/');
  task.finish(`Tìm thấy ${out.length} sách`);
  return importFiles(out);
}

// A book synced from another device: its cover row exists but the image is only on that device. Read the
// cover from this device's file and attach it under the same row, so the cover shows here too.
async function repairCover(itemId, f) {
  const cover = await db.files.where('itemId').equals(itemId).filter(x => x.role === 'cover').first();
  if (!cover || storage.hasLocal(cover)) return;
  const file = f.handle ? await f.handle.getFile() : f;
  const { coverBlob } = await extractMeta(asNamedFile(file, f.name));
  if (coverBlob) await storage.attachLocal(cover, coverBlob);
}

// A book item added from the Library: read its file's metadata and cover into the book row.
export async function readMetaInto(itemId) {
  const f = await db.files.where('itemId').equals(itemId).filter(x => x.role === 'main').first();
  if (!f) return;
  const meta = await extractMeta(asNamedFile(await storage.open(f), f.name));
  const b = await db.books.get(itemId), item = await db.items.get(itemId);
  const patch = {};
  for (const k of ['isbn', 'language', 'publisher', 'published', 'description', 'pages', 'words', 'series', 'seriesIndex', 'format']) if (meta[k] && !b?.[k]) patch[k] = meta[k];
  if (meta.genres?.length && !b?.genres?.length) patch.genres = meta.genres;
  if (meta.authors?.length && !b?.authorIds?.length) patch.authors = meta.authors;
  if (meta.title && item?.meta?.originalName) patch.title = meta.title;
  if (Object.keys(patch).length) await store.updateBook(itemId, patch);
  const cover = await db.files.where('itemId').equals(itemId).filter(x => x.role === 'cover').first();
  if (meta.coverBlob && !cover) await setCover(itemId, meta.coverBlob);
  else if (meta.coverBlob && !storage.hasLocal(cover)) await storage.attachLocal(cover, meta.coverBlob);
}

// ── Online metadata (bulk) ───────────────────────────────────────
export async function fetchMetadata(ids, { onlyEmpty = true } = {}) {
  const task = tasks.start({ label: 'Lấy thông tin sách trên mạng', total: ids.length, cancellable: true });
  let ok = 0;
  for (const id of ids) {
    if (task.cancelled) break;
    const b = await store.get(id);
    if (!b) { task.step(1); continue; }
    task.update({ detail: b.title });
    try {
      const cands = await lookup({ isbn: b.book.isbn, title: b.title, author: b.authors[0] || '' }, { signal: task.signal });
      if (cands.length) { await applyCandidate(id, b, merge(cands.slice(0, 3)), { onlyEmpty }); ok++; }
    } catch (e) { if (e?.name === 'AbortError') break; }
    task.step(1);
    await new Promise(r => setTimeout(r, 250));   // be polite with the free APIs
  }
  task.finish(`Cập nhật ${ok}/${ids.length} sách`);
  toast(`Đã lấy thông tin cho ${ok}/${ids.length} sách`);
}

// onlyEmpty: fill only missing fields (bulk); otherwise overwrite with the chosen match.
export async function applyCandidate(id, b, c, { onlyEmpty = false } = {}) {
  const patch = {};
  const take = (k, v, cur) => { if (v && (!Array.isArray(v) || v.length) && (!onlyEmpty || !cur || (Array.isArray(cur) && !cur.length))) patch[k] = v; };
  if (!onlyEmpty) take('title', c.title, '');
  take('authors', c.authors, b.authors);
  take('isbn', c.isbn, b.book.isbn);
  take('pages', c.pages, b.book.pages);
  take('published', c.published, b.book.published);
  take('publisher', c.publisher, b.book.publisher);
  take('language', c.language, b.book.language);
  take('description', c.description, b.book.description);
  take('genres', c.genres, b.book.genres);
  if (Object.keys(patch).length) await store.updateBook(id, patch);
  if (c.coverUrl && (!onlyEmpty || !(b.cover || b.book.coverUrl))) {
    const blob = await fetchCover(c.coverUrl);
    if (blob) await setCover(id, blob); else await store.updateBook(id, { coverUrl: c.coverUrl });
  }
  store.changed([id]);
}

export function candidatesHtml(list) {
  return list.length ? list.map((c, i) => `<button type="button" class="bk-cand" data-i="${i}">
      ${c.coverUrl ? `<img src="${esc(c.coverUrl)}" alt="" loading="lazy">` : '<span class="bk-cand-ph"></span>'}
      <span><b>${esc(c.title)}</b><small>${esc(c.authors.join(', '))}${c.published ? ' · ' + esc(c.published) : ''}${c.pages ? ` · ${c.pages} tr.` : ''}</small><small class="muted">${esc(c.source)}${c.isbn ? ' · ISBN ' + esc(c.isbn) : ''}</small></span></button>`).join('')
    : '<p class="muted">Không tìm thấy kết quả.</p>';
}

// ── Paper book by ISBN / barcode ─────────────────────────────────
export async function addPaperBook(ctx) {
  const body = h(`<form class="stack bk-paper">
    <p class="muted">Nhập ISBN (hoặc quét mã vạch sau bìa), app tìm thông tin trên Open Library và Google Books. Hoặc nhập tay.</p>
    <div class="bk-isbn-row"><input name="isbn" inputmode="numeric" placeholder="ISBN 10 hoặc 13 số" aria-label="ISBN">
      ${'BarcodeDetector' in window ? `<button type="button" class="btn" data-scan>${icon('b-scan')}Quét</button>` : ''}
      <button type="button" class="btn" data-find>${icon('search')}Tìm</button></div>
    <video class="bk-scan" playsinline muted hidden></video>
    <div class="bk-cands" aria-live="polite"></div>
    <label>Tên sách<input name="title" placeholder="Tìm theo tên, hoặc nhập tay"></label><label>Tác giả<input name="author"></label>
    <label class="check"><input type="checkbox" name="ebook"> Sách điện tử chưa có tệp (không phải sách giấy)</label>
    <div class="row-actions"><button class="btn" type="button" data-find2>${icon('search')}Tìm theo tên</button><button class="btn primary" type="submit">${icon('plus')}Thêm thủ công</button></div></form>`);
  const s = sheet('Thêm sách giấy / theo ISBN', body);
  const cands = body.querySelector('.bk-cands');
  let stream = null;
  s.wrap.onclose = () => stream?.getTracks().forEach(t => t.stop());
  const show = (list) => {
    cands.innerHTML = candidatesHtml(list);
    cands.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => {
      const c = list[+b.dataset.i];
      const id = await store.createBook({ ...c, physical: body.querySelector('[name=ebook]').checked ? 0 : 1, coverUrl: '' }, { quiet: true });
      const blob = await fetchCover(c.coverUrl);
      if (blob) await setCover(id, blob); else if (c.coverUrl) await store.updateBook(id, { coverUrl: c.coverUrl });
      store.changed([id]); s.close(); toast(`Đã thêm “${c.title}”`); ctx.go('books/book/' + id);
    });
  };
  const find = async (byTitle) => {
    const isbn = byTitle ? '' : validIsbn(body.querySelector('[name=isbn]').value);
    const title = body.querySelector('[name=title]').value.trim(), author = body.querySelector('[name=author]').value.trim();
    if (!isbn && !title) { toast('Nhập ISBN hoặc tên sách', 'warn'); return; }
    cands.innerHTML = '<p class="muted">Đang tìm…</p>';
    try { show(await lookup({ isbn, title, author })); } catch (e) { cands.innerHTML = `<p class="hint">Không tìm được (${esc(e.message)}). Kiểm tra mạng hoặc nhập tay.</p>`; }
  };
  body.querySelector('[data-find]').onclick = () => find(false);
  body.querySelector('[data-find2]').onclick = () => find(true);
  body.querySelector('[name=isbn]').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); find(false); } };
  body.querySelector('[data-scan]')?.addEventListener('click', async () => {
    const video = body.querySelector('video');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; video.hidden = false; await video.play();
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
      const loop = async () => {
        if (!stream?.active) return;
        const code = (await det.detect(video).catch(() => [])).map(c => c.rawValue).find(v => validIsbn(v));
        if (code) { body.querySelector('[name=isbn]').value = code; stream.getTracks().forEach(t => t.stop()); video.hidden = true; find(false); return; }
        requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { toast('Không mở được camera: ' + e.message, 'error'); }
  });
  body.onsubmit = async (e) => {
    e.preventDefault();
    const title = body.querySelector('[name=title]').value.trim();
    if (!title) { toast('Nhập tên sách', 'warn'); return; }
    const id = await store.createBook({ title, authors: body.querySelector('[name=author]').value, isbn: validIsbn(body.querySelector('[name=isbn]').value), physical: body.querySelector('[name=ebook]').checked ? 0 : 1 });
    s.close(); toast(`Đã thêm “${title}”`); ctx.go('books/book/' + id);
  };
}

// ── CSV / JSON import ────────────────────────────────────────────
export async function importCsvText(text) {
  const { headers, rows } = parseCsv(text);
  const kind = detect(headers);
  const recs = toRecords(rows, kind).filter(r => r.title);
  if (!recs.length) { toast('Tệp không có dòng sách nào', 'warn'); return 0; }
  const snap = await store.snapshot();
  const byIsbn = new Map(snap.list.filter(b => b.book.isbn).map(b => [b.book.isbn, b]));
  const key = (t, a) => store.fold(t) + '|' + store.fold(a || '');
  const byKey = new Map(snap.list.map(b => [key(b.title, b.authors[0]), b]));
  const shelfId = new Map(snap.shelves.map(s => [store.fold(s.name), s.id]));
  const task = tasks.start({ label: `Nhập ${recs.length} sách từ ${{ goodreads: 'Goodreads', storygraph: 'StoryGraph', generic: 'CSV' }[kind]}`, total: recs.length, cancellable: true });
  let created = 0, updated = 0;
  for (const r of recs) {
    if (task.cancelled) break;
    const shelfIds = [];
    for (const n of r.shelfNames || []) {
      const k = store.fold(n);
      if (!shelfId.has(k)) shelfId.set(k, await store.createShelf(n));
      shelfIds.push(shelfId.get(k));
    }
    delete r.shelfNames;
    const hit = (r.isbn && byIsbn.get(r.isbn)) || byKey.get(key(r.title, r.authors?.[0]));
    if (hit) {
      const patch = {};
      for (const [k, v] of Object.entries(r)) if (v && (!Array.isArray(v) || v.length) && !['addedAt', 'source', 'status', 'reads'].includes(k)) patch[k] = v;
      if (shelfIds.length) patch.shelfIds = [...new Set([...(hit.book.shelfIds || []), ...shelfIds])];
      if (r.status && r.status !== hit.status) patch.status = r.status;
      await store.updateBook(hit.id, patch);
      updated++;
    } else {
      await store.createBook({ ...r, shelfIds, reads: r.status === 'finished' && r.finishedAt ? [{ start: null, end: r.finishedAt }] : [] }, { quiet: true });
      created++;
    }
    task.step(1, r.title);
  }
  task.finish(`Thêm ${created}, cập nhật ${updated}`);
  store.changed();
  toast(`Đã nhập: thêm ${created} sách, cập nhật ${updated} sách`);
  return created + updated;
}

// The Books part of the data as JSON (the app-wide backup in Cài đặt also contains it).
export async function exportJson() {
  const items = await db.items.where('type').equals('book').toArray();
  const ids = new Set(items.map(i => i.id));
  return {
    format: 'my-hub-books', version: 1, exportedAt: new Date().toISOString(),
    items, books: await db.books.toArray(), authors: await db.authors.toArray(), series: await db.series.toArray(),
    shelves: await db.collections.where('moduleId').equals('books').toArray(), annotations: await db.annotations.toArray(),
    readingSessions: await db.readingSessions.toArray(), readingGoals: await db.readingGoals.toArray(),
    progress: (await db.progress.toArray()).filter(p => ids.has(p.itemId)),
  };
}
export async function importJson(data) {
  if (data?.format !== 'my-hub-books') throw new Error('Không phải tệp xuất của Sách (my-hub-books)');
  const T = { items: db.items, books: db.books, authors: db.authors, series: db.series, shelves: db.collections, annotations: db.annotations, readingSessions: db.readingSessions, readingGoals: db.readingGoals, progress: db.progress };
  const task = tasks.start({ label: 'Nhập dữ liệu Sách', total: Object.keys(T).length });
  let n = 0;
  for (const [k, table] of Object.entries(T)) {
    const rows = data[k] || [];
    const kp = table.schema.primKey.keyPath;
    const cur = await table.bulkGet(rows.map(r => r[kp]));
    const newer = rows.filter((r, i) => !cur[i] || (r.updatedAt || 0) >= (cur[i].updatedAt || 0));
    await table.bulkPut(newer); n += newer.length;
    task.step(1, k);
  }
  task.finish(`${n} dòng`);
  store.changed();
  return n;
}
