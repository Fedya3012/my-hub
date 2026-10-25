// One panel for every AI lyrics choice on wide screens (Windows / desktop): pick the recognition model, vocal
// isolation, language, and the translation model as cards, then run it for the song. Phones keep the short menus
// of ai-menu.js. kind: 'gen' | 'sync' | 'translate' (run for the song t) | 'settings' (just change defaults).
import { sheet } from './sheets.js';
import { icon } from '../../../core/icons.js';
import { toast, esc } from '../../../core/ui.js';
import { prefs, setPref } from '../lib/prefs.js';
import { aiPref, setAiPref, hasSongPrefs, clearSongPrefs, SONG_KEYS } from '../lib/ai-prefs.js';

const REC = {
  tiny: { name: 'Tiny', tag: 'Rất nhanh', desc: 'Nhẹ nhất, hợp bài rõ lời và máy yếu.', size: '≈ 40 MB', stars: 1 },
  base: { name: 'Base', tag: 'Cân bằng', desc: 'Có sẵn trong app, dùng được ngay, không cần tải.', size: '≈ 80 MB', stars: 2 },
  small: { name: 'Small', tag: 'Chính xác', desc: 'Nghe rõ tiếng Việt, Nhật, Hàn; khuyên dùng khi đồng bộ từng chữ.', size: '≈ 250 MB', stars: 3 },
  medium: { name: 'Medium', tag: 'Rất chính xác', desc: 'Giữa Small và Large; nghe tốt nhiều ngôn ngữ, vừa phải về RAM.', size: '≈ 500 MB', stars: 4 },
  large: { name: 'Large v3', tag: 'Tốt nhất', desc: 'Mô hình Whisper lớn nhất, chính xác nhất, rất nặng và chậm.', size: '≈ 1,1 GB', stars: 4 },
  turbo: { name: 'Large v3 Turbo', tag: 'Cao cấp', desc: 'Chính xác nhất, nặng và chậm; cần nhiều RAM.', size: '≈ 800 MB', stars: 4 },
  distil: { name: 'Distil Large v3', tag: 'Tiếng Anh nhanh', desc: 'Chỉ tiếng Anh, gần bằng Large v3 mà nhanh hơn nhiều.', size: '≈ 750 MB', stars: 4 },
};
// Big models may lack the word-timing export; then Base times the words (the app says so).
const SYNC_NOTE = { medium: 'Nếu thiếu bản giờ từng chữ, Base sẽ căn giờ.', large: 'Nếu thiếu bản giờ từng chữ, Base sẽ căn giờ.', turbo: 'Nếu thiếu bản giờ từng chữ, Base sẽ căn giờ.', distil: 'Nếu thiếu bản giờ từng chữ, Base sẽ căn giờ.' };
const TRM = {
  fast: { name: 'Dịch nhanh', tag: 'NLLB-200', desc: 'Mô hình dịch chuyên dụng cho khoảng 200 ngôn ngữ, dịch từng dòng, chống lặp.', size: '≈ 600 MB', stars: 3 },
  best: { name: 'Dịch chính xác', tag: 'Qwen2.5 1.5B', desc: 'Mô hình ngôn ngữ đọc cả bài theo cụm dòng: sát nghĩa, tự nhiên, xử lý được lời pha nhiều ngôn ngữ; chậm hơn.', size: '≈ 1 GB', stars: 4 },
};
const LANGS = { '': 'Tự nhận', vi: 'Tiếng Việt', en: 'Tiếng Anh', ja: 'Tiếng Nhật', ko: 'Tiếng Hàn', zh: 'Tiếng Trung' };
const TLANGS = { vi: 'Tiếng Việt', en: 'Tiếng Anh', ja: 'Tiếng Nhật', ko: 'Tiếng Hàn', zh: 'Tiếng Trung', fr: 'Tiếng Pháp', es: 'Tiếng Tây Ban Nha', de: 'Tiếng Đức' };

export const wide = () => !matchMedia('(max-width: 720px)').matches;

