// Trang tập (#podcasts/episode/<id>): artwork, show, date, length, actions, chapters, bookmarks and show notes.
import { icon } from '../../../core/icons.js';
import { esc } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { player } from '../lib/player.js';
import { art, fmtLen, fmtDate, fmtClock, notesHtml, tsToSec, runAction } from './common.js';

export async function render(el, { arg, ctx, go, rerender }) {
  const e = await store.episode(arg);
  if (!e) { el.innerHTML = '<p class="pc-empty">Không tìm thấy tập này.</p>'; return; }
  const s = await store.show(e.showId);
  const [p, dl, q, chs, marks] = await Promise.all([store.progressOf([e.id]).then(m => m.get(e.id)), store.isDownloaded(e.id), store.queue(), store.chapters(e), store.bookmarks(e.id)]);
  const pct = p?.total ? p.position / p.total * 100 : 0;
  const now = player.ep?.id === e.id;
  el.innerHTML = `
    <header class="pc-showhead ep">
      ${art(e.image || s?.image, s?.title || e.title, 'xl')}
      <div>
        <a class="eyebrow" href="#podcasts/show/${encodeURIComponent(e.showId)}">${esc(s?.title || 'Podcast')}</a>
        <h1>${esc(e.title)}</h1>
        <p class="muted">${[fmtDate(e.pubDate), fmtLen(e.duration), e.season ? `Mùa ${e.season}` : '', e.episode ? `Tập ${e.episode}` : '', e.played ? 'Đã nghe' : pct > 1 ? `Đã nghe ${Math.round(pct)}%` : ''].filter(Boolean).join(' · ')}</p>
        ${pct > 1 && !e.played ? `<span class="pc-bar wide"><i style="width:${pct}%"></i></span>` : ''}
        <div class="row-actions">
          <button class="btn primary pc-orange" data-a="play">${icon(now && player.playing ? 'pc-pause' : 'pc-play')}${now && player.playing ? 'Tạm dừng' : pct > 1 && !e.played ? 'Nghe tiếp' : 'Phát'}</button>
          <button class="btn" data-a="${q.includes(e.id) ? 'unqueue' : 'queue'}">${icon('pc-queue')}${q.includes(e.id) ? 'Bỏ khỏi hàng chờ' : 'Thêm vào hàng chờ'}</button>
          ${e.url ? `<button class="btn" data-a="${dl ? 'undl' : 'dl'}">${icon(dl ? 'pc-trash' : 'download')}${dl ? 'Xoá bản tải' : 'Tải về'}</button>` : ''}
          <button class="icon-btn" data-a="${e.played ? 'unplayed' : 'played'}" aria-label="${e.played ? 'Đánh dấu chưa nghe' : 'Đánh dấu đã nghe'}">${icon('pc-check')}</button>
          <button class="icon-btn ${e.starred ? 'on' : ''}" data-a="${e.starred ? 'unstar' : 'star'}" aria-label="Gắn sao">${icon('pc-star')}</button>
          <button class="icon-btn" data-a="share" aria-label="Chia sẻ">${icon('link')}</button>
        </div>
      </div>
    </header>
    ${(e.persons || []).length ? `<p class="pc-people">${e.persons.map(x => `<a class="chip" href="#podcasts/discover/${encodeURIComponent(x.name)}">${x.img ? `<img src="${esc(x.img)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : icon('pc-mic')}${esc(x.name)} <small>${x.role === 'guest' ? 'khách mời' : 'dẫn'}</small></a>`).join('')}</p>` : ''}
    ${chs.length ? `<section class="pc-sec"><header><h2>Chương</h2></header><ol class="pc-chaps">${chs.map((c, i) => `<li><button data-at="${c.start}"><span>${esc(c.title || 'Chương ' + (i + 1))}</span><small>${fmtClock(c.start)}</small></button></li>`).join('')}</ol></section>` : ''}
    ${marks.length ? `<section class="pc-sec"><header><h2>Dấu trang</h2></header><ul class="pc-marks">${marks.map(m => `<li><button data-at="${m.at}">${icon('pc-bookmark')}<b>${fmtClock(m.at)}</b><span>${esc(m.note || '')}</span></button></li>`).join('')}</ul></section>` : ''}
    <section class="pc-sec"><header><h2>Ghi chú tập</h2></header><div class="pc-notes">${notesHtml(e.description) || '<p class="muted">Không có ghi chú.</p>'}</div></section>`;
  el.addEventListener('click', async (ev) => {
    const at = ev.target.closest('[data-at]')?.dataset.at ?? (ev.target.closest('[data-ts]') && tsToSec(ev.target.closest('[data-ts]').dataset.ts));
    if (at != null) { await player.playEpisode(e, { at: +at }); return go('play'); }
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'play') { if (now) player.toggle(); else { await player.playEpisode(e); go('play'); } return; }
    await runAction(a, e, ctx);
    rerender();
  });
}
