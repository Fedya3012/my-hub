// Work page: AO3-style header (rating, fandoms, warnings, relationships, characters, tags, stats), summary and
// notes, goals, chapters & scenes (list or corkboard, drag to reorder), story notes (characters, plot, research,
// world, ideas, todos), reading progress from Books, publish / export, and other modules' blocks (Music).
import { icon } from '../../../core/icons.js';
import { esc, toast, confirmBox, modal, h } from '../../../core/ui.js';
import { extensions } from '../../../core/extensions.js';
import { onHold } from '../../../core/longpress.js';
import * as store from '../lib/store.js';
import { WARNINGS, CATEGORIES, CH_STATUS, CH_LABELS, NOTE_KINDS, ORIGINS } from '../lib/vocab.js';
import { mdToHtml } from '../lib/text.js';
import { audienceBadge, statusPill, chapterCount, fmtNum, fmtDate, ago, menu, sheet } from './common.js';

const VIEW_KEY = 'hub.fanfic.chView', NOTE_KEY = 'hub.fanfic.noteKind';
const ls = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export async function render(el, { ctx, arg: id, go, rerender }) {
  const v = await store.get(id);
  if (!v) { el.innerHTML = `<div class="empty"><p>Không tìm thấy truyện.</p><a class="btn" href="#fanfic/works">Về Tác phẩm</a></div>`; return; }
  const notes = await store.notesOf(id);
  const fic = v.fic, goal = fic.goal || {};
  const lastCh = v.chapters.find(c => c.id === fic.lastChapterId) || v.tops[0];
  const chView = ls(VIEW_KEY, 'list');
  let noteKind = ls(NOTE_KEY, 'character');
  el.innerHTML = `
  <article class="fx-detail">
    <div class="fold-top">
    <header class="fx-hero">
      <a class="fx-back" href="#fanfic/works">${icon('fx-back')}Tác phẩm</a>
      <div class="fx-hero-t">${audienceBadge(v.audience)}<div>
        <h1>${esc(v.title)}</h1>
        <p class="muted">${v.origin === 'saved' ? `${esc(ORIGINS.saved)}${fic.author ? ' · ' + esc(fic.author) : ''}` : esc(fic.author || 'Tác phẩm của bạn')}${fic.sourceUrl ? ` · <a href="${esc(fic.sourceUrl)}" target="_blank" rel="noopener">Nguồn</a>` : ''}</p>
      </div></div>
      <dl class="fx-meta">
        <dt>Fandom</dt><dd>${v.fandoms.map(f => `<a class="fx-tag fd" href="#fanfic/fandom/${esc(f.id)}">${esc(f.name)}</a>`).join('') || '<span class="muted">Chưa có</span>'}</dd>
        ${fic.warnings?.length ? `<dt>Cảnh báo</dt><dd>${fic.warnings.map(w => `<span class="fx-tag warn">${esc(WARNINGS[w] || w)}</span>`).join('')}</dd>` : ''}
        ${fic.categories?.length ? `<dt>Thể loại</dt><dd>${fic.categories.map(c => `<span class="fx-tag">${esc(CATEGORIES[c] || c)}</span>`).join('')}</dd>` : ''}
        ${v.relationships.length ? `<dt>Cặp đôi</dt><dd>${v.relationships.map(t => `<span class="fx-tag rel">${esc(t.name)}</span>`).join('')}</dd>` : ''}
        ${v.characters.length ? `<dt>Nhân vật</dt><dd>${v.characters.map(t => `<span class="fx-tag char">${esc(t.name)}</span>`).join('')}</dd>` : ''}
        ${v.tags.length ? `<dt>Tag</dt><dd>${v.tags.map(t => `<span class="fx-tag">${esc(t)}</span>`).join('')}</dd>` : ''}
        ${v.series ? `<dt>Bộ truyện</dt><dd>${esc(v.series.name)}${fic.seriesIndex != null ? ' · phần ' + fic.seriesIndex : ''}</dd>` : ''}
        <dt>Thống kê</dt><dd class="muted">${statusPill(v.status)} · ${fmtNum(v.words)} từ · ${chapterCount(v)} chương · sửa ${ago(v.editedAt)}${fic.language ? ' · ' + esc(fic.language) : ''}</dd>
      </dl>
      <div class="row-actions fx-actions">
        <button class="btn primary" data-a="write">${icon('quill')}${v.words ? 'Viết tiếp' : 'Bắt đầu viết'}</button>
        ${v.published ? `<button class="btn" data-a="read">${icon('book')}${v.readPercent ? `Đọc tiếp · ${v.readPercent}%` : 'Đọc trong Sách'}</button>` : ''}
        <button class="btn" data-a="publish">${icon('fx-publish')}${v.published ? (v.dirty ? 'Cập nhật bản trong Sách' : 'Đã xuất bản') : 'Xuất bản sang Sách'}</button>
        <button class="icon-btn" data-a="edit" aria-label="Sửa thông tin">${icon('fx-edit')}</button>
        <button class="icon-btn" data-a="more" aria-label="Thêm thao tác">${icon('fx-more')}</button>
      </div>
    </header>
    </div>
    <div class="fold-bottom fx-cols">
    <div class="fx-col">
      ${fic.summary || fic.notesStart ? `<section class="fx-panel fx-sumpanel">${fic.summary ? `<h2 class="section-title">Tóm tắt</h2><div class="fx-prose">${mdToHtml(fic.summary)}</div>` : ''}${fic.notesStart ? `<h3>Lời tác giả</h3><div class="fx-prose">${mdToHtml(fic.notesStart)}</div>` : ''}</section>` : ''}
      <section class="fx-panel">
        <div class="fx-sec-h"><h2 class="section-title">${icon('fx-binder')}Chương &amp; cảnh</h2>
          <div class="seg" role="group" aria-label="Kiểu xem"><button data-view="list" aria-pressed="${chView === 'list'}" aria-label="Danh sách">${icon('list')}</button><button data-view="cork" aria-pressed="${chView === 'cork'}" aria-label="Bảng thẻ (corkboard)">${icon('fx-cork')}</button></div>
          <button class="btn small" data-a="add-ch">${icon('plus')}Chương</button></div>
        <ol class="fx-binder ${chView === 'cork' ? 'cork' : ''}" data-binder>${v.tops.map(c => chapterLi(c, v)).join('') || '<li class="muted">Chưa có chương nào.</li>'}</ol>
        <p class="hint">Kéo tay cầm ⠿ để sắp xếp (hoặc Alt + ↑/↓). Nhấn giữ hoặc chuột phải một chương để xem thêm thao tác.</p>
      </section>
    </div>
    <div class="fx-col">
      <section class="fx-panel fx-goal">
        <h2 class="section-title">${icon('fx-target')}Mục tiêu &amp; tiến độ</h2>
        ${goal.total ? `<div class="bar lg"><i style="width:${Math.min(100, v.words / goal.total * 100)}%"></i></div><p class="muted">${fmtNum(v.words)} / ${fmtNum(goal.total)} từ${goal.deadline ? ` · hạn ${fmtDate(new Date(goal.deadline).getTime())}${dailyNeed(v)}` : ''}</p>` : `<p class="muted">Chưa đặt mục tiêu số từ. <button class="link" data-a="edit">Đặt mục tiêu</button></p>`}
        ${v.published ? `<p class="muted">${icon('book')}Trong Sách: ${v.pubCount} chương${v.progress ? ` · đã đọc ${v.readPercent}%${v.progress.label ? ' (' + esc(v.progress.label) + ')' : ''}` : ''}${v.dirty ? ' · <b>có thay đổi chưa xuất bản</b>' : ''}</p>` : ''}
      </section>
      <section class="fx-panel">
        <div class="fx-sec-h"><h2 class="section-title">${icon('fx-idea')}Ghi chú truyện</h2><button class="btn small" data-a="add-note">${icon('plus')}Thêm</button></div>
        <div class="chips fx-note-kinds">${Object.entries(NOTE_KINDS).map(([k, [l, ic]]) => `<button class="chip${k === noteKind ? ' on' : ''}" data-nk="${k}">${icon(ic)}${l}<span class="num">${notes.filter(n => n.kind === k).length || ''}</span></button>`).join('')}</div>
        <ul class="fx-notes" data-notes></ul>
      </section>
      <div id="fx-ext"></div>
    </div>
    </div>
  </article>`;
  const $ = (s) => el.querySelector(s);

  // ── Actions ──
  $('[data-a="write"]').onclick = () => go(`write/${id}${lastCh ? '/' + lastCh.id : ''}`);
  $('[data-a="read"]')?.addEventListener('click', () => { ctx.bus.emit('item:open', { item: { ...v.item, meta: { ...v.item.meta, published: 1 } } }); });
  $('[data-a="publish"]').onclick = async () => {
    if (v.published && !v.dirty) return toast('Bản trong Sách đã là bản mới nhất');
    await store.publish(id); toast(v.published ? 'Đã cập nhật bản trong Sách' : 'Đã xuất bản: truyện giờ có trong Thư viện và Sách');
  };
  el.querySelectorAll('[data-a="edit"]').forEach(b => b.onclick = async () => (await import('./edit.js')).editWork(v, { go }));
  $('[data-a="more"]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Xuất Markdown', icon: 'download', run: async () => (await import('../lib/io.js')).exportWork(id, 'md') },
    { label: 'Xuất TXT', icon: 'download', run: async () => (await import('../lib/io.js')).exportWork(id, 'txt') },
    { label: 'Xuất HTML', icon: 'download', run: async () => (await import('../lib/io.js')).exportWork(id, 'html') },
    { label: 'Xuất EPUB', icon: 'download', run: async () => (await import('../lib/io.js')).exportWork(id, 'epub') },
    { label: 'In / lưu PDF', icon: 'download', run: async () => (await import('../lib/io.js')).exportWork(id, 'pdf') },
    '-',
    { label: 'Nhân bản truyện', icon: 'fx-snapshot', run: async () => { const nid = await store.duplicateFanfic(id); go('work/' + nid); } },
    v.published ? { label: 'Gỡ khỏi Sách', icon: 'x', run: async () => { await store.unpublish(id); toast('Đã gỡ khỏi Sách'); } } : null,
    { label: 'Xoá truyện', icon: 'trash', danger: true, run: async () => { if (await confirmBox('Xoá truyện này?', `“${v.title}”, mọi chương, ghi chú và bản trong Sách sẽ bị xoá khỏi mọi thiết bị đồng bộ.`, 'Xoá')) { await store.removeFanfics([id]); go('works'); } } },
  ]);
  $('[data-a="add-ch"]').onclick = async () => { const cid = await store.addChapter(id); go(`write/${id}/${cid}`); };
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { lsSet(VIEW_KEY, b.dataset.view); rerender(); });

  // ── Binder: open, menu, drag and drop ──
  const binder = $('[data-binder]');
  binder.addEventListener('click', (e) => {
    if (e.target.closest('.fx-grip')) return;
    const li = e.target.closest('[data-ch]');
    if (li) go(`write/${id}/${li.dataset.ch}`);
  });
  onHold(binder, '[data-ch]', (li, e) => chapterMenu(li.dataset.ch, li, e));
  sortable(binder, async (chId, { parentId, beforeId }) => { await store.moveChapter(chId, { parentId, beforeId }); });
  binder.addEventListener('keydown', async (e) => {
    const li = e.target.closest('[data-ch]');
    if (!li) return;
    if (e.key === 'Enter') go(`write/${id}/${li.dataset.ch}`);
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const sibs = [...li.parentElement.children].filter(x => x.dataset.ch);
      const i = sibs.indexOf(li), j = e.key === 'ArrowUp' ? i - 1 : i + 2;
      if (j < 0 || j > sibs.length) return;
      await store.moveChapter(li.dataset.ch, { parentId: li.dataset.parent || null, beforeId: sibs[j]?.dataset.ch || null });
    }
  });
  function chapterMenu(chId, anchor, e) {
    const c = v.chapters.find(x => x.id === chId);
    if (!c) return;
    menu(anchor, [
      { label: 'Viết', icon: 'quill', run: () => go(`write/${id}/${chId}`) },
      { label: 'Đổi tên', icon: 'fx-edit', run: async () => { const t = await ask('Tên', c.title); if (t != null) await store.updateChapter(chId, { title: t }); } },
      { label: 'Tóm tắt (thẻ corkboard)', icon: 'fx-cork', run: async () => { const t = await ask('Tóm tắt', c.synopsis, true); if (t != null) await store.updateChapter(chId, { synopsis: t }); } },
      !c.parentId ? { label: 'Thêm cảnh', icon: 'plus', run: async () => { const sid = await store.addChapter(id, {}, { parentId: chId }); go(`write/${id}/${sid}`); } } : null,
      { label: 'Thêm chương sau', icon: 'plus', run: async () => { await store.addChapter(id, {}, { after: c.parentId ? c.parentId : chId }); } },
      '-',
      ...Object.entries(CH_STATUS).map(([k, l]) => ({ label: 'Trạng thái: ' + l, icon: c.status === k ? 'check' : '', run: () => store.updateChapter(chId, { status: k }) })),
      { label: 'Nhãn màu…', icon: 'palette', run: () => labelMenu(anchor, c) },
      { label: 'Chụp phiên bản', icon: 'fx-snapshot', run: async () => { await store.snapshotChapter(chId); toast('Đã lưu phiên bản'); } },
      '-',
      { label: c.parentId ? 'Xoá cảnh' : 'Xoá chương', icon: 'trash', danger: true, run: async () => { if (await confirmBox(`Xoá “${c.title}”?`, c.parentId ? 'Cảnh này sẽ bị xoá.' : 'Chương và các cảnh bên trong sẽ bị xoá. Các phiên bản đã chụp vẫn còn.', 'Xoá')) await store.removeChapter(chId); } },
    ], e?.type === 'contextmenu' ? { x: e.clientX, y: e.clientY } : null);
  }
  const labelMenu = (anchor, c) => menu(anchor, Object.entries(CH_LABELS).map(([k, col]) => ({ label: k ? k : 'Không nhãn', icon: c.label === k ? 'check' : '', run: () => store.updateChapter(c.id, { label: k }) })));

  // ── Notes ──
  const drawNotes = () => {
    const list = notes.filter(n => n.kind === noteKind);
    const box = $('[data-notes]');
    box.innerHTML = list.length ? list.map(n => noteLi(n)).join('') : `<li class="muted">${noteKind === 'character' ? 'Hồ sơ nhân vật: ngoại hình, tính cách, quan hệ, giọng nói…' : 'Chưa có ghi chú.'}</li>`;
    box.querySelectorAll('[data-done]').forEach(cb => cb.onchange = async () => { await store.saveNote({ ...notes.find(n => n.id === cb.dataset.done), done: cb.checked ? 1 : 0 }); });
    box.querySelectorAll('[data-note]').forEach(li => li.onclick = (e) => { if (!e.target.closest('input')) noteEditor(notes.find(n => n.id === li.dataset.note)); });
  };
  el.querySelectorAll('[data-nk]').forEach(b => b.onclick = () => { noteKind = b.dataset.nk; lsSet(NOTE_KEY, noteKind); el.querySelectorAll('[data-nk]').forEach(x => x.classList.toggle('on', x === b)); drawNotes(); });
  $('[data-a="add-note"]').onclick = () => noteEditor({ fanficId: id, kind: noteKind });
  const noteEditor = (n) => {
    const chars = v.characters;
    const f = h(`<form class="fx-form">
      <label>Loại<select data-f="kind">${Object.entries(NOTE_KINDS).map(([k, [l]]) => `<option value="${k}" ${k === n.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Tiêu đề<input data-f="title" value="${esc(n.title || '')}" placeholder="${n.kind === 'character' ? 'Tên nhân vật' : n.kind === 'todo' ? 'Viết cảnh gặp lại ở chương 3' : ''}"></label>
      ${chars.length ? `<label>Nhân vật liên quan<select data-f="tagId"><option value="">Không</option>${chars.map(t => `<option value="${esc(t.id)}" ${t.id === n.tagId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>` : ''}
      <label>Chương liên quan<select data-f="chapterId"><option value="">Không</option>${v.tops.map(c => `<option value="${c.id}" ${c.id === n.chapterId ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
      <label>Nội dung (Markdown)<textarea data-f="body" rows="8">${esc(n.body || '')}</textarea></label>
      <label><input type="checkbox" data-f="pinned" ${n.pinned ? 'checked' : ''}> Ghim lên đầu</label>
      <footer class="row-actions">${n.id ? `<button type="button" class="btn danger-ghost" data-del>${icon('trash')}Xoá</button>` : ''}<span class="sp"></span><button class="btn primary">${icon('check')}Lưu</button></footer></form>`);
    const s = sheet(n.id ? 'Ghi chú' : 'Ghi chú mới', f, { wide: true });
    f.querySelector('[data-del]')?.addEventListener('click', async () => { await store.removeNote(n.id); s.close(); });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const g = (k) => f.querySelector(`[data-f="${k}"]`);
      await store.saveNote({ ...n, kind: g('kind').value, title: g('title').value.trim(), body: g('body').value, tagId: g('tagId')?.value || null, chapterId: g('chapterId').value || null, pinned: g('pinned').checked ? 1 : 0 });
      s.close();
    };
  };
  drawNotes();

  // Other modules' blocks: Music "Nhạc nền" (playlist for this fanfic), future Todo app…
  const ext = $('#fx-ext');
  for (const fn of extensions('library.drawer')) {
    try { await fn({ item: v.item, el: ext, ctx, refresh: rerender, from: 'fanfic' }); } catch (e) { console.error('[fanfic ext]', e); }
  }
}

function dailyNeed(v) {
  const g = v.fic.goal, left = g.total - v.words, days = Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 864e5);
  if (left <= 0) return ' · đã đạt';
  if (days <= 0) return ' · đã quá hạn';
  return ` · cần ~${fmtNum(Math.ceil(left / days))} từ/ngày`;
}

function chapterLi(c, v) {
  const scenes = v.chapters.filter(s => s.parentId === c.id);
  const changedSincePub = v.published && c.pubAt && (c.editedAt || 0) > c.pubAt;
  const row = (x, cls = '') => `<li class="fx-ch ${cls}" data-ch="${x.id}" ${x.parentId ? `data-parent="${x.parentId}"` : ''} tabindex="0" style="${x.label ? `--lab:${CH_LABELS[x.label]}` : ''}">
      <span class="fx-grip" aria-label="Kéo để sắp xếp" title="Kéo để sắp xếp">${icon('fx-grip')}</span>
      <div class="fx-ch-b"><b>${esc(x.title || 'Không tên')}</b>${x.synopsis ? `<small>${esc(x.synopsis)}</small>` : ''}</div>
      <span class="fx-ch-m muted"><span class="num">${fmtNum(x.words)}</span> từ · ${esc(CH_STATUS[x.status] || '')}${x.pubAt ? ` · <span title="${changedSincePub && x === c ? 'Đã sửa sau khi xuất bản' : 'Đã xuất bản'}">${icon('book')}${changedSincePub && x === c ? '*' : ''}</span>` : ''}</span>
    </li>`;
  return row(c).replace(/<\/li>$/, scenes.length ? `<ol class="fx-scenes">${scenes.map(s => row(s, 'scene')).join('')}</ol></li>` : '</li>');
}

function noteLi(n) {
  return `<li class="fx-note${n.done ? ' done' : ''}" data-note="${n.id}">
    ${n.kind === 'todo' ? `<input type="checkbox" data-done="${n.id}" ${n.done ? 'checked' : ''} aria-label="Xong">` : ''}
    <div><b>${n.pinned ? '📌 ' : ''}${esc(n.title || 'Không tiêu đề')}</b>${n.body ? `<small>${esc(n.body.slice(0, 140))}</small>` : ''}</div></li>`;
}

const ask = async (title, value = '', long = false) => {
  const body = h(`<label>${esc(title)}${long ? `<textarea rows="4" id="fx-ask">${esc(value || '')}</textarea>` : `<input id="fx-ask" value="${esc(value || '')}">`}</label>`);
  return modal({ title, body, actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', kind: 'primary', value: (b) => b.querySelector('#fx-ask').value.trim() }] });
};

// Pointer drag by the ⠿ handle (mouse, touch, pen). Dropping on the right half of a chapter makes a scene of it.
export function sortable(list, onDrop) {
  let drag = null;
  list.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.fx-grip');
    if (!grip) return;
    const li = grip.closest('[data-ch]');
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    drag = { li, id: li.dataset.ch, isScene: !!li.dataset.parent, target: null };
    li.classList.add('dragging');
    document.body.classList.add('fx-dragging');
  });
  list.addEventListener('pointermove', (e) => {
    if (!drag) return;
    list.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-ch]');
    if (!over || over === drag.li || drag.li.contains(over)) { drag.target = null; return; }
    const r = over.getBoundingClientRect();
    const own = over.querySelector(':scope > .fx-ch-b').getBoundingClientRect();
    const y = e.clientY - r.top, overScene = !!over.dataset.parent;
    let mode = y < Math.min(own.height, r.height) / 2 ? 'before' : 'after';
    if (!overScene && e.clientX > r.left + r.width * 0.6) mode = 'into';
    over.classList.add('drop-' + mode);
    drag.target = { over, mode };
  });
  const end = async () => {
    if (!drag) return;
    const { li, id, target } = drag;
    drag = null;
    li.classList.remove('dragging');
    document.body.classList.remove('fx-dragging');
    list.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    if (!target) return;
    const o = target.over, parentOf = o.dataset.parent || null;
    if (target.mode === 'into') return onDrop(id, { parentId: o.dataset.ch, beforeId: null });
    if (target.mode === 'before') return onDrop(id, { parentId: parentOf, beforeId: o.dataset.ch });
    const sibs = [...o.parentElement.children].filter(x => x.dataset.ch && x !== li);
    const next = sibs[sibs.indexOf(o) + 1];
    return onDrop(id, { parentId: parentOf, beforeId: next?.dataset.ch || null });
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}
