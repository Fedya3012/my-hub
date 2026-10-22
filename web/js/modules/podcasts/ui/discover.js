// Khám phá: online search (Podcast Index + iTunes; by everything, show name, or person = host / guest), search
// history and suggestions from what you listen to, charts, trending, categories, and a private RSS link.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import * as store from '../lib/store.js';
import { search, topCharts, trending, CATEGORIES, hasPodcastIndex, SOURCES, sourceNames } from '../lib/online.js';
import { get, set } from '../lib/prefs.js';
import { normFeed } from '../lib/net.js';
import { art, showCard, bindShows } from './common.js';

const KINDS = [['all', 'Tất cả'], ['title', 'Tên podcast'], ['person', 'Người dẫn / khách mời']];
let kind = 'all', ctl = null;
const SRC = [['all', 'Tất cả các nguồn'], ['pi', SOURCES.pi], ['itunes', SOURCES.itunes]];

export async function render(el, { arg, go }) {
  const q = arg && !/^(genre:|charts$|trending$)/.test(arg) ? arg : '';
  el.innerHTML = `
    <div class="pc-hero slim">
      <form class="pc-search" role="search" data-search>
        ${icon('search')}<input type="search" name="q" value="${esc(q)}" placeholder="Tên show, người dẫn, khách mời, từ khoá, thể loại…" autocomplete="off" enterkeyhint="search" list="pc-sugg">
        <button type="submit" class="pc-search-go" aria-label="Tìm">${icon('pc-discover')}</button>
      </form>
      <datalist id="pc-sugg"></datalist>
      <div class="pc-src"><span class="muted">Nguồn tìm</span><div class="pc-seg" role="radiogroup" aria-label="Nguồn tìm kiếm">${SRC.map(([k, l]) => `<button type="button" role="radio" aria-checked="${(get('searchSource') || 'all') === k}" data-source="${k}">${l}${k === 'pi' && !hasPodcastIndex() ? ' 🔑' : ''}</button>`).join('')}</div></div>
      <div class="pc-seg" role="radiogroup" aria-label="Tìm theo">${KINDS.map(([k, l]) => `<button type="button" role="radio" aria-checked="${k === kind}" data-kind="${k}">${l}</button>`).join('')}</div>
    </div>
    <div data-body></div>`;
  const form = el.querySelector('[data-search]'), body = el.querySelector('[data-body]'), dl = el.querySelector('#pc-sugg');
  const fillSugg = async () => { dl.innerHTML = (await store.suggestions(form.q.value)).map(s => `<option value="${esc(s)}">`).join(''); };
  form.q.addEventListener('input', fillSugg); fillSugg();
  form.onsubmit = (e) => { e.preventDefault(); const v = form.q.value.trim(); if (v) go('discover/' + encodeURIComponent(v)); };
  el.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { kind = b.dataset.kind; el.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-checked', x === b)); if (q) results(body, q); });
  el.querySelectorAll('[data-source]').forEach(btn => btn.onclick = async () => { await set('searchSource', btn.dataset.source); el.querySelectorAll('[data-source]').forEach(x => x.setAttribute('aria-checked', x === btn)); const v = form.q.value.trim(); if (v) results(body, v); });
  body.addEventListener('click', onSubscribeClick);
  bindShows(el);
  if (q) await results(body, q);
  else if (arg?.startsWith('genre:')) await genre(body, arg.slice(6));
  else await landing(body, arg);
  return () => ctl?.abort();
}

async function results(body, q) {
  ctl?.abort(); ctl = new AbortController();
  await store.rememberSearch(q);
  body.innerHTML = `<p class="muted pc-loading">${icon('search')} Đang tìm “${esc(q)}”…</p>`;
  // A pasted feed link is subscribed to directly.
  if (/^(https?|feed|itpc|pcast):\/\//i.test(q)) return rssBox(body, q);
  try {
    const list = await search(q, { kind, source: get('searchSource') || 'all', signal: ctl.signal });
    const subs = new Set((await store.shows()).map(s => s.feedUrl));
    body.innerHTML = `<section class="pc-sec"><header><h2>${list.length} kết quả cho “${esc(q)}”</h2><small class="muted">Nguồn: ${esc(SRC.find(x => x[0] === (get('searchSource') || 'all'))[1])}${(get('searchSource') || 'all') === 'all' && !hasPodcastIndex() ? ' · chỉ Apple Podcasts, thêm khoá Podcast Index trong Cài đặt để tìm rộng hơn' : ''}</small></header>
      ${list.length ? `<ul class="pc-results">${list.map(r => resultRow(r, subs.has(normFeed(r.feedUrl)))).join('')}</ul>` : '<p class="muted pc-empty">Không tìm thấy. Thử từ khoá khác, tìm theo người, hoặc dán link RSS.</p>'}</section>`;
  } catch (e) {
    if (e?.name === 'AbortError') return;
    body.innerHTML = `<p class="pc-empty">Không tìm được: ${esc(e.message)}</p>`;
  }
}

function resultRow(r, subscribed) {
  const stars = r.rating ? `<span class="pc-stars" title="${r.rating.toFixed(1)} / 5">${'★'.repeat(Math.round(r.rating))}<i>${'★'.repeat(5 - Math.round(r.rating))}</i></span>` : '';
  return `<li class="pc-result">
    <a href="#podcasts/preview/${encodeURIComponent(r.feedUrl)}">${art(r.image, r.title, 'md')}</a>
    <a class="pc-result-main" href="#podcasts/preview/${encodeURIComponent(r.feedUrl)}">
      <b>${esc(r.title)}</b>
      <small class="muted">${esc(r.author || '')}</small>
      <small class="muted">${[r.episodes ? r.episodes + ' tập' : '', r.categories?.slice(0, 2).join(', '), r.guestIn ? 'Khách mời trong: ' + r.guestIn : ''].filter(Boolean).map(esc).join(' · ')} ${stars}</small>
      <small class="pc-source">${icon('pc-wifi')}Nguồn: ${esc(sourceNames(r.sources) || 'Không rõ')}</small>
    </a>
    <button class="btn ${subscribed ? '' : 'primary'} pc-sub" data-sub="${esc(r.feedUrl)}" ${subscribed ? 'disabled' : ''}>${icon(subscribed ? 'pc-check' : 'pc-plus')}${subscribed ? 'Đã đăng ký' : 'Đăng ký'}</button>
  </li>`;
}

async function onSubscribeClick(ev) {
  const b = ev.target.closest('[data-sub]');
  if (!b) return;
  ev.preventDefault();
  b.disabled = true;
  const { seen } = await import('../lib/online.js');
  const r = seen.get(b.dataset.sub) || { feedUrl: b.dataset.sub };
  try {
    await tasks.run({ label: 'Đăng ký podcast', detail: r.title || r.feedUrl, cancellable: true }, (t) => store.subscribe(r, { signal: t.signal }));
    b.innerHTML = `${icon('pc-check')}Đã đăng ký`; b.classList.remove('primary');
    toast(`Đã đăng ký ${r.title || 'podcast'}`);
  } catch (e) { b.disabled = false; if (e?.name !== 'AbortError') toast(e.message, 'error'); }
}

async function landing(body, arg) {
  const [hist, sugg] = await Promise.all([store.searchHistory(10), store.suggestions('')]);
  const topics = sugg.filter(s => !hist.some(h => h.q === s)).slice(0, 8);
  body.innerHTML = `
    ${hist.length ? `<section class="pc-sec"><header><h2>Tìm gần đây</h2><button class="btn ghost sm" data-clear>Xoá lịch sử</button></header>
      <div class="pc-chips">${hist.map(h => `<a class="chip" href="#podcasts/discover/${encodeURIComponent(h.q)}">${icon('search')}${esc(h.q)}</a>`).join('')}</div></section>` : ''}
    ${topics.length ? `<section class="pc-sec"><header><h2>Gợi ý cho bạn</h2><small class="muted">Từ những gì bạn nghe</small></header>
      <div class="pc-chips">${topics.map(t => `<a class="chip accent" href="#podcasts/discover/${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div></section>` : ''}
    <section class="pc-sec"><header><h2>Thể loại</h2></header>
      <div class="pc-cats">${CATEGORIES.slice(1).map(([id, vi], i) => `<a class="pc-cat" style="--h:${(i * 37) % 360}" href="#podcasts/discover/genre:${id}">${esc(vi)}</a>`).join('')}</div></section>
    <section class="pc-sec"><header><h2>${arg === 'trending' ? 'Đang thịnh hành' : 'Bảng xếp hạng'}</h2>
      <div class="pc-seg sm"><a href="#podcasts/discover/charts" aria-current="${arg !== 'trending'}">Top Apple</a><a href="#podcasts/discover/trending" aria-current="${arg === 'trending'}">Thịnh hành</a></div></header>
      <div class="pc-grid" data-charts><p class="muted pc-loading">Đang tải…</p></div></section>
    <section class="pc-sec"><header><h2>Thêm bằng link RSS</h2><small class="muted">Feed riêng, Patreon, Supercast, Substack…</small></header>
      <form class="pc-rss" data-rss>${icon('pc-rss')}<input type="url" name="u" placeholder="https://…/feed.xml" required><button class="btn primary">Đăng ký</button></form></section>`;
  body.querySelector('[data-clear]')?.addEventListener('click', async () => { await store.clearSearchHistory(); landing(body, arg); });
  body.querySelector('[data-rss]').onsubmit = (e) => { e.preventDefault(); rssBox(body, e.target.u.value.trim(), true); };
  const box = body.querySelector('[data-charts]');
  try {
    const list = arg === 'trending' ? await trending() : await topCharts({ limit: 30 });
    if (box.isConnected) box.innerHTML = list.map((s, i) => showCard(s, { rank: arg === 'trending' ? null : i + 1 })).join('') || '<p class="muted">Chưa có dữ liệu.</p>';
  } catch (e) { if (box.isConnected) box.innerHTML = `<p class="muted">Không tải được (${esc(e.message)}).</p>`; }
}

async function genre(body, id) {
  const name = CATEGORIES.find(c => c[0] === id)?.[1] || 'Thể loại';
  body.innerHTML = `<section class="pc-sec"><header><h2>Top ${esc(name)}</h2><a href="#podcasts/discover">‹ Khám phá</a></header><div class="pc-grid" data-charts><p class="muted pc-loading">Đang tải…</p></div></section>`;
  const box = body.querySelector('[data-charts]');
  try { const list = await topCharts({ genre: id, limit: 40 }); box.innerHTML = list.map((s, i) => showCard(s, { rank: i + 1 })).join('') || '<p class="muted">Chưa có dữ liệu.</p>'; }
  catch (e) { box.innerHTML = `<p class="muted">Không tải được (${esc(e.message)}).</p>`; }
}

// Subscribe to a feed URL (private feeds included: the link often carries its own token).
async function rssBox(body, url, fromForm = false) {
  const feedUrl = normFeed(url);
  try {
    const id = await tasks.run({ label: 'Đăng ký từ link RSS', detail: feedUrl, cancellable: true }, (t) => store.subscribe({ feedUrl, sources: ['rss'] }, { signal: t.signal }));
    toast('Đã đăng ký');
    location.hash = 'podcasts/show/' + encodeURIComponent(id);
  } catch (e) {
    if (e?.name === 'AbortError') return;
    if (fromForm) toast(e.message, 'error');
    else body.innerHTML = `<p class="pc-empty">Không đọc được RSS: ${esc(e.message)}</p>`;
  }
}
