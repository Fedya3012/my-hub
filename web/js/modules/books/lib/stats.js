// Reading statistics (StoryGraph-style), computed from the books snapshot + reading sessions.
// compute(list, sessions, { from, to }) -> totals, distributions, monthly series, heatmap, streaks.
import { MOODS, PACES } from './store.js';
import { FORMATS } from './formats.js';

export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const inRange = (t, from, to) => t && t >= from && t <= to;

// Finishes (re-reads count each time) inside the range.
function finishes(list, from, to) {
  const out = [];
  for (const b of list) {
    const ends = (b.book.reads || []).filter(r => !r.dnf && inRange(r.end, from, to)).map(r => r.end);
    if (!ends.length && b.status === 'finished' && inRange(b.book.finishedAt, from, to)) ends.push(b.book.finishedAt);
    for (const end of ends) out.push({ b, end });
  }
  return out;
}

function count(arr) { const m = new Map(); for (const k of arr) if (k) m.set(k, (m.get(k) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); }

export function streaks(dayset) {
  let cur = 0;   // today or yesterday keeps the streak alive
  const d = new Date(); d.setHours(12, 0, 0, 0);
  if (!dayset.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (dayset.has(dayKey(d))) { cur++; d.setDate(d.getDate() - 1); }
  let best = 0, run = 0, prev = null;
  for (const k of [...dayset].sort()) {
    const t = Date.parse(k + 'T12:00:00');
    run = prev && t - prev < 1.5 * 864e5 ? run + 1 : 1;
    best = Math.max(best, run); prev = t;
  }
  return { current: cur, longest: best };
}

export function compute(list, sessions, { from = 0, to = Date.now() } = {}) {
  const fin = finishes(list, from, to);
  const ses = sessions.filter(s => inRange(s.start, from, to));
  const secs = ses.reduce((a, s) => a + (s.seconds || 0), 0);
  const words = ses.reduce((a, s) => a + (s.words || 0), 0);
  const wpmSecs = ses.filter(s => s.words).reduce((a, s) => a + (s.seconds || 0), 0);
  const sesPages = ses.reduce((a, s) => a + (s.pages || 0), 0);
  const finPages = fin.reduce((a, f) => a + (f.b.pages || 0), 0);
  const rated = fin.filter(f => f.b.rating > 0);
  const heat = new Map();
  for (const s of sessions) { const k = dayKey(s.start); heat.set(k, (heat.get(k) || 0) + (s.seconds || 0) / 60); }
  for (const f of finishes(list, 0, Date.now())) { const k = dayKey(f.end); if (!heat.has(k)) heat.set(k, 0.01); }
  const st = streaks(new Set(heat.keys()));
  const books = fin.map(f => f.b);
  const len = (p) => !p ? null : p < 200 ? '< 200' : p < 350 ? '200–349' : p < 500 ? '350–499' : '500+';
  const months = [];   // monthly series over the range (max 36 buckets)
  if (from > 0) {
    const start = new Date(Math.max(from, to - 3 * 365 * 864e5)); start.setDate(1); start.setHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= to && months.length < 36; d.setMonth(d.getMonth() + 1)) {
      const a = d.getTime(), e = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1;
      const f = fin.filter(x => inRange(x.end, a, e));
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, books: f.length, pages: f.reduce((s, x) => s + (x.b.pages || 0), 0),
        hours: sessions.filter(s => inRange(s.start, a, e)).reduce((s, x) => s + (x.seconds || 0), 0) / 3600 });
    }
  }
  const withPages = books.filter(b => b.pages);
  return {
    booksRead: fin.length, pages: Math.max(finPages, sesPages), hours: secs / 3600, sessions: ses.length,
    avgRating: rated.length ? rated.reduce((a, f) => a + f.b.rating, 0) / rated.length : 0,
    avgPages: withPages.length ? Math.round(withPages.reduce((a, b) => a + b.pages, 0) / withPages.length) : 0,
    wpm: wpmSecs > 60 ? Math.round(words / (wpmSecs / 60)) : 0,
    dnf: list.filter(b => b.status === 'dnf' && inRange(b.book.dnfAt, from, to)).length,
    reading: list.filter(b => b.status === 'reading').length, want: list.filter(b => b.status === 'want').length,
    streak: st.current, longestStreak: st.longest, heat,
    byGenre: count(books.flatMap(b => b.book.genres || [])).slice(0, 12),
    byMood: count(books.flatMap(b => b.book.moods || [])).map(([k, n]) => [MOODS[k] || k, n]),
    byPace: count(books.map(b => b.book.pace)).map(([k, n]) => [PACES[k] || k, n]),
    byFormat: count(books.map(b => b.book.physical ? 'paper' : b.format)).map(([k, n]) => [FORMATS[k]?.label || k, n]),
    byLanguage: count(books.map(b => b.book.language && b.book.language.slice(0, 2))),
    byAuthor: count(books.flatMap(b => b.authors)).slice(0, 10),
    byLength: count(books.map(b => len(b.pages))),
    byRating: [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map(r => [r, books.filter(b => b.rating === r).length]).filter(x => x[1]),
    months, topRated: [...rated].sort((a, b) => b.b.rating - a.b.rating).slice(0, 5).map(f => f.b),
    longest: [...withPages].sort((a, b) => b.pages - a.pages)[0] || null,
    shortest: [...withPages].sort((a, b) => a.pages - b.pages)[0] || null,
    finished: fin,
  };
}

