// Thống kê: words per day (last 30 days, goal line), streaks, writing time, words per minute, minutes per page
// (250 words), per-work totals and the most used words across your own works.
import { icon } from '../../../core/icons.js';
import { esc } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { today } from '../lib/text.js';
import { frequency } from '../lib/analyze.js';
import { get as pref } from '../lib/prefs.js';
import { fmtNum } from './common.js';

export async function render(el) {
  const [snap, rows] = await Promise.all([store.snapshot(), store.writingRows(365)]);
  const goal = pref('dailyGoal') || 0;
  const byDay = new Map(), byFic = new Map();
  let secs = 0, words = 0, sessions = 0;
  for (const r of rows) {
    const w = Math.max(0, r.words || 0);
    byDay.set(r.day, (byDay.get(r.day) || 0) + w);
    byFic.set(r.fanficId, (byFic.get(r.fanficId) || 0) + w);
    secs += r.seconds || 0; words += w; sessions += r.sessions || 0;
  }
  const days = [...Array(30)].map((_, i) => { const d = today(new Date(Date.now() - (29 - i) * 864e5)); return [d, byDay.get(d) || 0]; });
  const max = Math.max(goal, ...days.map(d => d[1]), 1);
  const streak = store.streakOf(byDay);
  let best = 0, run = 0;
  for (let i = 365; i >= 0; i--) { const d = today(new Date(Date.now() - i * 864e5)); run = byDay.get(d) > 0 ? run + 1 : 0; best = Math.max(best, run); }
  const wpm = secs > 60 ? words / (secs / 60) : 0;
  const hit = days.filter(d => goal && d[1] >= goal).length;
  const mine = snap.list.filter(v => v.origin === 'mine');
  const total = mine.reduce((a, v) => a + v.words, 0);
  const freq = frequency(mine.flatMap(v => v.chapters.map(c => c.body)).join('\n\n'), 24);
  const W = 600, H = 160, bw = W / days.length;
  el.innerHTML = `
    <div class="fx-kpis wide">
      <div><b class="num">${fmtNum(total)}</b><small>từ trong ${mine.length} truyện</small></div>
      <div><b class="num">${fmtNum(days.reduce((a, d) => a + d[1], 0))}</b><small>từ 30 ngày qua</small></div>
      <div><b class="num">${streak}</b><small>ngày liên tiếp · dài nhất ${best}</small></div>
      <div><b class="num">${wpm ? Math.round(wpm) : '–'}</b><small>từ / phút khi viết</small></div>
      <div><b class="num">${wpm ? Math.round(250 / wpm) : '–'}</b><small>phút / trang (250 từ)</small></div>
      <div><b class="num">${Math.round(secs / 3600 * 10) / 10}</b><small>giờ viết · ${sessions} phiên</small></div>
    </div>
    <section class="fx-panel"><h2 class="section-title">${icon('fx-stats')}Số từ mỗi ngày (30 ngày)</h2>
      <div class="fx-chart"><svg viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="Số từ mỗi ngày trong 30 ngày">
        ${goal ? `<line x1="0" x2="${W}" y1="${H - goal / max * H}" y2="${H - goal / max * H}" class="goal"/><text x="${W - 4}" y="${H - goal / max * H - 4}" text-anchor="end" class="lbl">mục tiêu ${fmtNum(goal)}</text>` : ''}
        ${days.map(([d, w], i) => `<rect x="${i * bw + 2}" y="${H - w / max * H}" width="${bw - 4}" height="${Math.max(0, w / max * H)}" rx="2" class="${goal && w >= goal ? 'hit' : ''}"><title>${d}: ${fmtNum(w)} từ</title></rect>`).join('')}
        ${days.map(([d], i) => i % 5 === 0 || i === 29 ? `<text x="${i * bw + bw / 2}" y="${H + 16}" text-anchor="middle" class="lbl">${d.slice(8)}/${d.slice(5, 7)}</text>` : '').join('')}
      </svg></div>
      <p class="muted">${goal ? `Đạt mục tiêu ${hit}/30 ngày.` : 'Đặt mục tiêu mỗi ngày trong tab <a href="#fanfic/settings">Cài đặt</a>.'}</p></section>
    <div class="fx-cols">
      <section class="fx-panel"><h2 class="section-title">${icon('fx-works')}Theo truyện</h2>
        <ul class="fx-mini">${mine.sort((a, b) => b.words - a.words).map(v => `<li><a href="#fanfic/work/${v.id}">${esc(v.title)}</a> <small class="muted num">${fmtNum(v.words)} từ · năm nay +${fmtNum(byFic.get(v.id) || 0)}</small>${v.fic.goal?.total ? `<div class="bar sm"><i style="width:${Math.min(100, v.words / v.fic.goal.total * 100)}%"></i></div>` : ''}</li>`).join('') || '<li class="muted">Chưa có truyện.</li>'}</ul></section>
      <section class="fx-panel"><h2 class="section-title">${icon('fx-plot')}Từ dùng nhiều nhất</h2>
        <div class="fx-tags">${freq.map(([w, n]) => `<span class="fx-tag">${esc(w)} <small>${fmtNum(n)}</small></span>`).join('') || '<span class="muted">Chưa đủ chữ để phân tích.</span>'}</div>
        <p class="hint">Từ chức năng (và, là, của, the…) đã được bỏ qua. Trong trình viết, menu ⋯ → Kiểm tra lặp từ để xem từng chương.</p></section>
    </div>`;
}
