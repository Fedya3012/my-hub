// Chọn nhiều tập (giống Trình phát nhạc): nhấn giữ một tập để bắt đầu chọn, rồi chạm các tập khác để thêm / bỏ.
// Thanh dưới cùng làm việc với tất cả tập đã chọn: phát, phát tiếp, hàng chờ, danh sách, tải về, xoá bản tải,
// đánh dấu đã nghe, gắn sao, chọn hết.
import { icon } from '../../../core/icons.js';
import { toast, confirmBox } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import * as store from '../lib/store.js';
import { player } from '../lib/player.js';
import { pick, pickPlaylist } from './common.js';

const S = { on: false, picked: new Set(), root: null, bar: null, opts: {}, busy: false };

export const isSelecting = () => S.on;

const rows = () => [...(S.root || document).querySelectorAll('.pc-ep[data-ep]')];
const idsInOrder = () => { const seen = rows().map(r => r.dataset.ep).filter(id => S.picked.has(id)); return [...seen, ...[...S.picked].filter(id => !seen.includes(id))]; };

function paint() {
  rows().forEach(r => { const on = S.picked.has(r.dataset.ep); r.classList.toggle('sel', on); r.setAttribute('aria-selected', on); });
}

function drawBar() {
  if (!S.on) { S.bar?.remove(); S.bar = null; return; }
  if (!S.bar) {
    S.bar = document.createElement('div');
    S.bar.className = 'pc-selbar';
    S.bar.setAttribute('role', 'toolbar');
    S.bar.setAttribute('aria-label', 'Thao tác với các tập đã chọn');
    document.body.appendChild(S.bar);
    S.bar.addEventListener('click', onBar);
  }
  const n = S.picked.size, dis = n ? '' : 'disabled';
  const ib = (k, ic, label, cls = '', off = true) => `<button class="icon-btn ${cls}" data-s="${k}" ${off ? dis : ''} aria-label="${label}" title="${label}">${icon(ic)}</button>`;
  S.bar.innerHTML = `${ib('exit', 'x', 'Thoát chọn', '', false)}<span class="pc-sel-t"><b>${n}</b> đã chọn</span><span class="grow"></span>
    ${ib('play', 'pc-play', 'Phát')}${ib('queue', 'pc-queue', 'Thêm vào hàng chờ')}${ib('dl', 'download', 'Tải về máy')}${ib('list', 'pc-plus', 'Thêm vào danh sách')}
    ${ib('all', 'pc-check', `Chọn hết (${rows().length})`, 'pc-sel-x', false)}${ib('del', 'trash', 'Xoá bản tải', 'pc-sel-x danger')}${ib('more', 'pc-more', 'Thêm thao tác', '', false)}`;
}

async function episodes() {
  const eps = await Promise.all(idsInOrder().map(id => store.episode(id)));
  return eps.filter(Boolean);
}

async function downloadAll(eps) {
  const todo = [];
  for (const e of eps) if (e.url && !(await store.isDownloaded(e.id))) todo.push(e);
  if (!todo.length) return toast('Các tập này đã có trên máy hoặc không có tệp để tải');
  let ok = 0;
  for (const e of todo) {
    try { await tasks.run({ label: `Tải tập podcast (${ok + 1}/${todo.length})`, detail: e.title, cancellable: true }, (t) => store.download(e, t)); ok++; }
    catch (err) { if (err?.name === 'AbortError') break; toast(`${e.title}: ${err.message}`, 'error'); }
  }
  if (ok) toast(`Đã tải ${ok} tập về máy`);
}

async function removeDownloads(eps) {
  const dl = [];
  for (const e of eps) if (!e.local && await store.isDownloaded(e.id)) dl.push(e);
  const local = eps.filter(e => e.local && e.id !== player.ep?.id);
  if (!dl.length && !local.length) return toast('Không có bản tải nào để xoá');
  const parts = [dl.length && `${dl.length} bản tải`, local.length && `${local.length} tệp âm thanh đã thêm`].filter(Boolean).join(' và ');
  if (!(await confirmBox(`Xoá ${parts}?`, local.length ? 'Tệp đã thêm từ máy này sẽ biến mất khỏi thư viện. Tập từ podcast vẫn còn, chỉ xoá bản đã tải.' : 'Tập vẫn còn trong podcast, bạn có thể tải lại sau.', 'Xoá'))) return false;
  for (const e of dl) await store.deleteDownload(e.id, { quiet: true });
  if (local.length) await store.deleteLocal(local.map(e => e.id));
  else store.notify();
  toast(`Đã xoá ${parts}`);
  return true;
}

