// "Tự ẩn thanh tab": on phones the bottom tab bar of an app slides away while scrolling down and comes back when
// scrolling up (or at the top of the page). Each app can be left out (ui.hide_<app> in Settings).
// The page itself is the scroller (body on phones, see native.css).
import { params } from './params.js';

// Apps with a phone bottom bar (Music and Books); the choice per app is in Settings (ui.hide_music, ui.hide_books).
const APPS = ['music', 'books'];
export function currentApp() {
  const head = location.hash.slice(1).split('/')[0];
  return APPS.includes(head) ? head : null;
}

let on = false, last = 0, bound = false;
const top = () => Math.max(document.body.scrollTop, document.documentElement.scrollTop, window.scrollY || 0);
const show = () => document.body.classList.remove('tabs-hidden');
const wanted = () => { const a = currentApp(); return !!a && !!params.get('ui.hide_' + a); };

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
