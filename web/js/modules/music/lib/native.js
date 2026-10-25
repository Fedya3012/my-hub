// Android app only (Capacitor plugins in android/app/src/main/java/com/myhub/app):
// - NativeMedia: media notification, lock screen, Bluetooth / watch controls and Android Auto. The song, the
//   play state and a browse tree (Hàng chờ, Danh sách phát, Album, Nghệ sĩ) are mirrored to MediaPlaybackService;
//   its commands come back here.
// - Dlna: play on a DLNA / UPnP speaker, receiver or TV on the Wi-Fi.
// - UsbAudio: USB DAC at the song's own sample rate, or bit-perfect (Android 14+).
import { bus } from '../../../core/bus.js';
import { toast } from '../../../core/ui.js';
import { storage } from '../../../core/storage/index.js';
import { prefs } from './prefs.js';
import { library, mainFile } from './store.js';
import { fileUrl, makeThumb } from './art.js';

const P = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null);
export const hasDlna = () => !!P()?.Dlna;
export const hasUsb = () => !!P()?.UsbAudio;

const dataUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(blob); });

// ── Media session / Android Auto ────────────────────────────────
async function sendTrack(N, player) {
  const t = player.track;
  if (!t) return;
  let art = '';
  try {
    const u = await fileUrl(player._lib?.fullCoverOf(t) || player._lib?.coverOf(t));
    if (u) art = await dataUrl(await makeThumb(await (await fetch(u)).blob(), 320));
  } catch { /* no cover */ }
  await N.setTrack({ id: t.id, title: t.title || '', artist: t.artist || '', album: t.album || '', duration: player.duration || t.duration || 0, art });
}
const sendState = (N, player) => N.setState({ playing: player.playing, position: player.time || 0, rate: player.engine.rate || 1 }).catch(() => {});

const item = (id, title, subtitle = '', o = {}) => ({ id, title: title || '—', subtitle, ...o });
async function sendTree(N, player) {
  const L = await library();
  const tree = {};
  tree.root = [
    item('queue', 'Hàng chờ', '', { browsable: true }),
    item('playlists', 'Danh sách phát', '', { browsable: true }),
    item('albums', 'Album', '', { browsable: true }),
    item('artists', 'Nghệ sĩ', '', { browsable: true }),
    item('shuffle:all', 'Phát ngẫu nhiên tất cả', `${L.tracks.size} bài`, { playable: true }),
  ];
  tree.queue = player.queue.slice(0, 150).map((id, i) => { const t = L.tracks.get(id); return item('q:' + i, t?.title, t?.artist || '', { playable: true }); });
  tree.playlists = L.playlists.slice(0, 100).map(p => item('pl:' + p.id, p.name, `${p.count || 0} bài`, { browsable: true }));
  for (const p of L.playlists.slice(0, 100)) tree['pl:' + p.id] = [item('play:playlist:' + p.id + ':s', 'Phát ngẫu nhiên', p.name, { playable: true }), item('play:playlist:' + p.id, 'Phát tất cả', p.name, { playable: true })];
  const albums = [...L.albums.values()].slice(0, 400);
  tree.albums = albums.map(a => item('al:' + a.id, a.title, a.artist || '', { browsable: true }));
  for (const a of albums) tree['al:' + a.id] = (a.tracks || []).map((t, i) => item(`play:album:${a.id}:${i}`, t.title, t.artist || '', { playable: true }));
  const artists = [...L.artists.values()].sort((a, b) => (b.tracks?.length || 0) - (a.tracks?.length || 0)).slice(0, 300);
  tree.artists = artists.map(a => item('ar:' + a.id, a.name, `${a.tracks?.length || 0} bài`, { browsable: true }));
  for (const a of artists) tree['ar:' + a.id] = [item(`play:artist:${a.id}:s`, 'Phát ngẫu nhiên', a.name, { playable: true }), ...(a.tracks || []).slice(0, 200).map((t, i) => item(`play:artist:${a.id}:${i}`, t.title, t.album || '', { playable: true }))];
  tree.tracks = [...L.tracks.values()].slice(0, 5000).map(t => item('play:track:' + t.id, t.title, t.artist || '', { playable: true }));
  await N.setTree({ tree });
}

