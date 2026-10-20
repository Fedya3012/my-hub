// Music background service: started at boot (manifest.service) and kept running while you
// browse other modules. Owns the mini player dock, keyboard shortcuts, the Library drawer
// extension (play / linked music), auto-play of music linked to books, fanfic and podcasts,
// the album-art accent colour and the demo library.
import './lib/icons.js';
import { db, getSetting, setSetting, uid, now, withoutSyncHooks } from '../../core/db.js';
import { icon } from '../../core/icons.js';
import { esc, toast } from '../../core/ui.js';
import { extend } from '../../core/extensions.js';
import { tasks } from '../../core/tasks.js';
import { player } from './lib/player.js';
import * as store from './lib/store.js';
import { loadPrefs, prefs } from './lib/prefs.js';
import { artHtml, hydrate } from './lib/art.js';
import { badges, techLine, fmtTime } from './lib/format.js';
import { mountDock, unmountDock, showRemote } from './ui/dock.js';
import { attachParams } from './lib/params-bridge.js';

let offs = [], css = null, ctx = null;

export async function start(context) {
  ctx = context;
  css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('./music.css', import.meta.url).href;
  document.head.appendChild(css);
  // Audio path panels (31-band EQ, Hi-Res, outputs, timers, ambient) keep their own stylesheet.
  css.audio = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./audio.css', import.meta.url).href });
  document.head.appendChild(css.audio);
  await loadPrefs();
  await player.init();
  mountDock();
  offs.push(attachParams());
  import('./ui/dnd.js').then(m => offs.push(m.bindGlobalDnd())).catch(e => console.error(e));   // music + audio + playback parameters, player/art/timers services
  import('./ui/lyrics-mini.js').then(m => m.startMiniLyrics()).catch(() => {});
  const B = ctx.bus;
  offs.push(
    B.on('item:open', ({ item }) => player.onItemOpen(item)),
    B.on('item:close', ({ item }) => player.onItemClose(item)),
    // API for other modules: bus.emit('music:play', { kind: 'playlist'|'album'|'artist'|'track', id, shuffle })
    B.on('music:play', ({ kind, id, ids, shuffle }) => ids ? player.play(ids, { shuffle }) : player.playSource(kind, id, { shuffle })),
    B.on('music:pause', () => player.pause()),
    B.on('music:toggle', () => player.toggle()),
    B.on('progress:pulled', async () => { if (player.playing) return; const s = await player.checkRemote(); if (s) showRemote(s); }),
    B.on('theme:changed', accent),
    extend('library.drawer', drawerBlock),
  );
  player.addEventListener('track', accent);
  offs.push(() => player.removeEventListener('track', accent));
  document.addEventListener('keydown', keys);
  offs.push(() => document.removeEventListener('keydown', keys));
}

export async function stop() {
  player.pause();
  offs.forEach(f => f()); offs = [];
  unmountDock();
  css?.audio?.remove();
  css?.remove();
  document.documentElement.style.removeProperty('--accent-music');
}

// Optional: tint the whole app with the playing album's colour.
async function accent() {
  const root = document.documentElement;
  if (root.dataset.musicAccent) { root.style.removeProperty('--accent'); delete root.dataset.musicAccent; }
  const t = player.track;
  if (!t || !prefs().np.appAccent) return;
  const c = (await store.library()).albums.get(t.albumId)?.colors;
  if (!c) return;
  const dark = root.dataset.hubBase === 'dark' || (root.dataset.hubBase === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches) || matchMedia('(prefers-color-scheme: dark)').matches && !root.dataset.hubBase;
  root.style.setProperty('--accent', dark ? c.light : c.dark);
  root.dataset.musicAccent = '1';
}

// Desktop-friendly shortcuts (ignored while typing).
function keys(e) {
  if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!player.track && e.code !== 'Space') return;
  const k = e.key;
  const act = {
    ' ': () => player.toggle(),
    k: () => player.toggle(),
    ArrowRight: () => e.shiftKey ? player.next() : player.seekBy(10),
    ArrowLeft: () => e.shiftKey ? player.prev() : player.seekBy(-10),
    n: () => player.next(), p: () => player.prev(),
    ArrowUp: () => e.shiftKey && player.setVolume(Math.min(1, player.engine.volume + 0.05)),
    ArrowDown: () => e.shiftKey && player.setVolume(Math.max(0, player.engine.volume - 0.05)),
    m: () => player.engine.setMuted(!player.engine.muted),
    s: () => player.setShuffle(!player.shuffle),
    r: () => player.cycleRepeat(),
    l: () => import('./ui/nowplaying.js').then(m => m.openNowPlaying('lyrics')),
    q: () => import('./ui/nowplaying.js').then(m => m.openNowPlaying('queue')),
    f: () => import('./ui/nowplaying.js').then(m => m.isOpen() ? m.closeNowPlaying() : m.openNowPlaying()),
    e: () => import('./ui/eq-panel.js').then(m => m.eqSheet()),
  }[k.length === 1 ? k.toLowerCase() : k];
  if (!act) return;
  if ((k === 'ArrowUp' || k === 'ArrowDown') && !e.shiftKey) return;
  if (k === ' ' && document.activeElement?.closest('button, a')) return;
  e.preventDefault();
  act();
}

