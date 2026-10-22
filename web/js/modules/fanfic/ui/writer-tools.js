// Writer tool sheets (loaded on first use): page look, sounds, session lock, find & replace across chapters,
// repetition / long-sentence / rhythm check, note editor, version comparison.
import { icon } from '../../../core/icons.js';
import { esc, toast, h } from '../../../core/ui.js';
import { params } from '../../../core/params.js';
import * as store from '../lib/store.js';
import { countWords, mdToHtml } from '../lib/text.js';
import { repetitions, longSentences, rhythm, frequency } from '../lib/analyze.js';
import { FONTS, PAPERS, get as pref, set as setPref } from '../lib/prefs.js';
import { NOTE_KINDS } from '../lib/vocab.js';
import { sheet, fmtNum } from './common.js';

// ── Page look: paper, font, size, spacing, width, margins, dimming, typewriter ──
export function lookSheet() {
  const range = (k, label, min, max, step, unit = '') => `<label class="fx-range">${label}<span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${pref(k)}"><output class="num">${pref(k)}${unit}</output></span></label>`;
  const box = h(`<div class="fx-form">
    <div><p class="fx-lbl">Nền trang</p><div class="fx-papers">${Object.entries(PAPERS).map(([k, p]) => `<button type="button" data-paper="${k}" class="${pref('paper') === k ? 'on' : ''}" style="${p.bg ? `--pb:${p.bg};--pf:${p.fg}` : ''}" aria-pressed="${pref('paper') === k}"><i>Aa</i><span>${esc(p.label)}</span></button>`).join('')}</div></div>
    <label>Phông chữ<select data-k="font">${Object.entries(FONTS).map(([k, [l, css]]) => `<option value="${k}" ${pref('font') === k ? 'selected' : ''} style="font-family:${esc(css)}">${esc(l)}</option>`).join('')}</select></label>
    ${range('fontSize', 'Cỡ chữ', 13, 32, 1, 'px')}
    ${range('lineHeight', 'Giãn dòng', 1.2, 2.4, 0.05)}
    ${range('width', 'Độ rộng dòng', 420, 1200, 20, 'px')}
    ${range('margin', 'Lề hai bên', 0, 120, 2, 'px')}
    <label>Làm mờ chữ đã viết<select data-k="dim"><option value="off">Tắt</option><option value="paragraph">Chỉ sáng đoạn đang viết</option><option value="sentence">Chỉ sáng câu đang viết</option></select></label>
    <label class="fx-check-row"><input type="checkbox" data-k="typewriter" ${pref('typewriter') ? 'checked' : ''}> Kiểu máy chữ: dòng đang gõ luôn ở giữa màn hình</label>
    <label class="fx-check-row"><input type="checkbox" data-k="spellcheck" ${pref('spellcheck') ? 'checked' : ''}> Kiểm tra chính tả</label>
  </div>`);
  box.querySelector('[data-k="dim"]').value = pref('dim');
  sheet('Giao diện trang viết', box);
  box.querySelectorAll('[data-paper]').forEach(b => b.onclick = async () => { await setPref('paper', b.dataset.paper); box.querySelectorAll('[data-paper]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); });
  box.querySelectorAll('[data-k]').forEach(i => i.oninput = async () => {
    const val = i.type === 'checkbox' ? (i.checked ? 1 : 0) : i.type === 'range' ? +i.value : i.value;
    const out = i.parentElement.querySelector('output'); if (out) out.textContent = val + (out.textContent.replace(/[\d.]+/, '') || '');
    await setPref(i.dataset.k, val);
  });
}

// ── Sounds: key sounds, ambient mixer from Trình phát nhạc, the music attached to this work ──
export async function soundSheet(ctx, item) {
  const amb = await ctx.services.get('ambient')?.load().catch(() => null);
  const SOUNDS = amb ? (await import('../../music/lib/ambient.js').catch(() => ({}))).SOUNDS || {} : {};
  const box = h(`<div class="fx-form">
    <label>Âm thanh gõ phím<select data-k="keySound"><option value="off">Tắt</option><option value="typewriter">Máy chữ cơ (có chuông xuống dòng)</option><option value="soft">Bàn phím êm</option></select></label>
    <label class="fx-range">Âm lượng tiếng gõ<span><input type="range" data-k="keyVolume" min="0" max="1" step="0.05" value="${pref('keyVolume')}"><output class="num">${Math.round(pref('keyVolume') * 100)}%</output></span></label>
    ${amb ? `<p class="fx-lbl">Âm thanh nền</p>${Object.entries(SOUNDS).map(([k, s]) => `<label class="fx-range">${esc(s.label)}<span><input type="range" data-amb="${k}" min="0" max="1" step="0.05" value="${amb.level(k)}"><output class="num">${Math.round(amb.level(k) * 100)}%</output></span></label>`).join('')}` : '<p class="muted">Bật Trình phát nhạc để có âm thanh nền (mưa, lửa trại, sóng biển…).</p>'}
    <div class="row-actions"><button type="button" class="btn" data-music>${icon('music')}Phát nhạc đã gắn với truyện</button><button type="button" class="btn" data-pause>Tạm dừng nhạc</button></div>
    <p class="hint">Gắn danh sách phát lofi cho truyện ở trang tác phẩm (khối Nhạc nền). Âm thanh nền và tiếng gõ không cần mạng.</p>
  </div>`);
  box.querySelector('[data-k="keySound"]').value = pref('keySound');
  sheet('Âm thanh khi viết', box);
  box.querySelector('[data-k="keySound"]').onchange = (e) => setPref('keySound', e.target.value);
  box.querySelector('[data-k="keyVolume"]').oninput = (e) => { setPref('keyVolume', +e.target.value); e.target.nextElementSibling.textContent = Math.round(e.target.value * 100) + '%'; };
  box.querySelectorAll('[data-amb]').forEach(r => r.oninput = () => { amb.set(r.dataset.amb, +r.value); r.nextElementSibling.textContent = Math.round(r.value * 100) + '%'; });
  // Music listens to item:open and plays what is attached; 'unhandled' keeps the app from navigating.
  box.querySelector('[data-music]').onclick = async () => {
    const player = ctx.services.get('player');
    if (!player) return toast('Bật Trình phát nhạc trong Quản lý ứng dụng để phát nhạc', 'warn');
    const linked = await (await import('../../music/lib/store.js')).musicFor(item.id).catch(() => []);
    if (!linked.length) return toast('Truyện chưa gắn nhạc. Gắn ở trang tác phẩm, khối Nhạc nền.', 'warn');
    const m = linked[0];
    await player.play(m.kind, m.link.fromId, { shuffle: !!m.link.shuffle });
    toast(`Đang phát: ${m.name}`);
  };
  box.querySelector('[data-pause]').onclick = () => ctx.services.get('player')?.pause();
}

// ── Session lock ──
export function lockSheet(api) {
  if (api.lock && !api.lock.done) return toast('Phiên khoá đang chạy. Viết tới mục tiêu để mở khoá.');
  const box = h(`<form class="fx-form">
    <p class="muted">Khoá trình viết cho tới khi đạt số từ hoặc hết thời gian. Nút thoát, đóng tab và chuyển trang đều bị chặn (trên điện thoại, nút Quay lại hỏi lại).</p>
    <div class="fx-2"><label>Viết thêm (từ)<input type="number" id="fx-lock-w" min="0" step="50" value="500"></label>
      <label>Trong ít nhất (phút)<input type="number" id="fx-lock-m" min="0" step="5" value="0"></label></div>
    <div class="chips">${[[250, 0], [500, 0], [1000, 0], [0, 25], [0, 45]].map(([w, m]) => `<button type="button" class="chip" data-w="${w}" data-m="${m}">${w ? w + ' từ' : m + ' phút'}</button>`).join('')}</div>
    <footer class="row-actions"><button class="btn primary">${icon('fx-lock')}Bắt đầu phiên khoá</button></footer></form>`);
  const s = sheet('Khoá phiên viết', box);
  box.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { box.querySelector('#fx-lock-w').value = b.dataset.w; box.querySelector('#fx-lock-m').value = b.dataset.m; });
  box.onsubmit = (e) => {
    e.preventDefault();
    const w = +box.querySelector('#fx-lock-w').value || 0, m = +box.querySelector('#fx-lock-m').value || 0;
    if (!w && !m) return toast('Đặt số từ hoặc số phút', 'warn');
    api.startLock(w, m); s.close(); api.ta.focus();
  };
}

// ── Find & replace (this chapter or every chapter) ──
export function findReplace(api) {
  const box = h(`<form class="fx-form">
    <label>Tìm<input id="fx-find" autocomplete="off" placeholder="Tên nhân vật, cụm từ…"></label>
    <label>Thay bằng<input id="fx-rep" autocomplete="off"></label>
    <div class="fx-checks"><label><input type="checkbox" id="fx-cs"> Phân biệt hoa thường</label><label><input type="checkbox" id="fx-word" checked> Nguyên từ</label><label><input type="checkbox" id="fx-re"> Biểu thức chính quy</label></div>
    <div class="seg fx-origin" role="radiogroup" aria-label="Phạm vi"><label><input type="radio" name="scope" value="ch" checked><span>Chương này</span></label><label><input type="radio" name="scope" value="all"><span>Cả truyện</span></label></div>
    <div class="fx-hits" data-hits aria-live="polite"></div>
    <footer class="row-actions"><button type="button" class="btn" data-next>${icon('search')}Tìm tiếp</button><span class="sp"></span><button class="btn primary">Thay tất cả</button></footer></form>`);
  const s = sheet('Tìm và thay thế', box, { wide: true });
  const q = () => box.querySelector('#fx-find').value;
  const opts = () => ({ cs: box.querySelector('#fx-cs').checked, word: box.querySelector('#fx-word').checked, regex: box.querySelector('#fx-re').checked });
  const scope = () => box.querySelector('[name="scope"]:checked').value;
  const sel = api.ta.value.slice(api.ta.selectionStart, api.ta.selectionEnd);
  if (sel && sel.length < 60) box.querySelector('#fx-find').value = sel;
  async function hits() {
    const re = store.findRegex(q(), opts());
    const out = box.querySelector('[data-hits]');
    if (!re) { out.innerHTML = q() ? '<p class="muted">Biểu thức không hợp lệ.</p>' : ''; return; }
    await api.flush();
    const chs = scope() === 'all' ? api.v.chapters : [api.cur];
    const rows = [];
    for (const c of chs) {
      const body = c.id === api.cur.id ? api.ta.value : c.body;
      for (const m of body.matchAll(re)) { rows.push({ c, i: m.index, ctx: body.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40), m: m[0] }); if (rows.length > 200) break; }
    }
    out.innerHTML = `<p class="muted">${rows.length > 200 ? '200+' : rows.length} kết quả${scope() === 'all' ? ` trong ${new Set(rows.map(r => r.c.id)).size} chương` : ''}</p>
      <ul class="fx-hitlist">${rows.slice(0, 60).map((r, k) => `<li><button type="button" data-k="${k}"><small>${esc(r.c.title)}</small><span>…${esc(r.ctx).replace(esc(r.m), `<mark>${esc(r.m)}</mark>`)}…</span></button></li>`).join('')}</ul>`;
    out.querySelectorAll('[data-k]').forEach(b => b.onclick = async () => { const r = rows[+b.dataset.k]; if (r.c.id !== api.cur.id) await api.show(r.c.id); api.ta.focus(); api.ta.setSelectionRange(r.i, r.i + r.m.length); });
    return rows;
  }
  let t = 0;
  box.querySelectorAll('input').forEach(i => i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(hits, 250); }));
  box.querySelector('[data-next]').onclick = () => {
    const re = store.findRegex(q(), opts()); if (!re) return;
    const from = api.ta.selectionEnd; re.lastIndex = 0;
    const all = [...api.ta.value.matchAll(re)], m = all.find(x => x.index >= from) || all[0];
    if (!m) return toast('Không thấy trong chương này');
    api.ta.focus(); api.ta.setSelectionRange(m.index, m.index + m[0].length);
  };
  box.onsubmit = async (e) => {
    e.preventDefault();
    if (!q()) return;
    await api.flush();
    const n = await store.replaceAll(api.id, q(), box.querySelector('#fx-rep').value, opts(), scope() === 'all' ? null : [api.cur.id]);
    await api.reload(); await api.show(api.cur.id);
    toast(n ? `Đã thay ${n} chỗ (đã lưu phiên bản trước khi thay)` : 'Không có gì để thay');
    s.close();
  };
  box.querySelector('#fx-find').focus();
  hits();
}

