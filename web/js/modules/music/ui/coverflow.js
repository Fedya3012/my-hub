// Cover Flow: albums in 3D, the focused one facing you with a reflection.
// Drag/swipe, mouse wheel, arrow keys or the slider to browse; click the centre album to open it.
import { esc } from '../../../core/ui.js';
import { icon } from '../../../core/icons.js';
import { artHtml, hydrate } from '../lib/art.js';

export function coverFlow(el, albums, { onOpen, onPlay, start = Math.floor((albums.length - 1) / 2) } = {}) {
  if (!albums.length) { el.innerHTML = ''; return () => {}; }
  let pos = Math.min(start, albums.length - 1), target = pos, raf = 0;
  el.classList.add('mcf');
  el.tabIndex = 0;
  el.setAttribute('aria-roledescription', 'Cover Flow');
  el.innerHTML = `<div class="mcf-stage">${albums.map((a, i) => `<button class="mcf-item" data-i="${i}" aria-label="${esc(a.title)} – ${esc(a.artist)}">${artHtml(a.cover, a.title, { cls: 'cf' })}</button>`).join('')}</div>
    <div class="mcf-cap"><b data-t></b><span data-a></span><button class="btn small primary" data-play>${icon('play-fill')}Phát album</button></div>
    <input class="mcf-range" type="range" min="0" max="${albums.length - 1}" value="${pos}" aria-label="Chọn album">`;
  hydrate(el);
  const items = [...el.querySelectorAll('.mcf-item')];
  const range = el.querySelector('.mcf-range');

  function layout() {
    const w = el.clientWidth;
    const size = Math.min(w < 600 ? w * 0.52 : 300, 300);
    el.style.setProperty('--cf', size + 'px');
    const step = size * (w < 600 ? 0.3 : 0.26), push = size * 0.42;
    for (let i = 0; i < items.length; i++) {
      const o = i - pos, a = Math.abs(o);
      if (a > 9) { items[i].style.visibility = 'hidden'; continue; }
      const s = Math.sign(o), near = Math.min(1, a);
      const x = o * step + s * push * near;
      const rot = -s * 62 * near;
      const z = -near * size * 0.55 - a * 4;
      items[i].style.visibility = '';
      items[i].style.transform = `translate3d(${x}px,0,${z}px) rotateY(${rot}deg)`;
      items[i].style.zIndex = 1000 - Math.round(a * 10);
      items[i].style.filter = a > 0.5 ? `brightness(${1 - Math.min(0.45, a * 0.08)})` : '';
      items[i].tabIndex = a < 0.5 ? 0 : -1;
    }
    const cur = albums[Math.round(pos)];
    el.querySelector('[data-t]').textContent = cur.title;
    el.querySelector('[data-a]').textContent = cur.artist + (cur.year ? ' · ' + cur.year : '');
  }

  function animate() {
    cancelAnimationFrame(raf);
    const tick = () => {
      pos += (target - pos) * 0.18;
      if (Math.abs(target - pos) < 0.002) pos = target;
      layout();
      if (pos !== target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  const go = (i) => { target = Math.max(0, Math.min(albums.length - 1, Math.round(i))); range.value = target; animate(); };

  items.forEach(b => b.onclick = () => { const i = +b.dataset.i; if (i === Math.round(pos) && !dragged) onOpen?.(albums[i]); else go(i); });
  el.querySelector('[data-play]').onclick = () => onPlay?.(albums[Math.round(target)]);
  range.oninput = () => go(+range.value);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { go(target - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { go(target + 1); e.preventDefault(); }
    if (e.key === 'Enter' && e.target === el) onOpen?.(albums[target]);
  });
  let wheelAcc = 0;
  el.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if (!d) return;
    e.preventDefault();
    wheelAcc += d;
    if (Math.abs(wheelAcc) > 40) { go(target + Math.sign(wheelAcc)); wheelAcc = 0; }
  }, { passive: false });
  // Drag with inertia.
  let x0 = null, p0 = 0, dragged = false, lastX = 0, lastT = 0, v = 0;
  const stage = el.querySelector('.mcf-stage');
  stage.addEventListener('pointerdown', (e) => { x0 = e.clientX; p0 = pos; dragged = false; lastX = e.clientX; lastT = performance.now(); v = 0; cancelAnimationFrame(raf); });
  stage.addEventListener('pointermove', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 6) { dragged = true; stage.setPointerCapture?.(e.pointerId); }
    if (!dragged) return;
    const step = parseFloat(getComputedStyle(el).getPropertyValue('--cf')) * 0.3 || 90;
    pos = Math.max(0, Math.min(albums.length - 1, p0 - dx / step));
    const t = performance.now(); v = (e.clientX - lastX) / Math.max(1, t - lastT); lastX = e.clientX; lastT = t;
    layout();
  });
  const end = () => { if (x0 == null) return; x0 = null; if (dragged) { target = pos; go(pos - v * 6); setTimeout(() => dragged = false, 0); } };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  const ro = new ResizeObserver(layout); ro.observe(el);
  layout();
  return () => { ro.disconnect(); cancelAnimationFrame(raf); };
}
