// New fanfic / edit its information (AO3 posting form, shortened): fandoms, rating, warnings, categories,
// relationships, characters, tags, summary, notes, series, status, goals.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { db } from '../../../core/db.js';
import * as store from '../lib/store.js';
import { STATUSES, AUDIENCE, WARNINGS, CATEGORIES, ORIGINS } from '../lib/vocab.js';
import { sheet, listInput } from './common.js';
import { get as pref } from '../lib/prefs.js';

export async function editWork(v = null, { go, preset = {} } = {}) {
  const snap = await store.snapshot();
  const fic = v?.fic || {};
  const names = (ids, M) => (ids || []).map(id => M.get(id)?.name).filter(Boolean);
  const allTags = [...snap.tags.values()];
  const data = {
    origin: fic.origin || preset.origin || 'mine', title: v?.title || '', author: fic.author || '', sourceUrl: fic.sourceUrl || '',
    fandoms: v ? v.fandoms.map(f => f.name) : (preset.fandoms || []), audience: fic.audience || 'nr', warnings: fic.warnings || [],
    categories: fic.categories || [], relationships: v ? v.relationships.map(t => t.name) : [], characters: v ? v.characters.map(t => t.name) : [],
    tags: v?.tags || [], status: fic.status || 'draft', planned: fic.plannedChapters || '', summary: fic.summary || '',
    notesStart: fic.notesStart || '', notesEnd: fic.notesEnd || '', series: v?.series?.name || '', seriesIndex: fic.seriesIndex ?? '',
    language: fic.language || 'vi', goal: fic.goal?.total || '', deadline: fic.goal?.deadline || '',
  };
  const form = document.createElement('form');
  form.className = 'fx-form';
  form.innerHTML = `
    <div class="seg fx-origin" role="radiogroup" aria-label="Nguồn">${Object.entries(ORIGINS).map(([k, l]) => `<label><input type="radio" name="origin" value="${k}" ${data.origin === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <label>Tên truyện<input data-f="title" required value="${esc(data.title)}" placeholder="Tên tác phẩm"></label>
    <div class="fx-2">
      <label data-saved>Tác giả<input data-f="author" value="${esc(data.author)}" placeholder="Bút danh của tác giả"></label>
      <label data-saved>Đường dẫn gốc<input data-f="sourceUrl" type="url" value="${esc(data.sourceUrl)}" placeholder="https://archiveofourown.org/works/…"></label>
    </div>
    <label>Fandom<span class="hint">Nhiều fandom cách nhau bằng dấu phẩy (crossover)</span>${listInput('fandoms', data.fandoms, snap.fandomList.map(f => f.name), 'Harry Potter, Marvel…')}</label>
    <div class="fx-2">
      <label>Xếp hạng<select data-f="audience">${Object.entries(AUDIENCE).map(([k, a]) => `<option value="${k}" ${k === data.audience ? 'selected' : ''}>${a.short} · ${a.label}</option>`).join('')}</select></label>
      <label>Trạng thái<select data-f="status">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${k === data.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <fieldset><legend>Cảnh báo</legend><div class="fx-checks">${Object.entries(WARNINGS).map(([k, l]) => `<label><input type="checkbox" name="warnings" value="${k}" ${data.warnings.includes(k) ? 'checked' : ''}>${l}</label>`).join('')}</div></fieldset>
    <fieldset><legend>Thể loại quan hệ</legend><div class="fx-checks">${Object.entries(CATEGORIES).map(([k, l]) => `<label><input type="checkbox" name="categories" value="${k}" ${data.categories.includes(k) ? 'checked' : ''}>${l}</label>`).join('')}</div></fieldset>
    <label>Cặp đôi / quan hệ<span class="hint">A/B là tình cảm, A &amp; B là tình bạn</span>${listInput('relationships', data.relationships, allTags.filter(t => t.kind === 'relationship').map(t => t.name), 'Harry Potter/Draco Malfoy')}</label>
    <label>Nhân vật${listInput('characters', data.characters, allTags.filter(t => t.kind === 'character').map(t => t.name), 'Hermione Granger, Luna Lovegood')}</label>
    <label>Tag tự do${listInput('tags', data.tags, snap.list.flatMap(x => x.tags), 'Fluff, Hurt/Comfort, AU…')}</label>
    <label>Tóm tắt<textarea data-f="summary" rows="4" placeholder="Vài câu giới thiệu truyện">${esc(data.summary)}</textarea></label>
    <details ${data.notesStart || data.notesEnd ? 'open' : ''}><summary>Lời tác giả</summary>
      <label>Đầu truyện<textarea data-f="notesStart" rows="3">${esc(data.notesStart)}</textarea></label>
      <label>Cuối truyện<textarea data-f="notesEnd" rows="3">${esc(data.notesEnd)}</textarea></label></details>
    <details ${data.series || data.goal ? 'open' : ''}><summary>Bộ truyện, mục tiêu, ngôn ngữ</summary>
      <div class="fx-2"><label>Thuộc bộ truyện<input data-f="series" value="${esc(data.series)}" list="fx-dl-series"><datalist id="fx-dl-series">${[...snap.series.values()].map(s => `<option value="${esc(s.name)}">`).join('')}</datalist></label>
        <label>Phần số<input data-f="seriesIndex" type="number" min="0" step="1" value="${esc(data.seriesIndex)}"></label></div>
      <div class="fx-2"><label>Số chương dự kiến<input data-f="planned" type="number" min="1" value="${esc(data.planned)}" placeholder="?"></label>
        <label>Ngôn ngữ<input data-f="language" value="${esc(data.language)}" placeholder="vi, en…"></label></div>
      <div class="fx-2"><label>Mục tiêu cả truyện (từ)<input data-f="goal" type="number" min="0" step="1000" value="${esc(data.goal)}"></label>
        <label>Hạn hoàn thành<input data-f="deadline" type="date" value="${esc(data.deadline || '')}"></label></div>
    </details>
    <footer class="row-actions"><button type="button" class="btn" data-cancel>Huỷ</button><button class="btn primary">${icon('check')}${v ? 'Lưu' : 'Tạo truyện'}</button></footer>`;
  const s = sheet(v ? 'Sửa thông tin truyện' : 'Truyện mới', form, { wide: true });
  const saved = () => form.querySelectorAll('[data-saved]').forEach(x => { x.hidden = form.querySelector('[name="origin"]:checked').value !== 'saved'; });
  form.querySelectorAll('[name="origin"]').forEach(r => r.onchange = saved); saved();
  form.querySelector('[data-cancel]').onclick = s.close;
  form.querySelector('[data-f="title"]').focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = (k) => form.querySelector(`[data-f="${k}"]`).value.trim();
    const checked = (n) => [...form.querySelectorAll(`[name="${n}"]:checked`)].map(x => x.value);
    const origin = form.querySelector('[name="origin"]:checked').value;
    const patch = {
      origin, title: f('title'), author: origin === 'saved' ? f('author') : (fic.author || pref('penName') || ''), sourceUrl: f('sourceUrl'),
      fandoms: store.splitList(f('fandoms')), audience: f('audience'), status: f('status'), warnings: checked('warnings'), categories: checked('categories'),
      relationships: store.splitList(f('relationships')), characters: store.splitList(f('characters')), tags: store.splitList(f('tags')),
      summary: f('summary'), notesStart: f('notesStart'), notesEnd: f('notesEnd'), language: f('language'),
      plannedChapters: +f('planned') || null, seriesIndex: f('seriesIndex') === '' ? null : +f('seriesIndex'),
      seriesId: await store.ensureSeries(f('series')),
      goal: { ...(fic.goal || {}), total: +f('goal') || 0, deadline: f('deadline') || null },
    };
    if (!patch.title) return;
    if (v) { await store.updateFanfic(v.id, patch); toast('Đã lưu'); s.close(); return; }
    const id = await store.createFanfic({ ...patch, noChapter: origin === 'saved' });
    s.close();
    toast('Đã tạo truyện');
    go?.('work/' + id);
  };
  return s;
}

// Fandom editor: name, kind, aliases, description, canon books (Books items or series).
export async function editFandom(fd, { onDone } = {}) {
  const { FANDOM_KINDS } = await import('../lib/vocab.js');
  const form = document.createElement('form');
  form.className = 'fx-form';
  form.innerHTML = `
    <label>Tên fandom<input data-f="name" required value="${esc(fd?.name || '')}"></label>
    <label>Loại nguyên tác<select data-f="kind">${Object.entries(FANDOM_KINDS).map(([k, l]) => `<option value="${k}" ${k === (fd?.kind || 'book') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Tên khác<input data-f="aliases" value="${esc((fd?.aliases || []).join(', '))}" placeholder="HP, Harry Potter - J. K. Rowling"></label>
    <label>Mô tả<textarea data-f="description" rows="3">${esc(fd?.description || '')}</textarea></label>
    <footer class="row-actions"><button type="button" class="btn" data-cancel>Huỷ</button><button class="btn primary">${icon('check')}Lưu</button></footer>`;
  const s = sheet(fd ? 'Sửa fandom' : 'Fandom mới', form);
  form.querySelector('[data-cancel]').onclick = s.close;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = (k) => form.querySelector(`[data-f="${k}"]`).value.trim();
    const patch = { name: f('name'), kind: f('kind'), aliases: store.splitList(f('aliases')), description: f('description') };
    if (!patch.name) return;
    let id = fd?.id;
    if (id) await store.updateFandom(id, patch);
    else { [id] = await store.ensureFandoms([patch.name]); await store.updateFandom(id, patch); }
    s.close(); onDone?.(id);
  };
}

export async function pickCanon(fd, { onDone } = {}) {
  const books = (await db.items.where('type').equals('book').toArray()).filter(i => !i.deleted);
  const series = (await db.series.toArray()).filter(s => !s.deleted);
  const box = document.createElement('div');
  box.className = 'stack';
  box.innerHTML = `<label class="search">${icon('search')}<input type="search" placeholder="Tìm sách hoặc bộ sách trong Sách" data-q></label><ul class="fx-pick"></ul>`;
  const s = sheet(`Nguyên tác của ${fd.name}`, box);
  const draw = (q = '') => {
    const m = (t) => store.fold(t).includes(store.fold(q));
    const rows = [
      ...series.filter(x => m(x.name)).map(x => ({ id: x.id, kind: 'series', name: x.name, on: (fd.bookSeriesIds || []).includes(x.id) })),
      ...books.filter(x => m(x.title + ' ' + (x.subtitle || ''))).map(x => ({ id: x.id, kind: 'book', name: x.title, sub: x.subtitle, on: (fd.bookIds || []).includes(x.id) })),
    ].slice(0, 80);
    box.querySelector('.fx-pick').innerHTML = rows.length ? rows.map(r => `<li><label><input type="checkbox" data-k="${r.kind}" value="${esc(r.id)}" ${r.on ? 'checked' : ''}>${icon(r.kind === 'series' ? 'library' : 'book')}<span>${esc(r.name)}${r.sub ? ` <small class="muted">${esc(r.sub)}</small>` : ''}</span></label></li>`).join('')
      : '<li class="muted">Chưa có sách nào trong Sách khớp. Thêm sách gốc bên Sách trước.</li>';
    box.querySelectorAll('input[data-k]').forEach(c => c.onchange = async () => {
      await store.linkCanon(fd.id, c.dataset.k === 'series' ? { seriesId: c.value } : { bookId: c.value }, c.checked);
      fd = await db.fandoms.get(fd.id); onDone?.();
    });
  };
  box.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
  draw();
  return s;
}