// Podcast shares the same media session: while it is the app that last started playing, its commands are not music's.
let active = 'music';
bus.on('media:play', ({ app }) => { active = app; });
async function command(player, c) {
  if (active === 'podcasts') return;
  switch (c.action) {
    case 'play': if (!player.playing) await player.toggle(); break;
    case 'pause': player.pause(); break;
    case 'next': await player.next(); break;
    case 'prev': await player.prev(); break;
    case 'seek': player.seek(+c.position || 0); break;
    case 'playId': {
      const id = String(c.mediaId || '');
      if (id.startsWith('q:')) return player.jump(+id.slice(2));
      if (id === 'shuffle:all') { const L = await library(); return player.play([...L.tracks.values()], { shuffle: true, source: { kind: 'all', name: 'Tất cả bài hát' } }); }
      const m = id.match(/^play:(album|artist|playlist|track):(.+?)(?::(s|\d+))?$/);
      if (!m) return;
      const [, kind, sid, k] = m;
      if (kind === 'track') { const L = await library(); return player.play([sid], { source: { kind: 'track', id: sid, name: L.tracks.get(sid)?.title } }); }
      await player.playSource(kind, sid, { shuffle: k === 's' });
      if (k && k !== 's' && +k > 0) await player.jump(+k);
      break;
    }
    case 'search': {
      const L = await library(), q = String(c.query || '').toLowerCase().trim();
      const all = [...L.tracks.values()];
      const hit = q ? all.filter(t => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) : all;
      if (!hit.length) { toast('Không tìm thấy “' + q + '”', 'warn'); return; }
      await player.play(hit, { shuffle: !q, source: { kind: 'search', name: q || 'Tất cả bài hát' } });
      break;
    }
  }
}

// ── USB DAC ─────────────────────────────────────────────────────
async function applyUsb(player, { quiet = true } = {}) {
  const U = P()?.UsbAudio, mode = prefs().audio?.usbMode || 'off';
  if (!U) return;
  if (mode === 'off') { await U.clear().catch(() => {}); return; }
  const rate = player.track?.tech?.sampleRate || 0;
  const r = await U.apply({ sampleRate: rate, bitPerfect: mode === 'bitperfect' }).catch(e => ({ applied: false, reason: e.message }));
  if (!quiet || !r.applied) toast(r.applied ? `USB DAC: ${r.rate / 1000} kHz · ${r.bits > 32 ? '32-bit float' : r.bits + '-bit'}${r.bitPerfect ? ' · bit-perfect' : ''}` : 'USB DAC: ' + (r.reason || 'không áp dụng được'), r.applied ? 'info' : 'warn');
}
export async function usbInfo() { return P()?.UsbAudio ? P().UsbAudio.info() : null; }

// The synced lyrics of the current song go to the home-screen widget once; it follows the line by itself
// (the widget keeps time natively, so it works with the app in the background). Translation rides along.
async function sendLyrics(N, player) {
  if (!N.setLyrics) return;
  const t = player.track;
  let lines = [];
  if (t) {
    const [{ getLyricsRow }, { parseLyrics, mergeTranslation }] = await Promise.all([import('./lyrics-sources.js'), import('./lyrics.js')]);
    const row = await getLyricsRow(t.id).catch(() => null);
    if (player.track?.id !== t.id) return;
    const p = row?.text ? mergeTranslation(parseLyrics(row.text, t.duration), row.trText) : null;
    const off = +row?.offset || 0;
    if (p?.synced) lines = p.lines.filter(l => l.t != null).map(l => ({ t: Math.max(0, l.t - off), text: l.text || '', tr: l.tr || '' }));
  }
  await N.setLyrics({ lines });
}

