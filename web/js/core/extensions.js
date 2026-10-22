// Extension points: lets one module add UI inside another without importing it.
//   extend('library.drawer', async ({ item, el, ctx }) => { el.append(...) })   // provider (e.g. Music)
//   for (const fn of extensions('library.drawer')) await fn({...})              // host (e.g. Library)
// Known points: 'library.drawer' (extra blocks in an item's detail drawer), 'audio.sources' (apps that play sound:
// the Books reader's "Nghe khi đọc" switch, see books/reader/audio-switch.js).
const points = new Map();

export function extend(point, fn) {
  if (!points.has(point)) points.set(point, new Set());
  points.get(point).add(fn);
  return () => points.get(point).delete(fn);
}

export const extensions = (point) => [...(points.get(point) || [])];
