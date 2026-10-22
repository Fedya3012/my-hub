// Trang podcast (#podcasts/show/<id>) and preview of a search result (#podcasts/preview/<feedUrl>): the feed is
// read and cached (not subscribed) so its episodes can be played right away.
import { icon } from '../../../core/icons.js';
import { esc, toast, confirmBox } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import * as store from '../lib/store.js';
import { SOURCES } from '../lib/online.js';
import { seen, sourceNames } from '../lib/online.js';
import { normFeed } from '../lib/net.js';
import { get } from '../lib/prefs.js';
import { art, episodeList, bindEpisodes, notesHtml, stripHtml, pick } from './common.js';

const filters = new Map();   // show id → { f, q, sort } for this session

export async function render(el, { head, arg, go, ctx, rerender }) {
  let id = arg;
  if (head === 'preview') {
    const feedUrl = normFeed(arg);
    id = store.showIdOf(feedUrl);
    if (!(await store.show(id))) {
      el.innerHTML = `<p class="muted pc-loading">${icon('podcast')} Đang đọc RSS…</p>`;
      try {
        const meta = seen.get(arg) || { feedUrl, sources: ['rss'] };
        await tasks.run({ label: 'Đọc podcast', detail: meta.title || feedUrl, cancellable: true }, async (t) => store.saveFeed(await store.loadFeed(feedUrl, { itunesId: meta.itunesId, signal: t.signal }), meta));
      } catch (e) {
        if (e?.name !== 'AbortError') el.innerHTML = `<p class="pc-empty">Không đọc được podcast này: ${esc(e.message)}</p>`;
        return;
      }
    }
  }
  const s = await store.show(id);
  if (!s) { el.innerHTML = '<p class="pc-empty">Không tìm thấy podcast.</p>'; return; }
  const all = (await store.episodesOf(id)).map(e => ({ ...e, show: s }));
  const st = filters.get(id) || { f: '', q: '', sort: 'new' };
  const prog = await store.progressOf(all.map(e => e.id));
  let eps = all;
  if (st.f === 'unplayed') eps = eps.filter(e => !e.played && prog.get(e.id)?.state !== 'finished');
  if (st.f === 'progress') eps = eps.filter(e => !e.played && prog.get(e.id)?.position > 5 && prog.get(e.id)?.state !== 'finished');
  if (st.f === 'starred') eps = eps.filter(e => e.starred);
  if (st.q) { const q = st.q.toLowerCase(); eps = eps.filter(e => (e.title + ' ' + stripHtml(e.description).slice(0, 400) + ' ' + (e.persons || []).map(p => p.name).join(' ')).toLowerCase().includes(q)); }
  if (st.sort === 'old') eps = [...eps].reverse();
  const local = s.feedUrl.startsWith('local:');
  const sets = s.settings || {};
  const desc = stripHtml(s.description);
  const hosts = (s.persons || []).filter(p => p.role === 'host' && p.name !== s.author);
  el.innerHTML = `
    <header class="pc-showhead" style="--bgimg:url('${esc(s.image || '')}')">
      ${art(s.image, s.title, 'xl')}
      <div>
        <p class="eyebrow">${esc((s.categories || []).slice(0, 3).join(' · ') || 'Podcast')}</p>
        <h1>${esc(s.title)}</h1>
        <p class="muted">${esc(s.author)}${hosts.length ? ' · Dẫn: ' + hosts.map(h => esc(h.name)).join(', ') : ''}</p>
        <p class="muted">${all.length} tập${s.rating ? ` · ★ ${(+s.rating).toFixed(1)}` : ''}${s.complete ? ' · Đã hoàn thành' : ''}${s.partial ? ' · <span title="RSS bị chặn, danh sách tập lấy từ Apple">từ Apple</span>' : ''}</p>
        <div class="row-actions">
          ${local ? '' : s.subscribed ? `<button class="btn" data-a="unsub">${icon('pc-check')}Đã đăng ký</button>` : `<button class="btn primary" data-a="sub">${icon('pc-plus')}Đăng ký</button>`}
          ${all[0] ? `<button class="btn" data-play="${esc((all.find(e => !e.played) || all[0]).id)}">${icon('pc-play')}Phát tập ${all.find(e => !e.played) ? 'mới nhất chưa nghe' : 'mới nhất'}</button>` : ''}
          ${local ? '' : `<button class="icon-btn" data-a="refresh" aria-label="Làm mới">${icon('refresh')}</button>`}
          <button class="icon-btn" data-a="settings" aria-label="Cài đặt riêng">${icon('settings')}</button>
          ${s.link ? `<a class="icon-btn" href="${esc(s.link)}" target="_blank" rel="noopener" aria-label="Trang web">${icon('link')}</a>` : ''}
        </div>
      </div>
    </header>
    ${desc ? `<details class="pc-desc"><summary>${esc(desc.slice(0, 220))}${desc.length > 220 ? '… <b>Xem thêm</b>' : ''}</summary><div>${notesHtml(s.description)}</div></details>` : ''}
    <p class="pc-source big">${icon('pc-wifi')}<span>Nguồn: <b>${esc(sourceNames(s.sources) || (local ? 'Tệp trên máy này' : 'Link RSS trực tiếp'))}</b>${local ? '' : ` · RSS: <a href="${esc(s.feedUrl)}" target="_blank" rel="noopener">${esc(hostOf(s.feedUrl))}</a>`}${s.itunesId ? ` · Apple ID ${esc(s.itunesId)}` : ''}${s.piId ? ` · Podcast Index ID ${esc(s.piId)}` : ''}</span></p>
    ${s.funding?.length ? `<p class="pc-fund">${icon('pc-star')} Ủng hộ: ${s.funding.map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.label || 'Ủng hộ')}</a>`).join(' · ')}</p>` : ''}
    ${Object.keys(sets).length ? `<p class="muted pc-sets">${[sets.speed && `Tốc độ ${sets.speed}×`, sets.skipIntro && `Bỏ ${sets.skipIntro}s đầu`, sets.skipOutro && `Bỏ ${sets.skipOutro}s cuối`, sets.autoDownload != null && (sets.autoDownload ? 'Tự tải' : 'Không tự tải')].filter(Boolean).join(' · ')}</p>` : ''}
    ${sourcesBox(s)}
    <div class="pc-toolbar">
      <div class="pc-seg sm">${[['', 'Tất cả'], ['unplayed', 'Chưa nghe'], ['progress', 'Đang nghe'], ['starred', 'Có sao']].map(([k, l]) => `<button data-f="${k}" aria-current="${st.f === k}">${l}</button>`).join('')}</div>
      <label class="pc-find">${icon('search')}<input type="search" placeholder="Tìm trong ${all.length} tập" value="${esc(st.q)}" data-q></label>
      <button class="icon-btn" data-a="sort" aria-label="${st.sort === 'new' ? 'Mới nhất trước' : 'Cũ nhất trước'}" title="${st.sort === 'new' ? 'Mới nhất trước' : 'Cũ nhất trước'}">${icon('pc-sort')}</button>
      <button class="icon-btn" data-a="allplayed" aria-label="Đánh dấu tất cả đã nghe">${icon('pc-check')}</button>
    </div>
    <div data-eps>${await episodeList(eps.slice(0, 200), { showName: false, empty: 'Không có tập nào khớp.' })}</div>
    ${eps.length > 200 ? `<p class="muted">Hiện 200 / ${eps.length} tập. Dùng ô tìm để lọc.</p>` : ''}`;
  const off = bindEpisodes(el, { ctx, rerender });
  el.querySelector('[data-srccheck]')?.addEventListener('click', () => compareSources(el, s, rerender));
  el.querySelectorAll('[data-use]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await tasks.run({ label: 'Đổi nguồn podcast', detail: s.title, cancellable: true }, () => store.switchSource(id, b.dataset.use)); toast('Đã chuyển sang nguồn này'); }
    catch (e) { if (e?.name !== 'AbortError') toast('Không đổi được nguồn: ' + e.message, 'error'); }
    rerender();
  });
  const save = (p) => { filters.set(id, { ...st, ...p }); rerender(); };
  el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => save({ f: b.dataset.f }));
  let t; el.querySelector('[data-q]').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => save({ q: e.target.value }), 300); });
  el.querySelector('.pc-desc')?.addEventListener('click', (e) => { const b = e.target.closest('[data-ts]'); if (b) e.preventDefault(); });
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'sub') { await store.subscribeCached(id); toast('Đã đăng ký'); }
    if (a === 'unsub' && await confirmBox('Huỷ đăng ký?', `Bỏ ${s.title} khỏi danh sách đăng ký. Tiến độ nghe vẫn được giữ.`, 'Huỷ đăng ký')) await store.unsubscribe(id);
    if (a === 'refresh') { try { const r = await tasks.run({ label: 'Làm mới podcast', detail: s.title, cancellable: true }, (t) => store.refresh(id, { signal: t.signal })); toast(r.fresh.length ? `${r.fresh.length} tập mới` : 'Không có tập mới'); } catch (e) { if (e?.name !== 'AbortError') toast(e.message, 'error'); } }
    if (a === 'sort') return save({ sort: st.sort === 'new' ? 'old' : 'new' });
    if (a === 'allplayed' && await confirmBox('Đánh dấu tất cả đã nghe?', `${eps.filter(e => !e.played).length} tập sẽ được đánh dấu đã nghe.`, 'Đánh dấu', 'primary')) { for (const e of eps) if (!e.played) await store.setPlayed(e.id, true); }
    if (a === 'settings') await showSettings(s);
    rerender();
  });
  void go;
  return off;
}

async function showSettings(s) {
  const c = s.settings || {};
  const r = await pick(`Cài đặt riêng: ${s.title}`, `<form class="pc-form" onsubmit="return false">
    <label>Tốc độ riêng <select name="speed"><option value="">Theo mặc định (${get('speed')}×)</option>${[0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2, 2.5, 3].map(r => `<option ${c.speed === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label>Bỏ qua đoạn mở đầu <span><input name="skipIntro" type="number" min="0" max="600" step="5" value="${c.skipIntro || 0}"> giây</span></label>
    <label>Bỏ qua đoạn kết <span><input name="skipOutro" type="number" min="0" max="600" step="5" value="${c.skipOutro || 0}"> giây</span></label>
    <label>Tự tải tập mới <select name="autoDownload"><option value="">Theo cài đặt chung</option><option value="1" ${c.autoDownload === 1 ? 'selected' : ''}>Bật</option><option value="0" ${c.autoDownload === 0 ? 'selected' : ''}>Tắt</option></select></label>
    <label>Giữ tối đa <span><input name="keep" type="number" min="1" max="100" value="${c.keep || get('keepDownloads')}"> tập đã tải</span></label>
    <button type="button" class="btn primary" data-v="save">Lưu</button></form>`, { collect: (root) => Object.fromEntries(new FormData(root.querySelector('form'))) });
  if (r?.v !== 'save') return;
  const d = r.data;
  await store.setShowSettings(s.itemId, {
    speed: d.speed ? +d.speed : null, skipIntro: +d.skipIntro || 0, skipOutro: +d.skipOutro || 0,
    autoDownload: d.autoDownload === '' ? null : +d.autoDownload, keep: +d.keep || null,
  });
  toast('Đã lưu cài đặt riêng');
}

