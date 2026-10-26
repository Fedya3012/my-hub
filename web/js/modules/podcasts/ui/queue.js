// Hàng chờ (#podcasts/queue, drag to reorder) and Hộp tập mới (#podcasts/inbox, new episodes of subscriptions).
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { player } from '../lib/player.js';
import { episodeList, bindEpisodes, fmtLen } from './common.js';

export async function render(el, { head, ctx, rerender }) {
  if (head === 'inbox') {
    const eps = await store.inbox();
    el.innerHTML = `<section class="pc-sec"><header><h1>Hộp tập mới <span class="pc-count">${eps.length}</span></h1>
      ${eps.length ? `<div class="row-actions"><button class="btn" data-a="queueall">${icon('pc-queue')}Thêm hết vào hàng chờ</button><button class="btn ghost" data-a="clear">${icon('pc-check')}Đã xem hết</button></div>` : ''}</header>
      ${await episodeList(eps, { empty: 'Không có tập mới. Tập mới của podcast đã đăng ký sẽ hiện ở đây.' })}</section>`;
    el.querySelector('[data-a="queueall"]')?.addEventListener('click', async () => { await store.enqueue(eps.map(e => e.id)); await store.clearInbox(eps.map(e => e.id)); toast('Đã thêm vào hàng chờ'); });
    el.querySelector('[data-a="clear"]')?.addEventListener('click', () => store.clearInbox());
    return bindEpisodes(el, { ctx, rerender });
  }
  const eps = await store.queueEpisodes();
  const total = eps.reduce((a, e) => a + (e.duration || 0), 0);
  const cur = player.ep;
  el.innerHTML = `<section class="pc-sec"><header><h1>Hàng chờ</h1><small class="muted">${eps.length} tập${total ? ' · ' + fmtLen(total / (player.rate || 1)) + ` ở ${player.rate}×` : ''}</small>
      ${eps.length ? `<button class="btn ghost sm" data-a="clear">${icon('x')}Xoá hàng chờ</button>` : ''}</header>
    ${cur ? `<p class="muted">Đang phát: <a href="#podcasts/play">${esc(cur.title)}</a></p>` : ''}
    <div data-list>${await episodeList(eps, { empty: 'Hàng chờ trống. Mở menu ⋯ của một tập → “Thêm vào hàng chờ”.' })}</div>
    <p class="muted"><small>Kéo để đổi thứ tự. Hết một tập sẽ tự phát tập kế tiếp (tắt được trong Cài đặt).</small></p></section>`;
  el.querySelector('[data-a="clear"]')?.addEventListener('click', () => store.clearQueue());
  // Drag to reorder (pointer events, so it works with touch too).
  const list = el.querySelector('.pc-eps');
  list?.querySelectorAll('.pc-ep').forEach(li => {
    const h = document.createElement('span'); h.className = 'pc-grip'; h.innerHTML = icon('pc-chapters'); h.setAttribute('aria-hidden', 'true');
    li.prepend(h);
    h.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); h.setPointerCapture(ev.pointerId); li.classList.add('drag');
      const move = (m) => { const over = document.elementFromPoint(m.clientX, m.clientY)?.closest('.pc-ep'); if (over && over !== li && over.parentNode === list) { const r = over.getBoundingClientRect(); list.insertBefore(li, m.clientY > r.top + r.height / 2 ? over.nextSibling : over); } };
      const up = async () => { h.removeEventListener('pointermove', move); li.classList.remove('drag'); await store.moveInQueue(li.dataset.ep, [...list.children].indexOf(li)); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up, { once: true });
    });
  });
  return bindEpisodes(el, { ctx, rerender, inQueue: true });
}
