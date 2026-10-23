// Shared pieces of the Podcast pages: artwork, episode rows and cards, the episode menu, show cards, formatting.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import { onHold } from '../../../core/longpress.js';
import { hash } from '../lib/net.js';
import * as store from '../lib/store.js';
import { player } from '../lib/player.js';

export const fmtLen = (s) => {
  s = Math.round(s || 0);
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} giờ ${m ? m + ' phút' : ''}`.trim() : `${Math.max(1, m)} phút`;
};
export const fmtClock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};
export const fmtDate = (t) => {
  if (!t) return '';
  const d = new Date(t), days = (Date.now() - t) / 864e5;
  if (days < 1 && d.getDate() === new Date().getDate()) return 'Hôm nay';
  if (days < 2) return 'Hôm qua';
  if (days < 7) return `${Math.floor(days)} ngày trước`;
  return d.toLocaleDateString('vi-VN', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};
// Feed HTML is parsed inert (DOMParser runs no scripts and loads no images) and only its text and links are kept.
const inert = (h) => new DOMParser().parseFromString(String(h || ''), 'text/html').body;
export const stripHtml = (h) => inert(h).textContent.replace(/\s+/g, ' ').trim();

// Safe show notes: text, line breaks, links and timestamps (12:34 → seek).
export function notesHtml(h) {
  const d = inert(h);
  d.querySelectorAll('script, style, iframe, object, embed').forEach(n => n.remove());
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out.push(esc(c.textContent).replace(/\b(\d{1,2}:)?\d{1,2}:\d{2}\b/g, (m) => `<button type="button" class="pc-ts" data-ts="${m}">${m}</button>`));
      else if (c.nodeType === 1) {
        const tag = c.tagName.toLowerCase();
        if (tag === 'a' && /^https?:/i.test(c.getAttribute('href') || '')) { out.push(`<a href="${esc(c.getAttribute('href'))}" target="_blank" rel="noopener">`); walk(c); out.push('</a>'); }
        else if (['p', 'div', 'li', 'br', 'h1', 'h2', 'h3', 'h4'].includes(tag)) { walk(c); out.push(tag === 'li' ? '<br>• ' : '<br>'); }
        else walk(c);
      }
    }
  };
  walk(d);
  return out.join('').replace(/(<br>\s*){3,}/g, '<br><br>').replace(/^(<br>)+|(<br>)+$/g, '');
}
export const tsToSec = (m) => m.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);

// Artwork with an initial-letter fallback in a colour made from the title.
// Apple artwork URLs carry their size (…/100x100bb.jpg): ask for 600px so covers stay sharp on dense phone screens.
const sharp = (u) => /mzstatic\.com\/.*\/\d+x\d+(bb|ss|cc)?\.(jpg|png|webp)$/i.test(u || '') ? u.replace(/\/\d+x\d+(bb|ss|cc)?\.(jpg|png|webp)$/i, '/600x600bb.$2') : u;
export function art(src, title = '', cls = '') {
  src = sharp(src);
  const hue = parseInt(hash(title || 'x').slice(0, 4), 36) % 360;
  const fb = `<span class="pc-art-fb" style="--h:${hue}">${esc((title || '?').trim().slice(0, 1).toUpperCase())}</span>`;
  return `<span class="pc-art ${cls}">${fb}${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-drop-on-error>` : ''}</span>`;
}

