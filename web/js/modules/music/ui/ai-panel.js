// One panel for every AI lyrics choice on wide screens (Windows / desktop): pick the recognition model, vocal
// isolation, language, and the translation model as cards, then run it for the song. Phones keep the short menus
// of ai-menu.js. kind: 'gen' | 'sync' | 'translate' (run for the song t) | 'settings' (just change defaults).
import { sheet } from './sheets.js';
import { icon } from '../../../core/icons.js';
import { toast, esc } from '../../../core/ui.js';
import { prefs, setPref } from '../lib/prefs.js';

const REC = {
  tiny: { name: 'Tiny', tag: 'Rất nhanh', desc: 'Nhẹ nhất, hợp bài rõ lời và máy yếu.', size: '≈ 40 MB', stars: 1 },
  base: { name: 'Base', tag: 'Cân bằng', desc: 'Có sẵn trong app, dùng được ngay, không cần tải.', size: '≈ 80 MB', stars: 2 },
  small: { name: 'Small', tag: 'Chính xác', desc: 'Nghe rõ tiếng Việt, Nhật, Hàn; khuyên dùng khi đồng bộ từng chữ.', size: '≈ 250 MB', stars: 3 },
  turbo: { name: 'Large v3 Turbo', tag: 'Cao cấp', desc: 'Chính xác nhất, nặng và chậm; cần nhiều RAM.', size: '≈ 800 MB', stars: 4 },
  distil: { name: 'Distil Large v3', tag: 'Tiếng Anh nhanh', desc: 'Chỉ tiếng Anh, gần bằng Large v3 mà nhanh hơn nhiều.', size: '≈ 750 MB', stars: 4 },
};
const TRM = {
  fast: { name: 'Dịch nhanh', tag: 'Opus-MT', desc: 'Mô hình nhỏ theo từng cặp ngôn ngữ; cặp nào thiếu thì tự dùng bản chính xác.', size: '≈ 80 MB', stars: 2 },
  best: { name: 'Dịch chính xác', tag: 'NLLB-200', desc: 'Một mô hình cho khoảng 200 ngôn ngữ, sát nghĩa hơn, nhất là Nhật, Hàn, Trung.', size: '≈ 600 MB', stars: 4 },
};
const LANGS = { '': 'Tự nhận', vi: 'Tiếng Việt', en: 'Tiếng Anh', ja: 'Tiếng Nhật', ko: 'Tiếng Hàn', zh: 'Tiếng Trung' };
const TLANGS = { vi: 'Tiếng Việt', en: 'Tiếng Anh', ja: 'Tiếng Nhật', ko: 'Tiếng Hàn', zh: 'Tiếng Trung', fr: 'Tiếng Pháp', es: 'Tiếng Tây Ban Nha', de: 'Tiếng Đức' };

export const wide = () => !matchMedia('(max-width: 720px)').matches;

