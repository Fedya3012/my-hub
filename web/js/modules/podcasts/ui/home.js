// Trang chủ: search bar, category chips, Nghe tiếp (big cards), Tập mới (inbox), Top podcast tuần này, Khám phá tập.
import { icon } from '../../../core/icons.js';
import { esc } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { CATEGORIES, topCharts } from '../lib/online.js';
import { player } from '../lib/player.js';
import { art, episodeList, bindEpisodes, bindShows, showCard, fmtLen, fmtDate } from './common.js';

let chartCache = null;   // { at, list } — charts change slowly; one fetch per session is plenty

export async function render(el, { ctx, go }) {
  const [cont, inbox, subs, latest] = await Promise.all([store.continueListening(10), store.inbox(), store.shows(), store.latest(30)]);
  const hello = (() => { const h = new Date().getHours(); return h < 11 ? 'Chào buổi sáng' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'; })();
  const surprise = latest.filter(e => !e.played).sort(() => Math.random() - 0.5).slice(0, 4);
  el.innerHTML = `
    <div class="pc-hero">
      <h1>${hello}</h1>
      <form class="pc-search" role="search" data-search>
        ${icon('search')}<input type="search" name="q" placeholder="Tìm podcast, người dẫn, khách mời, chủ đề…" autocomplete="off" enterkeyhint="search">
        <button type="submit" class="pc-search-go" aria-label="Tìm">${icon('pc-discover')}</button>
      </form>
      <div class="pc-chips" role="list">${CATEGORIES.map(([id, vi]) => `<a role="listitem" class="chip" href="#podcasts/discover/${id ? 'genre:' + id : ''}">${esc(vi)}</a>`).join('')}</div>
    </div>

    ${cont.length ? `<section class="pc-sec"><header><h2>Nghe tiếp</h2><a href="#podcasts/queue">Hàng chờ ›</a></header>
      <div class="pc-rail pc-cont">${cont.map(e => contCard(e)).join('')}</div></section>` : ''}

    <section class="pc-sec"><header><h2>Tập mới ${inbox.length ? `<span class="pc-count">${inbox.length}</span>` : ''}</h2>${inbox.length ? '<a href="#podcasts/inbox">Hộp tập mới ›</a>' : ''}</header>
      ${subs.length ? await episodeList(inbox.length ? inbox.slice(0, 4) : latest.slice(0, 4), { empty: 'Chưa có tập mới.' })
        : `<div class="pc-empty-card">${icon('podcast')}<div><b>Chưa đăng ký podcast nào</b><p class="muted">Tìm theo tên, người dẫn hoặc chủ đề, dán link RSS riêng, hoặc thả tệp âm thanh vào đây.</p>
          <div class="row-actions"><a class="btn primary" href="#podcasts/discover">${icon('pc-discover')}Khám phá</a><a class="btn" href="#podcasts/settings">${icon('pc-upload')}Nhập tệp / OPML</a></div></div></div>`}
    </section>

    <section class="pc-sec"><header><h2>Top podcast tuần này</h2><a href="#podcasts/discover/charts">Bảng xếp hạng ›</a></header>
      <div class="pc-rail pc-shows" data-charts>${Array.from({ length: 6 }, () => '<span class="pc-show sk"><span class="pc-art"></span><b></b><small></small></span>').join('')}</div></section>

    ${surprise.length ? `<section class="pc-sec"><header><h2>Khám phá tập</h2><a href="#podcasts/lists/f-unplayed">Tất cả ›</a></header>
      ${await episodeList(surprise)}</section>` : ''}
  `;
  const form = el.querySelector('[data-search]');
  form.onsubmit = (e) => { e.preventDefault(); const q = form.q.value.trim(); if (q) go('discover/' + encodeURIComponent(q)); };
  const off = bindEpisodes(el, { ctx });
  bindShows(el, { rerender: () => loadCharts(el.querySelector("[data-charts]")) });
  el.querySelectorAll('[data-cont]').forEach(b => b.addEventListener('click', async (ev) => { ev.preventDefault(); const e = await store.episode(b.dataset.cont); if (e) { await player.playEpisode(e); go('play'); } }));
  loadCharts(el.querySelector('[data-charts]'));
  return off;
}

function contCard(e) {
  const p = e.progress, pct = p?.total ? p.position / p.total * 100 : 0;
  return `<a class="pc-cont-card" href="#podcasts/episode/${encodeURIComponent(e.id)}">
    ${art(e.image || e.show?.image, e.show?.title || e.title, 'lg')}
    <button class="pc-round big" data-cont="${esc(e.id)}" aria-label="Nghe tiếp">${icon('pc-play')}</button>
    <span class="pc-bar"><i style="width:${pct}%"></i></span>
    <b>${esc(e.title)}</b><small class="muted">${esc(e.show?.title || '')} · còn ${fmtLen((p?.total || e.duration) - (p?.position || 0))} · ${fmtDate(p?.updatedAt)}</small>
  </a>`;
}

async function loadCharts(box) {
  try {
    if (!chartCache || Date.now() - chartCache.at > 6 * 3600e3) chartCache = { at: Date.now(), list: await topCharts({ limit: 20 }) };
    if (!box.isConnected) return;
    box.innerHTML = chartCache.list.length ? chartCache.list.map((s, i) => showCard(s, { rank: i + 1 })).join('') : '<p class="muted">Chưa tải được bảng xếp hạng.</p>';
  } catch (e) {
    if (box.isConnected) box.innerHTML = `<p class="muted">Chưa tải được bảng xếp hạng. ${e.code === 'cors' ? 'Trình duyệt chặn (CORS): dùng app Windows/Android hoặc đặt Proxy CORS trong Cài đặt.' : 'Kiểm tra mạng.'}</p>`;
  }
}
