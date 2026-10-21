// "Tự ẩn thanh tab": on phones the bottom tab bar of an app slides away while scrolling down and comes back when
// scrolling up (or at the top of the page). Each bottom tab can be left out (ui.hide_<app>_<tab> in Settings).
// The page itself is the scroller (body on phones, see native.css).
import { params } from './params.js';

// Hash route → the bottom tab it belongs to (Music and Books have bottom bars).
const TAB_OF = {
  music: (sub) => (!sub ? 'home' : sub === 'new' || sub === 'stats' ? sub : 'songs'),
  books: (sub) => (!sub ? 'home' : sub === 'library' || sub === 'book' ? 'library' : sub === 'trending' ? 'trending'
    : ['shelves', 'shelf', 'authors', 'author', 'series'].includes(sub) ? 'shelves' : 'tools'),
};

export function currentTab() {
  const [head, sub] = location.hash.slice(1).split('/');
  const f = TAB_OF[head];
  return f ? `${head}_${f(sub)}` : null;
}

let on = false, last = 0, bound = false;
const top = () => Math.max(document.body.scrollTop, document.documentElement.scrollTop, window.scrollY || 0);
const show = () => document.body.classList.remove('tabs-hidden');
const wanted = () => { const k = currentTab(); return !!k && !!params.get('ui.hide_' + k); };

function onScroll() {
  if (!on) return;
  const y = top(), d = y - last;
  if (y < 24 || d < -6) show();
  else if (d > 10 && y > 80 && wanted()) document.body.classList.add('tabs-hidden');
  if (Math.abs(d) > 4) last = y;
}

export function setTabsAutoHide(v) {
  on = !!+v;
  document.body.classList.toggle('tabs-autohide', on);
  if (!on) show();
  if (bound) return;
  bound = true;
  document.body.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('hashchange', () => { last = 0; show(); });
}
