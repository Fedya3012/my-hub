// Drag & drop for music (mouse; touch where the browser supports native drag, otherwise the ⋯ menus
// and the ⠿ handles do the same; keyboard: Alt+↑/↓ on a ⠿ handle reorders).
//  · Files / folders dropped anywhere on the Nhạc page are imported (progress in the task tray).
//  · Songs, albums, artists, groups dragged from any list → drop bar at the bottom: Phát tiếp,
//    Cuối hàng chờ, any playlist, or a new playlist. Dropping on a playlist card / the dock / the
//    queue works too.
//  · An image dropped on an album / artist / playlist / genre … card sets its artwork.
//  · On Now Playing: a video sets the song's background video, .lrc / .ttml / .srt sets its lyrics.
import { dropFiles, setPayload, getPayload, hasPayload, hasFiles, filesFromDrop } from '../../../core/dnd.js';
import { esc, toast } from '../../../core/ui.js';
import { icon } from '../../../core/icons.js';
import { player } from '../lib/player.js';
import * as store from '../lib/store.js';

const isImg = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name);
const isLyr = (f) => /\.(lrc|ttml|srt|txt)$/i.test(f.name);
const GROUP_MAP = { artist: 'artists', albumartist: 'albumArtists', genre: 'genres', year: 'years', label: 'labels', composer: 'composers' };

// Track ids for a dragged element (row, card, queue row).
async function idsOf(el) {
  if (el.dataset.id) return [el.dataset.id];
  const kind = el.dataset.artKind, id = el.dataset.artId;
  if (!kind) return [];
  const L = await store.library();
  if (kind === 'album') return (L.albums.get(id)?.tracks || []).map(t => t.id);
  if (GROUP_MAP[kind]) return (L[GROUP_MAP[kind]].get(id)?.tracks || []).map(t => t.id);
  if (kind === 'playlist') {
    const builtin = store.BUILTIN_SMART.find(s => s.id === id);
    const pl = builtin ? { ...builtin, kind: 'smart' } : L.playlists.find(p => p.id === id);
    return pl ? (await store.playlistTracks(pl)).map(t => t.id) : [];
  }
  return [];
}

// Page-level part, bound while the music page is mounted. Returns off().
export function bindPageDnd(root, { onImport }) {
  const offs = [];
  // Files / folders anywhere on the page → import.
  offs.push(dropFiles(window, {
    overlay: `${icon('plus')} Thả tệp hoặc thư mục nhạc để thêm vào thư viện`,
    when: () => root.isConnected && !document.querySelector('.mnp'),
    onFiles: (files) => {
      const media = files.filter(f => !isImg(f) || files.some(x => !isImg(x)));
      if (!media.length) { toast('Thả ảnh lên một album, nghệ sĩ hay danh sách phát để đổi ảnh bìa', 'warn'); return; }
      onImport(media);
    },
  }));
  // Rows are draggable (set in markup); cards are links, draggable by default.
  const start = async (e) => {
    const el = e.target.closest?.('.mrow[data-id], [data-art-kind]');
    if (!el || !root.contains(el) || e.target.closest('[data-drag]') || dragFromHandle) { if (dragFromHandle) e.preventDefault(); return; }
    // Payload must be set synchronously: rows know their id; cards resolve ids at drop time.
    const name = el.querySelector('.mrow-t, .mcard-t')?.textContent?.trim() || '';
    setPayload(e, 'music', { id: el.dataset.id || null, kind: el.dataset.artKind || null, artId: el.dataset.artId || null, name }, { label: name });
    showDropBar(name);
  };
  let dragFromHandle = false;
  const pd = (e) => { dragFromHandle = !!e.target.closest?.('[data-drag]'); };
  root.addEventListener('pointerdown', pd, true);
  root.addEventListener('dragstart', start);
  offs.push(() => { root.removeEventListener('dragstart', start); root.removeEventListener('pointerdown', pd, true); });
  // Image onto a card / row with artwork; songs onto a playlist card.
  const over = (e) => {
    const t = e.target.closest?.('[data-art-kind]');
    if (!t || !root.contains(t)) return;
    const pl = t.dataset.artKind === 'playlist' && !store.BUILTIN_SMART.some(s => s.id === t.dataset.artId);
    if (hasFiles(e) || (pl && hasPayload(e, 'music'))) { e.preventDefault(); e.stopPropagation(); t.classList.add('drop-ok'); }
  };
  const leave = (e) => e.target.closest?.('[data-art-kind]')?.classList.remove('drop-ok');
  const drop = async (e) => {
    const t = e.target.closest?.('[data-art-kind]');
    if (!t || !root.contains(t)) return;
    t.classList.remove('drop-ok');
    const kind = t.dataset.artKind, id = t.dataset.artId;
    if (hasFiles(e)) {
      e.preventDefault(); e.stopPropagation();
      const img = (await filesFromDrop(e.dataTransfer)).find(isImg);
      if (!img) { toast('Chỉ thả ảnh (JPG, PNG, WebP) lên bìa', 'warn'); return; }
      try { await store.setArtwork(kind, id, img); toast('Đã đổi ảnh'); } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const p = getPayload(e, 'music');
    if (p && kind === 'playlist') { e.preventDefault(); e.stopPropagation(); await addTo(id, p); }
  };
  root.addEventListener('dragover', over); root.addEventListener('dragleave', leave); root.addEventListener('drop', drop);
  offs.push(() => { root.removeEventListener('dragover', over); root.removeEventListener('dragleave', leave); root.removeEventListener('drop', drop); });
  return () => offs.forEach(f => f());
}

// idsOf for a payload (cards resolve lazily).
async function resolve(p) {
  if (p.id) return [p.id];
  const fake = document.createElement('i');
  fake.dataset.artKind = p.kind; fake.dataset.artId = p.artId;
  return idsOf(fake);
}

async function addTo(playlistId, p) {
  const ids = await resolve(p);
  if (!ids.length) return;
  await store.addToPlaylist(playlistId, ids);
  const L = await store.library();
  toast(`Đã thêm ${ids.length} bài vào “${L.playlists.find(x => x.id === playlistId)?.name || 'danh sách phát'}”`);
}

// ── Drop bar: targets for whatever is being dragged, from any page ──
let bar = null;
async function showDropBar(name) {
  hideDropBar();
  const L = await store.library();
  const pls = L.playlists.filter(p => p.kind === 'playlist');
  bar = document.createElement('div');
  bar.className = 'mdropbar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Thả vào');
  bar.innerHTML = `<span class="mdropbar-t">Thả “${esc(name.slice(0, 40))}” vào</span>
    <span class="mdz" data-dz="next">${icon('play')}Phát tiếp</span><span class="mdz" data-dz="queue">${icon('list')}Cuối hàng chờ</span>
    ${pls.map(p => `<span class="mdz" data-dz="pl:${esc(p.id)}">${icon('list')}${esc(p.name)}</span>`).join('')}
    <span class="mdz" data-dz="new">${icon('plus')}Danh sách mới</span>`;
  bar.addEventListener('dragover', (e) => { const z = e.target.closest('[data-dz]'); if (!z || !hasPayload(e, 'music')) return; e.preventDefault(); bar.querySelectorAll('.drop-ok').forEach(x => x !== z && x.classList.remove('drop-ok')); z.classList.add('drop-ok'); });
  bar.addEventListener('dragleave', (e) => e.target.closest?.('[data-dz]')?.classList.remove('drop-ok'));
  bar.addEventListener('drop', async (e) => {
    const z = e.target.closest('[data-dz]'), p = getPayload(e, 'music');
    if (!z || !p) return;
    e.preventDefault(); e.stopPropagation();
    hideDropBar();
    const dz = z.dataset.dz;
    if (dz.startsWith('pl:')) return addTo(dz.slice(3), p);
    const ids = await resolve(p);
    if (!ids.length) return;
    if (dz === 'next') return player.playNext(ids);
    if (dz === 'queue') return player.addToQueue(ids);
    if (dz === 'new') { const pl = await store.createPlaylist(p.name || 'Danh sách mới', ids); toast(`Đã tạo “${pl.name}”`); }
  });
  document.body.appendChild(bar);
}
function hideDropBar() { bar?.remove(); bar = null; }
addEventListener('dragend', () => setTimeout(hideDropBar, 50));

