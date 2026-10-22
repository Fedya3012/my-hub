// Sources of the "Thịnh hành" tab. The user turns sources on and off, orders them and adds their own
// (an Open Library subject or a Google Books search). Saved per device in db.settings ('books.trendSources').
// Goodreads, Fable, StoryGraph and Amazon have no public API that a browser app may call, so they cannot be listed.
import { getSetting, setSetting } from '../../../core/db.js';

export const KINDS = {
  'ol-trending': { label: 'Open Library · thịnh hành', arg: 'period', args: { daily: 'Hôm nay', weekly: 'Tuần này', monthly: 'Tháng này', yearly: 'Năm nay', forever: 'Mọi thời' } },
  'ol-subject': { label: 'Open Library · chủ đề', arg: 'subject', hint: 'ví dụ: fantasy, romance, science_fiction, manga' },
  'gbooks': { label: 'Google Books · tìm kiếm', arg: 'query', hint: 'ví dụ: subject:fiction, tiểu thuyết, light novel' },
};
export const UNAVAILABLE = ['Goodreads', 'Fable', 'StoryGraph', 'Amazon'];

const DEFAULTS = [
  { id: 'ol-week', kind: 'ol-trending', arg: 'weekly', on: true },
  { id: 'ol-day', kind: 'ol-trending', arg: 'daily', on: true },
  { id: 'ol-month', kind: 'ol-trending', arg: 'monthly', on: true },
  { id: 'ol-year', kind: 'ol-trending', arg: 'yearly', on: true },
  { id: 'ol-fantasy', kind: 'ol-subject', arg: 'fantasy', on: false },
  { id: 'gb-fiction', kind: 'gbooks', arg: 'subject:fiction', on: false },
];

export const sources = async () => (await getSetting('books.trendSources', null)) || DEFAULTS.map(s => ({ ...s }));
export const saveSources = (list) => setSetting('books.trendSources', list);
export const resetSources = () => setSetting('books.trendSources', null);
export const labelOf = (s) => {
  const k = KINDS[s.kind];
  if (!k) return s.kind;
  if (s.kind === 'ol-trending') return 'Open Library · ' + (k.args[s.arg] || s.arg);
  return (s.kind === 'gbooks' ? 'Google Books · ' : 'Open Library · ') + s.arg;
};

const cache = new Map();
// → [{ title, authors, year, cover }]
export async function fetchSource(s, signal) {
  const key = s.kind + '|' + s.arg;
  if (cache.has(key)) return cache.get(key);
  let list = [];
  if (s.kind === 'ol-trending') {
    const r = await fetch(`https://openlibrary.org/trending/${encodeURIComponent(s.arg)}.json?limit=30`, { signal });
    if (!r.ok) throw new Error('Open Library: ' + r.status);
    list = ((await r.json()).works || []).map(w => ({ title: w.title || '', authors: (w.author_name || []).slice(0, 3), year: w.first_publish_year || '', cover: w.cover_i ? `https://covers.openlibrary.org/b/id/${w.cover_i}-M.jpg` : '' }));
  } else if (s.kind === 'ol-subject') {
    const r = await fetch(`https://openlibrary.org/subjects/${encodeURIComponent(s.arg.trim().toLowerCase().replace(/\s+/g, '_'))}.json?limit=30&sort=editions`, { signal });
    if (!r.ok) throw new Error('Open Library: ' + r.status);
    list = ((await r.json()).works || []).map(w => ({ title: w.title || '', authors: (w.authors || []).map(a => a.name).slice(0, 3), year: w.first_publish_year || '', cover: w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : '' }));
  } else if (s.kind === 'gbooks') {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(s.arg)}&orderBy=relevance&maxResults=30&printType=books`, { signal });
    if (!r.ok) throw new Error('Google Books: ' + r.status);
    list = ((await r.json()).items || []).map(i => { const v = i.volumeInfo || {}; return { title: v.title || '', authors: (v.authors || []).slice(0, 3), year: (v.publishedDate || '').slice(0, 4), cover: (v.imageLinks?.thumbnail || '').replace('http:', 'https:') }; });
  }
  list = list.filter(w => w.title);
  cache.set(key, list);
  return list;
}
