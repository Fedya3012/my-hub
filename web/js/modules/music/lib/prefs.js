// Music preferences. Kept per device in settings (a phone and a desktop usually want
// different layouts, output and EQ); everything else (library, playlists, plays) syncs.
import { getSetting, setSetting } from '../../../core/db.js';
import { bus } from '../../../core/bus.js';

export const TABS = {
  home: 'Trang chủ', songs: 'Âm nhạc', new: 'Mới', albums: 'Album', artists: 'Nghệ sĩ', albumArtists: 'Nghệ sĩ album',
  composers: 'Nhạc sĩ', years: 'Năm', labels: 'Hãng đĩa',
  genres: 'Thể loại', folders: 'Thư mục', playlists: 'Danh sách phát', stats: 'Thống kê',
};

export const DEFAULTS = {
  tabs: [['home', 1], ['songs', 1], ['albums', 1], ['artists', 1], ['albumArtists', 1], ['composers', 1], ['years', 1], ['labels', 1],
    ['folders', 1], ['playlists', 1], ['genres', 0], ['stats', 1]],
  view: { songs: 'list', albums: 'grid', artists: 'grid', albumArtists: 'grid', composers: 'list', years: 'grid', labels: 'list',
    genres: 'grid', folders: 'tree', playlists: 'grid' },
  // Sort key per list (tabs and the lists inside detail pages); desc flips the natural direction.
  sort: { songs: 'title', albums: 'artist', artists: 'name', albumArtists: 'name', composers: 'name', years: 'year', labels: 'name',
    genres: 'name', playlists: 'name', folders: 'name', albumTracks: 'trackNo', artistSongs: 'plays', artistAlbums: 'year',
    groupSongs: 'title', groupAlbums: 'year', playlistTracks: 'order', folderTracks: 'fileName' },
  desc: { songs: 0, albums: 0, artists: 0, genres: 0, playlists: 0 },
  gridSize: 'm',                 // s | m | l
  filters: { quality: '', codec: '', fav: 0, minRating: 0 },
  showBadges: 1, showHiRes: 1, hiResRule: 'standard', homeCoverFlow: 1,
  np: { art: 'vinyl', ambient: 1, albumTheme: 1, appAccent: 0, visualizer: 1, fakeKaraoke: 1, lyricsSize: 'm', layout: 'auto',
    // Background video behind the lyrics: show it, when (with the lyrics only / whole screen), darkening, blur, pause with the music
    // videoWhere: 'bg' (Đang phát) | 'lyrics' | 'both' ('always' = legacy 'both'); videoColors: tint UI from the clip
    video: 1, videoWhere: 'lyrics', videoDim: 0.45, videoBlur: 0, videoFollow: 1, videoColors: 1,
    // Visualizer theme behind Now Playing: '' = theo skin, 'off', or a VIS_THEMES key; fxWhere like videoWhere
    fx: '', fxWhere: 'both', fxIntensity: 0.8 },
  playback: {
    gapless: 1, crossfade: 0, smartCrossfade: 1, skipSilence: 0,
    rgMode: 'auto', rgPreamp: 0, rgUntagged: 0, rgClip: 1,
    engine: 'auto', outputRate: 0, sinkId: '', volume: 0.85, rate: 1, resume: 1,
  },
  links: { autoplay: 1, stopOnClose: 1 },
  // Folder-first: browse folders / SD card / USB live, without importing (ui/browse.js).
  folderMode: 0,
  // Automatic artwork: artists = 'collage' (4 album covers) | 'single' (most common cover); groups likewise.
  art: { artist: 'collage', groups: 'collage' },
  // Lyrics view (Namida / Symfonium / Noctis style) and sources. online: look up LRCLIB when a song has none.
  lyrics: { mode: 'word', online: 0, preferSynced: 1, tr: 1, roman: 1, align: 'left', weight: 800, blur: 1, autoScroll: 1, mini: 1, full: 0 },
  // Audio path (lib/outputs.js, lib/ambient.js, lib/timers.js): bit-perfect, outputs, timers, ambient mixer.
  audio: {
    bitPerfect: 0, eqAutoProfile: 1,
    out: { mode: 'single', a: { ch: 'stereo', trimL: 0, trimR: 0, gainDb: 0, delayMs: 0 }, b: { sinkId: '', ch: 'stereo', gainDb: 0, delayMs: 0 } },
    sleep: { minutes: 30, fadeSec: 60, slow: 0, tracks: 1, ambient: 1 },
    workout: { work: 40, rest: 20, rounds: 8, boost: 1.06, restDuck: 0.5, chime: 1 },
    focus: { work: 25, short: 5, long: 15, cycles: 4, pauseOnBreak: 1, chime: 1 },
    ambient: { master: 0.6, levels: {}, on: 0 },
  },
};

let cache = null;

function merge(def, val) {
  if (Array.isArray(def)) return Array.isArray(val) ? val : def;
  if (def && typeof def === 'object') {
    const out = { ...def };
    for (const k of Object.keys(val || {})) out[k] = k in def ? merge(def[k], val[k]) : val[k];
    return out;
  }
  return val ?? def;
}

export async function loadPrefs() {
  if (!cache) {
    cache = merge(DEFAULTS, await getSetting('music.prefs', {}));
    // A tab added in a later version shows up at the end.
    for (const [id, on] of DEFAULTS.tabs) if (!cache.tabs.some(t => t[0] === id)) cache.tabs.push([id, on]);
  }
  return cache;
}

export const prefs = () => cache || DEFAULTS;

// setPref('np.art', 'cd')
export async function setPref(path, value) {
  const p = await loadPrefs();
  const keys = path.split('.');
  let o = p;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
  await setSetting('music.prefs', p);
  bus.emit('music:prefs', { path, value });
}

export async function resetPrefs() {
  cache = merge(DEFAULTS, {});
  await setSetting('music.prefs', cache);
  bus.emit('music:prefs', { path: '*' });
}