export function episodeRow(e, { prog, showName = true, queued = false, downloaded = false } = {}) {
  const pct = prog?.total ? Math.min(100, prog.position / prog.total * 100) : 0;
  const played = e.played || prog?.state === 'finished';
  const left = prog && !played && prog.position > 5 ? `Còn ${fmtLen((prog.total || e.duration) - prog.position)}` : fmtLen(e.duration);
  const now = player.ep?.id === e.id && player.playing;
  return `<li class="pc-ep ${played ? 'played' : ''}" data-ep="${esc(e.id)}">
    <a class="pc-ep-art" href="#podcasts/episode/${encodeURIComponent(e.id)}">${art(e.image || e.show?.image, e.show?.title || e.title)}</a>
    <a class="pc-ep-main" href="#podcasts/episode/${encodeURIComponent(e.id)}">
      <small class="muted">${showName && e.show ? esc(e.show.title) + ' · ' : ''}${fmtDate(e.pubDate)}${e.inbox ? ' · <b class="pc-new">Mới</b>' : ''}${e.starred ? ' ★' : ''}</small>
      <b>${esc(e.title)}</b>
      <small class="muted">${played ? 'Đã nghe · ' : ''}${left}${downloaded ? ' · ' + icon('download') : ''}${queued ? ' · trong hàng chờ' : ''}</small>
      ${pct > 0 && !played ? `<span class="pc-bar"><i style="width:${pct}%"></i></span>` : ''}
    </a>
    <button class="pc-round ${now ? 'on' : ''}" data-play="${esc(e.id)}" aria-label="${now ? 'Tạm dừng' : 'Phát'}">${icon(now ? 'pc-pause' : 'pc-play')}</button>
    <button class="icon-btn" data-menu="${esc(e.id)}" aria-label="Thêm">${icon('pc-more')}</button>
  </li>`;
}

export async function episodeList(eps, opts = {}) {
  if (!eps.length) return `<p class="muted pc-empty">${opts.empty || 'Chưa có tập nào.'}</p>`;
  const prog = await store.progressOf(eps.map(e => e.id));
  const q = new Set(await store.queue());
  const dl = new Set(await (await import('../../../core/db.js')).db.pcDownloads.toCollection().primaryKeys());
  return `<ul class="pc-eps">${eps.map(e => episodeRow(e, { ...opts, prog: prog.get(e.id), queued: q.has(e.id), downloaded: dl.has(e.id) })).join('')}</ul>`;
}

// Click handling for play buttons, menus and timestamps inside `root`.
export function bindEpisodes(root, { ctx, rerender, playlistId = null } = {}) {
  const onClick = async (ev) => {
    const p = ev.target.closest('[data-play]');
    if (p) { ev.preventDefault(); const id = p.dataset.play; if (player.ep?.id === id) player.toggle(); else { const e = await store.episode(id); if (e) await player.playEpisode(e); } return; }
    const m = ev.target.closest('[data-menu]');
    if (m) { ev.preventDefault(); await episodeMenu(m.dataset.menu, { ctx, anchor: m, playlistId }); rerender?.(); }
  };
  root.addEventListener('click', onClick);
  onHold(root, '.pc-ep', async (row, e) => { if (e?.target?.closest?.('.pc-grip')) return; await episodeMenu(row.dataset.ep, { ctx, playlistId }); rerender?.(); });   // long press / right-click = the ⋯ menu
  return () => root.removeEventListener('click', onClick);
}

// Long press / right-click a show card or result row: open, (un)subscribe, refresh, share the feed.
export function bindShows(root, { rerender } = {}) {
  onHold(root, '.pc-show, .pc-result', async (el) => {
    const link = el.matches('a') ? el : el.querySelector('a[href^="#podcasts/"]');
    const m = /^#podcasts\/(show|preview)\/(.+)$/.exec(link?.getAttribute('href') || '');
    if (!m) return;
    await showMenu(m[1], decodeURIComponent(m[2]), el.querySelector('b')?.textContent || '');
    rerender?.();
  });
}