// ── Repetitions, long sentences, rhythm, word frequency ──
export async function analyze(api) {
  await api.flush();
  const text = api.ta.value, limit = pref('longSentence');
  const rep = repetitions(text).slice(0, 20), longs = longSentences(text, limit).slice(0, 15), r = rhythm(text), freq = frequency(text, 20);
  const maxLen = Math.max(1, ...r.lens);
  const box = h(`<div class="fx-analyze">
    <div class="fx-kpis"><div><b class="num">${fmtNum(countWords(text))}</b><small>từ</small></div><div><b class="num">${r.count}</b><small>câu</small></div><div><b class="num">${r.avg.toFixed(1)}</b><small>từ / câu</small></div><div><b class="num">${longs.length}</b><small>câu &gt; ${limit} từ</small></div></div>
    <section><h3>Nhịp câu</h3><p class="muted">Mỗi vạch là một câu, cao theo số từ. Nhịp đều quá (độ lệch ${r.sd.toFixed(1)}) dễ gây buồn ngủ; xen câu ngắn và dài.</p>
      <div class="fx-rhythm">${r.lens.slice(0, 300).map(n => `<i style="--h:${Math.round(n / maxLen * 100)}%" class="${n > limit ? 'long' : ''}" title="${n} từ"></i>`).join('')}</div></section>
    <section><h3>Từ lặp gần nhau</h3>${rep.length ? `<div class="fx-tags">${rep.map(([w, n]) => `<button class="fx-tag warn" data-find="${esc(w)}">${esc(w)} <small>${n}×</small></button>`).join('')}</div><p class="hint">Chạm một từ để tìm và thay trong chương.</p>` : '<p class="muted">Không thấy từ nào lặp dày.</p>'}</section>
    <section><h3>Câu dài</h3>${longs.length ? `<ul class="fx-hitlist">${longs.map((x, k) => `<li><button data-long="${k}"><small>${x.n} từ</small><span>${esc(x.s.slice(0, 220))}${x.s.length > 220 ? '…' : ''}</span></button></li>`).join('')}</ul>` : '<p class="muted">Không có câu nào quá dài.</p>'}</section>
    <section><h3>Từ dùng nhiều nhất</h3><div class="fx-tags">${freq.map(([w, n]) => `<span class="fx-tag">${esc(w)} <small>${n}</small></span>`).join('')}</div></section>
  </div>`);
  const s = sheet('Kiểm tra lặp từ và câu dài', box, { wide: true });
  box.querySelectorAll('[data-find]').forEach(b => b.onclick = () => { s.close(); api.ta.focus(); const re = store.findRegex(b.dataset.find, { word: true }); const m = re && [...api.ta.value.matchAll(re)][0]; if (m) api.ta.setSelectionRange(m.index, m.index + m[0].length); findReplace(api); });
  box.querySelectorAll('[data-long]').forEach(b => b.onclick = () => { const x = longs[+b.dataset.long]; const i = api.ta.value.indexOf(x.s); s.close(); api.ta.focus(); if (i >= 0) api.ta.setSelectionRange(i, i + x.s.length); });
}