const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };

// Where the podcast is listed: the source it is followed from, and the others (when several directories list it).
function sourcesBox(s) {
  const alts = s.alternates || [];
  if (!alts.length) return '';
  const label = (k) => SOURCES[k] || 'Link RSS';
  const rows = [{ url: s.feedUrl, name: label(s.sources?.[0]), current: true }, ...alts.map(a => ({ url: a.feedUrl, name: label(a.source), current: false }))];
  return `<section class="pc-sec pc-srcs"><header><h2>Nguồn của podcast này</h2><small class="muted">${rows.length} nguồn · đang theo: ${esc(rows[0].name)}</small>
    <button class="btn sm" data-srccheck>${icon('pc-chart')}So sánh chất lượng</button></header>
    <ul class="pc-srclist" data-srclist>${rows.map(r => `<li><span><b>${esc(r.name)}</b><small class="muted">${esc(hostOf(r.url))}</small></span>${r.current ? '<span class="pc-badge-txt">Đang theo</span>' : `<button class="btn sm" data-use="${esc(r.url)}">Theo nguồn này</button>`}</li>`).join('')}</ul></section>`;
}

async function compareSources(el, s, rerender) {
  const box = el.querySelector('[data-srclist]');
  const btn = el.querySelector('[data-srccheck]');
  btn.disabled = true; btn.textContent = 'Đang đo…';
  const urls = [{ url: s.feedUrl, name: SOURCES[s.sources?.[0]] || 'Link RSS' }, ...(s.alternates || []).map(a => ({ url: a.feedUrl, name: SOURCES[a.source] || 'Link RSS' }))];
  const res = await Promise.allSettled(urls.map(u => store.sourceQuality(u.url, s.itunesId, { fresh: true })));
  const ok = res.map((r, i) => r.status === 'fulfilled' ? { ...r.value, name: urls[i].name } : { url: urls[i].url, name: urls[i].name, error: r.reason?.message || 'lỗi' });
  const best = Math.max(...ok.filter(x => !x.error).map(x => x.score));
  const fmtNew = (t) => t ? new Date(t).toLocaleDateString('vi-VN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  box.outerHTML = `<div class="pc-cmp"><table><thead><tr><th>Nguồn</th><th>Tập</th><th>Mới nhất</th><th>Bitrate</th><th>Định dạng</th><th>Chương / chép lời</th><th>Điểm</th><th></th></tr></thead><tbody>
    ${ok.map(x => x.error ? `<tr><td><b>${esc(x.name)}</b></td><td colspan="6" class="muted">Không đọc được: ${esc(x.error)}</td><td></td></tr>` : `<tr class="${x.score === best ? 'best' : ''}">
      <td><b>${esc(x.name)}</b>${x.score === best ? ' <span class="pc-badge-txt">Tốt nhất</span>' : ''}<small class="muted">${esc(hostOf(x.feedUrl))}</small></td>
      <td>${x.episodes}</td><td>${fmtNew(x.newest)}</td><td>${x.kbps ? x.kbps + ' kbps' : '—'}</td><td>${esc(x.formats.join(', ') || '—')}</td>
      <td>${x.chapters || 0} / ${x.transcripts || 0}</td><td><b>${x.score}</b></td>
      <td>${x.feedUrl === s.feedUrl ? '<small class="muted">đang theo</small>' : `<button class="btn sm" data-use="${esc(x.feedUrl)}">Theo nguồn này</button>`}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted"><small>Điểm tính từ số tập, độ mới (30 ngày), bitrate thật (kích thước tệp / thời lượng, tối đa 192 kbps), có chương và bản chép lời. Nguồn chỉ đọc được từ Apple bị trừ điểm vì không đầy đủ.</small></p></div>`;
  btn.remove();
  el.querySelectorAll('[data-use]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await tasks.run({ label: 'Đổi nguồn podcast', detail: s.title, cancellable: true }, () => store.switchSource(s.itemId, b.dataset.use)); toast('Đã chuyển sang nguồn này'); }
    catch (e) { if (e?.name !== 'AbortError') toast('Không đổi được nguồn: ' + e.message, 'error'); }
    rerender();
  });
}