async function showMenu(kind, key, name) {
  const s = kind === 'show' ? await store.show(key) : null;
  const feed = s?.feedUrl || (kind === 'preview' ? key : '');
  const subbed = !!s?.subscribed;
  const acts = [
    ['open', 'podcast', 'Mở podcast'],
    subbed ? ['unsub', 'pc-trash', 'Huỷ đăng ký'] : ['sub', 'pc-plus', 'Đăng ký'],
    ...(subbed ? [['refresh', 'refresh', 'Làm mới tập']] : []),
    ...(feed ? [['share', 'link', 'Chép liên kết RSS']] : []),
  ];
  const v = await pick(s?.title || name || 'Podcast', `<div class="pc-menu">${acts.map(([k, ic, l]) => `<button class="btn ghost" data-v="${k}">${icon(ic)}${l}</button>`).join('')}</div>`);
  const fail = (err) => err?.name !== 'AbortError' && toast(err.message, 'error');
  switch (v) {
    case 'open': location.hash = `podcasts/${kind}/${encodeURIComponent(key)}`; break;
    case 'sub': await tasks.run({ label: 'Đăng ký podcast', detail: s?.title || name, cancellable: true }, (t) => s ? store.subscribeCached(s.itemId) : store.subscribe({ feedUrl: feed, title: name }, { signal: t?.signal })).then(() => toast('Đã đăng ký')).catch(fail); break;
    case 'unsub': await store.unsubscribe(s.itemId); toast('Đã huỷ đăng ký'); break;
    case 'refresh': await tasks.run({ label: 'Làm mới podcast', detail: s.title, cancellable: true }, (t) => store.refresh(s.itemId, { signal: t?.signal })).then(() => toast('Đã làm mới')).catch(fail); break;
    case 'share': try { await navigator.clipboard.writeText(feed); toast('Đã chép liên kết RSS'); } catch { toast('Không chép được liên kết', 'error'); } break;
  }
}

export async function episodeMenu(id, { ctx, playlistId = null } = {}) {
  const e = await store.episode(id);
  if (!e) return;
  const dl = await store.isDownloaded(id);
  const inQ = (await store.queue()).includes(id);
  const acts = [
    ['play', 'pc-play', 'Phát ngay'],
    ['next', 'pc-queue', 'Phát tiếp theo'],
    [inQ ? 'unqueue' : 'queue', 'pc-queue', inQ ? 'Bỏ khỏi hàng chờ' : 'Thêm vào cuối hàng chờ'],
    [e.played ? 'unplayed' : 'played', 'pc-check', e.played ? 'Đánh dấu chưa nghe' : 'Đánh dấu đã nghe'],
    [e.starred ? 'unstar' : 'star', 'pc-star', e.starred ? 'Bỏ sao' : 'Gắn sao'],
    ...(e.url ? [[dl ? 'undl' : 'dl', dl ? 'pc-trash' : 'download', dl ? 'Xoá bản tải' : 'Tải về máy']] : []),
    ['list', 'pc-plus', 'Thêm vào danh sách…'],
    ...(playlistId ? [['unlist', 'x', 'Bỏ khỏi danh sách này']] : []),
    ['share', 'link', 'Chia sẻ liên kết'],
    ['show', 'podcast', 'Mở podcast'],
  ];
  const v = await pick(e.title, `<div class="pc-menu">${acts.map(([k, ic, l]) => `<button class="btn ghost" data-v="${k}">${icon(ic)}${l}</button>`).join('')}</div>`);
  return runAction(v, e, ctx, { playlistId });
}

export async function runAction(v, e, ctx, { playlistId = null } = {}) {
  switch (v) {
    case 'play': return player.playEpisode(e);
    case 'next': return store.enqueue(e.id, { next: true }).then(() => toast('Sẽ phát tiếp theo'));
    case 'queue': return store.enqueue(e.id).then(() => toast('Đã thêm vào hàng chờ'));
    case 'unqueue': return store.dequeue(e.id);
    case 'played': return store.setPlayed(e.id, true);
    case 'unplayed': return store.setPlayed(e.id, false);
    case 'star': return store.setStar(e.id, true);
    case 'unstar': return store.setStar(e.id, false);
    case 'dl': return tasks.run({ label: 'Tải tập podcast', detail: e.title, cancellable: true }, (t) => store.download(e, t)).then(() => toast('Đã tải về máy')).catch(err => err?.name !== 'AbortError' && toast(err.message, 'error'));
    case 'undl': return store.deleteDownload(e.id);
    case 'list': return pickPlaylist(e);
    case 'unlist': return playlistId && store.removeFromPlaylist(playlistId, e.id).then(() => toast('Đã bỏ khỏi danh sách'));
    case 'share': { const url = e.link || e.url; try { if (navigator.share) await navigator.share({ title: e.title, url }); else { await navigator.clipboard.writeText(url); toast('Đã chép liên kết'); } } catch { /* cancelled */ } return; }
    case 'show': return ctx?.go ? ctx.go('podcasts/show/' + encodeURIComponent(e.showId)) : (location.hash = 'podcasts/show/' + encodeURIComponent(e.showId));
  }
}

