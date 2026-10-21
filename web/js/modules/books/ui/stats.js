// Statistics (StoryGraph style) and goals / challenges / badges.
//   stats: range picker (this year, last year, 30 days, all time, custom), KPI tiles, monthly chart,
//          distributions (genre, mood, pace, format, language, author, length, rating), reading heatmap,
//          yearly wrap-up, export as CSV / shareable PNG image.
//   goals: yearly / monthly goals (books, pages, hours), challenges limited by a search, badges.
import { icon } from '../../../core/icons.js';
import { esc, h, modal, toast } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { compute, goalProgress, badges, dayKey } from '../lib/stats.js';
import { compile } from '../lib/query.js';
import { coverHtml, hydrateCovers, fmtNum, fmtHours, download } from './common.js';

let range = { kind: 'year', from: '', to: '' };

export async function render(el, args) {
  return args.head === 'goals' ? goalsPage(el, args) : statsPage(el, args);
}

function bounds() {
  const y = new Date().getFullYear(), now = Date.now();
  switch (range.kind) {
    case 'year': return { from: new Date(y, 0, 1).getTime(), to: now, label: String(y), year: y };
    case 'lastyear': return { from: new Date(y - 1, 0, 1).getTime(), to: new Date(y, 0, 1).getTime() - 1, label: String(y - 1), year: y - 1 };
    case '30d': return { from: now - 30 * 864e5, to: now, label: '30 ngày qua' };
    case '12m': return { from: now - 365 * 864e5, to: now, label: '12 tháng qua' };
    case 'custom': return { from: range.from ? Date.parse(range.from) : 0, to: range.to ? Date.parse(range.to) + 864e5 - 1 : now, label: `${range.from || '…'} → ${range.to || 'nay'}` };
    default: return { from: 0, to: now, label: 'Mọi lúc' };
  }
}

// Horizontal bar list (accessible: plain text values next to the bars).
function bars(title, rows, { fmt = (n) => n } = {}) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map(r => r[1]));
  return `<section class="bk-panel bk-dist"><h3>${esc(title)}</h3><ul>${rows.map(([k, n]) => `<li><span class="bk-dist-k">${esc(k)}</span><span class="bk-dist-bar"><i style="width:${n / max * 100}%"></i></span><span class="num">${fmt(n)}</span></li>`).join('')}</ul></section>`;
}

function monthChart(months, key, label) {
  if (!months.length) return '';
  const max = Math.max(1, ...months.map(m => m[key]));
  return `<section class="bk-panel bk-months"><h3>${esc(label)}</h3><div class="bk-mchart" role="img" aria-label="${esc(label)}">${months.map(m => `<div class="bk-mcol" title="${m.key}: ${fmtNum(m[key], 1)}"><i style="height:${m[key] / max * 100}%"></i><small>${m.key.slice(5)}</small></div>`).join('')}</div></section>`;
}

function heatmap(heat) {
  const days = [];
  const end = new Date(); end.setHours(12, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - 364 - start.getDay());
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(dayKey(d));
  const lvl = (m) => !m ? 0 : m < 10 ? 1 : m < 30 ? 2 : m < 60 ? 3 : 4;
  return `<section class="bk-panel"><h3>Bản đồ nhiệt ngày đọc (12 tháng)</h3><div class="bk-heat" role="img" aria-label="Số phút đọc mỗi ngày">${days.map(k => `<i class="l${lvl(heat.get(k))}" title="${k}: ${Math.round(heat.get(k) || 0)} phút"></i>`).join('')}</div>
    <p class="bk-heat-legend muted">Ít <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> Nhiều</p></section>`;
}

