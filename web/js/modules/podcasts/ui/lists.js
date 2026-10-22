// Danh sách (#podcasts/lists[/<id>]): smart filters (built-in and your own), playlists, downloads, bookmarks, stats.
import { icon } from '../../../core/icons.js';
import { esc, toast, confirmBox } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { episodeList, bindEpisodes, fmtLen, fmtClock, pick } from './common.js';

export async function render(el, { arg, ctx, go, rerender }) {
  if (arg) return detail(el, arg, { ctx, go, rerender });
  const [lists, dls, marks, st] = await Promise.all([store.playlists(), store.downloads(), store.bookmarks(), store.stats()]);
  const size = dls.reduce((a, e) => a + (e.download?.size || 0), 0);
  const tile = (href, ic, name, sub = '') => `<a class="pc-tile" href="#podcasts/lists/${encodeURIComponent(href)}">${icon(ic)}<b>${esc(name)}</b>${sub ? `<small class="muted">${esc(sub)}</small>` : ''}</a>`;
  el.innerHTML = `
    <section class="pc-stats">
      <div><b>${fmtLen(st.listened) || '0 phút'}</b><small>đã nghe</small></div>
      <div><b>${st.finished}</b><small>tập nghe xong</small></div>
      <div><b>${fmtLen(st.saved) || '0 phút'}</b><small>tiết kiệm nhờ bỏ khoảng lặng</small></div>
      <div><b>${st.shows}</b><small>podcast đăng ký</small></div>
    </section>
    <section class="pc-sec"><header><h2>Bộ lọc thông minh</h2><button class="btn ghost sm" data-a="newsmart">${icon('pc-plus')}Bộ lọc mới</button></header>
      <div class="pc-tiles">${store.BUILTIN_FILTERS.map(f => tile(f.id, f.icon, f.name)).join('')}${lists.filter(p => p.kind === 'smart').map(p => tile(p.id, 'pc-filter', p.name, 'Bộ lọc của bạn')).join('')}</div></section>
    <section class="pc-sec"><header><h2>Danh sách của bạn</h2><button class="btn ghost sm" data-a="newlist">${icon('pc-plus')}Danh sách mới</button></header>
      <div class="pc-tiles">${lists.filter(p => p.kind === 'list').map(p => tile(p.id, 'pc-queue', p.name, `${p.episodeIds?.length || 0} tập`)).join('') || '<p class="muted">Chưa có. Thêm tập từ menu ⋯ của tập.</p>'}</div></section>
    <section class="pc-sec"><header><h2>Đã tải về máy</h2><small class="muted">${dls.length} tập · ${(size / 1e6).toFixed(0)} MB</small><a href="#podcasts/lists/f-downloaded">Xem ›</a></header></section>
    <section class="pc-sec"><header><h2>Dấu trang</h2><small class="muted">${marks.length}</small></header>
      ${marks.length ? `<ul class="pc-marks">${(await Promise.all(marks.slice(0, 30).map(async m => ({ m, e: await store.episode(m.episodeId) })))).filter(x => x.e).map(({ m, e }) => `<li><button data-mark="${esc(m.episodeId)}" data-at="${m.at}">${icon('pc-bookmark')}<b>${fmtClock(m.at)}</b><span>${esc(e.title)}${m.note ? ' — ' + esc(m.note) : ''}</span></button></li>`).join('')}</ul>` : '<p class="muted">Bấm “Đánh dấu” khi đang phát để lưu một khoảnh khắc.</p>'}</section>`;
  el.querySelector('[data-a="newlist"]').onclick = async () => { const name = prompt('Tên danh sách'); if (name) { await store.savePlaylist({ name, kind: 'list' }); rerender(); } };
  el.querySelector('[data-a="newsmart"]').onclick = async () => { const id = await editSmart(); if (id) go('lists/' + id); };
  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-mark]');
    if (!b) return;
    const e = await store.episode(b.dataset.mark);
    const { player } = await import('../lib/player.js');
    if (e) { await player.playEpisode(e, { at: +b.dataset.at }); go('play'); }
  });
}