// Goal progress: books / pages / hours inside the goal's year (or month), optionally only books matching a query.
export function goalProgress(goal, list, sessions, matcher = null) {
  const from = new Date(goal.year, goal.month ? goal.month - 1 : 0, 1).getTime();
  const to = new Date(goal.year, goal.month ? goal.month : 12, 1).getTime() - 1;
  const l = matcher ? list.filter(matcher) : list;
  const fin = finishes(l, from, to);
  const ids = new Set(l.map(b => b.id));
  const done = goal.kind === 'pages' ? fin.reduce((a, f) => a + (f.b.pages || 0), 0)
    : goal.kind === 'hours' ? sessions.filter(s => inRange(s.start, from, to) && ids.has(s.itemId)).reduce((a, s) => a + (s.seconds || 0), 0) / 3600
    : fin.length;
  const frac = Math.min(1, Math.max(0, (Date.now() - from) / (to - from)));
  return { done, target: goal.target, percent: goal.target ? Math.min(100, done / goal.target * 100) : 0, expected: goal.target * frac, ahead: done - goal.target * frac, from, to };
}

// Badges earned so far (computed, nothing stored).
export function badges(list, sessions) {
  const all = compute(list, sessions, { from: 0 });
  const done = list.filter(b => b.status === 'finished');
  const langs = new Set(done.map(b => (b.book.language || '').slice(0, 2)).filter(Boolean));
  const genres = new Set(done.flatMap(b => b.book.genres || []));
  const night = sessions.some(s => new Date(s.start).getHours() < 4 && s.seconds > 600);
  const B = [
    ['first', 'Cuốn đầu tiên', 'Đọc xong 1 cuốn', all.booksRead >= 1],
    ['ten', 'Mọt sách', 'Đọc xong 10 cuốn', all.booksRead >= 10],
    ['fifty', 'Thủ thư', 'Đọc xong 50 cuốn', all.booksRead >= 50],
    ['hundred', 'Trăm cuốn', 'Đọc xong 100 cuốn', all.booksRead >= 100],
    ['streak7', 'Một tuần liền', 'Chuỗi 7 ngày đọc', all.longestStreak >= 7],
    ['streak30', 'Một tháng liền', 'Chuỗi 30 ngày đọc', all.longestStreak >= 30],
    ['pages10k', '10.000 trang', 'Tổng 10.000 trang', all.pages >= 10000],
    ['brick', 'Cuốn gạch', 'Đọc xong một cuốn từ 800 trang', done.some(b => b.pages >= 800)],
    ['polyglot', 'Đa ngôn ngữ', 'Đọc sách bằng 3 ngôn ngữ', langs.size >= 3],
    ['explorer', 'Nhà thám hiểm', 'Đọc 10 thể loại', genres.size >= 10],
    ['night', 'Cú đêm', 'Đọc hơn 10 phút sau nửa đêm', night],
    ['marathon', 'Marathon', 'Một phiên đọc 3 giờ', sessions.some(s => s.seconds >= 3 * 3600)],
    ['critic', 'Nhà phê bình', 'Viết 10 nhận xét', list.filter(b => b.book.review).length >= 10],
    ['series', 'Trọn bộ', 'Đọc hết một bộ (từ 3 cuốn)', seriesDone(list)],
  ];
  return B.map(([id, name, desc, got]) => ({ id, name, desc, got: !!got }));
}
function seriesDone(list) {
  const by = new Map();
  for (const b of list) if (b.book.seriesId) { if (!by.has(b.book.seriesId)) by.set(b.book.seriesId, []); by.get(b.book.seriesId).push(b); }
  return [...by.values()].some(l => l.length >= 3 && l.every(b => b.status === 'finished'));
}
