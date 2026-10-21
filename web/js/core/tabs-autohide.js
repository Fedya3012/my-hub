// "Tự ẩn thanh tab": on phones every app's bottom tab bar slides away while scrolling down and comes back when
// scrolling up (or at the top of the page). The page itself is the scroller (body on phones, see native.css).
let on = false, last = 0, bound = false;
const top = () => Math.max(document.body.scrollTop, document.documentElement.scrollTop, window.scrollY || 0);
const show = () => document.body.classList.remove('tabs-hidden');

function onScroll() {
  if (!on) return;
  const y = top(), d = y - last;
  if (y < 24 || d < -6) show();
  else if (d > 10 && y > 80) document.body.classList.add('tabs-hidden');
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