async function statsPage(el, { snap, go }) {
  const sessions = await store.allSessions();
  const B = bounds();
  const s = compute(snap.list, sessions, B);
  el.innerHTML = `
    <div class="bk-sec-head"><h2>Thống kê · ${esc(B.label)}</h2>
      <div class="row-actions"><select data-range aria-label="Khoảng thời gian">${[['year', 'Năm nay'], ['lastyear', 'Năm trước'], ['30d', '30 ngày'], ['12m', '12 tháng'], ['all', 'Mọi lúc'], ['custom', 'Tuỳ chọn…']].map(([k, l]) => `<option value="${k}" ${range.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="bk-custom" ${range.kind === 'custom' ? '' : 'hidden'}><input type="date" data-from value="${range.from}" aria-label="Từ ngày"><input type="date" data-to value="${range.to}" aria-label="Đến ngày"></span>
        <button class="btn small" data-img>${icon('b-image')}Ảnh chia sẻ</button><button class="btn small" data-csv>${icon('download')}CSV</button></div></div>
    <div class="bk-kpi-grid">
      ${[['Sách đã đọc', fmtNum(s.booksRead)], ['Trang', fmtNum(s.pages)], ['Giờ đọc', fmtNum(s.hours, 1)], ['Chuỗi hiện tại', s.streak + ' ngày'], ['Chuỗi dài nhất', s.longestStreak + ' ngày'],
        ['Đánh giá TB', s.avgRating ? fmtNum(s.avgRating, 2) + '★' : '—'], ['Trang TB / cuốn', fmtNum(s.avgPages)], ['Tốc độ', s.wpm ? s.wpm + ' từ/phút' : '—'], ['Phiên đọc', fmtNum(s.sessions)], ['Bỏ dở', s.dnf]]
        .map(([l, v]) => `<div class="bk-kpi"><span>${l}</span><b class="num">${v}</b></div>`).join('')}
    </div>
    ${B.year ? wrapUp(s, B.year) : ''}
    <div class="bk-charts">
      ${monthChart(s.months, 'books', 'Sách mỗi tháng')}${monthChart(s.months, 'pages', 'Trang mỗi tháng')}${monthChart(s.months, 'hours', 'Giờ đọc mỗi tháng')}
      ${bars('Thể loại', s.byGenre)}${bars('Cảm xúc', s.byMood)}${bars('Nhịp đọc', s.byPace)}${bars('Định dạng', s.byFormat)}
      ${bars('Ngôn ngữ', s.byLanguage)}${bars('Tác giả', s.byAuthor)}${bars('Độ dài (trang)', s.byLength)}${bars('Số sao', s.byRating.map(([r, n]) => [r + '★', n]))}
    </div>
    ${heatmap(s.heat)}
    ${!s.booksRead && !s.sessions ? '<p class="muted">Chưa có dữ liệu trong khoảng này. Đánh dấu sách “Đã đọc”, hoặc đọc trong app để tự ghi phiên đọc.</p>' : ''}`;
  hydrateCovers(el, snap.all.byId);
  el.querySelectorAll('[data-id]').forEach(c => c.onclick = () => go('book/' + c.dataset.id));
  const rerender = () => statsPage(el, { snap, go });
  el.querySelector('[data-range]').onchange = (e) => { range.kind = e.target.value; rerender(); };
  el.querySelector('[data-from]').onchange = (e) => { range.from = e.target.value; rerender(); };
  el.querySelector('[data-to]').onchange = (e) => { range.to = e.target.value; rerender(); };
  el.querySelector('[data-csv]').onclick = () => {
    const rows = [['Mục', 'Giá trị'], ['Khoảng', B.label], ['Sách đã đọc', s.booksRead], ['Trang', s.pages], ['Giờ', s.hours.toFixed(1)], ['Đánh giá TB', s.avgRating.toFixed(2)], ['Chuỗi dài nhất', s.longestStreak],
      ...s.months.map(m => ['Tháng ' + m.key, `${m.books} sách / ${m.pages} trang / ${m.hours.toFixed(1)} giờ`]), ...s.finished.map(f => ['Đã đọc', `${new Date(f.end).toISOString().slice(0, 10)} ${f.b.title}`])];
    download(`thong-ke-sach-${B.label.replace(/\W+/g, '-')}.csv`, rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'text/csv');
  };
  el.querySelector('[data-img]').onclick = () => shareImage(s, B);
}

function wrapUp(s, year) {
  if (!s.booksRead) return '';
  return `<section class="bk-panel bk-wrap"><h3>${icon('b-sparkle')}Tổng kết ${year}</h3>
    <p>Bạn đã đọc <b>${s.booksRead}</b> cuốn, <b>${fmtNum(s.pages)}</b> trang${s.hours ? `, trong <b>${fmtHours(s.hours)}</b>` : ''}.
      ${s.byGenre[0] ? `Thể loại đọc nhiều nhất: <b>${esc(s.byGenre[0][0])}</b>.` : ''} ${s.byAuthor[0] ? `Tác giả đọc nhiều nhất: <b>${esc(s.byAuthor[0][0])}</b>.` : ''}
      ${s.longest ? `Cuốn dài nhất: <b>${esc(s.longest.title)}</b> (${s.longest.pages} trang).` : ''}</p>
    ${s.topRated.length ? `<div class="bk-rail">${s.topRated.map(b => `<span class="bk-wrap-b" data-id="${b.id}">${coverHtml(b, 'sm')}<small>${b.rating}★</small></span>`).join('')}</div>` : ''}</section>`;
}

// A shareable PNG card drawn on a canvas (Web Share on phones, download elsewhere).
async function shareImage(s, B) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1080, 1350); grad.addColorStop(0, '#2b2140'); grad.addColorStop(1, '#b97a10');
  g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = '#fff'; g.font = '600 56px "Be Vietnam Pro", system-ui, sans-serif'; g.fillText('Năm đọc sách của tôi', 80, 150);
  g.font = '400 40px "Be Vietnam Pro", system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(B.label, 80, 215);
  const tiles = [['sách', fmtNum(s.booksRead)], ['trang', fmtNum(s.pages)], ['giờ đọc', fmtNum(s.hours, 1)], ['ngày liên tiếp', String(s.longestStreak)]];
  tiles.forEach(([l, v], i) => {
    const x = 80 + (i % 2) * 480, y = 330 + Math.floor(i / 2) * 300;
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, 440, 250);
    g.fillStyle = '#fff'; g.font = '700 110px "Be Vietnam Pro", system-ui, sans-serif'; g.fillText(v, x + 36, y + 140);
    g.font = '400 38px "Be Vietnam Pro", system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(l, x + 40, y + 205);
  });
  g.fillStyle = '#fff'; g.font = '400 38px "Be Vietnam Pro", system-ui, sans-serif';
  if (s.byGenre[0]) g.fillText('Thể loại yêu thích: ' + s.byGenre[0][0], 80, 1000);
  if (s.avgRating) g.fillText('Đánh giá trung bình: ' + s.avgRating.toFixed(2) + ' ★', 80, 1070);
  if (s.topRated[0]) g.fillText('Cuốn hay nhất: ' + s.topRated[0].title.slice(0, 34), 80, 1140);
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '400 30px "Be Vietnam Pro", system-ui, sans-serif'; g.fillText('My Hub · Sách', 80, 1270);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], `nam-doc-sach-${B.label}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Năm đọc sách' }); return; } catch { /* cancelled */ } }
  download(file.name, blob);
}

// ── Goals, challenges, badges ────────────────────────────────────
async function goalsPage(el, { snap }) {
  const [goals, sessions] = await Promise.all([store.goals.list(), store.allSessions()]);
  const unit = { books: 'cuốn', pages: 'trang', hours: 'giờ' };
  const rows = goals.sort((a, b) => b.year - a.year || (a.month || 0) - (b.month || 0)).map(g => {
    let m = null; try { m = g.query ? compile(g.query, { shelves: snap.all.shelves }) : null; } catch { /* bad query */ }
    return { g, p: goalProgress(g, snap.all.list, sessions, m) };
  });
  const bs = badges(snap.all.list, sessions);
  el.innerHTML = `<div class="bk-sec-head"><h2>Mục tiêu & thử thách</h2><button class="btn primary" data-new>${icon('plus')}Mục tiêu mới</button></div>
    <div class="bk-goals">${rows.map(({ g, p }) => `<article class="bk-panel bk-goal-card">
      <div class="bk-ring sm" style="--p:${p.percent}"><b class="num">${Math.round(p.percent)}%</b></div>
      <div class="bk-goal-main"><b>${esc(g.label || `${g.month ? 'Tháng ' + g.month + '/' : 'Năm '}${g.year}: ${g.target} ${unit[g.kind]}`)}</b>
        <div class="bk-pbar"><i style="width:${p.percent}%"></i></div><small class="muted">${fmtNum(p.done, 1)} / ${g.target} ${unit[g.kind]}${g.query ? ` · <code>${esc(g.query)}</code>` : ''}${Date.now() < p.to ? ` · ${p.ahead >= 0 ? 'đúng / vượt kế hoạch' : `chậm ${fmtNum(-p.ahead, 1)} ${unit[g.kind]}`}` : p.done >= g.target ? ' · hoàn thành 🎉' : ' · đã kết thúc'}</small></div>
      <button class="icon-btn sm" data-del="${g.id}" aria-label="Xoá">${icon('x')}</button></article>`).join('') || '<p class="muted">Chưa có mục tiêu. Ví dụ: 24 cuốn trong năm, 30 giờ trong tháng, hoặc thử thách “5 cuốn của tác giả Việt” (điều kiện <code>lang:vi</code>).</p>'}</div>
    <h2 class="section-title">${icon('b-trophy')}Huy hiệu <span class="num muted">${bs.filter(b => b.got).length}/${bs.length}</span></h2>
    <div class="bk-badges">${bs.map(b => `<div class="bk-badge${b.got ? ' got' : ''}" title="${esc(b.desc)}">${icon(b.got ? 'b-trophy' : 'b-target')}<b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')}</div>`;
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => store.goals.remove(b.dataset.del));
  el.querySelector('[data-new]').onclick = async () => {
    const y = new Date().getFullYear();
    const body = h(`<form class="stack">
      <div class="bk-form-2"><label>Năm<input type="number" name="year" value="${y}"></label><label>Tháng (để trống = cả năm)<input type="number" name="month" min="1" max="12"></label></div>
      <div class="bk-form-2"><label>Loại<select name="kind"><option value="books">Số cuốn</option><option value="pages">Số trang</option><option value="hours">Số giờ</option></select></label><label>Mục tiêu<input type="number" name="target" value="24" min="1"></label></div>
      <label>Tên (tuỳ chọn)<input name="label" placeholder="Ví dụ: Đọc 5 cuốn kinh điển"></label>
      <label>Chỉ tính sách khớp điều kiện (thử thách, tuỳ chọn)<input name="query" placeholder="tag:kinh-điển  hoặc  lang:vi"></label></form>`);
    const r = await modal({ title: 'Mục tiêu mới', body, actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', kind: 'primary', value: (f) => ({
      year: +f.querySelector('[name=year]').value, month: +f.querySelector('[name=month]').value || null, kind: f.querySelector('[name=kind]').value,
      target: +f.querySelector('[name=target]').value, label: f.querySelector('[name=label]').value.trim(), query: f.querySelector('[name=query]').value.trim() }) }] });
    if (!r?.target) return;
    await store.goals.put(r);
    toast('Đã lưu mục tiêu');
  };
}
