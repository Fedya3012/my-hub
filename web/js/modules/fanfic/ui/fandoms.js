// Fandoms: list with counts; a fandom page shows its canon in Books (two-way link), characters, relationships
// and works, and starts a new work in it.
import { icon } from '../../../core/icons.js';
import { esc, toast, confirmBox } from '../../../core/ui.js';
import { db } from '../../../core/db.js';
import { onHold } from '../../../core/longpress.js';
import * as store from '../lib/store.js';
import { FANDOM_KINDS } from '../lib/vocab.js';
import { workRow, menu } from './common.js';

export async function render(el, ctx2) {
  if (ctx2.head === 'fandom') return fandomPage(el, ctx2);
  const { go } = ctx2;
  const snap = await store.snapshot();
  el.innerHTML = `
    <div class="fx-toolbar"><label class="search">${icon('search')}<input type="search" data-q placeholder="Tìm fandom" aria-label="Tìm fandom"></label>
      <button class="btn primary" data-new>${icon('plus')}<span>Fandom mới</span></button></div>
    <div class="fx-fd-grid" data-list></div>`;
  const draw = (q = '') => {
    const list = snap.fandomList.filter(f => store.fold(f.name + ' ' + (f.aliases || []).join(' ')).includes(store.fold(q)));
    el.querySelector('[data-list]').innerHTML = list.map(f => `<a class="fx-fd" href="#fanfic/fandom/${esc(f.id)}" data-fd="${esc(f.id)}">
      <span class="fx-fd-ic">${icon('fx-fandom')}</span><b>${esc(f.name)}</b>
      <small class="muted">${esc(FANDOM_KINDS[f.kind] || '')} · ${f.works.length} truyện${(f.bookIds?.length || f.bookSeriesIds?.length) ? ` · ${icon('book')}có nguyên tác` : ''}</small></a>`).join('')
      || `<div class="empty">${icon('fx-fandom')}<p>Chưa có fandom. Fandom được tạo khi bạn gắn nó cho truyện, hoặc tạo ở đây.</p></div>`;
  };
  el.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
  el.querySelector('[data-new]').onclick = async () => (await import('./edit.js')).editFandom(null, { onDone: (id) => go('fandom/' + id) });
  onHold(el.querySelector('[data-list]'), '[data-fd]', (a, e) => {
    const f = snap.fandoms.get(a.dataset.fd);
    menu(a, [
      { label: 'Sửa fandom', icon: 'fx-edit', run: async () => (await import('./edit.js')).editFandom(f) },
      { label: 'Nguyên tác trong Sách…', icon: 'book', run: async () => (await import('./edit.js')).pickCanon(f) },
      { label: 'Xoá fandom', icon: 'trash', danger: true, run: async () => { if (await confirmBox('Xoá fandom?', 'Truyện vẫn còn, chỉ bỏ gắn fandom này.', 'Xoá')) await store.removeFandom(f.id); } },
    ], e?.type === 'contextmenu' ? { x: e.clientX, y: e.clientY } : null);
  });
  draw();
}

async function fandomPage(el, { arg: id, go, ctx }) {
  const snap = await store.snapshot();
  const f = snap.fandomList.find(x => x.id === id);
  if (!f) { el.innerHTML = `<div class="empty"><p>Không tìm thấy fandom.</p><a class="btn" href="#fanfic/fandoms">Về Fandom</a></div>`; return; }
  const books = (await db.items.bulkGet(f.bookIds || [])).filter(b => b && !b.deleted);
  const series = (await db.series.bulkGet(f.bookSeriesIds || [])).filter(Boolean);
  const seriesBooks = series.length ? await db.books.where('seriesId').anyOf(series.map(s => s.id)).toArray() : [];
  const tags = [...snap.tags.values()].filter(t => t.fandomId === id);
  const chars = tags.filter(t => t.kind === 'character'), rels = tags.filter(t => t.kind === 'relationship');
  const count = (tid, k) => f.works.filter(w => (w.fic[k] || []).includes(tid)).length;
  el.innerHTML = `
    <article class="fx-detail">
      <a class="fx-back" href="#fanfic/fandoms">${icon('fx-back')}Fandom</a>
      <header class="fx-hero"><div class="fx-hero-t"><span class="fx-fd-ic lg">${icon('fx-fandom')}</span><div><h1>${esc(f.name)}</h1>
        <p class="muted">${esc(FANDOM_KINDS[f.kind] || '')}${f.aliases?.length ? ' · ' + esc(f.aliases.join(', ')) : ''}</p></div></div>
        ${f.description ? `<p>${esc(f.description)}</p>` : ''}
        <div class="row-actions"><button class="btn primary" data-new>${icon('plus')}Truyện mới trong fandom này</button>
          <button class="btn" data-edit>${icon('fx-edit')}Sửa</button></div></header>
      <section class="fx-panel"><div class="fx-sec-h"><h2 class="section-title">${icon('book')}Nguyên tác trong Sách</h2><button class="btn small" data-canon>${icon('link')}Gắn sách</button></div>
        ${books.length || series.length ? `<ul class="fx-canon">${series.map(s => `<li><a href="#books/series/${esc(s.id)}">${icon('library')}${esc(s.name)} <small class="muted">bộ sách · ${seriesBooks.length} cuốn</small></a></li>`).join('')}${books.map(b => `<li><a href="#books/book/${esc(b.id)}">${icon('book')}${esc(b.title)} <small class="muted">${esc(b.subtitle || '')}</small></a></li>`).join('')}</ul>`
          : '<p class="muted">Chưa gắn sách gốc. Gắn để trang sách bên Sách hiện các fanfic của fandom này, và ngược lại.</p>'}</section>
      <div class="fx-cols">
        <section class="fx-panel"><h2 class="section-title">${icon('fx-person')}Nhân vật</h2><div class="fx-tags">${chars.map(t => `<span class="fx-tag char">${esc(t.name)} <small>${count(t.id, 'characterIds')}</small></span>`).join('') || '<span class="muted">Chưa có</span>'}</div></section>
        <section class="fx-panel"><h2 class="section-title">${icon('fx-heart')}Cặp đôi</h2><div class="fx-tags">${rels.map(t => `<span class="fx-tag rel">${esc(t.name)} <small>${count(t.id, 'relationshipIds')}</small></span>`).join('') || '<span class="muted">Chưa có</span>'}</div></section>
      </div>
      <section><h2 class="section-title">Tác phẩm (${f.works.length})</h2><div class="fx-works">${f.works.map(v => workRow(v)).join('') || '<p class="muted">Chưa có truyện.</p>'}</div></section>
    </article>`;
  el.querySelector('[data-new]').onclick = async () => (await import('./edit.js')).editWork(null, { go, preset: { fandoms: [f.name] } });
  el.querySelector('[data-edit]').onclick = async () => (await import('./edit.js')).editFandom(f);
  el.querySelector('[data-canon]').onclick = async () => (await import('./edit.js')).pickCanon(f, { onDone: () => {} });
  el.querySelectorAll('.fx-work').forEach(c => c.onclick = () => go('work/' + c.dataset.id));
  void toast; void ctx;
}