export async function openAiPanel({ t = null, kind = 'settings', onDone } = {}) {
  const ai = await import('../lib/lyrics-ai.js');
  const tr = await import('../lib/lyrics-translate.js');
  const showRec = kind !== 'translate';
  const showTr = kind === 'translate' || kind === 'settings';
  const titles = { gen: 'Tạo lời tự động', sync: 'Tự đồng bộ từng chữ', translate: 'Dịch lời bằng AI', settings: 'Cài đặt AI cho lời' };
  let s;
  const Y = () => prefs().lyrics || {};
  const stars = (n) => `<span class="aip-stars" aria-label="${n} trên 4">${'●'.repeat(n)}<i>${'●'.repeat(4 - n)}</i></span>`;
  const card = (group, key, m, { on, badge, extra = '' }) => `<button class="aip-card${on ? ' on' : ''}" data-${group}="${key}" role="radio" aria-checked="${on}">
      <span class="aip-radio" aria-hidden="true">${on ? icon('check') : ''}</span>
      <span class="aip-card-t"><b>${esc(m.name)}</b><em>${esc(m.tag)}</em>${badge ? `<u>${esc(badge)}</u>` : ''}</span>
      <span class="aip-card-d">${esc(m.desc)}</span>
      <span class="aip-card-m">${stars(m.stars)}<span>${esc(m.size)}</span></span>${extra}</button>`;
  const draw = () => {
    ai.syncCustom();
    const y = Y(), cur = ai.AI_MODELS[y.aiModel] ? y.aiModel : 'base', got = y.aiRemoteOk || {};
    const badge = (k) => (!ai.AI_MODELS[k]?.remote ? 'Có sẵn' : got[k === 'custom' ? 'custom:' + ai.AI_MODELS.custom?.id : k] ? 'Đã tải' : 'Tải khi chọn');
    const trm = y.trModel === 'best' ? 'best' : 'fast';
    const body = `
      ${t ? `<p class="aip-song">${icon('music')}<span>${esc(t.title || 'Bài hát')}${t.artist ? ' · ' + esc(t.artist) : ''}</span></p>` : ''}
      ${showRec ? `<section class="aip-sec"><h3>Mô hình nghe giọng hát <small>(Whisper, chạy trên máy)</small></h3>
        <div class="aip-grid" role="radiogroup" aria-label="Mô hình nghe giọng hát">
          ${Object.keys(REC).map(k => card('m', k, REC[k], { on: cur === k, badge: badge(k) })).join('')}
          ${card('m', 'custom', { name: 'Mô hình tự chọn', tag: ai.AI_MODELS.custom ? ai.AI_MODELS.custom.id : 'Hugging Face', desc: 'Dán tên kho Whisper ONNX bất kỳ, ví dụ onnx-community/whisper-medium.', size: 'tuỳ mô hình', stars: 3 }, { on: cur === 'custom' && !!ai.AI_MODELS.custom, badge: ai.AI_MODELS.custom ? badge('custom') : '', extra: '' })}
        </div>
        <div class="aip-custom" ${ai.AI_MODELS.custom || y.aiModel === 'custom' || kind === 'settings' ? '' : 'hidden'}><input name="custom" value="${esc(y.aiCustom || '')}" placeholder="onnx-community/whisper-medium" spellcheck="false" aria-label="Tên kho Hugging Face"><button class="btn small" data-custom>Dùng mô hình này</button></div>
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
  const bind = () => {
    const q = (x) => s.el.querySelector(x);
    s.el.querySelectorAll('[data-m]').forEach(b => b.onclick = async () => {
      if (b.dataset.m === 'custom' && !ai.AI_MODELS.custom) { const c = q('.aip-custom'); c.hidden = false; c.querySelector('input').focus(); return; }
      await setPref('lyrics.aiModel', b.dataset.m); draw();
    });
    s.el.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => { await setPref('lyrics.trModel', b.dataset.t); draw(); });
    q('[data-custom]')?.addEventListener('click', async () => {
      const id = q('[name=custom]').value.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(id)) return toast('Tên kho không hợp lệ, cần dạng tác-giả/tên', 'warn');
      await setPref('lyrics.aiCustom', id); ai.syncCustom(); await setPref('lyrics.aiModel', 'custom'); draw();
    });
    q('[data-vocal]')?.addEventListener('change', (e) => setPref('lyrics.aiVocal', e.target.checked ? 1 : 0));
    q('[data-auto]')?.addEventListener('change', (e) => setPref('lyrics.aiAuto', e.target.checked ? 1 : 0));
    q('[data-lang]')?.addEventListener('change', (e) => setPref('lyrics.aiLang', e.target.value));
    q('[data-tlang]')?.addEventListener('change', (e) => setPref('lyrics.trLang', e.target.value));
    q('[data-x]')?.addEventListener('click', () => s.close());
    q('[data-go]')?.addEventListener('click', () => {
      s.close();
      const done = (e) => { if (e) toast(e.message || 'Không thực hiện được', 'warn'); onDone?.(e); };
      if (kind === 'translate') return tr.translateLyrics(t).then(() => done(), done);
      const model = ai.AI_MODELS[Y().aiModel] ? Y().aiModel : 'base', vocal = Y().aiVocal === 1;
      (kind === 'sync' ? ai.autoWordSync(t, { model, vocal }) : ai.generate(t, { model, vocal })).then(() => done(), done);
    });
  };
  s = sheet({ title: titles[kind], wide: true, cls: 'aip', body: '<div></div>' });
  draw();
  return s;
}
