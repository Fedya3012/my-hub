// Per-song choice of the AI model (and vocal isolation) for "Tạo lời tự động" and "Tự đồng bộ từng chữ", and the
// marks that show what AI work a song's lyrics already went through.
import { menu } from './sheets.js';
import { toast } from '../../../core/ui.js';
import { db } from '../../../core/db.js';
import { prefs, setPref } from '../lib/prefs.js';

const MODEL_DESC = { tiny: 'Rất nhanh, chính xác vừa, ≈ 40 MB (có sẵn)', base: 'Cân bằng, ≈ 80 MB (có sẵn)', small: 'Chính xác, ≈ 250 MB (có sẵn)', turbo: 'Cao cấp, chính xác nhất, chậm và nặng, tải thêm ≈ 800 MB' };

export async function aiPick(t, kind, { anchor = null, onDone } = {}) {
  const ai = await import('../lib/lyrics-ai.js');
  const Y = prefs().lyrics || {};
  const cur = ai.AI_MODELS[Y.aiModel] ? Y.aiModel : 'base';
  const vocal = Y.aiVocal === 1;
  const run = (model) => {
    const p = kind === 'sync' ? ai.autoWordSync(t, { model, vocal }) : ai.generate(t, { model, vocal });
    p.then(() => onDone?.(), (e) => { toast(e?.message || (kind === 'sync' ? 'Không đồng bộ được' : 'Không tạo được lời'), 'warn'); onDone?.(e); });
  };
  menu(anchor, [
    { icon: 'lyrics', label: 'Tách giọng hát khỏi nhạc nền', desc: vocal ? 'Đang bật: nghe rõ hơn với bài nhạc nền dày, lâu hơn một chút' : 'Đang tắt: bấm để bật (hiệu quả với bài stereo)', on: vocal, act: async () => { await setPref('lyrics.aiVocal', vocal ? 0 : 1); aiPick(t, kind, { anchor, onDone }); } },
    '-',
    ...Object.keys(ai.AI_MODELS).map(k => ({ icon: 'lyrics', label: ai.modelName(k), desc: MODEL_DESC[k], on: k === cur, act: () => run(k) })),
  ], { title: kind === 'sync' ? 'Tự đồng bộ từng chữ: chọn mô hình' : 'Tạo lời tự động: chọn mô hình' });
}

export async function aiTranslate(t, anchor = null, onDone) {
  const lib = await import('../lib/lyrics-translate.js');
  const cur = prefs().lyrics?.trModel || 'fast';
  const lang = lib.TR_LANGS[prefs().lyrics?.trLang] || lib.TR_LANGS.vi;
  const go = async (k) => {
    await setPref('lyrics.trModel', k);
    lib.translateLyrics(t).then(() => onDone?.(), e => { toast(e.message || 'Không dịch được', 'warn'); onDone?.(e); });
  };
  menu(anchor, [
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
    gen: row?.aiGen ? { desc: `Đã tạo lời bằng ${ai.modelName(row.aiGen.model)}${vo(row.aiGen)}${when(row.aiGen.at)}` } : null,
    words: row?.aiWords ? { desc: `Đã đồng bộ bằng ${ai.modelName(row.aiWords.model)} · khớp ${row.aiWords.matched}/${row.aiWords.total} chữ${vo(row.aiWords)}${when(row.aiWords.at)}` } : null,
    tr: row?.trInfo ? { desc: `Đã dịch bằng ${row.trInfo.name} · ${row.trInfo.src} → ${row.trInfo.tgt}${when(row.trInfo.at)}` } : null,
  };
}
