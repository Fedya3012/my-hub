// Per-song choice of the AI model (and vocal isolation) for "Tạo lời tự động" and "Tự đồng bộ từng chữ", and the
// marks that show what AI work a song's lyrics already went through.
import { menu } from './sheets.js';
import { toast, confirmBox, modal, esc } from '../../../core/ui.js';
import { saveLyrics } from '../lib/lyrics-sources.js';
import { parseLyrics, toModel, toLrc } from '../lib/lyrics.js';
import { db } from '../../../core/db.js';
import { prefs, setPref } from '../lib/prefs.js';

const MODEL_DESC = {
  tiny: 'Rất nhanh, chính xác vừa, tải thêm ≈ 40 MB',
  base: 'Cân bằng, ≈ 80 MB (có sẵn trong app)',
  small: 'Chính xác, nghe rõ tiếng Việt, Nhật, Hàn, tải thêm ≈ 250 MB',
  turbo: 'Cao cấp, chính xác nhất, chậm và nặng, tải thêm ≈ 800 MB',
  distil: 'Chỉ tiếng Anh, gần bằng Large v3 mà nhanh hơn nhiều, tải thêm ≈ 750 MB',
};
const big = () => (navigator.deviceMemory || 4) >= 8 && !/Android|iPhone|iPad/i.test(navigator.userAgent);

// Which model fits this song: by language (from the lyrics, else the title and artist) and by how strong the device is.
async function recommend(t, kind) {
  const { detectLang } = await import('../lib/lyrics-translate.js');
  const row = await db.lyrics.get(t.id);
  const lang = detectLang(row?.text || [t.title, t.artist].filter(Boolean).join(' '));
  if (kind === 'sync') return { key: 'small', why: 'Có dữ liệu giờ từng chữ, nghe tốt nhiều ngôn ngữ. Large v3 / Tiếng Anh nhanh nếu thiếu dữ liệu đó sẽ dùng Base để căn giờ' };
  if (lang === 'en') return { key: big() ? 'distil' : 'small', why: big() ? 'Bài tiếng Anh, máy khỏe: nhanh và rất chính xác' : 'Bài tiếng Anh: cân bằng giữa chính xác và nhẹ' };
  return { key: big() ? 'turbo' : 'small', why: big() ? 'Không phải tiếng Anh, máy khỏe: Large v3 Turbo nghe tốt nhất' : 'Không phải tiếng Anh: Small nghe rõ hơn Base và vẫn nhẹ' };
}

export async function aiPick(t, kind, { anchor = null, onDone } = {}) {
  const ai = await import('../lib/lyrics-ai.js');
  ai.syncCustom();
  const Y = prefs().lyrics || {};
  const cur = ai.AI_MODELS[Y.aiModel] ? Y.aiModel : 'base';
  const vocal = Y.aiVocal === 1;
  const rec = await recommend(t, kind).catch(() => null);
  const run = (model) => {
    const p = kind === 'sync' ? ai.autoWordSync(t, { model, vocal }) : ai.generate(t, { model, vocal });
    p.then(() => onDone?.(), (e) => { toast(e?.message || (kind === 'sync' ? 'Không đồng bộ được' : 'Không tạo được lời'), 'warn'); onDone?.(e); });
  };
  const again = () => aiPick(t, kind, { anchor, onDone });
  const custom = async () => {
    const id = await modal({ title: 'Mô hình Whisper trên Hugging Face', body: `<div class="stack"><p class="hint">Nhập tên kho dạng <b>tác-giả/tên</b> có bản ONNX, ví dụ <code>onnx-community/whisper-medium</code> hoặc <code>onnx-community/whisper-large-v3-ONNX</code>. Mô hình tải một lần rồi dùng được khi không có mạng.</p><input class="input" name="id" value="${esc(Y.aiCustom || '')}" placeholder="onnx-community/whisper-medium" spellcheck="false"></div>`, actions: [{ label: 'Huỷ', value: null }, { label: 'Dùng', kind: 'primary', value: (b) => b.querySelector('input').value.trim() }] });
    if (id == null) return;
    if (id && !/^[\w.-]+\/[\w.-]+$/.test(id)) { toast('Tên kho không hợp lệ, cần dạng tác-giả/tên', 'warn'); return again(); }
    await setPref('lyrics.aiCustom', id);
    ai.syncCustom();
    if (id) run('custom'); else again();
  };
  menu(anchor, [
    rec && { icon: 'star', label: `Gợi ý cho bài này: ${ai.modelName(rec.key)}`, desc: rec.why, act: () => run(rec.key) },
    '-',
    { icon: 'lyrics', label: 'Tách giọng hát khỏi nhạc nền', desc: vocal ? 'Đang bật: nghe rõ hơn với bài nhạc nền dày, lâu hơn một chút' : 'Đang tắt: bấm để bật (hiệu quả với bài stereo)', on: vocal, act: async () => { await setPref('lyrics.aiVocal', vocal ? 0 : 1); again(); } },
    '-',
    ...Object.keys(ai.AI_MODELS).filter(k => k !== 'custom').map(k => ({ icon: 'lyrics', label: ai.modelName(k) + (rec?.key === k ? ' ★' : ''), desc: MODEL_DESC[k], on: k === cur, act: () => run(k) })),
    ai.AI_MODELS.custom && { icon: 'lyrics', label: ai.modelName('custom'), desc: 'Mô hình bạn đã nhập', on: cur === 'custom', act: () => run('custom') },
    { icon: 'plus', label: ai.AI_MODELS.custom ? 'Đổi mô hình tự chọn…' : 'Nhập mô hình khác từ Hugging Face…', desc: 'Ví dụ onnx-community/whisper-medium', act: custom },
  ], { title: kind === 'sync' ? 'Tự đồng bộ từng chữ: chọn mô hình' : 'Tạo lời tự động: chọn mô hình' });
}

