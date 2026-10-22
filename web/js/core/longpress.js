// Press and hold (touch, pen or mouse) or right-click an item: one handler for "show this item's options".
// onHold(root, selector, fn): fn(itemEl, event). Safe to call again after a redraw: the newest fn is used and
// the listeners are only added once per root and selector. The click that ends a long press is swallowed.
const reg = new WeakMap();

export function onHold(root, selector, fn, { ms = 500 } = {}) {
  if (!root) return;
  let byRoot = reg.get(root);
  if (!byRoot) reg.set(root, byRoot = new Map());
  const known = byRoot.get(selector);
  if (known) { known.fn = fn; return; }
  const st = { fn };
  byRoot.set(selector, st);
  let timer = null, at = null, item = null, fired = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  const run = (el, e) => { fired = Date.now(); st.fn(el, e); };
  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const el = e.target.closest(selector);
    if (!el || !root.contains(el)) return;
    item = el; at = [e.clientX, e.clientY]; cancel();
    timer = setTimeout(() => { timer = null; navigator.vibrate?.(15); run(item, e); }, ms);
  }, true);   // capture: items with their own pointer handlers (drag & drop) may stop the event bubbling
  root.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - at[0], e.clientY - at[1]) > 10) cancel(); }, true);
  for (const t of ['pointerup', 'pointercancel']) root.addEventListener(t, cancel, true);
  root.addEventListener('contextmenu', (e) => {
    const el = e.target.closest(selector);
    if (!el || !root.contains(el)) return;
    e.preventDefault(); cancel();
    if (Date.now() - fired > 800) run(el, e);   // Android also sends contextmenu after a long press
  });
  root.addEventListener('click', (e) => {
    if (Date.now() - fired < 700 && e.target.closest(selector)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}
