// Lyrics translation made on this device with open translation models from Hugging Face
// (transformers.js + ONNX Runtime in WebAssembly): nothing about the song leaves the device, only the
// model files are downloaded once (the browser keeps them, so later songs work offline).
//  · "Nhanh": a small Opus-MT model for the language pair (≈ 80 MB); pairs it does not have fall back to NLLB.
//  · "Chính xác": NLLB-200 distilled 600M, one model for ~200 languages (≈ 600 MB), handles ja / ko / zh well.
// The result is saved as a translation track (LRC with the same stamps as the lyrics, or plain lines) in
// row.trText with trSource 'ai', so it shows under each line exactly like an imported translation.
import { tasks } from '../../../core/tasks.js';
import { confirmBox } from '../../../core/ui.js';
import { prefs, setPref } from './prefs.js';
import { loadLyrics, saveLyrics } from './lyrics-sources.js';
import { parseLyrics } from './lyrics.js';

export const TR_LANGS = { vi: 'Tiếng Việt', en: 'Tiếng Anh', ja: 'Tiếng Nhật', ko: 'Tiếng Hàn', zh: 'Tiếng Trung', fr: 'Tiếng Pháp', es: 'Tiếng Tây Ban Nha', de: 'Tiếng Đức' };
export const TR_MODELS = { fast: { label: 'Nhanh', size: '≈ 80 MB' }, best: { label: 'Chính xác', size: '≈ 600 MB' } };
const NLLB = { id: 'Xenova/nllb-200-distilled-600M', code: { vi: 'vie_Latn', en: 'eng_Latn', ja: 'jpn_Jpan', ko: 'kor_Hang', zh: 'zho_Hans', fr: 'fra_Latn', es: 'spa_Latn', de: 'deu_Latn' } };

const Y = () => prefs().lyrics || {};
const modelKey = () => (TR_MODELS[Y().trModel] ? Y().trModel : 'fast');
const targetLang = () => (TR_LANGS[Y().trLang] ? Y().trLang : 'vi');

// Which language the lyrics are in, from the writing system (and Vietnamese diacritics); Latin text is
// taken as English unless the person picked another language in the AI language setting.
export function detectLang(text) {
  const n = (re) => (text.match(re) || []).length;
  const k = { ko: n(/[가-힯]/g), ja: n(/[぀-ヿ]/g), zh: n(/[一-鿿]/g), vi: n(/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/gi) };
  if (k.ko > 1) return 'ko';
  if (k.ja > 1) return 'ja';
  if (k.zh > 1) return 'zh';
  if (k.vi > 3) return 'vi';
  return /[a-z]/i.test(text) ? (TR_LANGS[Y().aiLang] ? Y().aiLang : 'en') : 'en';
}

