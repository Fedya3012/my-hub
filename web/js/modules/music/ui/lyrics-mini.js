// Current lyric line on the mini player / dock (Namida & Symfonium show it under the title).
// Ticks 4× a second only while playing, visible and the dock is shown; writes text only on change.
import { player } from '../lib/player.js';
import { prefs } from '../lib/prefs.js';
import { parseLyrics, lineAt, mergeTranslation, ensureLyricsCss } from '../lib/lyrics.js';
import { getLyricsRow } from '../lib/lyrics-sources.js';

let parsed = null, offset = 0, forId = null, timer = 0, lastKey = '';

async function load() {
  const t = player.track;
  forId = t?.id || null; parsed = null; lastKey = '';
  if (!t) return;
  const row = await getLyricsRow(t.id).catch(() => null);
  if (forId !== t.id) return;
  const p = row ? mergeTranslation(parseLyrics(row.text, t.duration), row.trText) : null;
  parsed = p?.synced ? p : null; offset = +row?.offset || 0;
}

function tick() {
  const dock = document.querySelector('.mdock');
  const meta = dock?.querySelector('.mdock-meta');
  let el = meta?.querySelector('.mdock-ly');
  const on = parsed && prefs().lyrics?.mini !== 0 && !document.body.classList.contains('mnp-open');
  if (!on) { if (el) { el.remove(); dock?.classList.remove('has-ly'); } lastKey = ''; return; }
  if (!meta) return;
  if (!el) { el = document.createElement('span'); el.className = 'mdock-ly'; el.setAttribute('aria-live', 'off'); meta.appendChild(el); dock.classList.add('has-ly'); lastKey = ''; }
  const hit = lineAt(parsed, (player.engine.preciseTime ?? player.time) + offset);
  const txt = hit?.line.text || '';
  const key = (hit?.i ?? -1) + txt;
  if (key === lastKey) return;
  lastKey = key;
  el.textContent = txt ? '♪ ' + txt : '';
  el.classList.toggle('empty', !txt);
}

function sched() {
  clearInterval(timer); timer = 0;
  if (player.playing && document.visibilityState === 'visible') timer = setInterval(tick, 250);
  tick();
}

let started = false;
export function startMiniLyrics() {
  if (started) return;
  started = true;
  ensureLyricsCss();
  player.addEventListener('track', () => load().then(sched));
  player.addEventListener('state', sched);
  document.addEventListener('visibilitychange', sched);
  import('../../../core/bus.js').then(({ bus }) => { bus.on('music:prefs', () => tick()); bus.on('music:lyrics', () => load().then(sched)); });
  load().then(sched);
}
