// Đăng ký (#podcasts/subs): grid or list of subscriptions with unplayed counts, sort, refresh all, add.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import { db } from '../../../core/db.js';
import * as store from '../lib/store.js';
import { get, set } from '../lib/prefs.js';
import { art, fmtDate, bindShows } from './common.js';

export async function render(el, { rerender }) {
  const subs = await store.shows();
  const eps = await db.pcEpisodes.toArray();
  const unplayed = new Map();
  for (const e of eps) if (!e.played && !e.deleted && e.inbox) unplayed.set(e.showId, (unplayed.get(e.showId) || 0) + 1);
  const sort = get('subsSort') || 'recent', view = get('subsView') || 'grid';
  const sorters = { recent: (a, b) => (b.lastEpisodeAt || 0) - (a.lastEpisodeAt || 0), az: (a, b) => a.title.localeCompare(b.title, 'vi'), added: (a, b) => (b.subscribedAt || 0) - (a.subscribedAt || 0), unplayed: (a, b) => (unplayed.get(b.itemId) || 0) - (unplayed.get(a.itemId) || 0) };
  subs.sort(sorters[sort] || sorters.recent);
  el.innerHTML = `<section class="pc-sec"><header><h1>Podcast của tôi <span class="pc-count">${subs.length}</span></h1>
      <div class="row-actions">
        <select data-sort aria-label="Sắp xếp">${[['recent', 'Tập mới nhất'], ['unplayed', 'Nhiều tập mới'], ['added', 'Đăng ký gần đây'], ['az', 'Tên A–Z']].map(([k, l]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="icon-btn" data-a="view" aria-label="${view === 'grid' ? 'Xem dạng danh sách' : 'Xem dạng lưới'}">${icon(view === 'grid' ? 'list' : 'grid')}</button>
        <button class="icon-btn" data-a="refresh" aria-label="Làm mới tất cả">${icon('refresh')}</button>
        <a class="btn primary" href="#podcasts/discover">${icon('pc-plus')}Thêm</a>
      </div></header>
    ${subs.length ? view === 'grid'
      ? `<div class="pc-grid subs">${subs.map(s => `<a class="pc-show" href="#podcasts/show/${encodeURIComponent(s.itemId)}">${art(s.image, s.title)}${unplayed.get(s.itemId) ? `<span class="pc-badge">${unplayed.get(s.itemId)}</span>` : ''}<b>${esc(s.title)}</b></a>`).join('')}</div>`
      : `<ul class="pc-results">${subs.map(s => `<li class="pc-result"><a href="#podcasts/show/${encodeURIComponent(s.itemId)}">${art(s.image, s.title, 'md')}</a><a class="pc-result-main" href="#podcasts/show/${encodeURIComponent(s.itemId)}"><b>${esc(s.title)}</b><small class="muted">${esc(s.author || '')}</small><small class="muted">Tập mới nhất ${fmtDate(s.lastEpisodeAt)}${unplayed.get(s.itemId) ? ` · ${unplayed.get(s.itemId)} tập mới` : ''}</small></a></li>`).join('')}</ul>`
      : `<div class="pc-empty-card">${icon('pc-subs')}<div><b>Chưa có podcast nào</b><p class="muted">Tìm và đăng ký ở Khám phá, dán link RSS, hoặc nhập tệp OPML từ ứng dụng podcast khác (Cài đặt).</p><a class="btn primary" href="#podcasts/discover">${icon('pc-discover')}Khám phá</a></div></div>`}
  </section>`;
  bindShows(el, { rerender });
  el.querySelector('[data-sort]').onchange = async (e) => { await set('subsSort', e.target.value); rerender(); };
  el.querySelector('[data-a="view"]').onclick = async () => { await set('subsView', view === 'grid' ? 'list' : 'grid'); rerender(); };
  el.querySelector('[data-a="refresh"]').onclick = async () => {
    try { const n = await tasks.run({ label: 'Làm mới podcast', cancellable: true }, (t) => store.refreshAll(t)); toast(n ? `${n} tập mới` : 'Không có tập mới'); await store.autoDownload(tasks); }
    catch (e) { if (e?.name !== 'AbortError') toast(e.message, 'error'); }
  };
}
