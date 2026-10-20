// Small performance helpers shared by every module (core, no dependencies).
//   incremental(box, list, html, opts)  render a long list in chunks as the user scrolls (no cap:
//                                       every item is reachable; only the DOM grows lazily)
//   idle(fn, timeout)                   run when the main thread is free (requestIdleCallback fallback)
//   debounce(fn, ms) / rafThrottle(fn)  coalesce bursts of events
//   yieldToMain()                       let the browser paint between heavy steps
// Shared collators: `a.localeCompare(b, 'vi')` builds a new collator on every call, which dominates
// sorting a big library (20k titles took ~1 s). One Intl.Collator is ~20x faster.
export const cmpVi = new Intl.Collator('vi').compare;
export const cmpViNum = new Intl.Collator('vi', { numeric: true }).compare;

export const idle = (fn, timeout = 500) => (window.requestIdleCallback
  ? requestIdleCallback(fn, { timeout })
  : setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 1));

export const yieldToMain = () => new Promise(r => (globalThis.scheduler?.yield ? scheduler.yield().then(r) : setTimeout(r, 0)));

export function debounce(fn, ms = 150) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function rafThrottle(fn) {
  let q = false, args;
  return (...a) => { args = a; if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...args); }); };
}

// Render `list` into `box` chunk by chunk. html(item, index) -> string. onChunk(fragmentParent, from)
// binds events for the rows just added. Returns a dispose function.
export function incremental(box, list, html, { chunk = 120, first = chunk, onChunk, rootMargin = '800px', append = false } = {}) {
  let n = 0, obs = null, dead = false;
  if (!append) box.innerHTML = '';
  const sentinel = document.createElement('div');
  sentinel.className = 'lazy-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  const more = (size) => {
    if (dead) return;
    const from = n, part = list.slice(n, n + size);
    const tmp = document.createElement('div');
    tmp.innerHTML = part.map((x, i) => html(x, from + i)).join('');
    onChunk?.(tmp, from);
    sentinel.remove();
    box.append(...tmp.childNodes);
    n += part.length;
    if (n < list.length) { box.append(sentinel); if (obs) { obs.unobserve(sentinel); obs.observe(sentinel); } }
    else obs?.disconnect();
  };
  more(first);
  if (n < list.length && 'IntersectionObserver' in window) {
    obs = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) more(chunk); }, { rootMargin });
    obs.observe(sentinel);
  } else if (n < list.length) { while (n < list.length) more(chunk); }
  return () => { dead = true; obs?.disconnect(); };
}

// Memoize an async function until invalidate() is called (e.g. a library index).
export function cached(fn) {
  let p = null;
  const c = () => (p ||= Promise.resolve(fn()).catch(e => { p = null; throw e; }));
  c.invalidate = () => { p = null; };
  return c;
}