// ── Global part (service): dock / queue accept songs; Now Playing accepts video + lyrics ──
export function bindGlobalDnd() {
  const over = (e) => {
    const q = e.target.closest?.('.mdock, .mqp');
    if (q && hasPayload(e, 'music')) { e.preventDefault(); q.classList.add('drop-ok'); return; }
    const np = e.target.closest?.('.mnp');
    if (np && hasFiles(e)) { e.preventDefault(); np.classList.add('drop-ok'); }
  };
  const leave = (e) => { const x = e.target.closest?.('.mdock, .mqp, .mnp'); if (x && !x.contains(e.relatedTarget)) x.classList.remove('drop-ok'); };
  const drop = async (e) => {
    const q = e.target.closest?.('.mdock, .mqp');
    if (q && hasPayload(e, 'music')) {
      e.preventDefault(); q.classList.remove('drop-ok'); hideDropBar();
      const ids = await resolve(getPayload(e, 'music') || {});
      if (ids.length) player.addToQueue(ids);
      return;
    }
    const np = e.target.closest?.('.mnp');
    if (!np || !hasFiles(e)) return;
    e.preventDefault(); np.classList.remove('drop-ok');
    const t = player.track;
    if (!t) { toast('Chưa có bài nào đang phát', 'warn'); return; }
    const files = await filesFromDrop(e.dataTransfer);
    const vid = files.find(store.isVideoFile), lyr = files.find(isLyr), img = files.find(isImg);
    try {
      if (vid) { await store.setBgVideo('track', t.id, vid); toast('Đã đặt video nền cho bài này'); }
      if (lyr) { await store.setLyrics(t.id, await lyr.text()); toast('Đã đặt lời bài hát'); }
      if (img && !vid && !lyr) { await store.setArtwork('album', t.albumId, img); toast('Đã đổi ảnh bìa album'); }
      if (!vid && !lyr && !img) { toast('Thả video (MP4/WebM), lời (.lrc/.ttml/.srt) hoặc ảnh bìa', 'warn'); return; }
      (await import('./nowplaying.js')).refreshNowPlaying();
    } catch (err) { toast(err.message, 'error'); }
  };
  document.addEventListener('dragover', over); document.addEventListener('dragleave', leave); document.addEventListener('drop', drop);
  return () => { document.removeEventListener('dragover', over); document.removeEventListener('dragleave', leave); document.removeEventListener('drop', drop); };
}
