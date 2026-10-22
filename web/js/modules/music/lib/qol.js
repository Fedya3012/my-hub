// Quality-of-life helpers for the Trình phát nhạc: Auto DJ (keeps playing similar songs when the queue
// runs out), ListenBrainz scrobbling (with an offline queue) and casting to a speaker / TV (Remote Playback).
import { getSetting, setSetting } from '../../../core/db.js';
import { bus } from '../../../core/bus.js';
import { toast } from '../../../core/ui.js';
import { prefs } from './prefs.js';
import { library } from './store.js';

const Q = () => prefs().qol || {};

// ── Auto DJ ─────────────────────────────────────────────────────
// Score every song against the one playing: same artist, album artist, genre, close year; songs you like and
// play often weigh a little more; songs heard recently (queue / history) are left out.
export async function similar(seed, n = 10, exclude = new Set()) {
  const L = await library();
  const g = new Set(seed.genres || []);
  const scored = [];
  for (const t of L.tracks.values()) {
    if (t.id === seed.id || exclude.has(t.id) || t.type === 'podcast') continue;
    let s = 0;
    if (seed.artist && t.artist === seed.artist) s += 3;
    if (seed.albumArtist && t.albumArtist === seed.albumArtist) s += 1.5;
    if ((t.genres || []).some(x => g.has(x))) s += 2;
    if (seed.year && t.year && Math.abs(seed.year - t.year) <= 5) s += 1;
    if (t.favorite) s += 0.6;
    s += Math.min(1, (t.plays || 0) / 20) * 0.6 + Math.random() * 1.2;
    if (s > 1.2) scored.push([s, t.id]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, n).map(x => x[1]);
}

function autoDj(player) {
  player.addEventListener('track', async () => {
    if (!Q().autoDj || player.repeat !== 'off' || player._main) return;
    if (player.index < player.queue.length - 2 || !player.track) return;
    const ids = await similar(player.track, 10, new Set(player.queue.slice(-200)));
    if (!ids.length) return;
    player.queue.push(...ids);
    player._afterQueueEdit();
    if (player.source?.kind !== 'autodj') toast(`Auto DJ: thêm ${ids.length} bài tương tự vào hàng chờ`);
  });
}

// ── ListenBrainz ────────────────────────────────────────────────
const LB = 'https://api.listenbrainz.org/1/submit-listens';
const PENDING = 'music.lbPending';
const meta = (t) => ({ artist_name: t.artist || 'Unknown', track_name: t.title || 'Unknown', ...(t.album ? { release_name: t.album } : {}),
  additional_info: { media_player: 'My Hub', submission_client: 'My Hub', ...(t.duration ? { duration_ms: Math.round(t.duration * 1000) } : {}) } });
async function lbSend(type, payload) {
  const token = Q().lbToken;
  if (!token) return false;
  const r = await fetch(LB, { method: 'POST', headers: { Authorization: 'Token ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ listen_type: type, payload }) });
  if (r.status === 401) { toast('ListenBrainz: token không đúng', 'warn'); return false; }
  if (!r.ok) throw new Error('ListenBrainz ' + r.status);
  return true;
}
async function flush() {
  const list = (await getSetting(PENDING, [])) || [];
  if (!list.length || !navigator.onLine) return;
  try { for (let i = 0; i < list.length; i += 100) await lbSend('import', list.slice(i, i + 100)); await setSetting(PENDING, []); } catch { /* retry later */ }
}
export async function testToken(token) {
  const r = await fetch('https://api.listenbrainz.org/1/validate-token', { headers: { Authorization: 'Token ' + token } });
  const j = await r.json().catch(() => ({}));
  return j.valid ? j.user_name : null;
}
function scrobble(player) {
  player.addEventListener('track', () => {
    const t = player.track;
    if (Q().lbToken && t && navigator.onLine) lbSend('playing_now', [{ track_metadata: meta(t) }]).catch(() => {});
  });
  bus.on('music:listened', async ({ track, at }) => {
    if (!Q().lbToken) return;
    const item = { listened_at: Math.floor(at / 1000), track_metadata: meta(track) };
    try { if (navigator.onLine && await lbSend('single', [item])) return; } catch { /* keep it */ }
    const list = (await getSetting(PENDING, [])) || [];
    list.push(item); await setSetting(PENDING, list.slice(-5000));
  });
  window.addEventListener('online', flush);
  setTimeout(flush, 8000);
}

// ── Cast (Chromecast and other remote speakers / TVs the browser knows) ──
export const canCast = (player) => !!player.engine.el?.remote && !navigator.userAgent.includes('Firefox');
export async function cast(player) {
  const el = player.engine.el;
  if (!el?.remote) { toast('Trình duyệt này không hỗ trợ phát lên loa / TV', 'warn'); return; }
  try {
    el.disableRemotePlayback = false;
    await el.remote.prompt();
  } catch (e) {
    toast(e?.name === 'NotSupportedError' ? 'Không phát lên thiết bị khác được với engine hiện tại. Thử Cài đặt → Đầu ra → Engine: Trực tiếp.' : e?.name === 'NotFoundError' ? 'Không tìm thấy loa / TV nào trong mạng' : 'Đã huỷ', 'warn');
  }
}

let started = false;
export function start(player) {
  if (started) return;
  started = true;
  autoDj(player);
  scrobble(player);
}