let started = false;
export async function start(player) {
  const N = P()?.NativeMedia;
  if (started || !P()) return;
  started = true;
  if (N) {
    N.addListener('command', (c) => command(player, c).catch(e => toast(e.message, 'warn')));
    player.addEventListener('track', () => { sendTrack(N, player).catch(() => {}); sendState(N, player); sendLyrics(N, player).catch(() => {}); });
    bus.on('music:lyrics', (e) => { if (e?.id === player.track?.id) sendLyrics(N, player).catch(() => {}); });
    player.addEventListener('state', () => sendState(N, player));
    let lastT = 0;
    player.addEventListener('time', () => { const now = Date.now(); if (now - lastT > 5000) { lastT = now; sendState(N, player); } });
    let tt = 0;
    const tree = () => { clearTimeout(tt); tt = setTimeout(() => sendTree(N, player).catch(() => {}), 1500); };
    player.addEventListener('queue', tree);
    bus.on('music:changed', tree);
    tree();
    if (player.track) { sendTrack(N, player).catch(() => {}); sendState(N, player); sendLyrics(N, player).catch(() => {}); }
    await N.ready().catch(() => {});
  }
  if (P().UsbAudio) {
    player.addEventListener('track', () => applyUsb(player));
    bus.on('music:prefs', (p) => { if (p?.path === 'audio.usbMode') applyUsb(player, { quiet: false }); });
    P().UsbAudio.addListener('change', () => applyUsb(player));
  }
}

// ── DLNA / UPnP ─────────────────────────────────────────────────
const EXT_MIME = { mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav' };
async function trackBlob(player, t) {
  const u = player.urls.get(t.id)?.url;
  if (u) return (await fetch(u)).blob();
  const row = await mainFile(t.id);
  if (!row) throw new Error('Không tìm thấy tệp nhạc');
  return row.locations?.local?.kind === 'url' ? (await fetch(row.locations.local.ref)).blob() : storage.open(row);
}

export const dlna = {
  device: null, timer: 0, playingId: null, lastPos: 0, dur: 0,
  async discover() { const r = await P().Dlna.discover({ timeout: 3500 }); return r.devices || []; },
  async start(player, device) {
    this.device = device;
    player.pause();
    await this.playCurrent(player);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.poll(player), 2000);
    bus.emit('music:dlna', { device });
  },
  async playCurrent(player) {
    const t = player.track, D = P().Dlna;
    if (!t || !this.device) return;
    const task = (await import('../../../core/tasks.js')).tasks.start({ label: `Đang gửi “${t.title}” tới ${this.device.name}`, delay: 300 });
    try {
      const blob = await trackBlob(player, t);
      const ext = (blob.type.split('/')[1] || t.tech?.codec || 'mp3').toLowerCase().replace('mpeg', 'mp3').replace('x-flac', 'flac');
      const mime = blob.type || EXT_MIME[ext] || 'audio/mpeg';
      const name = 'track-' + Date.now() + '.' + ext.replace(/[^a-z0-9]/g, '');
      const CH = 768 * 1024;
      let url = '';
      for (let o = 0; o < blob.size; o += CH) {
        task.update({ done: o, total: blob.size, unit: 'bytes' });
        const b64 = (await dataUrl(blob.slice(o, o + CH))).split(',')[1] || '';
        url = (await D.stage({ name, mime, data: b64, append: o > 0 })).url;
      }
      await D.play({ device: this.device, url, mime, title: t.title || '', artist: t.artist || '', album: t.album || '' });
      this.playingId = t.id; this.lastPos = 0; this.dur = t.duration || 0;
      task.finish(`Đang phát trên ${this.device.name}`);
    } catch (e) { task.fail(e); throw e; }
  },
  async poll(player) {
    if (!this.device) return;
    try {
      const s = await P().Dlna.status({ device: this.device });
      if (s.duration) this.dur = s.duration;
      const ended = s.state === 'STOPPED' && this.dur && this.lastPos >= this.dur - 4;
      this.lastPos = s.position || this.lastPos;
      bus.emit('music:dlna-status', s);
      if (ended && player.index + 1 < player.queue.length) { this.lastPos = 0; player.index++; player._emit('track', player.track); player._emit('queue'); await this.playCurrent(player); }
    } catch { /* device busy */ }
  },
  async control(action, position) { if (this.device) await P().Dlna.control({ device: this.device, action, position }); },
  async volume(v) { if (this.device) await P().Dlna.setVolume({ device: this.device, volume: Math.round(v) }); },
  async skip(player, d) {
    const i = player.index + d;
    if (i < 0 || i >= player.queue.length) return;
    player.index = i; player._emit('track', player.track); player._emit('queue');
    await this.playCurrent(player);
  },
  async stop(player, { resume = true } = {}) {
    clearInterval(this.timer);
    const pos = this.lastPos;
    await this.control('stop').catch(() => {});
    this.device = null;
    bus.emit('music:dlna', { device: null });
    if (resume && player.track) { await player.jump(player.index); player.seek(pos); }
  },
};
