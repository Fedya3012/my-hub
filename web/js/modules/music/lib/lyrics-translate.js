// Lyrics translation made on this device with open translation models from Hugging Face
// (transformers.js + ONNX Runtime in WebAssembly): nothing about the song leaves the device, only the
// model files are downloaded once (the browser keeps them, so later songs work offline).
//  · "Nhanh": NLLB-200 distilled 600M (≈ 600 MB), a dedicated translation model for ~200 languages, line by line.
//  · "Chính xác": Qwen2.5 1.5B Instruct (≈ 1 GB), a chat model that reads the song in blocks of lines, so it keeps the
//    meaning across lines and copes with lyrics that mix languages; slower.
// The result is saved as a translation track (LRC with the same stamps as the lyrics, or plain lines) in
// row.trText with trSource 'ai', so it shows under each line exactly like an imported translation.
import { tasks } from '../../../core/tasks.js';
import { confirmBox } from '../../../core/ui.js';
import { prefs, setPref } from './prefs.js';
import { loadLyrics, saveLyrics } from './lyrics-sources.js';
import { parseLyrics } from './lyrics.js';

export const TR_LANGS = { vi: 'Tiếng Việt', en: 'Tiếng Anh', ja: 'Tiếng Nhật', ko: 'Tiếng Hàn', zh: 'Tiếng Trung', fr: 'Tiếng Pháp', es: 'Tiếng Tây Ban Nha', de: 'Tiếng Đức' };
export const TR_MODELS = { fast: { label: 'Nhanh', size: '≈ 600 MB' }, best: { label: 'Chính xác', size: '≈ 1 GB' } };
const LLM = 'onnx-community/Qwen2.5-1.5B-Instruct';
const NLLB = { id: 'Xenova/nllb-200-distilled-600M', code: { vi: 'vie_Latn', en: 'eng_Latn', ja: 'jpn_Jpan', ko: 'kor_Hang', zh: 'zho_Hans', fr: 'fra_Latn', es: 'spa_Latn', de: 'deu_Latn', el: 'ell_Grek', ru: 'rus_Cyrl', th: 'tha_Thai', ar: 'arb_Arab', he: 'heb_Hebr', hi: 'hin_Deva' } };
// The script of one line tells its language when it is not Latin (lyrics often mix languages).
const SCRIPT = [[/[\u0370-\u03FF]/, 'el'], [/[\u0400-\u04FF]/, 'ru'], [/[\u0E00-\u0E7F]/, 'th'], [/[\u0600-\u06FF]/, 'ar'], [/[\u0590-\u05FF]/, 'he'], [/[\u0900-\u097F]/, 'hi'], [/[\uAC00-\uD7AF]/, 'ko'], [/[\u3040-\u30FF]/, 'ja'], [/[\u4E00-\u9FFF]/, 'zh']];
const lineLang = (text, dflt) => SCRIPT.find(([re]) => re.test(text))?.[1] || dflt;

const Y = () => prefs().lyrics || {};
const modelKey = () => (TR_MODELS[Y().trModel] ? Y().trModel : 'fast');
const LANG_EN = { vi: 'Vietnamese', en: 'English', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', fr: 'French', es: 'Spanish', de: 'German' };
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
async function loadModel(mid, task, label, { pipeline = 'translation', tries } = {}) {
  if (loadedId === mid) return;
  const files = new Map();
  onLoadProgress = (p) => {
    files.set(p.file, [p.loaded, p.total]);
    let done = 0, total = 0;
    for (const [a, b] of files.values()) { done += a; total += b; }
    task.update({ done, total, unit: 'bytes', detail: `Đang tải mô hình dịch (${label}, chỉ lần đầu)…` });
  };
  tries ||= [{}, { dtype: 'fp32' }, { dtype: 'q8', session_options: { graphOptimizationLevel: 'disabled' } }];
  try { await callWorker({ type: 'load', lib: LIB, wasm: LIB.slice(0, LIB.lastIndexOf('/') + 1), mid, tries, task: pipeline }); loadedId = mid; }
  catch (e) { throw new Error(`Không nạp được mô hình dịch ${mid.split('/')[1]}${e.errs?.length ? ' — ' + e.errs[0] : ''}`); }
  finally { onLoadProgress = null; }
}

// A seq2seq model that loops ("tu tu tu…") or runs on far past the line is retried with stricter decoding.
const looping = (out, src) => {
  const w = out.toLowerCase().split(/\s+/).filter(Boolean);
  if (w.length > 6 && new Set(w).size / w.length < 0.45) return true;
  for (let i = 0; i + 6 <= w.length; i++) { const g = w.slice(i, i + 3).join(' '); if (w.join(' ').split(g).length > 3) return true; }
  return out.length > src.length * 3 + 24;
};
const clean = (x) => String(x || '').replace(/\s+/g, ' ').trim();

async function nllbLines(texts, src, tgt, task) {
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    if (task.cancelled) return null;
    const text = texts[i], max = Math.min(96, Math.max(20, Math.ceil(text.length * 1.3)));
    const go = async (extra) => clean(((await callWorker({ type: 'run', texts: [text], opts: { src_lang: NLLB.code[lineLang(text, src)], tgt_lang: NLLB.code[tgt], max_new_tokens: max, ...extra } })).result?.[0] || {}).translation_text);
    let r = await go({ num_beams: 3, repetition_penalty: 1.2, no_repeat_ngram_size: 3 });
    if (!r || looping(r, text)) r = (await go({ num_beams: 1, repetition_penalty: 1.6, no_repeat_ngram_size: 2, max_new_tokens: Math.ceil(max / 2) })) || text;
    out.push(r);
    task.update({ done: i + 1, total: texts.length, unit: 'items', detail: 'Đang dịch từng dòng…' });
    if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
  }
  return out;
}

