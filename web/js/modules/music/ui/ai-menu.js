// Per-song choice of the AI model (and vocal isolation) for "Tạo lời tự động" and "Tự đồng bộ từng chữ", and the
// marks that show what AI work a song's lyrics already went through.
import { menu } from './sheets.js';
import { openAiPanel, wide } from './ai-panel.js';
import { toast, confirmBox, modal, esc } from '../../../core/ui.js';
import { saveLyrics } from '../lib/lyrics-sources.js';
import { parseLyrics, toModel, toLrc } from '../lib/lyrics.js';
import { db } from '../../../core/db.js';
import { prefs, setPref } from '../lib/prefs.js';
import { aiPref, setAiPref, hasSongPrefs, clearSongPrefs } from '../lib/ai-prefs.js';

// Phones: the first rows of each AI menu choose whether a pick is kept for this song only or for every song.
const scopes = new Map();   // track id → 'song' | 'all' (this session)
const scopeOf = (t) => scopes.get(t.id) || (hasSongPrefs(t) ? 'song' : 'all');
const scopeRows = (t, again) => {
  const sc = scopeOf(t);
  return [
    { icon: 'music', label: 'Chỉ cho bài này', desc: 'Lưu lựa chọn riêng cho bài này, cài đặt chung giữ nguyên', on: sc === 'song', act: () => { scopes.set(t.id, 'song'); again(); } },
    { icon: 'list', label: 'Cho tất cả bài hát', desc: hasSongPrefs(t) ? 'Đổi cài đặt chung (bài này vẫn giữ cài đặt riêng)' : 'Đổi cài đặt chung cho mọi bài', on: sc === 'all', act: () => { scopes.set(t.id, 'all'); again(); } },
    hasSongPrefs(t) && { icon: 'x', label: 'Bỏ cài đặt riêng của bài này', desc: 'Dùng lại cài đặt chung', act: async () => { await clearSongPrefs(t); scopes.set(t.id, 'all'); toast('Bài này dùng lại cài đặt chung'); again(); } },
    '-',
  ];
};

const MODEL_DESC = {
  tiny: 'Rất nhanh, chính xác vừa, tải thêm ≈ 40 MB',
  base: 'Cân bằng, ≈ 80 MB (có sẵn trong app)',
  small: 'Chính xác, nghe rõ tiếng Việt, Nhật, Hàn, tải thêm ≈ 250 MB',
  medium: 'Rất chính xác, nặng vừa, tải thêm ≈ 500 MB',
  large: 'Tốt nhất trong họ Whisper, rất nặng và chậm, tải thêm ≈ 1,1 GB',
  turbo: 'Cao cấp, chính xác nhất, chậm và nặng, tải thêm ≈ 800 MB',
  distil: 'Chỉ tiếng Anh, gần bằng Large v3 mà nhanh hơn nhiều, tải thêm ≈ 750 MB',
};
export async function aiPick(t, kind, { anchor = null, onDone } = {}) {
  if (wide()) return openAiPanel({ t, kind, onDone });
  const ai = await import('../lib/lyrics-ai.js');
  ai.syncCustom();
  const Y = prefs().lyrics || {};
  const tg = scopeOf(t) === 'song' ? t : null;
  const pk = kind === 'gen' ? 'aiGenModel' : 'aiModel', ck = pk === 'aiGenModel' ? (aiPref('aiGenModel', tg) ?? aiPref('aiModel', tg)) : aiPref('aiModel', tg);
  const cur = ai.AI_MODELS[ck] ? ck : 'base';
  const vocal = aiPref('aiVocal', tg) === 1;
  const run = async (model) => {
    await setAiPref(pk, model, tg);
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
    ...scopeRows(t, again),
    { icon: 'lyrics', label: 'Tách giọng hát khỏi nhạc nền', desc: vocal ? 'Đang bật: nghe rõ hơn với bài nhạc nền dày, lâu hơn một chút' : 'Đang tắt: bấm để bật (hiệu quả với bài stereo)', on: vocal, act: async () => { await setAiPref('aiVocal', vocal ? 0 : 1, tg); again(); } },
    '-',
    ...Object.keys(ai.AI_MODELS).filter(k => k !== 'custom').map(k => ({ icon: 'lyrics', label: ai.modelName(k), desc: MODEL_DESC[k], on: k === cur, act: () => run(k) })),
    ai.AI_MODELS.custom && { icon: 'lyrics', label: ai.modelName('custom'), desc: 'Mô hình bạn đã nhập', on: cur === 'custom', act: () => run('custom') },
    { icon: 'plus', label: ai.AI_MODELS.custom ? 'Đổi mô hình tự chọn…' : 'Nhập mô hình khác từ Hugging Face…', desc: 'Ví dụ onnx-community/whisper-medium', act: custom },
  ], { title: kind === 'sync' ? 'Tự đồng bộ từng chữ: chọn mô hình' : 'Tạo lời tự động: chọn mô hình' });
}

export const aiSettings = () => openAiPanel({ kind: 'settings' });

export async function aiTranslate(t, anchor = null, onDone) {
  if (wide()) return openAiPanel({ t, kind: 'translate', onDone });
  const lib = await import('../lib/lyrics-translate.js');
  const tg = scopeOf(t) === 'song' ? t : null;
  const cur = aiPref('trModel', tg) || 'fast';
  const lk = lib.TR_LANGS[aiPref('trLang', tg)] ? aiPref('trLang', tg) : 'vi', lang = lib.TR_LANGS[lk];
  const again = () => aiTranslate(t, anchor, onDone);
  const go = async (k) => {
    await setAiPref('trModel', k, tg);
    lib.translateLyrics(t, { model: k, lang: lk }).then(() => onDone?.(), e => { toast(e.message || 'Không dịch được', 'warn'); onDone?.(e); });
  };
  const pickLang = () => menu(anchor, Object.entries(lib.TR_LANGS).map(([k, v]) => ({ icon: 'translate', label: v, on: k === lk, act: async () => { await setAiPref('trLang', k, tg); again(); } })), { title: 'Dịch sang' });
  menu(anchor, [
    ...scopeRows(t, again),
    { icon: 'translate', label: 'Dịch sang: ' + lang, desc: 'Bấm để đổi ngôn ngữ đích', act: pickLang },
    { icon: 'translate', label: 'Dịch nhanh', desc: `NLLB-200, dịch từng dòng, ≈ 600 MB (đích: ${lang})`, on: cur === 'fast', act: () => go('fast') },
    { icon: 'translate', label: 'Dịch chính xác', desc: 'Qwen2.5 1.5B, đọc cả bài nên sát nghĩa và tự nhiên hơn, chậm hơn, ≈ 1 GB', on: cur === 'best', act: () => go('best') },
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
