// "Dịch lời bằng AI": asks fast or accurate each time, then translates the track's lyrics.
import { menu } from './sheets.js';
import { toast } from '../../../core/ui.js';
import { prefs, setPref } from '../lib/prefs.js';

export async function aiTranslate(t, anchor = null) {
  const lib = await import('../lib/lyrics-translate.js');
  const cur = prefs().lyrics?.trModel || 'fast';
  const lang = lib.TR_LANGS[prefs().lyrics?.trLang] || lib.TR_LANGS.vi;
  const go = async (k) => {
    await setPref('lyrics.trModel', k);
    lib.translateLyrics(t).then(null, e => toast(e.message || 'Không dịch được', 'warn'));
  };
  menu(anchor, [
    { icon: 'translate', label: 'Dịch nhanh', desc: `Mô hình nhỏ ≈ 80 MB, tải nhanh (đích: ${lang})`, on: cur === 'fast', act: () => go('fast') },
    { icon: 'translate', label: 'Dịch chính xác', desc: 'Mô hình lớn ≈ 600 MB, sát nghĩa hơn, nhất là tiếng Nhật, Hàn, Trung', on: cur === 'best', act: () => go('best') },
  ], { title: 'Dịch lời bằng AI' });
}
