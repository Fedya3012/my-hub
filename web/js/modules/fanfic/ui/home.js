// Bàn viết (writing desk): today's words against the daily goal, streak and the last 14 days, continue writing,
// open todos, works in progress and recently saved works.
import { icon } from '../../../core/icons.js';
import { esc } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { today } from '../lib/text.js';
import { get as pref } from '../lib/prefs.js';
import { db } from '../../../core/db.js';
import { workRow, fmtNum, ago } from './common.js';

export async function render(el, { go }) {
  const snap = await store.snapshot();
  const by = await store.writingDays(30);
  const todayW = by.get(today()) || 0, goal = pref('dailyGoal') || 0, streak = store.streakOf(by);
  const mine = snap.list.filter(v => v.origin === 'mine');
  const active = mine.filter(v => ['wip', 'draft'].includes(v.status)).sort((a, b) => b.editedAt - a.editedAt);
  const last = active[0];
  const lastCh = last && (last.chapters.find(c => c.id === last.fic.lastChapterId) || last.tops.at(-1));
  const todos = (await db.ficNotes.where('kind').equals('todo').toArray()).filter(n => !n.deleted && !n.done && snap.byId.has(n.fanficId)).slice(0, 6);
  const days = [...Array(14)].map((_, i) => { const d = today(new Date(Date.now() - (13 - i) * 864e5)); return [d, by.get(d) || 0]; });
  const max = Math.max(goal, ...days.map(d => d[1]), 1);
  const saved = snap.list.filter(v => v.origin === 'saved').sort((a, b) => (b.progress?.updatedAt || b.editedAt) - (a.progress?.updatedAt || a.editedAt)).slice(0, 4);
  el.innerHTML = `
    <div class="fold-top">
    <section class="fx-desk">
      <div class="fx-ring" style="--p:${goal ? Math.min(100, todayW / goal * 100) : 0}%" role="img" aria-label="Hôm nay ${todayW} trên ${goal} từ">
        <b class="num">${fmtNum(todayW)}</b><small>${goal ? `/ ${fmtNum(goal)} từ hôm nay` : 'từ hôm nay'}</small></div>
      <div class="fx-desk-b">
        <p class="muted">${streak ? `🔥 Chuỗi ${streak} ngày viết` : 'Viết vài chữ hôm nay để bắt đầu chuỗi ngày.'}</p>
        <div class="fx-spark" aria-label="14 ngày gần đây">${days.map(([d, w]) => `<i style="--h:${Math.round(w / max * 100)}%" class="${goal && w >= goal ? 'hit' : ''}" title="${d}: ${w} từ"></i>`).join('')}</div>
        <div class="row-actions">
          ${last ? `<button class="btn primary" data-cont>${icon('quill')}Viết tiếp: ${esc(last.title)}${lastCh ? ` · ${esc(lastCh.title)}` : ''}</button>` : ''}
          <button class="btn${last ? '' : ' primary'}" data-new>${icon('plus')}Truyện mới</button>
        </div>
      </div>
    </section>
    </div>
    <div class="fold-bottom">
    ${todos.length ? `<section class="fx-panel"><h2 class="section-title">${icon('check')}Việc cần làm</h2><ul class="fx-todo">${todos.map(n => `<li><input type="checkbox" data-done="${n.id}" aria-label="Xong"><a href="#fanfic/work/${n.fanficId}">${esc(n.title || 'Việc')}<small class="muted"> · ${esc(snap.byId.get(n.fanficId)?.title || '')}</small></a></li>`).join('')}</ul></section>` : ''}
    <section><h2 class="section-title">Đang viết <a class="more" href="#fanfic/works">Tất cả</a></h2>
      <div class="fx-works">${active.slice(0, 6).map(v => workRow(v)).join('') || '<p class="muted">Chưa có truyện đang viết.</p>'}</div></section>
    ${saved.length ? `<section><h2 class="section-title">Truyện đã lưu để đọc <a class="more" href="#fanfic/works/origin:saved">Tất cả</a></h2><div class="fx-works">${saved.map(v => workRow(v)).join('')}</div></section>` : ''}
    </div>`;
  el.querySelector('[data-cont]')?.addEventListener('click', () => go(`write/${last.id}${lastCh ? '/' + lastCh.id : ''}`));
  el.querySelector('[data-new]').onclick = async () => (await import('./edit.js')).editWork(null, { go });
  el.querySelectorAll('[data-done]').forEach(cb => cb.onchange = async () => { const n = await db.ficNotes.get(cb.dataset.done); await store.saveNote({ ...n, done: 1 }); });
  el.querySelectorAll('.fx-work').forEach(c => c.onclick = () => go('work/' + c.dataset.id));
  void ago;
}