export async function aiTranslate(t, anchor = null, onDone) {
  const lib = await import('../lib/lyrics-translate.js');
  const cur = prefs().lyrics?.trModel || 'fast';
  const lang = lib.TR_LANGS[prefs().lyrics?.trLang] || lib.TR_LANGS.vi;
  const row = await db.lyrics.get(t.id);
  const src = row?.text ? lib.detectLang(row.text) : null;
  const cjk = ['ja', 'ko', 'zh'].includes(src) || ['ja', 'ko', 'zh'].includes(prefs().lyrics?.trLang);
  const recK = cjk ? 'best' : 'fast';
  const why = cjk ? 'Tiếng Nhật, Hàn, Trung: mô hình lớn dịch sát nghĩa hơn' : 'Cặp ngôn ngữ phổ biến: mô hình nhỏ dịch nhanh và đủ tốt';
  const go = async (k) => {
    await setPref('lyrics.trModel', k);
    lib.translateLyrics(t).then(() => onDone?.(), e => { toast(e.message || 'Không dịch được', 'warn'); onDone?.(e); });
  };
  menu(anchor, [
    { icon: 'star', label: `Gợi ý cho bài này: ${recK === 'best' ? 'Dịch chính xác' : 'Dịch nhanh'}`, desc: why, act: () => go(recK) },
    '-',
    { icon: 'translate', label: 'Dịch nhanh', desc: `Mô hình nhỏ ≈ 80 MB, tải nhanh (đích: ${lang})`, on: cur === 'fast', act: () => go('fast') },
    { icon: 'translate', label: 'Dịch chính xác', desc: 'Mô hình lớn ≈ 600 MB, sát nghĩa hơn, nhất là tiếng Nhật, Hàn, Trung', on: cur === 'best', act: () => go('best') },
  ], { title: 'Dịch lời bằng AI' });
}

// → { gen, words, tr }: each null (not used) or { desc } describing what was used, for a menu row with a tick.
export async function aiMarks(t) {
  const row = t?.id ? await db.lyrics.get(t.id) : null;
  const ai = await import('../lib/lyrics-ai.js');
  const when = (at) => (at ? ' · ' + new Date(at).toLocaleDateString('vi-VN') : '');
  const vo = (x) => (x.vocal ? ' · có tách giọng' : '');
  return {
    any: !!(row?.aiGen || row?.aiWords || row?.trInfo),
    gen: row?.aiGen ? { desc: `Đã tạo lời bằng ${ai.modelName(row.aiGen.model)}${vo(row.aiGen)}${when(row.aiGen.at)}` } : null,
    words: row?.aiWords ? { desc: `Đã đồng bộ bằng ${ai.modelName(row.aiWords.model)} · khớp ${row.aiWords.matched}/${row.aiWords.total} chữ${vo(row.aiWords)}${when(row.aiWords.at)}` } : null,
    tr: row?.trInfo ? { desc: `Đã dịch bằng ${row.trInfo.name} · ${row.trInfo.src} → ${row.trInfo.tgt}${when(row.trInfo.at)}` } : null,
  };
}

// Puts the lyrics back as they were before any AI work: word timing removed (the saved original is restored,
// or the words are folded back to line timing), the AI translation dropped, AI-made lyrics deleted.
export async function aiReset(t, onDone) {
  const row = t?.id ? await db.lyrics.get(t.id) : null;
  if (!row) return;
  const ok = await confirmBox('Đặt lại lời', row.aiGen && !row.aiOrig ? 'Lời do AI tạo cho bài này sẽ bị xoá.' : 'Bỏ đồng bộ từng chữ và bản dịch do AI, đưa lời về như trước khi dùng AI?', 'Đặt lại', 'danger');
  if (!ok) return;
  if (row.aiGen && !row.aiOrig) await saveLyrics(t, { text: '' });
  else {
    const patch = { aiWords: null, aiGen: null, aiOrig: null };
    if (row.aiOrig?.text) { patch.text = row.aiOrig.text; patch.source = row.aiOrig.source; }
    else if (row.aiWords) patch.text = toLrc(toModel(parseLyrics(row.text, t.duration || 0)), { words: false, tr: false });
    if (row.trInfo || row.trSource === 'ai') Object.assign(patch, { trText: null, trSource: null, trInfo: null, trLang: null });
    await saveLyrics(t, patch);
  }
  toast('Đã đặt lại lời về như ban đầu');
  onDone?.();
}
