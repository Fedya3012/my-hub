// Reader audio switch: one small button in the reader's top bar picks what plays while you read
// (Trình phát nhạc, Podcast, or any app that registers an audio source). Only the chosen app's
// dock stays visible (body[data-audio-source]); starting playback in another app switches to it.
//
// Providers (docs/MODULES.md, extension point 'audio.sources'):
//   extend('audio.sources', () => ({ id, name, icon, hasMedia(), playing(), title(), play(), pause(), onChange(cb) → off }))
import { extensions } from '../../../core/extensions.js';
import { getSetting, setSetting } from '../../../core/db.js';
import { icon } from '../../../core/icons.js';
import { esc } from '../../../core/ui.js';

const KEY = 'books.readerAudio';
const sources = () => extensions('audio.sources').map(f => { try { return f(); } catch { return null; } }).filter(Boolean);

export async function audioSwitch(btn) {
  const offs = [];
  let active = await getSetting(KEY, null);
  const list = () => sources();
  const pick = () => {
    const all = list();
    // The one playing wins, then the remembered one, then the first with something loaded.
    return (all.find(s => s.playing()) || all.find(s => s.id === active) || all.find(s => s.hasMedia()) || all[0])?.id || null;
  };
  const apply = () => {
    const all = list();
    btn.hidden = !all.length || !all.some(s => s.hasMedia()) && all.length < 2;
    const cur = all.find(s => s.id === active);
    if (cur) { document.body.dataset.audioSource = cur.id; btn.innerHTML = icon(cur.icon); btn.setAttribute('aria-label', 'Âm thanh khi đọc: ' + cur.name); btn.classList.toggle('on', cur.playing()); }
    else delete document.body.dataset.audioSource;
  };
  const choose = async (id, { play = true } = {}) => {
    active = id;
    await setSetting(KEY, id);
    for (const s of list()) if (s.id !== id && s.playing()) s.pause();
    const s = list().find(x => x.id === id);
    if (play && s?.hasMedia() && !s.playing()) s.play();
    apply();
  };
  active = pick();
  // Something started in an app that is not the chosen one: follow it (one sound at a time).
  const watch = () => {
    for (const s of list()) {
      const off = s.onChange?.(() => {
        if (s.playing() && s.id !== active) choose(s.id, { play: false });
        else apply();
        if (pop) render();
      });
      if (off) offs.push(off);
    }
  };
  watch();
  apply();

  let pop = null;
  const render = () => {
    pop.innerHTML = `<p class="bk-ra-h">Nghe khi đọc</p>${list().map(s => `
      <div class="bk-ra-row${s.id === active ? ' on' : ''}" data-id="${esc(s.id)}">
        <button class="bk-ra-pick" data-pick role="menuitemradio" aria-checked="${s.id === active}">${icon(s.icon)}<span><b>${esc(s.name)}</b><small>${esc(s.hasMedia() ? (s.title() || '') : 'Chưa có gì để phát')}</small></span></button>
        ${s.hasMedia() ? `<button class="icon-btn" data-pp aria-label="${s.playing() ? 'Tạm dừng' : 'Phát'}">${s.playing() ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' : icon('play')}</button>` : ''}
      </div>`).join('')}`;
    pop.querySelectorAll('.bk-ra-row').forEach(r => {
      const s = list().find(x => x.id === r.dataset.id);
      r.querySelector('[data-pick]').onclick = async () => { await choose(s.id); render(); };
      r.querySelector('[data-pp]')?.addEventListener('click', async () => { if (s.playing()) s.pause(); else await choose(s.id); render(); });
    });
  };
  const hide = () => { pop?.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) hide(); };
  btn.onclick = () => {
    if (pop) return hide();
    pop = document.createElement('div');
    pop.className = 'bk-ra';
    pop.setAttribute('role', 'menu');
    btn.closest('.bk-reader').append(pop);
    render();
    const r = btn.getBoundingClientRect();
    pop.style.top = r.bottom + 6 + 'px';
    pop.style.right = Math.max(8, innerWidth - r.right) + 'px';
    document.addEventListener('pointerdown', outside, true);
  };
  return () => { hide(); offs.forEach(f => f()); delete document.body.dataset.audioSource; };
}
