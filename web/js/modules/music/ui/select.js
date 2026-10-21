// Multi-select for track lists. Press and hold a song to start selecting; then tap others to add or remove them.
// The bar at the bottom acts on all picked songs at once: play, play next, queue, add to a playlist, edit tags,
// select all, clear, delete from the library.
import { player } from '../lib/player.js';
import * as store from '../lib/store.js';
import { confirmBox, toast } from '../../../core/ui.js';
import { pickPlaylist } from './sheets.js';
import { tagEditor } from './tageditor.js';
import { icon } from '../../../core/icons.js';

const S = { on: false, picked: new Map(), visible: [], refresh: () => {}, bar: null };

export const isSelecting = () => S.on;
export const isPicked = (id) => S.picked.has(id);
export function setRefresh(fn) { S.refresh = fn; }

function paintRows() {
  document.querySelectorAll('.mrow[data-id]').forEach(r => {
    const on = S.picked.has(r.dataset.id);
    r.classList.toggle('sel', on);
    r.setAttribute('aria-selected', on);
  });
}

function drawBar() {
  if (!S.on) { S.bar?.remove(); S.bar = null; return; }
  if (!S.bar) {
    S.bar = document.createElement('div');
    S.bar.className = 'msel-bar';
    S.bar.setAttribute('role', 'toolbar');
    S.bar.setAttribute('aria-label', 'Thao tác với các bài đã chọn');
    document.body.appendChild(S.bar);
    S.bar.addEventListener('click', onBarClick);
  }
  const n = S.picked.size;
  const dis = n ? '' : 'disabled';
  S.bar.innerHTML = `<b class="num msel-n">${n}</b><span class="msel-t">đã chọn</span>
    <button class="icon-btn sm" data-s="all" aria-label="Chọn hết (${S.visible.length})" title="Chọn hết (${S.visible.length})">${icon('check')}</button>
    <button class="icon-btn sm" data-s="play" ${dis} aria-label="Phát" title="Phát">${icon('play')}</button>
    <button class="icon-btn sm" data-s="next" ${dis} aria-label="Phát tiếp" title="Phát tiếp">${icon('next')}</button>
    <button class="icon-btn sm" data-s="queue" ${dis} aria-label="Thêm vào hàng chờ" title="Thêm vào hàng chờ">${icon('queue')}</button>
    <button class="icon-btn sm" data-s="list" ${dis} aria-label="Thêm vào danh sách phát" title="Thêm vào danh sách phát">${icon('list')}</button>
    <button class="icon-btn sm" data-s="edit" ${dis} aria-label="Sửa thẻ" title="Sửa thẻ">${icon('edit')}</button>
    <button class="icon-btn sm danger" data-s="del" ${dis} aria-label="Xoá khỏi thư viện" title="Xoá khỏi thư viện">${icon('trash')}</button>
    <button class="icon-btn sm" data-s="exit" aria-label="Thoát chọn" title="Thoát chọn">${icon('x')}</button>`;
}

async function onBarClick(e) {
  const b = e.target.closest('[data-s]');
  if (!b || b.disabled) return;
  const tracks = [...S.picked.values()];
  const ids = tracks.map(t => t.id);
  const src = { kind: 'selection', name: `Đã chọn (${tracks.length})` };
  switch (b.dataset.s) {
    case 'all': S.visible.forEach(t => S.picked.set(t.id, t)); paintRows(); drawBar(); break;
    case 'play': player.play(tracks, { source: src }); exit(); break;
    case 'next': player.playNext(ids); toast(`Đã thêm ${ids.length} bài để phát tiếp`); break;
    case 'queue': player.addToQueue(ids); toast(`Đã thêm ${ids.length} bài vào hàng chờ`); break;
    case 'list': await pickPlaylist(ids); break;
    case 'edit': tagEditor(tracks, () => S.refresh()); break;
    case 'del':
      if (!(await confirmBox(`Xoá ${ids.length} bài khỏi thư viện?`, 'Tệp nhạc trên máy này cũng bị xoá. Tệp trên thư mục đồng bộ không bị động tới.', 'Xoá'))) return;
      await store.deleteTracks(ids); toast(`Đã xoá ${ids.length} bài`); exit(); S.refresh(); break;
    case 'exit': exit(); break;
  }
}

// Long-press on a row starts selecting with that row picked; while selecting, a tap toggles a row.
export function hold(t, visible) {
  S.visible = visible;
  if (!S.on) { S.on = true; document.body.classList.add('msel-on'); }
  if (S.picked.has(t.id)) S.picked.delete(t.id); else S.picked.set(t.id, t);
  paintRows(); drawBar();
}
export function tap(t, visible) { S.visible = visible; hold(t, visible); }

export function exit() {
  S.on = false; S.picked.clear();
  document.body.classList.remove('msel-on');
  paintRows(); drawBar();
}

// Called after every render of a list so the picks stay visible.
export function markRows(box) {
  box.querySelectorAll('.mrow[data-id]').forEach(r => { const on = S.picked.has(r.dataset.id); r.classList.toggle('sel', on); r.setAttribute('aria-selected', on); });
}
