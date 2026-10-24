// Makes a folded mini player (the round "bubble") movable: drag it anywhere, it snaps to the nearest side edge and
// remembers its place on this device (one place shared by the podcast bar and the music dock).
// Only active while the element has the class "is-folded"; unfolded, the bar is full width and nothing is moved.
const KEY = 'hub.miniPos';
const SIZE = 58, MARGIN = 14, EDGE = 8, THRESHOLD = 6;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable: lasts this session */ } };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function draggableBubble(el) {
  let pos = load(), start = null, moved = false, justDragged = false;

  const clear = () => ['left', 'top', 'right', 'bottom'].forEach(p => el.style.removeProperty(p));
  const put = (left, top) => { el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; };
  const place = () => {
    if (!el.classList.contains('is-folded') || !pos) return clear();   // no saved place: the style sheet's corner
    const W = innerWidth, H = innerHeight;
    put(pos.side === 'l' ? MARGIN : W - SIZE - MARGIN, clamp(pos.y * (H - SIZE), EDGE, H - SIZE - EDGE));
  };

  const down = (e) => {
    if (!el.classList.contains('is-folded') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const r = el.getBoundingClientRect();
    start = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    moved = false;
    // The pointer leaves the small bubble as soon as it moves: follow it on the window until it is released.
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  const move = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved) {
      if (Math.hypot(dx, dy) < THRESHOLD) return;
      moved = true;   // from here it is a drag, not a tap
      el.classList.add('is-dragging');
    }
    put(clamp(start.left + dx, EDGE, innerWidth - SIZE - EDGE), clamp(start.top + dy, EDGE, innerHeight - SIZE - EDGE));
    e.preventDefault();
  };
  const up = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const wasMoved = moved;
    start = null; moved = false;
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    if (!wasMoved) return;
    const r = el.getBoundingClientRect();
    pos = { side: r.left + SIZE / 2 < innerWidth / 2 ? 'l' : 'r', y: clamp(r.top / (innerHeight - SIZE), 0, 1) };
    save(pos);
    el.classList.remove('is-dragging');
    place();   // snaps to the side (animated by the style sheet)
    justDragged = true; setTimeout(() => { justDragged = false; }, 60);
  };
  const noClick = (e) => { if (justDragged) { e.preventDefault(); e.stopPropagation(); } };

  const noNativeDrag = (e) => e.preventDefault();   // the cover is a link + image: the browser would start its own drag
  el.addEventListener('dragstart', noNativeDrag);
  el.addEventListener('pointerdown', down);
  el.addEventListener('click', noClick, true);
  addEventListener('resize', place);
  const mo = new MutationObserver(place);
  mo.observe(el, { attributes: true, attributeFilter: ['class'] });
  place();
  return () => {
    el.removeEventListener('pointerdown', down); el.removeEventListener('dragstart', noNativeDrag);
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    el.removeEventListener('click', noClick, true);
    removeEventListener('resize', place); mo.disconnect(); clear();
  };
}