async function pickPlaylist(e) {
  const lists = (await store.playlists()).filter(p => p.kind === 'list');
  const v = await pick('Thêm vào danh sách', `<div class="pc-menu">${lists.map(p => `<button class="btn ghost" data-v="${esc(p.id)}">${icon('pc-queue')}${esc(p.name)}</button>`).join('')}<button class="btn" data-v="__new">${icon('pc-plus')}Danh sách mới…</button></div>`);
  if (!v) return;
  if (v === '__new') {
    const name = await askText('Danh sách mới', { placeholder: 'Tên danh sách', ok: 'Tạo' });
    if (!name) return;
    await store.savePlaylist({ name, kind: 'list', episodeIds: [e.id] });
    toast(`Đã tạo “${name}” với tập này`);
  } else { await store.addToPlaylist(v, e.id); toast('Đã thêm vào danh sách'); }
}

// Show card (subscriptions grid, search results, charts).
export function showCard(s, { sub = false, badge = 0, rank = null } = {}) {
  const href = s.itemId ? `#podcasts/show/${encodeURIComponent(s.itemId)}` : `#podcasts/preview/${encodeURIComponent(s.feedUrl)}`;
  return `<a class="pc-show" href="${href}" data-feed="${esc(s.feedUrl || '')}">
    ${art(s.image, s.title)}${badge ? `<span class="pc-badge">${badge}</span>` : ''}${rank ? `<span class="pc-rank">${rank}</span>` : ''}
    <b>${esc(s.title)}</b><small class="muted">${esc(s.author || '')}</small>
    ${sub ? '' : ''}
  </a>`;
}

// A list of choices in the app's modal style; resolves to the clicked button's data-v (null when closed), or with
// collect(root) to { v, data } so a small form can be read before the sheet closes.
export function pick(title, html, { collect } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', title);
    wrap.innerHTML = `<div class="modal pc-sheet"><header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Đóng">${icon('x')}</button></header><div class="modal-body">${html}</div></div>`;
    const done = (v) => { const data = collect && v != null ? collect(wrap) : null; wrap.remove(); document.removeEventListener('keydown', key); resolve(collect ? (v == null ? null : { v, data }) : v); };
    const key = (e) => { if (e.key === 'Escape') done(null); };
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v); else if (e.target === wrap || e.target.closest('[data-close]')) done(null); });
    document.addEventListener('keydown', key);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-v]')?.focus();
  });
}

// In-app text question (replaces window.prompt, which blocks the app and looks foreign on Android).
export async function askText(title, { placeholder = '', value = '', ok = 'Lưu' } = {}) {
  const wait = pick(title, `<form class="pc-ask" data-ask><input name="t" value="${esc(value)}" placeholder="${esc(placeholder)}" required enterkeyhint="done" autocomplete="off">
    <div class="row-actions"><button type="button" class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-v="ok">${esc(ok)}</button></div></form>`,
    { collect: (w) => w.querySelector('[name="t"]').value.trim() });
  const form = document.querySelector('.modal-wrap:last-of-type [data-ask]');
  if (form) { form.onsubmit = (e) => { e.preventDefault(); form.querySelector('[data-v="ok"]').click(); }; setTimeout(() => form.t.focus(), 30); }
  const r = await wait;
  return r?.data || null;
}

