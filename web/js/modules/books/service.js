// Books background service (manifest.service): parameters, the Library drawer block for books,
// the 'books' service for other modules, and catching up book items added from the Library
// (gives them a books row and reads their metadata/cover in the background).
import './lib/icons.js';
import { db } from '../../core/db.js';
import { icon } from '../../core/icons.js';
import { esc } from '../../core/ui.js';
import { extend } from '../../core/extensions.js';
import { tasks } from '../../core/tasks.js';
import { definePrefs } from './lib/prefs.js';
import * as store from './lib/store.js';

let offs = [], css = null, ctx = null;

export async function start(context) {
  ctx = context;
  definePrefs();
  css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./books.css', import.meta.url).href });
  document.head.appendChild(css);
  offs.push(extend('library.drawer', drawerBlock), extend('cover.cards', coverCard));
  ctx.services.provide('books', {
    open: (id) => ctx.go('books/read/' + id),
    show: (id) => ctx.go('books/book/' + id),
    snapshot: () => store.snapshot(),
    stats: async (range) => { const [{ compute }, s] = await Promise.all([import('./lib/stats.js'), store.snapshot()]); return compute(s.list, await store.allSessions(), range); },
  });
  // Book items imported through the Library: catch up shortly after start and after each import.
  setTimeout(catchUp, 1500);
  offs.push(ctx.bus.on('item:changed', (e) => { if (e?.source !== 'books') { clearTimeout(timer); timer = setTimeout(catchUp, 2500); } }));
}

// "Đang đọc" card for the cover screen (core/cover.js, docs/FOLDABLE.md): the book read last, one tap to go on.
async function coverCard() {
  const p = (await db.progress.where('moduleId').equals('books').toArray())
    .filter(r => r.state !== 'finished' && (r.percent || 0) < 98).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const item = p && await db.items.get(p.itemId);
  if (!item || item.deleted) return null;
  return {
    id: 'continue-' + item.id, app: 'Sách', icon: 'book', order: 20, route: 'books/read/' + item.id,
    title: item.title, sub: p.label || '', percent: p.percent || 0,
    actions: [{ label: 'Đọc tiếp', icon: 'book', primary: true, full: true, run: () => ctx.go('books/read/' + item.id) }],
  };
}

export async function stop() { offs.forEach(f => f()); offs = []; css?.remove(); clearTimeout(timer); }

let timer = 0, running = false;
async function catchUp() {
  if (running) return;
  running = true;
  try {
    await store.ensureRows();
    const todo = (await db.books.toArray()).filter(b => b.needsMeta === 1 && !b.deleted);
    if (!todo.length) return;
    const { readMetaInto } = await import('./ui/importer.js');
    const task = tasks.start({ label: 'Đọc thông tin sách mới', total: todo.length, delay: 800, cancellable: true });
    for (const b of todo) {
      if (task.cancelled) break;
      try { await readMetaInto(b.itemId); } catch (e) { console.warn('[books] meta', e); }
      await db.books.update(b.itemId, { needsMeta: 0 });
      task.step(1);
    }
    task.finish('Xong');
    store.changed();
  } catch (e) { console.warn('[books] catch-up', e); } finally { running = false; }
}

// Library → book drawer: reading status, rating, progress and a link to the book page.
async function drawerBlock({ item, el, refresh, from }) {
  if (item.type !== 'book' || from === 'books') return;
  await store.ensureRows();
  const b = await store.get(item.id);
  if (!b) return;
  const box = document.createElement('div');
  box.className = 'block bk-drawer';
  box.innerHTML = `<h3>Sách</h3>
    <p class="muted">${esc(b.authors.join(', ') || 'Chưa rõ tác giả')}${b.series ? ` · ${esc(b.series)}${b.seriesIndex != null ? ' #' + b.seriesIndex : ''}` : ''}${b.pages ? ` · ${b.pages} trang` : ''}</p>
    <div class="row-actions">
      <select data-st aria-label="Trạng thái đọc">${Object.entries(store.STATUSES).map(([k, v]) => `<option value="${k}" ${k === b.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <span class="bk-stars-mini">${[1, 2, 3, 4, 5].map(n => `<button data-r="${n}" aria-label="${n} sao" class="${b.rating >= n ? 'on' : b.rating >= n - 0.5 ? 'half' : ''}">${icon('star')}</button>`).join('')}</span>
    </div>
    ${b.percent ? `<div class="bar"><i style="width:${b.percent}%"></i></div>` : ''}
    <div class="row-actions"><a class="btn" href="#books/book/${item.id}">${icon('book')}Trang sách</a></div>`;
  el.appendChild(box);
  box.querySelector('[data-st]').onchange = async (e) => { await store.setStatus(item.id, e.target.value); refresh(); };
  box.querySelectorAll('[data-r]').forEach(btn => btn.onclick = async () => { const r = +btn.dataset.r; await store.updateBook(item.id, { rating: b.rating === r ? 0 : r }); refresh(); });
}
