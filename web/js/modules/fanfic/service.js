// Xưởng Viết background service (manifest.service): parameters, the 'fanfic' service (the Books reader builds
// a fanfic from it), blocks for the Library drawer and the Books book page, and the cover-screen card.
import './lib/icons.js';
import { db } from '../../core/db.js';
import { icon } from '../../core/icons.js';
import { esc } from '../../core/ui.js';
import { extend } from '../../core/extensions.js';
import { definePrefs } from './lib/prefs.js';
import { WARNINGS } from './lib/vocab.js';
import { today } from './lib/text.js';
import * as store from './lib/store.js';

const NAME = 'Xưởng Viết';
let offs = [], css = null, ctx = null;

export async function start(context) {
  ctx = context;
  definePrefs();
  css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./fanfic.css', import.meta.url).href });
  document.head.appendChild(css);
  offs.push(extend('library.drawer', drawerBlock));
  ctx.services.provide('fanfic', {
    // Books reader: { title, author, language, chapters: [{ title, html }] } from the published chapters.
    book: (id) => store.readableBook(id),
    // Books page / reader: open this fanfic for editing, optionally at the chapter being read (0-based index).
    edit: async (id, chapterIndex = null) => {
      const v = await store.get(id);
      const ch = chapterIndex != null ? v?.tops.filter(c => c.pubAt)[chapterIndex] : null;
      if (!v) return ctx.go('fanfic/works');
      ctx.go(`fanfic/write/${id}${ch ? '/' + ch.id : ''}`);   // no position yet: the writer opens the last edited chapter
    },
    show: (id) => ctx.go('fanfic/work/' + id),
    snapshot: () => store.snapshot(),
    fandomsOfBook: (bookId, seriesId) => store.fandomsOfBook(bookId, seriesId),
  });
  offs.push(ctx.bus.on('fanfic:changed', () => ctx.bus.emit('cover:refresh')));
}

export async function stop() { offs.forEach(f => f()); offs = []; css?.remove(); }

// Library drawer and Books book page (from === 'books'):
//  - a fanfic: fandom, rating, warnings, pairings, tags, words, and "Sửa trong Xưởng Viết";
//  - a book that is the canon of a fandom: the fandom(s) and their fanfics, "Viết fanfic cho truyện này".
async function drawerBlock({ item, el, from }) {
  if (from === 'fanfic') return;
  if (item.type === 'fanfic') return fanficBlock(item, el, from);
  if (item.type === 'book') return canonBlock(item, el);
}

async function fanficBlock(item, el, from) {
  const v = await store.get(item.id);
  if (!v) return;
  const { AUDIENCE } = await import('./lib/vocab.js');
  const box = document.createElement('div');
  box.className = 'block fx-ext';
  const tag = (t, cls = '') => `<span class="fx-tag ${cls}">${esc(t)}</span>`;
  box.innerHTML = `<h3>Fanfic</h3>
    <p class="muted"><span class="fx-aud" style="--c:${AUDIENCE[v.audience].color}">${AUDIENCE[v.audience].short}</span> ${v.fandoms.map(f => `<a href="#fanfic/fandom/${esc(f.id)}">${esc(f.name)}</a>`).join(', ') || 'Chưa có fandom'} · ${v.words.toLocaleString()} từ · ${v.chapterCount}/${v.planned || '?'} chương</p>
    <div class="fx-tags">${[...(v.fic.warnings || []).filter(w => w !== 'none').map(w => tag(WARNINGS[w], 'warn')), ...v.relationships.map(t => tag(t.name, 'rel')), ...v.characters.map(t => tag(t.name, 'char')), ...v.tags.map(t => tag(t))].join('')}</div>
    ${v.fic.summary && from !== 'books' ? `<p>${esc(v.fic.summary.slice(0, 300))}</p>` : ''}
    <div class="row-actions">
      <a class="btn" href="#fanfic/work/${item.id}">${icon('fx-edit')}Sửa trong ${NAME}</a>
      ${from !== 'books' && v.published ? `<a class="btn" href="#books/book/${item.id}">${icon('book')}Trang trong Sách</a>` : ''}
      ${v.dirty ? `<button class="btn" data-pub>${icon('fx-publish')}Cập nhật bản đọc</button>` : ''}
    </div>`;
  el.appendChild(box);
  box.querySelector('[data-pub]')?.addEventListener('click', async (e) => { e.currentTarget.disabled = true; await store.publish(item.id); e.currentTarget.textContent = 'Đã cập nhật'; });
}

async function canonBlock(item, el) {
  const book = await db.books.get(item.id);
  const fds = await store.fandomsOfBook(item.id, book?.seriesId);
  const box = document.createElement('div');
  box.className = 'block fx-ext';
  if (!fds.length) {
    // Not linked yet: offer it only when a fandom's name matches the title or series, so the block stays quiet otherwise.
    const snap = await store.snapshot();
    const series = book?.seriesId ? (await db.series.get(book.seriesId))?.name : '';
    const hay = store.fold(item.title + ' ' + (series || ''));
    const guess = snap.fandomList.find(f => [f.name, ...(f.aliases || [])].some(n => n && hay.includes(store.fold(n))));
    if (!guess) return;
    box.innerHTML = `<h3>Fandom</h3><p class="muted">Có thể là nguyên tác của fandom “${esc(guess.name)}” (${guess.works.length} fanfic).</p>
      <div class="row-actions"><button class="btn" data-link>${icon('link')}Gắn làm nguyên tác</button></div>`;
    el.appendChild(box);
    box.querySelector('[data-link]').onclick = async () => { await store.linkCanon(guess.id, book?.seriesId ? { seriesId: book.seriesId } : { bookId: item.id }); box.innerHTML = `<p class="muted">Đã gắn với fandom ${esc(guess.name)}.</p>`; };
    return;
  }
  const snap = await store.snapshot();
  const works = fds.flatMap(f => snap.fandomList.find(x => x.id === f.id)?.works || []);
  box.innerHTML = `<h3>Fanfic của ${fds.map(f => esc(f.name)).join(', ')}</h3>
    ${works.length ? `<ul class="fx-mini">${works.slice(0, 6).map(w => `<li><a href="#${w.published ? 'books/book' : 'fanfic/work'}/${w.id}">${esc(w.title)}</a> <small class="muted">${w.words.toLocaleString()} từ${w.published ? '' : ' · bản nháp'}</small></li>`).join('')}</ul>` : '<p class="muted">Chưa có fanfic nào.</p>'}
    <div class="row-actions"><a class="btn" href="#fanfic/fandom/${esc(fds[0].id)}">${icon('fx-fandom')}Mở fandom</a><button class="btn" data-new>${icon('plus')}Viết fanfic cho truyện này</button></div>`;
  el.appendChild(box);
  box.querySelector('[data-new]').onclick = async () => (await import('./ui/edit.js')).editWork(null, { go: (r) => ctx.go('fanfic/' + r), preset: { fandoms: [fds[0].name] } });
}
