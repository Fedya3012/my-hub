// Thống kê nghe nhạc (#music/stats): listening time per day / week / month, top songs, artists,
// albums and genres, streaks, time-of-day heatmap, format / quality, library growth, skips.
// Source: db.plays (one row per listen: ms heard, completed; skip rows { skip: 1 } come from
// store.attachListenLog). Charts are inline SVG coloured with theme variables (no libraries).
import '../lib/libicons.js';
import { db } from '../../../core/db.js';
import { icon } from '../../../core/icons.js';
import { esc } from '../../../core/ui.js';
import * as store from '../lib/store.js';
import { artHtml, hydrate } from '../lib/art.js';
import { player } from '../lib/player.js';

const RANGES = { 7: '7 ngày', 30: '30 ngày', 90: '3 tháng', 365: '12 tháng', 0: 'Tất cả', custom: 'Tuỳ chọn' };
const DAY = 864e5;
let state = { range: '30', from: '', to: '', top: 'plays', group: 'auto' };
try { state = { ...state, ...JSON.parse(sessionStorage.getItem('music.stats') || '{}') }; } catch { /* ignore */ }
const save = () => { try { sessionStorage.setItem('music.stats', JSON.stringify(state)); } catch { /* ignore */ } };

const hm = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60 ? (m % 60) + ' phút' : ''}`.trim(); };
const nf = (n) => n.toLocaleString('vi-VN');
const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export async function statsPage(c, L) {
  const all = await db.plays.toArray();
  const nowT = Date.now();
  let from = 0, to = nowT;
  if (state.range === 'custom') { from = state.from ? new Date(state.from).getTime() : 0; to = state.to ? new Date(state.to).getTime() + DAY - 1 : nowT; }
  else if (+state.range) from = startOfDay(nowT - (+state.range - 1) * DAY);
  const rows = all.filter(p => p.at >= from && p.at <= to);
  if (!from && rows.length) from = startOfDay(rows.reduce((m, r) => Math.min(m, r.at), Infinity));   // no spread: any number of plays
  const listens = rows.filter(r => !r.skip), skips = rows.filter(r => r.skip);
  const totalMs = rows.reduce((s, r) => s + (r.ms || 0), 0);
  const trackOf = (r) => L.tracks.get(r.itemId) || (r.title ? { id: r.itemId, title: r.title, artist: r.artist || '', virtual: true } : null);

  // ── Series ──
  const span = Math.max(1, Math.round((to - from) / DAY));
  const group = state.group !== 'auto' ? state.group : span <= 45 ? 'day' : span <= 400 ? 'week' : 'month';
  const bucketOf = (t) => {
    const d = new Date(t);
    if (group === 'day') return dayKey(t);
    if (group === 'week') { const m = new Date(startOfDay(t)); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return dayKey(m.getTime()); }
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };
  const buckets = new Map();
  for (let t = from; t <= to; t += group === 'month' ? 28 * DAY : group === 'week' ? 7 * DAY : DAY) buckets.set(bucketOf(t), 0);
  buckets.set(bucketOf(to), buckets.get(bucketOf(to)) || 0);
  for (const r of rows) { const k = bucketOf(r.at); buckets.set(k, (buckets.get(k) || 0) + (r.ms || 0)); }
  const series = [...buckets].sort((a, b) => a[0] < b[0] ? -1 : 1);

  // ── Tops ──
  const by = state.top;
  const agg = (keyFn, nameFn) => {
    const m = new Map();
    for (const r of listens) for (const k of keyFn(r)) { if (k == null) continue; const x = m.get(k) || { k, n: 0, ms: 0 }; x.n++; x.ms += r.ms || 0; m.set(k, x); }
    return [...m.values()].sort((a, b) => by === 'time' ? b.ms - a.ms : b.n - a.n).slice(0, 10).map(x => ({ ...x, ...nameFn(x.k) }));
  };
  const topSongs = agg(r => [r.itemId], (id) => { const t = trackOf({ itemId: id, ...listens.find(r => r.itemId === id) }); return { name: t?.title || 'Bài đã xoá', sub: t?.artist || '', cover: t ? L.coverOf(t) : null, href: t && !t.virtual ? `#music/album/${t.albumId}` : null, track: t }; });
  const topArtists = agg(r => L.tracks.get(r.itemId)?.artistIds || [], (id) => { const a = L.artists.get(id); return { name: a?.name || '—', sub: `${a?.albums?.length || 0} album`, cover: a?.cover, href: `#music/artist/${id}`, round: true }; });
  const topAlbums = agg(r => [L.tracks.get(r.itemId)?.albumId], (id) => { const a = L.albums.get(id); return { name: a?.title || '—', sub: a?.artist || '', cover: a?.cover, href: `#music/album/${id}` }; });
  const topGenres = agg(r => L.tracks.get(r.itemId)?.genres?.length ? L.tracks.get(r.itemId).genres : [], (g) => { const x = L.genres.get(g); return { name: g, sub: `${x?.count || 0} bài`, cover: x?.cover, href: `#music/genre/${encodeURIComponent(g)}` }; });

  // ── Streaks (all time) ──
  const days = new Set(all.filter(r => !r.skip).map(r => dayKey(r.at)));
  let longest = 0, run = 0, prev = null;
  for (const d of [...days].sort()) { const t = new Date(d).getTime(); run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = t; }
  let current = 0;
  let st = startOfDay(nowT);
  if (!days.has(dayKey(st))) st -= DAY; // today not listened yet: the streak may still run until yesterday
  while (days.has(dayKey(st))) { current++; st = startOfDay(st - DAY / 2); }

  // ── Heatmap weekday × hour ──
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const r of rows) { const d = new Date(r.at); heat[(d.getDay() + 6) % 7][d.getHours()] += r.ms || 0; }

  // ── Formats (time listened) + library quality ──
  const fmt = new Map();
  for (const r of rows) { const t = L.tracks.get(r.itemId); const k = t?.tech?.codecLabel?.replace(/DSD\d+/, 'DSD') || 'Khác'; fmt.set(k, (fmt.get(k) || 0) + (r.ms || 0)); }
  const tracks = [...L.tracks.values()];
  const q = { hires: tracks.filter(t => t.hiResNow).length, lossless: tracks.filter(t => t.tech?.lossless && !t.hiResNow).length, lossy: tracks.filter(t => t.tech && !t.tech.lossless).length, none: tracks.filter(t => !t.tech).length };

  // ── Library growth (cumulative by month) ──
  const gm = new Map();
  for (const t of tracks) { const d = new Date(t.addedAt || 0); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); gm.set(k, (gm.get(k) || 0) + 1); }
  let cum = 0;
  const growth = [...gm].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, n]) => [k, cum += n]);

  // ── Skips ──
  const sk = new Map();
  for (const r of skips) sk.set(r.itemId, (sk.get(r.itemId) || 0) + 1);
  const skipList = [...sk].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => { const t = trackOf({ itemId: id, ...skips.find(r => r.itemId === id) }); return { name: t?.title || 'Bài đã xoá', sub: `${t?.artist || ''} · bỏ qua ${n} lần`, cover: t ? L.coverOf(t) : null, n }; });

  const tile = (v, l) => `<div class="lst-tile"><b class="num">${v}</b><span>${l}</span></div>`;
  const topList = (list, empty) => list.length ? `<ol class="lst-top">${list.map((x, i) => `<li><span class="num lst-rank">${i + 1}</span>${x.href ? `<a href="${x.href}">` : '<span>'}${artHtml(x.cover, x.name, { cls: 'xs' + (x.round ? ' round' : '') })}<span class="lst-tn"><b>${esc(x.name)}</b><small>${esc(x.sub || '')}</small></span>${x.href ? '</a>' : '</span>'}<span class="num lst-v">${by === 'time' ? hm(x.ms) : x.n + ' lượt'}</span></li>`).join('')}</ol>` : `<p class="muted">${empty}</p>`;
  c.innerHTML = `<div class="lst">
    <div class="lst-bar">
      <div class="seg small" role="group" aria-label="Khoảng thời gian">${Object.entries(RANGES).map(([k, v]) => `<button data-range="${k}" aria-pressed="${state.range === k}">${v}</button>`).join('')}</div>
      ${state.range === 'custom' ? `<label class="lst-date">Từ <input type="date" data-from value="${esc(state.from)}"></label><label class="lst-date">đến <input type="date" data-to value="${esc(state.to)}"></label>` : ''}
    </div>
    <section class="lst-tiles">
      ${tile(hm(totalMs), 'thời gian nghe')}${tile(nf(listens.length), 'lượt nghe')}${tile(nf(new Set(listens.map(r => r.itemId)).size), 'bài khác nhau')}
      ${tile(nf(skips.length), `lần bỏ qua${rows.length ? ` (${Math.round(skips.length / rows.length * 100)}%)` : ''}`)}${tile(current + ' ngày', 'chuỗi hiện tại')}${tile(longest + ' ngày', 'chuỗi dài nhất')}
    </section>
    <section class="lst-card lst-wide"><header><h3>${icon('chart')}Thời gian nghe</h3>
      <div class="seg small" role="group" aria-label="Gộp theo">${Object.entries({ auto: 'Tự động', day: 'Ngày', week: 'Tuần', month: 'Tháng' }).map(([k, v]) => `<button data-group="${k}" aria-pressed="${state.group === k}">${v}</button>`).join('')}</div></header>
      ${barChart(series, group)}</section>
    <div class="lst-cols">
      <section class="lst-card"><header><h3>${icon('music')}Bài nghe nhiều</h3><div class="seg small"><button data-top="plays" aria-pressed="${by === 'plays'}">Lượt</button><button data-top="time" aria-pressed="${by === 'time'}">Thời gian</button></div></header>${topList(topSongs, 'Chưa nghe bài nào trong khoảng này.')}</section>
      <section class="lst-card"><header><h3>${icon('user')}Nghệ sĩ</h3></header>${topList(topArtists, 'Chưa có dữ liệu.')}</section>
      <section class="lst-card"><header><h3>${icon('album')}Album</h3></header>${topList(topAlbums, 'Chưa có dữ liệu.')}</section>
      <section class="lst-card"><header><h3>${icon('tag')}Thể loại</h3></header>${topList(topGenres, 'Bài đã nghe chưa có thể loại.')}</section>
    </div>
    <section class="lst-card lst-wide"><header><h3>${icon('clock')}Giờ nghe trong tuần</h3></header>${heatmap(heat)}</section>
    <div class="lst-cols">
      <section class="lst-card"><header><h3>${icon('wave')}Định dạng đã nghe</h3></header>${shareBars([...fmt].sort((a, b) => b[1] - a[1]), hm)}</section>
      <section class="lst-card"><header><h3>${icon('hires')}Chất lượng thư viện</h3></header>${shareBars([['Hi-Res', q.hires], ['Lossless', q.lossless], ['Lossy', q.lossy], ['Chưa có tệp', q.none]].filter(x => x[1]), (n) => n + ' bài')}</section>
      <section class="lst-card"><header><h3>${icon('plus')}Thư viện tăng dần</h3></header>${lineChart(growth)}</section>
      <section class="lst-card"><header><h3>${icon('next')}Hay bỏ qua</h3></header>${topList(skipList.map(x => ({ ...x, href: null })), 'Chưa bỏ qua bài nào.').replace(/<span class="num lst-v">[^<]*<\/span>/g, '')}</section>
    </div>
    <p class="hint">Một lượt nghe được tính khi nghe ≥ 50% bài hoặc ≥ 4 phút; dừng sớm hơn được tính là bỏ qua. Lịch sử nghe đồng bộ giữa các máy.</p></div>`;
  hydrate(c);
  const re = () => { save(); statsPage(c, L); };
  c.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { state.range = b.dataset.range; re(); });
  c.querySelectorAll('[data-group]').forEach(b => b.onclick = () => { state.group = b.dataset.group; re(); });
  c.querySelectorAll('[data-top]').forEach(b => b.onclick = () => { state.top = b.dataset.top; re(); });
  c.querySelector('[data-from]')?.addEventListener('change', (e) => { state.from = e.target.value; re(); });
  c.querySelector('[data-to]')?.addEventListener('change', (e) => { state.to = e.target.value; re(); });
  c.querySelectorAll('.lst-top li').forEach((li, i) => { li.ondblclick = () => { const t = topSongs[i]?.track; if (t) player.play([t]); }; });
}

