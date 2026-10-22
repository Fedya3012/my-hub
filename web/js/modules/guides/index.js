// Hướng dẫn sử dụng: numbered table of contents on the left (collapsible, remembered), one guide page at a time.
// Routes: #guides, #guides/<page>, #guides/<page>/<section>.
import { PAGES } from './content.js';

const TOC_KEY = 'hub.guides.tocHidden';
let root;

const pref = () => { try { return localStorage.getItem(TOC_KEY) === '1'; } catch { return false; } };
const setPref = (on) => { try { localStorage.setItem(TOC_KEY, on ? '1' : ''); } catch { /* private mode */ } };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (name) => new URL('./img/' + name, import.meta.url).href;

export async function mount(el, ctx, rest = '') {
  root = el;
  if (!document.querySelector('link[href*="guides/guides.css"]')) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./guides.css', import.meta.url).href }));
  root.innerHTML = `<section class="page gd${pref() ? ' gd-mini' : ''}">
    <aside class="gd-side" aria-label="Mục lục">
      <div class="gd-side-h"><b>Mục lục</b><button type="button" class="gd-btn" data-act="hide" aria-label="Thu gọn mục lục" title="Thu gọn mục lục">‹</button></div>
      <nav class="gd-toc">${toc()}</nav>
    </aside>
    <div class="gd-main">
      <div class="gd-top"><button type="button" class="gd-btn gd-open" data-act="show" aria-label="Mở mục lục">☰ Mục lục</button><span class="gd-cur"></span></div>
      <article class="gd-body"></article>
    </div></section>`;
  root.querySelector('[data-act="hide"]').onclick = () => toggle(true);
  root.querySelector('[data-act="show"]').onclick = () => toggle(false);
  root.querySelector('.gd-body').addEventListener('click', (e) => {
    const im = e.target.closest('figure img'); if (!im) return;
    const lb = Object.assign(document.createElement('div'), { className: 'gd-lb', innerHTML: '<img alt="">' });
    lb.firstChild.src = im.src; lb.onclick = () => lb.remove(); document.body.append(lb);
  });
  navigate(rest);
}

export function unmount() { document.querySelector('.gd-lb')?.remove(); root = null; }

const phone = () => matchMedia('(max-width: 860px)').matches;

// Computers: hide/show the contents column (remembered). Phones: the contents open above the page
// and close again once a page is picked; that state is not remembered.
function toggle(hide) {
  const gd = root.querySelector('.gd');
  if (phone()) { gd.classList.toggle('gd-phone-open', !hide); return; }
  setPref(hide);
  gd.classList.toggle('gd-mini', hide);
}

function toc() {
  let html = '<ol class="gd-l1">', group = null;
  PAGES.forEach((p, i) => {
    if (p.group !== group) {
      if (group) html += '</ol></li>';
      group = p.group;
      if (group) html += `<li class="gd-grp"><span><i>${p.num.split('.')[0]}.</i> ${esc(group)}</span><ol>`;
    }
    html += `<li class="gd-pg" data-page="${p.id}"><a href="#guides/${p.id}"><i>${p.num}.</i> ${esc(p.label)}</a><ol class="gd-secs">${
      p.sections.map(s => `<li class="gd-s${s.level}"><a href="#guides/${p.id}/${s.id}"><i>${s.num}.</i> ${esc(s.title)}</a></li>`).join('')}</ol></li>`;
    if (i === PAGES.length - 1 && group) html += '</ol></li>';
  });
  return html + '</ol>';
}

function home() {
  const groups = [];
  for (const p of PAGES) {
    const key = p.group || p.label;
    let g = groups.find(x => x.key === key);
    if (!g) groups.push(g = { key, num: p.num.split('.')[0], pages: [] });
    g.pages.push(p);
  }
  return `<p class="gd-crumb">My Hub</p><h1>Hướng dẫn sử dụng</h1>
    <p class="gd-lead">Cách cài app, đồng bộ dữ liệu và dùng từng ứng dụng. Chọn một mục ở mục lục hoặc bên dưới. Chạm vào ảnh để phóng to.</p>
    ${groups.map(g => `<h2 class="gd-gh">${g.num}. ${esc(g.key)}</h2><div class="gd-cards">${g.pages.map(p =>
      `<a class="gd-card" href="#guides/${p.id}"><b>${p.num} ${esc(p.label)}</b><span>${esc(p.title)}</span></a>`).join('')}</div>`).join('')}`;
}

export function navigate(rest = '') {
  if (!root) return;
  const [pid, sec] = rest.split('/');
  const i = PAGES.findIndex(p => p.id === pid);
  const p = PAGES[i];
  const body = root.querySelector('.gd-body');
  if (!p) body.innerHTML = home();
  else {
    const prev = PAGES[i - 1], next = PAGES[i + 1];
    body.innerHTML = `<p class="gd-crumb">${p.num} · ${esc(p.label)}</p><h1>${esc(p.title)}</h1>${p.html}
      <nav class="gd-pn">${prev ? `<a href="#guides/${prev.id}"><small>Trước</small>${prev.num}. ${esc(prev.label)}</a>` : '<span></span>'}${
        next ? `<a class="gd-nx" href="#guides/${next.id}"><small>Tiếp</small>${next.num}. ${esc(next.label)}</a>` : ''}</nav>`;
    body.querySelectorAll('img[data-src]').forEach(im => { im.src = img(im.dataset.src); im.loading = 'lazy'; });
  }
  root.querySelectorAll('.gd-pg').forEach(li => li.classList.toggle('open', li.dataset.page === p?.id));
  root.querySelectorAll('.gd-toc a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#guides/' + rest.replace(/\/$/, '') || (!sec && a.getAttribute('href') === '#guides/' + pid)));
  root.querySelector('.gd-cur').textContent = p ? `${p.num}. ${p.label}` : 'Trang đầu';
  root.querySelector('.gd').classList.remove('gd-phone-open');
  const target = sec && body.querySelector(`[data-sec="${CSS.escape(sec)}"]`);
  if (target) target.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
}