async function onBar(ev) {
  const b = ev.target.closest('[data-s]');
  if (!b || b.disabled || S.busy) return;
  const k = b.dataset.s;
  if (k === 'exit') return exit();
  if (k === 'all') { rows().forEach(r => S.picked.add(r.dataset.ep)); paint(); return drawBar(); }
  if (k === 'more') return moreMenu();
  S.busy = true;
  try {
    const eps = await episodes();
    const ids = eps.map(e => e.id);
    switch (k) {
      case 'play': await store.enqueue(ids.slice(1), { next: true }); await player.playEpisode(eps[0]); toast(ids.length > 1 ? `Đang phát, ${ids.length - 1} tập tiếp theo trong hàng chờ` : 'Đang phát'); exit(); break;
      case 'next': await store.enqueue(ids, { next: true }); toast(`Sẽ phát tiếp ${ids.length} tập`); break;
      case 'queue': await store.enqueue(ids); toast(`Đã thêm ${ids.length} tập vào hàng chờ`); break;
      case 'list': if (await pickPlaylist(ids)) exit(); break;
      case 'dl': await downloadAll(eps); break;
      case 'del': if (await removeDownloads(eps)) { exit(); S.opts.rerender?.(); } break;
    }
  } finally { S.busy = false; }
}

async function moreMenu() {
  const n = S.picked.size;
  const acts = [
    ['all', 'pc-check', `Chọn hết (${rows().length})`],
    ...(n ? [
      ['next', 'pc-queue', 'Phát tiếp theo'],
      ['played', 'pc-check', 'Đánh dấu đã nghe'],
      ['unplayed', 'pc-check', 'Đánh dấu chưa nghe'],
      ['star', 'pc-star', 'Gắn sao'],
      ['unstar', 'pc-star', 'Bỏ sao'],
      ['del', 'trash', 'Xoá bản tải'],
      ...(S.opts.inQueue ? [['unqueue', 'x', 'Bỏ khỏi hàng chờ']] : []),
      ...(S.opts.playlistId ? [['unlist', 'x', 'Bỏ khỏi danh sách này']] : []),
    ] : []),
  ];
  const v = await pick(`${n} tập đã chọn`, `<div class="pc-menu">${acts.map(([k, ic, l]) => `<button class="btn ghost" data-v="${k}">${icon(ic)}${l}</button>`).join('')}</div>`);
  if (!v) return;
  if (v === 'all' || v === 'next' || v === 'del') return onBar({ target: { closest: () => ({ dataset: { s: v }, disabled: false }) } });
  const ids = idsInOrder();
  if (v === 'played' || v === 'unplayed') for (const id of ids) await store.setPlayed(id, v === 'played');
  if (v === 'star' || v === 'unstar') for (const id of ids) await store.setStar(id, v === 'star');
  if (v === 'unqueue') for (const id of ids) await store.dequeue(id);
  if (v === 'unlist') for (const id of ids) await store.removeFromPlaylist(S.opts.playlistId, id);
  toast(`Đã cập nhật ${ids.length} tập`);
  if (v === 'unqueue' || v === 'unlist') exit();
  S.opts.rerender?.();
}

// Called from bindEpisodes after each draw of a list: keeps the picks visible and remembers the page's callbacks.
export function attach(root, opts = {}) {
  S.root = root; S.opts = opts;
  if (S.on) { paint(); drawBar(); }
}

// Start selecting with nothing picked yet (the Chọn button).
export function begin() {
  if (!S.on) { S.on = true; document.body.classList.add('pc-sel-on'); }
  paint(); drawBar();
}

export function toggle(id) {
  if (!S.on) { S.on = true; document.body.classList.add('pc-sel-on'); }
  if (S.picked.has(id)) S.picked.delete(id); else S.picked.add(id);
  paint(); drawBar();
}

export function exit() {
  S.on = false; S.picked.clear();
  document.body.classList.remove('pc-sel-on');
  paint(); drawBar();
}

window.addEventListener('hashchange', () => { if (S.on) exit(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.on && !document.querySelector('.modal-wrap')) exit(); });