// ── Note editor (from the pinned panel) ──
export function editNote(n, done) {
  const f = h(`<form class="fx-form">
    <label>Loại<select data-f="kind">${Object.entries(NOTE_KINDS).map(([k, [l]]) => `<option value="${k}" ${k === n.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Tiêu đề<input data-f="title" value="${esc(n.title || '')}"></label>
    <label>Nội dung (Markdown)<textarea data-f="body" rows="10">${esc(n.body || '')}</textarea></label>
    <footer class="row-actions"><button class="btn primary">${icon('check')}Lưu</button></footer></form>`);
  const s = sheet('Sửa ghi chú', f, { wide: true });
  f.onsubmit = async (e) => { e.preventDefault(); const g = (k) => f.querySelector(`[data-f="${k}"]`).value; await store.saveNote({ ...n, kind: g('kind'), title: g('title').trim(), body: g('body') }); s.close(); done?.(); };
}

// ── Compare an old version with the current text, paragraph by paragraph; copy a lost paragraph back ──
export function versionDiff(ver, current, insert) {
  const old = ver.body.split(/\n\s*\n/), now = new Set(current.split(/\n\s*\n/).map(p => p.trim()));
  const box = h(`<div class="fx-diff">
    <p class="muted">${new Date(ver.createdAt).toLocaleString(globalThis.__LOCALE || 'vi-VN')} · ${fmtNum(ver.words)} từ. Đoạn tô màu là đoạn không còn trong bản hiện tại: chạm “Chèn lại” để đưa về vị trí con trỏ.</p>
    ${old.map((p, i) => p.trim() ? `<div class="fx-diff-p${now.has(p.trim()) ? '' : ' gone'}"><div class="fx-prose">${mdToHtml(p)}</div>${now.has(p.trim()) ? '' : `<button class="btn small" data-ins="${i}">Chèn lại</button>`}</div>` : '').join('')}
  </div>`);
  const s = sheet(ver.label || 'Phiên bản', box, { wide: true });
  box.querySelectorAll('[data-ins]').forEach(b => b.onclick = () => { insert(old[+b.dataset.ins].trim() + '\n\n'); s.close(); });
}
void params;