// The chat model gets 8 numbered lines at a time (plus the last lines already done, for context) and returns the same numbering.
async function llmLines(texts, tgt, task, title) {
  const out = [], N = 8;
  for (let i = 0; i < texts.length; i += N) {
    if (task.cancelled) return null;
    const chunk = texts.slice(i, i + N), prev = out.slice(-3);
    const messages = [
      { role: 'system', content: `You are a professional song-lyrics translator. Translate each numbered lyric line into ${LANG_EN[tgt]}. The lines may mix languages; translate every line. Keep the meaning, feeling and a natural, singable tone; do not explain; do not merge or split lines; keep proper names. Answer only with the same numbered lines, like "1. ...".` },
      { role: 'user', content: `${title ? `Song: ${title}\n` : ''}${prev.length ? `Previous lines (already translated, for context only): ${prev.join(' / ')}\n` : ''}Lyrics:\n${chunk.map((l, k) => `${k + 1}. ${l}`).join('\n')}` },
    ];
    const res = (await callWorker({ type: 'run', messages, opts: { max_new_tokens: 60 * chunk.length, do_sample: false, repetition_penalty: 1.08 } })).result;
    const txt = res?.[0]?.generated_text;
    const reply = Array.isArray(txt) ? txt.at(-1)?.content : String(txt || '');
    const got = new Map();
    for (const m of String(reply || '').matchAll(/^\s*(\d+)[.)]\s*(.+)$/gm)) got.set(+m[1], clean(m[2]));
    chunk.forEach((l, k) => out.push(got.get(k + 1) || l));
    task.update({ done: Math.min(i + N, texts.length), total: texts.length, unit: 'items', detail: 'Đang dịch theo ngữ cảnh…' });
    await new Promise(r => setTimeout(r, 0));
  }
  return out;
}

const fmt = (s) => { const m = Math.floor(s / 60), r = s - m * 60; return `[${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}]`; };
const running = new Map();
export const isTranslating = (id) => running.has(id);

export async function ensureConsent() {
  if (Y().trConsent === 1) return true;
  const ok = await confirmBox('Dịch lời bằng AI', 'Mô hình dịch mã nguồn mở từ huggingface.co sẽ được tải về một lần (“Nhanh” ≈ 600 MB, “Chính xác” ≈ 1 GB) và chạy ngay trên máy; lời bài hát không rời khỏi máy. Tiếp tục?', 'Dịch', 'primary');
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
      const texts = lines.map(l => l.text);
      let out, name;
      if (modelKey() === 'best') {
        await loadModel(LLM, task, TR_MODELS.best.label, { pipeline: 'text-generation', tries: [{ dtype: 'q4' }, { dtype: 'q4', session_options: { graphOptimizationLevel: 'disabled' } }, { dtype: 'q8' }] });
        out = await llmLines(texts, tgt, task, [t.title, t.artist].filter(Boolean).join(' – '));
        name = 'Qwen2.5 1.5B (Chính xác)';
      } else {
        await loadModel(NLLB.id, task, TR_MODELS.fast.label);
        out = await nllbLines(texts, src, tgt, task);
        name = 'NLLB-200 600M (Nhanh)';
      }
      if (!out) return null;
      const trText = parsed.synced ? lines.map((l, i) => fmt(l.t) + out[i]).join('\n') : out.join('\n');
      await saveLyrics(t, { trText, trSource: 'ai', trLang: tgt, trInfo: { name, src: TR_LANGS[src].replace('Tiếng ', ''), tgt: TR_LANGS[tgt].replace('Tiếng ', ''), at: Date.now() } });
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
