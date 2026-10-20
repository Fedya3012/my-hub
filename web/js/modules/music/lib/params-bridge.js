// Music ⇄ shared parameters (core/params.js).
//  · Declares the 'music' namespace from prefs.DEFAULTS (values stay in the existing 'music.prefs'
//    setting, so nothing stored before changes). Keys with a label appear in Cài đặt → Thông số.
//  · Backs the global 'audio' namespace with the music engine: any module that sets
//    audio.volume / audio.outputDevice / audio.rate / audio.hiResRule / audio.bitPerfect drives the
//    player, and the player's own changes show up there.
//  · Reports what is playing as playback.* and offers services: player, art, timers, ambient.
import { params, services } from '../../../core/params.js';
import { setLive } from '../../../core/params-core.js';
import { bus } from '../../../core/bus.js';
import { DEFAULTS, prefs, setPref } from './prefs.js';
import { player } from './player.js';
import { fileUrl, artHtml, hydrate, palette } from './art.js';

// Labels (and option names) for the prefs that make sense as plain settings. Others stay in the
// music Customize sheet only (ui: false) but are still readable / writable / subscribable.
const L = {
  showBadges: ['bool', 'Hiện huy hiệu định dạng'], showHiRes: ['bool', 'Hiện huy hiệu Hi-Res'],
  homeCoverFlow: ['bool', 'Cover Flow ở Trang chủ'], folderMode: ['bool', 'Duyệt thư mục trước (không nhập)'],
  gridSize: ['enum', 'Cỡ lưới', { s: 'Nhỏ', m: 'Vừa', l: 'Lớn' }],
  'playback.gapless': ['bool', 'Phát liền mạch (gapless)'], 'playback.crossfade': ['number', 'Crossfade (giây)', null, 0, 12, 1],
  'playback.smartCrossfade': ['bool', 'Crossfade thông minh'], 'playback.skipSilence': ['bool', 'Bỏ qua đoạn lặng'],
  'playback.rgMode': ['enum', 'ReplayGain', { auto: 'Tự động', track: 'Theo bài', album: 'Theo album', off: 'Tắt' }],
  'playback.resume': ['bool', 'Nghe tiếp khi mở lại'],
  'np.art': ['enum', 'Kiểu Now Playing', { cover: 'Bìa', cd: 'CD', vinyl: 'Đĩa than', cassette: 'Cassette' }],
  'np.ambient': ['bool', 'Nền ambient theo bìa'], 'np.visualizer': ['bool', 'Visualizer'], 'np.video': ['bool', 'Video nền sau lời'],
  'lyrics.online': ['bool', 'Tìm lời trên LRCLIB khi bài chưa có'], 'lyrics.mini': ['bool', 'Lời mini trên thanh phát'],
  'links.autoplay': ['bool', 'Tự phát nhạc gắn với sách/podcast'],
};

function schema() {
  const out = {};
  const walk = (o, base) => {
    for (const [k, v] of Object.entries(o)) {
      const path = base ? base + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && !L[path]) { walk(v, path); continue; }
      const l = L[path];
      out[path] = l
        ? { type: l[0], default: v, label: l[1], ...(l[2] ? { options: l[2] } : {}), ...(l[3] != null ? { min: l[3], max: l[4], step: l[5] } : {}), section: path.split('.')[0] }
        : { type: Array.isArray(v) || (v && typeof v === 'object') ? 'json' : typeof v === 'number' ? 'number' : 'string', default: v, ui: false };
    }
  };
  walk(DEFAULTS, '');
  return out;
}
const dig = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

// global audio.* <-> music prefs
const AUDIO = { volume: 'playback.volume', outputDevice: 'playback.sinkId', rate: 'playback.rate', hiResRule: 'hiResRule', bitPerfect: 'audio.bitPerfect' };

let quiet = 0;
export function attachParams() {
  const offs = [];
  params.define('music', {
    title: 'Trình phát nhạc', icon: 'music', module: 'music', order: 20, params: schema(),
    adapter: { get: (k) => dig(prefs(), k), set: async (k, v) => { quiet++; try { await setPref(k, v); } finally { quiet--; } if (k === 'hiResRule' || k.startsWith('art.')) import('./store.js').then(m => m.invalidate()); } },
  });
  params.define('audio', {
    adapter: {
      get: (k) => (AUDIO[k] ? dig(prefs(), AUDIO[k]) : undefined),
      async set(k, v) {
        if (!AUDIO[k]) return false;
        quiet++;
        try { return await setAudio(k, v); } finally { quiet--; }
      },
    },
  });
  async function setAudio(k, v) {
    {
        if (k === 'volume') { player.setVolume(v); return setPref(AUDIO[k], v); }
        if (k === 'rate') return player.setRate(v);
        if (k === 'outputDevice') { await player.engine?.setOutput?.(v); return setPref(AUDIO[k], v); }
        await setPref(AUDIO[k], v);
        if (k === 'hiResRule') import('./store.js').then(m => m.invalidate());
    }
  }
  // Mirror prefs changes (from the music UI) as params events.
  const rev = Object.fromEntries(Object.entries(AUDIO).map(([a, m]) => [m, a]));
  offs.push(bus.on('music:prefs', ({ path, value } = {}) => {
    if (quiet) return;   // the change came through params.set(), which reports it itself
    if (!path || path === '*') { params.changed('music.*', null, null, 'music'); return; }
    params.changed('music.' + path, value, undefined, 'music');
    if (rev[path]) params.changed('audio.' + rev[path], value, undefined, 'music');
  }));
  // playback.* live values
  const report = () => {
    const t = player.track;
    setLive('playback.module', t ? 'music' : '');
    setLive('playback.itemId', t?.id || '');
    setLive('playback.title', t ? `${t.title}${t.artist ? ' · ' + t.artist : ''}` : '');
    setLive('playback.state', !t ? 'stopped' : player.playing ? 'playing' : 'paused');
    setLive('playback.duration', Math.round(player.duration || t?.duration || 0));
  };
  let lastPos = -1;
  const tick = () => { const p = Math.floor(player.time || 0); if (p !== lastPos) { lastPos = p; setLive('playback.position', p); } };
  for (const ev of ['track', 'state']) { player.addEventListener(ev, report); offs.push(() => player.removeEventListener(ev, report)); }
  const iv = setInterval(() => { if (player.playing) tick(); }, 1000);
  offs.push(() => clearInterval(iv));
  report();
  // Services for other modules.
  offs.push(
    services.provide('player', {
      play: (kind, id, o) => player.playSource(kind, id, o), playIds: (ids, o) => player.play(ids, o),
      pause: () => player.pause(), toggle: () => player.toggle(), next: () => player.next?.(), prev: () => player.prev?.(),
      get playing() { return player.playing; }, get track() { return player.track; },
      on: (ev, fn) => { player.addEventListener(ev, fn); return () => player.removeEventListener(ev, fn); },
      // Duck while another module speaks / plays (honours audio.duckOthers).
      duck(on) { if (!params.get('audio.duckOthers')) return; player.engine?.setVolume?.(on ? (prefs().playback.volume || 0.85) * 0.25 : prefs().playback.volume); },
    }),
    services.provide('art', { url: fileUrl, html: artHtml, hydrate, palette }),
    services.provide('timers', { load: () => import('./timers.js').then(m => m.timers) }),
    services.provide('ambient', { load: () => import('./ambient.js').then(m => m.ambient) }),
  );
  return () => offs.forEach(f => f());
}