// The model runs in translate-worker.js: the page sends a few lines at a time and receives the translations.
const LIB = new URL('../../../../vendor/transformers/transformers.min.js', import.meta.url).href;
let worker = null, seq = 0, onLoadProgress = null, loadedId = '';
const waits = new Map();
function startWorker() {
  const w = new Worker(new URL('./translate-worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (e) => {
    if (e.data.progress) { onLoadProgress?.(e.data.progress); return; }
    const x = waits.get(e.data.id);
    if (!x) return;
    waits.delete(e.data.id);
    if (e.data.error) x.rej(Object.assign(new Error(e.data.error), { errs: e.data.errs })); else x.res(e.data);
  };
  w.onerror = (e) => {
    for (const x of waits.values()) x.rej(new Error('Không chạy được tiến trình dịch lời' + (e.message ? ': ' + e.message : '')));
    waits.clear(); w.terminate(); worker = null; loadedId = '';
  };
  return w;
}
function callWorker(msg) {
  worker ||= startWorker();
  return new Promise((res, rej) => { const id = ++seq; waits.set(id, { res, rej }); worker.postMessage({ id, ...msg }); });
}
// Loads a model into the worker (once); the first error of every way tried is reported when all of them fail.
async function loadModel(mid, task, label) {
  if (loadedId === mid) return;
  const files = new Map();
  onLoadProgress = (p) => {
    files.set(p.file, [p.loaded, p.total]);
    let done = 0, total = 0;
    for (const [a, b] of files.values()) { done += a; total += b; }
    task.update({ done, total, unit: 'bytes', detail: `Đang tải mô hình dịch (${label}, chỉ lần đầu)…` });
  };
  const tries = [{}, { dtype: 'fp32' }, { dtype: 'q8', session_options: { graphOptimizationLevel: 'disabled' } }];
  try { await callWorker({ type: 'load', lib: LIB, wasm: LIB.slice(0, LIB.lastIndexOf('/') + 1), mid, tries }); loadedId = mid; }
  catch (e) { throw new Error(`Không nạp được mô hình dịch ${mid.split('/')[1]}${e.errs?.length ? ' — ' + e.errs[0] : ''}`); }
  finally { onLoadProgress = null; }
}

const fmt = (s) => { const m = Math.floor(s / 60), r = s - m * 60; return `[${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}]`; };
const running = new Map();
export const isTranslating = (id) => running.has(id);

export async function ensureConsent() {
  if (Y().trConsent === 1) return true;
  const ok = await confirmBox('Dịch lời bằng AI', 'Mô hình dịch mã nguồn mở từ huggingface.co sẽ được tải về một lần (“Nhanh” ≈ 80 MB, “Chính xác” ≈ 600 MB) và chạy ngay trên máy; lời bài hát không rời khỏi máy. Tiếp tục?', 'Dịch', 'primary');
  if (ok) await setPref('lyrics.trConsent', 1);
  return !!ok;
}

export function translateLyrics(t) {
  if (running.has(t.id)) return running.get(t.id);
  const job = (async () => {
    const row = await loadLyrics(t, { allowOnline: false });
    if (!row?.text?.trim()) throw new Error('Bài này chưa có lời để dịch');
    if (!(await ensureConsent())) return null;
    const task = tasks.start({ label: `Đang dịch lời: ${t.title || 'bài hát'}`, cancellable: true, delay: 300 });
    try {
      const parsed = parseLyrics(row.text, t.duration);
      const lines = parsed.lines.filter(l => l.text);
      if (!lines.length) throw new Error('Bài này chưa có lời để dịch');
      const src = detectLang(lines.map(l => l.text).join('\n')), tgt = targetLang();
      if (src === tgt) { task.finish(`Lời đã bằng ${TR_LANGS[tgt].toLowerCase()}, không cần dịch`); return null; }
      const mk = modelKey();
      let nllb = mk === 'best';
      if (!nllb) {
        try { await loadModel(`Xenova/opus-mt-${src}-${tgt}`, task, TR_MODELS.fast.label); }
        catch (e) { nllb = true; console.warn('[lyrics-translate]', e.message); }   // no Opus-MT model for this pair
      }
      if (nllb) await loadModel(NLLB.id, task, TR_MODELS.best.label);
      const opts = nllb ? { src_lang: NLLB.code[src], tgt_lang: NLLB.code[tgt], max_new_tokens: 160 } : { max_new_tokens: 160 };
      const out = [];
      for (let i = 0; i < lines.length; i += 6) {
        if (task.cancelled) return null;
        const batch = lines.slice(i, i + 6).map(l => l.text);
        const r = (await callWorker({ type: 'run', texts: batch, opts })).result;
        (Array.isArray(r) ? r : [r]).forEach((x, j) => out.push((Array.isArray(x) ? x[0] : x)?.translation_text?.trim() || batch[j]));
        task.update({ done: Math.min(i + 6, lines.length), total: lines.length, unit: 'items', detail: 'Đang dịch từng dòng…' });
        await new Promise(r => setTimeout(r, 0));
      }
      const trText = parsed.synced ? lines.map((l, i) => fmt(l.t) + out[i]).join('\n') : out.join('\n');
      await saveLyrics(t, { trText, trSource: 'ai', trLang: tgt });
      await setPref('lyrics.tr', 1);
      task.finish(`Đã dịch lời “${t.title || 'bài hát'}” sang ${TR_LANGS[tgt].toLowerCase()}`);
      return trText;
    } catch (e) {
      if (task.cancelled || e?.name === 'AbortError') return null;
      task.fail(e); throw e;
    }
  })().finally(() => running.delete(t.id));
  running.set(t.id, job);
  return job;
}