async function detail(el, id, { ctx, go, rerender }) {
  const builtin = store.BUILTIN_FILTERS.find(f => f.id === id);
  const p = builtin || (await store.playlists()).find(x => x.id === id);
  if (!p) { el.innerHTML = '<p class="pc-empty">Không tìm thấy danh sách.</p>'; return; }
  const eps = p.kind === 'list' ? await store.withShows((await Promise.all((p.episodeIds || []).map(x => store.episode(x)))).filter(Boolean)) : await store.runFilter(p.rules);
  el.innerHTML = `<section class="pc-sec"><header><h1>${esc(p.name)} <span class="pc-count">${eps.length}</span></h1>
    <div class="row-actions">
      ${eps.length ? `<button class="btn primary pc-orange" data-a="playall">${icon('pc-play')}Phát tất cả</button>` : ''}
      ${!builtin && p.kind === 'smart' ? `<button class="btn" data-a="edit">${icon('pc-filter')}Sửa bộ lọc</button>` : ''}
      ${!builtin ? `<button class="icon-btn" data-a="del" aria-label="Xoá danh sách">${icon('pc-trash')}</button>` : ''}
      <a class="btn ghost" href="#podcasts/lists">‹ Danh sách</a></div></header>
    ${await episodeList(eps, { empty: 'Chưa có tập nào ở đây.' })}</section>`;
  el.querySelector('[data-a="playall"]')?.addEventListener('click', async () => {
    const { player } = await import('../lib/player.js');
    await store.enqueue(eps.slice(1).map(e => e.id), { next: true });
    await player.playEpisode(eps[0]);
    toast(`Đang phát ${eps.length} tập`);
  });
  el.querySelector('[data-a="edit"]')?.addEventListener('click', async () => { await editSmart(p); rerender(); });
  el.querySelector('[data-a="del"]')?.addEventListener('click', async () => { if (await confirmBox('Xoá danh sách?', p.name, 'Xoá')) { await store.deletePlaylist(p.id); go('lists'); } });
  return bindEpisodes(el, { ctx, rerender });
}

async function editSmart(p = null) {
  const r0 = p?.rules || {};
  const subs = await store.shows();
  const r = await pick(p ? 'Sửa bộ lọc' : 'Bộ lọc thông minh mới', `<form class="pc-form" onsubmit="return false">
    <label>Tên <input name="name" value="${esc(p?.name || '')}" placeholder="Ví dụ: Tin tức sáng"></label>
    <label>Trạng thái <select name="state"><option value="">Bất kỳ</option>${[['unplayed', 'Chưa nghe'], ['inprogress', 'Đang nghe dở'], ['played', 'Đã nghe']].map(([k, l]) => `<option value="${k}" ${r0.state === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Trong vòng <span><input name="days" type="number" min="0" value="${r0.days || ''}" placeholder="—"> ngày gần đây</span></label>
    <label>Dài từ <span><input name="minMin" type="number" min="0" value="${r0.minMin || ''}" placeholder="—"> đến <input name="maxMin" type="number" min="0" value="${r0.maxMin || ''}" placeholder="—"> phút</span></label>
    <label class="row"><input type="checkbox" name="downloaded" ${r0.downloaded ? 'checked' : ''}> Chỉ tập đã tải</label>
    <label class="row"><input type="checkbox" name="starred" ${r0.starred ? 'checked' : ''}> Chỉ tập có sao</label>
    <label>Sắp xếp <select name="sort">${[['new', 'Mới nhất'], ['old', 'Cũ nhất'], ['short', 'Ngắn nhất'], ['long', 'Dài nhất']].map(([k, l]) => `<option value="${k}" ${r0.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <fieldset><legend>Chỉ các podcast (bỏ trống = tất cả)</legend>${subs.map(s => `<label class="row"><input type="checkbox" name="show" value="${esc(s.itemId)}" ${r0.showIds?.includes(s.itemId) ? 'checked' : ''}> ${esc(s.title)}</label>`).join('')}</fieldset>
    <button type="button" class="btn primary" data-v="save">Lưu</button></form>`, { collect: (root) => { const f = root.querySelector('form'); const d = Object.fromEntries(new FormData(f)); d.showIds = new FormData(f).getAll('show'); return d; } });
  if (r?.v !== 'save') return null;
  const d = r.data;
  return store.savePlaylist({ ...(p || {}), kind: 'smart', name: d.name || 'Bộ lọc', rules: { state: d.state, days: +d.days || 0, minMin: +d.minMin || 0, maxMin: +d.maxMin || 0, downloaded: d.downloaded ? 1 : 0, starred: d.starred ? 1 : 0, sort: d.sort, showIds: d.showIds } });
}
