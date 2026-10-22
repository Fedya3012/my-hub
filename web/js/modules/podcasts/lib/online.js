// Online directories: Podcast Index (preferred, needs a free API key: https://api.podcastindex.org) and Apple
// iTunes Search (no key). Every result is normalised to
//   { feedUrl, title, author, image, description, categories, episodes, rating, itunesId, piId, source }
// so the Discover page and "Đăng ký" work the same whatever the source.
import { fetchJson } from './net.js';
import { get } from './prefs.js';

const PI = 'https://api.podcastindex.org/api/1.0';
// Results seen this session, by feed URL: the preview page of a show found in search keeps its iTunes id and rating.
export const seen = new Map();
const keep = (list) => { for (const r of list) if (r.feedUrl) seen.set(r.feedUrl, { ...seen.get(r.feedUrl), ...r }); return list; };
// Where a result came from; shown on every result and on the show page.
export const SOURCES = { pi: 'Podcast Index', itunes: 'Apple Podcasts', rss: 'Link RSS trực tiếp' };
export const sourceNames = (list = []) => list.map(k => SOURCES[k] || k).join(' · ');
export const hasPodcastIndex = () => !!(get('piKey') && get('piSecret'));

async function sha1(s) {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function pi(path, params = {}, signal) {
  const key = get('piKey'), secret = get('piSecret');
  const date = Math.floor(Date.now() / 1000);
  const qs = new URLSearchParams({ ...params, pretty: '' }).toString();
  const headers = { 'X-Auth-Key': key, 'X-Auth-Date': String(date), Authorization: await sha1(key + secret + date), 'X-User-Agent': 'MyHub/1.0' };
  const r = await fetch(`${PI}${path}?${qs}`, { headers, signal });
  if (!r.ok) throw new Error(r.status === 401 ? 'Podcast Index từ chối API key/secret' : `Podcast Index lỗi ${r.status}`);
  return r.json();
}

const fromPi = (f) => ({
  feedUrl: f.url || f.originalUrl, title: f.title, author: f.author || f.ownerName || '', image: f.artwork || f.image || '',
  description: f.description || '', categories: Object.values(f.categories || {}), episodes: f.episodeCount || null,
  rating: null, itunesId: f.itunesId || null, piId: f.id || f.feedId || null, language: f.language || '', newest: (f.newestItemPublishTime || f.lastUpdateTime || 0) * 1000, source: 'pi', sources: ['pi'],
});
const fromItunes = (r) => ({
  feedUrl: r.feedUrl, title: r.collectionName || r.trackName, author: r.artistName || '', image: r.artworkUrl600 || r.artworkUrl100 || '',
  description: '', categories: (r.genres || []).filter(g => g !== 'Podcasts'), episodes: r.trackCount || null,
  rating: r.averageUserRating || null, itunesId: r.collectionId || null, piId: null, newest: Date.parse(r.releaseDate) || 0, source: 'itunes', sources: ['itunes'],
});

// iTunes allows CORS on /search and /lookup.
async function itunes(path, params, signal) {
  const qs = new URLSearchParams(params).toString();
  return fetchJson(`https://itunes.apple.com/${path}?${qs}`, { signal });
}

// Search by show name, host, guest, keyword. kind: 'all' | 'title' | 'person'.
export async function search(q, { kind = 'all', source = 'all', signal, limit = 40 } = {}) {
  q = q.trim();
  if (!q) return [];
  if (source === 'pi' && !hasPodcastIndex()) throw Object.assign(new Error('Chưa có khoá Podcast Index. Nhập key và secret trong Cài đặt của Podcast, hoặc chọn nguồn khác.'), { code: 'nokey' });
  const jobs = [];
  if (source !== 'itunes' && hasPodcastIndex()) {
    jobs.push(kind === 'person'
      ? pi('/search/byperson', { q, max: limit }, signal).then(j => dedupeEpisodes(j.items || []))
      : pi(kind === 'title' ? '/search/bytitle' : '/search/byterm', { q, max: limit, similar: '' }, signal).then(j => (j.feeds || []).map(fromPi)));
  }
  if (source !== 'pi') jobs.push(itunes('search', { media: 'podcast', term: q, limit, country: get('country') || 'vn', ...(kind === 'person' ? { attribute: 'artistTerm' } : kind === 'title' ? { attribute: 'titleTerm' } : {}) }, signal)
    .then(j => (j.results || []).filter(r => r.feedUrl).map(fromItunes)));
  const all = await Promise.allSettled(jobs);
  if (all.every(r => r.status === 'rejected')) throw all[0].reason;
  return keep(merge(all.flatMap(r => r.status === 'fulfilled' ? r.value : [])));
}

// Podcast Index "byperson" returns episodes: turn them into their shows.
function dedupeEpisodes(items) {
  const m = new Map();
  for (const e of items) if (!m.has(e.feedUrl)) m.set(e.feedUrl, { feedUrl: e.feedUrl, title: e.feedTitle, author: e.feedAuthor || '', image: e.feedImage || e.image || '', description: '', categories: [], episodes: null, rating: null, itunesId: e.feedItunesId || null, piId: e.feedId, source: 'pi', sources: ['pi'], guestIn: e.title });
  return [...m.values()];
}

// Same feed from two sources → one result with the best of both (rating from iTunes, counts from Podcast Index).
function merge(list) {
  const m = new Map();
  const key = (r) => r.itunesId ? 'i' + r.itunesId : 'u' + String(r.feedUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  for (const r of list) {
    if (!r.feedUrl) continue;
    const k = key(r), k2 = 'u' + String(r.feedUrl).replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
    const old = m.get(k) || m.get(k2);
    if (old) { old.sources = [...new Set([...(old.sources || []), ...(r.sources || [])])]; for (const [f, v] of Object.entries(r)) if (f !== 'sources' && (old[f] == null || old[f] === '' || (Array.isArray(old[f]) && !old[f].length))) old[f] = v; }
    else { m.set(k, r); m.set(k2, r); }
  }
  return [...new Set(m.values())];
}

// Charts: Apple top podcasts per country (+ genre), or Podcast Index trending.
export async function topCharts({ genre = '', limit = 30, signal } = {}) {
  const c = get('country') || 'vn';
  const url = `https://itunes.apple.com/${c}/rss/toppodcasts/limit=${limit}${genre ? '/genre=' + genre : ''}/json`;
  const feed = await fetchJson(url, { signal });
  const ids = (feed.feed?.entry || []).map(e => e.id?.attributes?.['im:id']).filter(Boolean);
  if (!ids.length) return [];
  const look = await itunes('lookup', { id: ids.join(','), country: c, entity: 'podcast' }, signal);
  const by = new Map((look.results || []).map(r => [String(r.collectionId), r]));
  return keep(ids.map(id => by.get(String(id))).filter(r => r?.feedUrl).map(fromItunes));
}
export async function trending({ cat = '', signal } = {}) {
  if (!hasPodcastIndex()) return topCharts({ signal });
  const j = await pi('/podcasts/trending', { max: 30, lang: get('country') === 'vn' ? 'vi,en' : '', ...(cat ? { cat } : {}) }, signal);
  return keep((j.feeds || []).map(fromPi));
}
// Episodes recently published across the directory (Discover → "Tập mới nổi bật").
export async function recentEpisodes({ signal } = {}) {
  if (!hasPodcastIndex()) return [];
  const j = await pi('/recent/episodes', { max: 20, lang: get('country') === 'vn' ? 'vi' : 'en' }, signal);
  return (j.items || []).map(e => ({ title: e.title, feedUrl: null, piFeedId: e.feedId, feedTitle: e.feedTitle, image: e.image || e.feedImage, url: e.enclosureUrl, duration: e.duration, pubDate: e.datePublished * 1000, guid: e.guid }));
}
export async function byFeedId(id, signal) { const j = await pi('/podcasts/byfeedid', { id }, signal); return j.feed ? fromPi(j.feed) : null; }

// iTunes "lookup" also gives up to 200 episodes with their audio URL: used when the RSS itself is blocked (CORS).
export async function itunesEpisodes(itunesId, signal) {
  const j = await itunes('lookup', { id: itunesId, entity: 'podcastEpisode', limit: 200 }, signal);
  return (j.results || []).filter(r => r.kind === 'podcast-episode').map(r => ({
    guid: r.episodeGuid || r.episodeUrl, title: r.trackName, description: r.description || r.shortDescription || '', url: r.episodeUrl,
    mime: r.episodeContentType ? r.episodeContentType + '/' + (r.episodeFileExtension || 'mpeg') : '', size: 0,
    pubDate: Date.parse(r.releaseDate) || 0, duration: Math.round((r.trackTimeMillis || 0) / 1000), image: r.artworkUrl600 || '',
    season: null, episode: null, type: 'full', chapters: [], chaptersUrl: '', transcripts: [], persons: [],
  }));
}

// Apple genre ids for the category chips (names in Vietnamese; Podcast Index understands the English name).
export const CATEGORIES = [
  ['', 'Tất cả', ''], ['1318', 'Công nghệ', 'Technology'], ['1489', 'Tin tức', 'News'], ['1303', 'Hài', 'Comedy'],
  ['1321', 'Kinh doanh', 'Business'], ['1304', 'Giáo dục', 'Education'], ['1324', 'Xã hội & văn hoá', 'Society'],
  ['1512', 'Sức khoẻ', 'Health'], ['1488', 'Tội phạm có thật', 'True Crime'], ['1487', 'Lịch sử', 'History'],
  ['1533', 'Khoa học', 'Science'], ['1301', 'Nghệ thuật', 'Arts'], ['1309', 'Phim & TV', 'TV'],
  ['1310', 'Âm nhạc', 'Music'], ['1545', 'Thể thao', 'Sports'], ['1483', 'Hư cấu', 'Fiction'], ['1305', 'Trẻ em & gia đình', 'Kids'],
];