// ── Library drawer extension ────────────────────────────────────
async function drawerBlock({ item, el, refresh }) {
  const L = await store.library();
  if (item.type === 'music' || item.type === 'podcast') {
    const t = L.tracks.get(item.id);
    if (!t) return;
    const box = document.createElement('div');
    box.className = 'block mdrawer';
    box.innerHTML = `<h3>Trình phát nhạc</h3>
      <div class="mdrawer-row">${artHtml(L.coverOf(t), t.album || t.title, { cls: 'md' })}
        <div><div class="mbadges">${badges(t.tech, { hiRes: t.hiResNow, size: 'lg' })}</div><p class="muted">${esc(techLine(t.tech))}</p>
          <p class="muted">${esc(t.album || '')}${t.duration ? ' · ' + fmtTime(t.duration) : ''}${t.plays ? ` · đã nghe ${t.plays} lần` : ''}</p></div></div>
      <div class="row-actions"><button class="btn primary" data-p>${icon('play-fill')}Phát</button><button class="btn" data-n>${icon('queue')}Phát tiếp theo</button><button class="btn" data-i>${icon('info')}Thông tin tệp</button></div>`;
    el.appendChild(box);
    hydrate(box);
    box.querySelector('[data-p]').onclick = () => player.onItemOpen(item);
    box.querySelector('[data-n]').onclick = () => player.playNext([item.id]);
    box.querySelector('[data-i]').onclick = () => import('./ui/sheets.js').then(m => m.infoSheet(t));
    return;
  }
  if (!['book', 'fanfic', 'podcast', 'video', 'note'].includes(item.type)) return;
  const linked = await store.musicFor(item.id);
  const box = document.createElement('div');
  box.className = 'block mdrawer';
  box.innerHTML = `<h3>Nhạc nền <button class="btn small" data-add>${icon('music')}Gắn nhạc</button></h3>
    ${linked.length ? `<ul class="mdrawer-list">${linked.map((m, i) => `<li>
      ${m.cover ? artHtml(m.cover, m.name, { cls: 'xs' }) : `<span class="mart xs mpl-ic">${icon(m.kind === 'album' ? 'album' : m.kind === 'track' ? 'music' : 'list')}</span>`}
      <span class="mdrawer-t"><b>${esc(m.name)}</b><small>${{ playlist: 'Danh sách phát', album: 'Album', track: 'Bài hát' }[m.kind]}${m.link.autoplay ? ' · tự phát khi mở' : ''}${m.link.shuffle ? ' · ngẫu nhiên' : ''}</small></span>
      <button class="icon-btn sm" data-play="${i}" aria-label="Phát">${icon('play-fill')}</button>
      <button class="icon-btn sm" data-auto="${i}" aria-pressed="${!!m.link.autoplay}" aria-label="Tự phát khi mở">${icon('bolt')}</button>
      <button class="icon-btn sm" data-rm="${i}" aria-label="Gỡ">${icon('x')}</button></li>`).join('')}</ul>`
      : '<p class="muted">Gắn một danh sách phát hoặc album: khi mở mục này, nhạc sẽ tự phát (bật/tắt trong Nhạc → Tuỳ chỉnh → Liên kết).</p>'}`;
  el.appendChild(box);
  hydrate(box);
  const redo = () => { box.remove(); drawerBlock({ item, el, refresh }); };
  box.querySelector('[data-add]').onclick = () => import('./ui/sheets.js').then(m => m.musicPickerFor(item, redo));
  box.querySelectorAll('[data-play]').forEach(b => b.onclick = async () => {
    const m = linked[+b.dataset.play];
    player.play(await m.tracks(), { shuffle: !!m.link.shuffle, source: { kind: m.kind, id: m.link.fromId, name: m.name, forItem: item.id, forTitle: item.title } });
  });
  box.querySelectorAll('[data-auto]').forEach(b => b.onclick = async () => { const m = linked[+b.dataset.auto]; await db.links.update(m.link.id, { autoplay: m.link.autoplay ? 0 : 1 }); redo(); });
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { await store.unlinkMusic(linked[+b.dataset.rm].link.id); redo(); });
}