// ── Charts (SVG, theme colours via currentColor / CSS variables) ──
function barChart(series, group) {
  if (!series.length) return '<p class="muted">Chưa có dữ liệu.</p>';
  const W = 720, H = 200, P = 28, max = Math.max(1, ...series.map(s => s[1]));
  const bw = (W - P) / series.length;
  const label = (k) => group === 'month' ? k.slice(5) + '/' + k.slice(2, 4) : k.slice(8) + '/' + k.slice(5, 7);
  const every = Math.ceil(series.length / 12);
  const unitMin = max >= 3600e3 * 2;
  const fmtY = (ms) => unitMin ? Math.round(ms / 3600e3) + 'h' : Math.round(ms / 60000) + "'";
  return `<svg class="lst-svg" viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="Biểu đồ thời gian nghe">
    ${[0.5, 1].map(f => `<line x1="${P}" x2="${W}" y1="${H - H * f + 4}" y2="${H - H * f + 4}" class="lst-grid"/><text x="0" y="${H - H * f + 8}" class="lst-ax">${fmtY(max * f)}</text>`).join('')}
    ${series.map(([k, v], i) => { const h = v / max * (H - 8); return `<rect class="lst-barr" x="${P + i * bw + bw * 0.12}" y="${H + 4 - h}" width="${Math.max(1, bw * 0.76)}" height="${Math.max(v ? 2 : 0, h)}" rx="2"><title>${k}: ${hm(v)}</title></rect>${i % every === 0 ? `<text x="${P + i * bw + bw / 2}" y="${H + 20}" class="lst-ax" text-anchor="middle">${label(k)}</text>` : ''}`; }).join('')}
  </svg>`;
}
function heatmap(m) {
  const max = Math.max(1, ...m.flat());
  const D = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const cw = 26, ch = 20, X = 28;
  return `<div class="lst-scroll"><svg class="lst-svg lst-heat" viewBox="0 0 ${X + 24 * cw} ${7 * ch + 20}" role="img" aria-label="Biểu đồ nhiệt giờ nghe">
    ${m.map((row, d) => `<text x="0" y="${d * ch + 14}" class="lst-ax">${D[d]}</text>${row.map((v, h) => `<rect x="${X + h * cw}" y="${d * ch}" width="${cw - 3}" height="${ch - 3}" rx="3" class="lst-cell" style="--a:${v ? (0.15 + 0.85 * v / max).toFixed(2) : 0}"><title>${D[d]} ${h}h: ${hm(v)}</title></rect>`).join('')}`).join('')}
    ${[0, 3, 6, 9, 12, 15, 18, 21].map(h => `<text x="${X + h * cw + cw / 2}" y="${7 * ch + 14}" class="lst-ax" text-anchor="middle">${h}h</text>`).join('')}
  </svg></div>`;
}
function shareBars(list, fmt) {
  const total = list.reduce((s, x) => s + x[1], 0);
  if (!total) return '<p class="muted">Chưa có dữ liệu.</p>';
  return `<ul class="lst-share">${list.slice(0, 8).map(([k, v], i) => `<li><span>${esc(k)}</span><span class="lst-track"><i style="width:${(v / total * 100).toFixed(1)}%;--i:${i}"></i></span><span class="num">${Math.round(v / total * 100)}% · ${fmt(v)}</span></li>`).join('')}</ul>`;
}
function lineChart(pts) {
  if (pts.length < 1) return '<p class="muted">Chưa có dữ liệu.</p>';
  if (pts.length === 1) pts = [[pts[0][0], 0], pts[0]];
  const W = 340, H = 140, max = Math.max(1, ...pts.map(p => p[1]));
  const xy = pts.map((p, i) => [8 + i / (pts.length - 1) * (W - 16), H - 6 - p[1] / max * (H - 24)]);
  const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg class="lst-svg" viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="Số bài trong thư viện theo thời gian">
    <path d="${d} L${xy.at(-1)[0]} ${H - 6} L${xy[0][0]} ${H - 6}Z" class="lst-area"/><path d="${d}" class="lst-line"/>
    <text x="8" y="${H + 12}" class="lst-ax">${pts[0][0]}</text><text x="${W - 8}" y="${H + 12}" class="lst-ax" text-anchor="end">${pts.at(-1)[0]} · ${pts.at(-1)[1]} bài</text></svg>`;
}