export async function openAiPanel({ t = null, kind = 'settings', onDone } = {}) {
  const ai = await import('../lib/lyrics-ai.js');
  const tr = await import('../lib/lyrics-translate.js');
  const showRec = kind !== 'translate', showGen = kind === 'gen' || kind === 'settings', showSync = kind === 'sync' || kind === 'settings';
  const showTr = kind === 'translate' || kind === 'settings';
  const titles = { gen: 'Tạo lời tự động', sync: 'Tự đồng bộ từng chữ', translate: 'Dịch lời bằng AI', settings: 'Cài đặt AI cho lời' };
  let s;
  // With a song open the choices can be kept for that song only ('song') or changed for every song ('all').
  let scope = t && hasSongPrefs(t) ? 'song' : 'all';
  const tgt = () => (scope === 'song' ? t : null);
  const Y = () => { const y = { ...(prefs().lyrics || {}) }; for (const k of SONG_KEYS) y[k] = aiPref(k, tgt()); return y; };
  const stars = (n) => `<span class="aip-stars" aria-label="${n} trên 4">${'●'.repeat(n)}<i>${'●'.repeat(4 - n)}</i></span>`;
  const card = (group, key, m, { on, badge, extra = '' }) => `<button class="aip-card${on ? ' on' : ''}" data-${group}="${key}" role="radio" aria-checked="${on}">
      <span class="aip-radio" aria-hidden="true">${on ? icon('check') : ''}</span>
      <span class="aip-card-t"><b>${esc(m.name)}</b><em>${esc(m.tag)}</em>${badge ? `<u>${esc(badge)}</u>` : ''}</span>
      <span class="aip-card-d">${esc(m.desc)}</span>
      <span class="aip-card-m">${stars(m.stars)}<span>${esc(m.size)}</span></span>${extra}</button>`;
  const draw = () => {
    ai.syncCustom();
    const y = Y(), got = y.aiRemoteOk || {};
    const curOf = (pk) => { const k = pk === 'aiGenModel' ? (y.aiGenModel ?? y.aiModel) : y.aiModel; return ai.AI_MODELS[k] ? k : 'base'; };
    const badge = (k) => (!ai.AI_MODELS[k]?.remote ? 'Có sẵn' : got[k === 'custom' ? 'custom:' + ai.AI_MODELS.custom?.id : k] ? 'Đã tải' : 'Tải khi chọn');
    const recSection = (pk, title, sub) => { const cur = curOf(pk); return `<section class="aip-sec"><h3>${title} <small>(${sub})</small></h3>
        <div class="aip-grid" role="radiogroup" aria-label="${title}">
          ${Object.keys(REC).map(k => card('m', pk + '|' + k, { ...REC[k], desc: pk === 'aiModel' && SYNC_NOTE[k] ? REC[k].desc + ' ' + SYNC_NOTE[k] : REC[k].desc }, { on: cur === k, badge: badge(k) })).join('')}
          ${card('m', pk + '|custom', { name: 'Mô hình tự chọn', tag: ai.AI_MODELS.custom ? ai.AI_MODELS.custom.id : 'Hugging Face', desc: 'Dán tên kho Whisper ONNX bất kỳ, ví dụ onnx-community/whisper-medium.', size: 'tuỳ mô hình', stars: 3 }, { on: cur === 'custom' && !!ai.AI_MODELS.custom, badge: ai.AI_MODELS.custom ? badge('custom') : '' })}
        </div></section>`; };
    const trm = y.trModel === 'best' ? 'best' : 'fast';
    const own = t && hasSongPrefs(t);
    const body = `
      ${t ? `<p class="aip-song">${icon('music')}<span>${esc(t.title || 'Bài hát')}${t.artist ? ' · ' + esc(t.artist) : ''}</span></p>
      <div class="aip-scope"><span class="aip-scope-l">Áp dụng cài đặt cho</span>
        <div class="aip-seg" role="radiogroup" aria-label="Áp dụng cài đặt cho">
          <button role="radio" aria-checked="${scope === 'song'}" class="${scope === 'song' ? 'on' : ''}" data-scope="song">Chỉ bài này</button>
          <button role="radio" aria-checked="${scope === 'all'}" class="${scope === 'all' ? 'on' : ''}" data-scope="all">Tất cả bài hát</button>
        </div>
        <small>${scope === 'song' ? (own ? 'Bài này đang dùng cài đặt riêng. Mục nào không đổi thì theo cài đặt chung.' : 'Chọn bên dưới để lưu riêng cho bài này; cài đặt chung giữ nguyên.') : own ? 'Đang sửa cài đặt chung. Bài này vẫn có cài đặt riêng, chọn “Chỉ bài này” để xem.' : 'Thay đổi áp dụng cho mọi bài chưa có cài đặt riêng.'}</small>
        ${own ? `<button class="btn small" data-unown>${icon('x')}Bỏ cài đặt riêng của bài này</button>` : ''}
      </div>` : ''}
      ${showGen ? recSection('aiGenModel', 'Mô hình tạo lời', 'Whisper, chạy trên máy; nghe cả bài và viết lời có mốc theo dòng') : ''}
      ${showSync ? recSection('aiModel', 'Mô hình đồng bộ từng chữ', 'Whisper, chạy trên máy; cần bản có giờ từng chữ') : ''}
      ${showRec ? `<section class="aip-sec">
        <div class="aip-custom" ${ai.AI_MODELS.custom || kind === 'settings' ? '' : 'hidden'}><input name="custom" value="${esc(y.aiCustom || '')}" placeholder="onnx-community/whisper-medium" spellcheck="false" aria-label="Tên kho Hugging Face"><button class="btn small" data-custom>Dùng mô hình này</button></div>
        <div class="aip-opts">
          <label class="aip-opt"><input type="checkbox" data-vocal ${y.aiVocal === 1 ? 'checked' : ''}><span><b>Tách giọng hát khỏi nhạc nền</b><small>Nghe rõ hơn với bài nhạc nền dày (stereo), lâu hơn một chút.</small></span></label>
          <label class="aip-opt"><input type="checkbox" data-auto ${y.aiAuto !== 0 ? 'checked' : ''}><span><b>Tự tạo lời khi bài chưa có lời</b><small>Chạy ngầm sau vài giây phát nhạc.</small></span></label>
          <label class="aip-opt sel"><span><b>Ngôn ngữ bài hát</b><small>Chọn đúng sẽ ít nghe nhầm hơn.</small></span><select data-lang>${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${(y.aiLang || '') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        </div></section>` : ''}
      ${showTr ? `<section class="aip-sec"><h3>Mô hình dịch lời <small>(Hugging Face, chạy trên máy)</small></h3>
        <div class="aip-grid two" role="radiogroup" aria-label="Mô hình dịch">${Object.keys(TRM).map(k => card('t', k, TRM[k], { on: trm === k, badge: '' })).join('')}</div>
        <div class="aip-opts"><label class="aip-opt sel"><span><b>Dịch sang</b><small>Ngôn ngữ của bản dịch hiện dưới từng dòng lời.</small></span><select data-tlang>${Object.entries(TLANGS).map(([k, v]) => `<option value="${k}" ${(y.trLang || 'vi') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div></section>` : ''}
      ${kind !== 'settings' ? `<div class="aip-foot"><button class="btn" data-x>Huỷ</button><button class="btn primary" data-go>${icon('play')}${{ gen: 'Tạo lời', sync: 'Đồng bộ từng chữ', translate: 'Dịch lời' }[kind]}</button></div>` : ''}`;
    s.el.querySelector('.msheet-body').innerHTML = body;
    bind();
  };
  let customFor = kind === 'gen' ? 'aiGenModel' : 'aiModel';
  const bind = () => {
    const q = (x) => s.el.querySelector(x);
    s.el.querySelectorAll('[data-m]').forEach(b => b.onclick = async () => {
      const [pk, k] = b.dataset.m.split('|');
      if (k === 'custom' && !ai.AI_MODELS.custom) { customFor = pk; const c = q('.aip-custom'); c.hidden = false; c.querySelector('input').focus(); return; }
      await setAiPref(pk, k, tgt()); draw();
    });
    s.el.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => { await setAiPref('trModel', b.dataset.t, tgt()); draw(); });
    s.el.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => { scope = b.dataset.scope; draw(); });
    q('[data-unown]')?.addEventListener('click', async () => { await clearSongPrefs(t); scope = 'all'; toast('Bài này dùng lại cài đặt chung'); draw(); });
    q('[data-custom]')?.addEventListener('click', async () => {
      const id = q('[name=custom]').value.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(id)) return toast('Tên kho không hợp lệ, cần dạng tác-giả/tên', 'warn');
      await setPref('lyrics.aiCustom', id); ai.syncCustom(); await setAiPref(customFor, 'custom', tgt()); draw();
    });
    q('[data-vocal]')?.addEventListener('change', (e) => setAiPref('aiVocal', e.target.checked ? 1 : 0, tgt()).then(draw));
    q('[data-auto]')?.addEventListener('change', (e) => setPref('lyrics.aiAuto', e.target.checked ? 1 : 0));
    q('[data-lang]')?.addEventListener('change', (e) => setAiPref('aiLang', e.target.value, tgt()).then(draw));
    q('[data-tlang]')?.addEventListener('change', (e) => setAiPref('trLang', e.target.value, tgt()).then(draw));
    q('[data-x]')?.addEventListener('click', () => s.close());
    q('[data-go]')?.addEventListener('click', () => {
      s.close();
      const done = (e) => { if (e) toast(e.message || 'Không thực hiện được', 'warn'); onDone?.(e); };
      if (kind === 'translate') return tr.translateLyrics(t, { model: Y().trModel, lang: Y().trLang }).then(() => done(), done);
      const y = Y(), mk = kind === 'gen' ? (y.aiGenModel ?? y.aiModel) : y.aiModel;
      const model = ai.AI_MODELS[mk] ? mk : 'base', vocal = y.aiVocal === 1;
      (kind === 'sync' ? ai.autoWordSync(t, { model, vocal }) : ai.generate(t, { model, vocal })).then(() => done(), done);
    });
  };
  s = sheet({ title: titles[kind], wide: true, cls: 'aip', body: '<div></div>' });
  draw();
  return s;
}
