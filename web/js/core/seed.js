// Example content shown on first run so the Library isn't empty.
// Every sample has meta.sample = true and can be removed in one click.
import { db, uid, now, withoutSyncHooks } from './db.js';
import { thisDevice } from './device.js';
import { storage } from './storage/index.js';

const D = 864e5;

export async function seedIfEmpty() {
  if (await db.items.count()) return false;
  const t = now();
  const S = (o) => ({ id: uid(), moduleId: null, tags: [], favorite: 0, status: 'new', deleted: 0, rating: 0,
    createdAt: t - (o.age || 1) * D, updatedAt: t - (o.age || 1) * D, rev: 1, ...o, meta: { sample: true, ...(o.meta || {}) } });

  const items = {
    dune:      S({ type: 'book', title: 'Xứ Cát (Dune)', subtitle: 'Frank Herbert', tags: ['khoa học viễn tưởng', 'kinh điển'], status: 'in-progress', favorite: 1, rating: 5, lastOpenedAt: t - 0.2 * D, age: 40, meta: { pages: 688, year: 1965 } }),
    dune2:     S({ type: 'video', title: 'Dune: Part Two', subtitle: 'Denis Villeneuve · 2024', tags: ['phim', 'khoa học viễn tưởng'], status: 'done', rating: 4, lastOpenedAt: t - 9 * D, age: 30, meta: { duration: 9960 } }),
    inter:     S({ type: 'video', title: 'Interstellar', subtitle: 'Christopher Nolan · 2014', tags: ['phim', 'không gian'], age: 25, meta: { duration: 10140 } }),
    cornfield: S({ type: 'music', title: 'Cornfield Chase', subtitle: 'Hans Zimmer · Interstellar OST', tags: ['nhạc phim', 'không lời'], favorite: 1, lastOpenedAt: t - 1 * D, status: 'done', age: 20, meta: { duration: 126 } }),
    spice:     S({ type: 'music', title: 'A Time of Quiet Between the Storms', subtitle: 'Hans Zimmer · Dune: Part Two OST', tags: ['nhạc phim'], age: 18, meta: { duration: 238 } }),
    hen:       S({ type: 'music', title: 'Chúng Ta Của Hiện Tại', subtitle: 'Sơn Tùng M-TP', tags: ['v-pop'], lastOpenedAt: t - 3 * D, age: 6, meta: { duration: 301 } }),
    sapiens:   S({ type: 'book', title: 'Sapiens: Lược sử loài người', subtitle: 'Yuval Noah Harari', tags: ['lịch sử', 'phi hư cấu'], status: 'done', rating: 4, age: 90, meta: { pages: 560 } }),
    nha:       S({ type: 'book', title: 'Nhà Giả Kim', subtitle: 'Paulo Coelho', tags: ['tiểu thuyết'], status: 'in-progress', lastOpenedAt: t - 2 * D, age: 12, meta: { pages: 228 } }),
    pod1:      S({ type: 'podcast', title: 'Vì sao Dune khó chuyển thể?', subtitle: 'Chuyện Phim · Tập 87', tags: ['phim', 'thảo luận'], status: 'in-progress', lastOpenedAt: t - 0.5 * D, age: 3, meta: { duration: 2880 } }),
    pod2:      S({ type: 'podcast', title: 'Thói quen đọc sách mỗi ngày', subtitle: 'Góc Đọc · Tập 12', tags: ['phát triển bản thân'], age: 5, meta: { duration: 2400 } }),
    fic1:      S({ type: 'fanfic', title: 'Những vì sao trên Arrakis', subtitle: 'Fanfic Xứ Cát · 14 chương', tags: ['fanfic', 'khoa học viễn tưởng'], status: 'in-progress', lastOpenedAt: t - 4 * D, age: 8, meta: { chapters: 14 } }),
    note1:     S({ type: 'note', title: 'Trích dẫn hay từ Xứ Cát', subtitle: '12 đoạn trích', tags: ['trích dẫn'], age: 2, updatedAt: t - 0.3 * D }),
    img1:      S({ type: 'image', title: 'Bìa sách tháng 10', subtitle: 'Ảnh chụp · 4 ảnh', tags: ['kệ sách'], age: 1 }),
  };
  for (const it of Object.values(items)) it.moduleId = { music: 'music', podcast: 'music', book: 'reader', fanfic: 'reader', video: 'video', image: 'gallery', note: 'notes' }[it.type];

  const L = (from, to, relation) => ({ id: uid(), fromId: items[from].id, toId: items[to].id, relation, createdAt: t, updatedAt: t, rev: 1, sample: true });
  const links = [
    L('dune2', 'dune', 'adapted-from'),
    L('spice', 'dune2', 'soundtrack-of'),
    L('cornfield', 'inter', 'soundtrack-of'),
    L('pod1', 'dune', 'discusses'),
    L('pod1', 'dune2', 'discusses'),
    L('note1', 'dune', 'notes-on'),
    L('fic1', 'dune', 'related'),
  ];
  const collections = [{ id: uid(), kind: 'playlist', moduleId: 'music', name: 'Nhạc phim Hans Zimmer', createdAt: t, updatedAt: t, rev: 1, deleted: 0, sample: true }];
  links.push({ id: uid(), fromId: collections[0].id, toId: items.cornfield.id, relation: 'contains', order: 1, createdAt: t, updatedAt: t, rev: 1, sample: true },
             { id: uid(), fromId: collections[0].id, toId: items.spice.id, relation: 'contains', order: 2, createdAt: t, updatedAt: t, rev: 1, sample: true });

  const activity = [
    ['dune', 'open', 0.2], ['pod1', 'play', 0.5], ['cornfield', 'play', 1], ['nha', 'open', 2], ['hen', 'play', 3], ['dune2', 'finish', 9],
  ].map(([k, action, ago]) => ({ itemId: items[k].id, moduleId: items[k].moduleId, action, at: t - ago * D }));

  // Where the user stopped. Two of them come from a sample "Windows" device to show
  // cross-device resume: open the podcast here and it continues from 16:48.
  const me = await thisDevice();
  const win = { id: 'sample-windows', name: 'Máy tính Windows (mẫu)', platform: 'windows', lastSeenAt: t - 0.5 * D, updatedAt: t - 0.5 * D, sample: true };
  const P = (k, o) => ({ itemId: items[k].id, moduleId: items[k].moduleId, state: 'paused', sample: true, ...o });
  const progressRows = [
    P('dune', { position: 289, total: 688, unit: 'page', percent: 42, label: 'Trang 289 / 688', deviceId: win.id, updatedAt: t - 0.2 * D }),
    P('pod1', { position: 1008, total: 2880, unit: 'second', percent: 35, label: '16:48 / 48:00', deviceId: win.id, updatedAt: t - 0.5 * D }),
    P('nha', { position: 162, total: 228, unit: 'page', percent: 71, label: 'Trang 162 / 228', deviceId: me.id, updatedAt: t - 2 * D }),
  ];

  await withoutSyncHooks(async () => {
    await db.items.bulkPut(Object.values(items));
    await db.devices.put(win);
    await db.progress.bulkPut(progressRows);
    await db.links.bulkPut(links);
    await db.collections.bulkPut(collections);
    await db.activity.bulkAdd(activity);
  });
  return true;
}

export async function removeSamples() {
  const ids = (await db.items.toArray()).filter(i => i.meta?.sample).map(i => i.id);
  const owners = new Set([...ids, ...(await db.albums.filter(a => a.sample).primaryKeys())]);
  for (const f of await db.files.filter(f => owners.has(f.itemId)).toArray()) await storage.removeFile(f, { everywhere: false }).catch(() => {});
  await withoutSyncHooks(async () => {
    await db.items.bulkDelete(ids);
    await db.links.filter(l => l.sample).delete();
    await db.collections.filter(c => c.sample).delete();
    await db.activity.where('itemId').anyOf(ids).delete();
    await db.progress.where('itemId').anyOf(ids).delete();
    await db.devices.filter(d => d.sample).delete();
    // Music demo (tracks, albums, playlists… added by the Music module) carries `sample: 1` too.
    for (const t of ['tracks', 'albums', 'artists', 'plays', 'lyrics']) await db.table(t).filter(r => r.sample).delete();
  });
  return ids.length;
}
