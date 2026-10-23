// Lyrics made on this device when a song has none: no saved text, no sidecar file, no tag and nothing on
// LRCLIB. The vocals are transcribed with Whisper (transformers.js + ONNX Runtime in WebAssembly), in
// 28-second pieces so the progress shows and the work can be cancelled between pieces.
// The first use downloads the speech model once (about 80 MB for "Cân bằng"); the browser keeps it, so later
// songs work offline. The result is saved as line-synced lyrics (LRC) with source 'ai': it can be edited,
// re-timed or replaced like any other lyrics. Songs where no singing was heard are remembered and skipped.
import { db, getSetting, setSetting } from '../../../core/db.js';
import { storage } from '../../../core/storage/index.js';
import { tasks } from '../../../core/tasks.js';
import { bus } from '../../../core/bus.js';
import { prefs, setPref } from './prefs.js';
import { confirmBox } from '../../../core/ui.js';
import { saveLyrics, loadLyrics } from './lyrics-sources.js';
import { parseLyrics, toModel, toLrc } from './lyrics.js';
import { mainFile } from './store.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js';
export const AI_MODELS = {
  tiny: { id: 'onnx-community/whisper-tiny', label: 'Nhanh', size: '≈ 40 MB' },
  base: { id: 'onnx-community/whisper-base', label: 'Cân bằng', size: '≈ 80 MB' },
  small: { id: 'onnx-community/whisper-small', label: 'Chính xác', size: '≈ 250 MB' },
};
const RATE = 16000, PIECE = 28;
const MISS = 'music.lyricsAiMiss';

const Y = () => prefs().lyrics || {};
// The speech library (transformers.js, from a CDN) and the model (from Hugging Face) are downloaded and run
// inside the page, so nothing is fetched before the person agrees once (ensureConsent). Automatic mode waits for it.
const consented = () => Y().aiConsent === 1;
export const autoOn = () => Y().aiAuto !== 0 && consented();
export async function ensureConsent() {
  if (consented()) return true;
  const ok = await confirmBox('Tạo lời bằng AI', 'Lần đầu app sẽ tải thư viện nhận dạng giọng hát (từ cdn.jsdelivr.net) và mô hình Whisper (khoảng 80 MB, từ huggingface.co), rồi chạy ngay trên máy. Âm thanh không rời khỏi máy. Tiếp tục?', 'Tải và dùng', 'primary');
  if (ok) await setPref('lyrics.aiConsent', 1);
  return !!ok;
}
const modelKey = () => (AI_MODELS[Y().aiModel] ? Y().aiModel : 'base');

let asr = null, asrKey = '', loading = null;
window.addEventListener('online', () => { modelFailed = ''; });
let modelFailed = '';   // model that could not be loaded: automatic mode stops retrying it on every song (manual still can)
// One model load at a time: two songs asking together share it (and its error) instead of loading twice.
// words: the "_timestamped" export of the same model, which can also give each word its own time.
function recognizer(task, words = false) {
  const key = modelKey() + (words ? ':w' : '');
  if (asr && asrKey === key) return Promise.resolve(asr);
  if (loading?.key === key) return loading.p;
  const p = loadRecognizer(task, key).finally(() => { if (loading?.p === p) loading = null; });
  loading = { key, p };
  return p;
}
async function loadRecognizer(task, key) {
  const [mk, w] = key.split(':'), mid = AI_MODELS[mk].id + (w ? '_timestamped' : '');
  let T;
  try { T = await import(LIB); }
  catch (e) { modelFailed = mk; throw new Error('Không tải được thư viện nhận dạng giọng hát (cần kết nối mạng)'); }
  T.env.allowLocalModels = false;
  // WebView Android không cho import() từ blob: → để ORT nạp .mjs/.wasm trực tiếp từ CDN, một luồng, không proxy worker
  try {
    T.env.useWasmCache = false;
    const wa = T.env.backends?.onnx?.wasm;
    if (wa) {
      wa.proxy = false;
      if (!(navigator.crossOriginIsolated)) wa.numThreads = 1;
      wa.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/';
    }
  } catch {}
  const files = new Map();
  const progress_callback = (p) => {
    if (p.status !== 'progress' || !p.total) return;
    files.set(p.file, [p.loaded || 0, p.total]);
    let done = 0, total = 0;
    for (const [a, b] of files.values()) { done += a; total += b; }
    task.update({ done, total, unit: 'bytes', detail: `Đang tải mô hình nhận dạng giọng hát (${AI_MODELS[mk].label}, chỉ lần đầu)…` });
  };
  // Some ONNX Runtime builds cannot create a session for the 8-bit Whisper decoder ("Can't create a session …
  // TransposeDQWeightsForMatMulNBits … Missing required scale"). The same model is retried with graph
  // optimisations off, then without any quantised file (full precision, a bigger download), then as 4-bit.
  // Whatever the first error says, every way is tried before giving up.
  const FP32 = { encoder_model: 'fp32', decoder_model_merged: 'fp32', decoder_model: 'fp32', decoder_with_past_model: 'fp32' };
  const tries = [
    { dtype: 'q8' },
    { dtype: 'q8', session_options: { graphOptimizationLevel: 'disabled' } },
    { dtype: FP32 },
    { dtype: FP32, session_options: { graphOptimizationLevel: 'disabled' } },
    { dtype: 'q4' },
  ];
  let err = null;
  const errs = [];
  for (const opt of tries) {
    try { asr = await T.pipeline('automatic-speech-recognition', mid, { device: 'wasm', progress_callback, ...opt }); err = null; break; }
    catch (e) { err = e; asr = null; errs.push(String(e?.message || e).split('\n')[0].slice(0, 160)); console.warn('[lyrics-ai] model load failed, trying the next way', opt, e); }
  }
  if (err && errs.length > 1) err = new Error(`Không nạp được mô hình nhận dạng giọng hát (đã thử ${errs.length} cách). Lỗi đầu: ${errs[0]}`);
  if (err) { modelFailed = mk; throw err; }
  modelFailed = '';
  asrKey = key;
  return asr;
}

// The song's audio as 16 kHz mono samples (what Whisper expects).
async function samples(t) {
  let blob = null;
  if (t.id === (await import('./player.js')).player.track?.id) {
    const src = (await import('./player.js')).player.engine?.el?.src;
    if (src?.startsWith('blob:')) blob = await (await fetch(src)).blob();   // already decoded / local
  }
  if (!blob) {
    const row = await mainFile(t.id);
    if (!row) throw new Error('Không tìm thấy tệp nhạc');
    blob = row.locations?.local?.kind === 'url' ? await (await fetch(row.locations.local.ref)).blob() : await storage.open(row);
  }
  return blobSamples(blob);
}
async function blobSamples(blob) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const probe = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try { decoded = await probe.decodeAudioData(await blob.arrayBuffer()); } finally { probe.close?.(); }
  const off = new AC(1, Math.ceil(decoded.duration * RATE), RATE);
  const src = off.createBufferSource();
  src.buffer = decoded; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}

// Whisper often "hears" captions in instrumental parts; those are not lyrics.
const JUNK = /^[\s[(♪*#.…-]*(music|nhạc|instrumental|applause|vỗ tay|♪+|thank(s| you) for watching|subscribe|subtitles? by|phụ đề)[\s\])♪*.…!-]*$/i;
const stamp = (s) => { const m = Math.floor(s / 60), x = s - m * 60; return `[${String(m).padStart(2, '0')}:${x.toFixed(2).padStart(5, '0')}]`; };

// → LRC text, or '' when no singing was heard.
export async function transcribe(t, { task } = {}) {
  const audio = await samples(t);
  const asr = await recognizer(task);
  const n = Math.ceil(audio.length / (PIECE * RATE));
  const lines = [];
  let last = '';
  for (let i = 0; i < n; i++) {
    task?.check();
    task?.update({ done: i, total: n, unit: 'items', detail: `Đang nghe lời hát · ${Math.round(i / n * 100)}%` });
    const piece = audio.subarray(i * PIECE * RATE, Math.min(audio.length, (i + 1) * PIECE * RATE));
    if (piece.length < RATE) continue;
    const out = await asr(piece, { return_timestamps: true, ...(Y().aiLang ? { language: Y().aiLang } : {}), task: 'transcribe' });
    for (const c of out.chunks || [{ timestamp: [0], text: out.text }]) {
      const text = String(c.text || '').replace(/\s+/g, ' ').trim();
      if (!text || JUNK.test(text) || text === last) continue;
      last = text;
      lines.push(stamp(i * PIECE + (c.timestamp?.[0] || 0)) + text);
    }
  }
  return lines.join('\n');
}

const running = new Map();
// Makes and saves lyrics for t, with a progress task. → the saved row, or null (nothing sung / cancelled).
export function generate(t, { quiet = false } = {}) {
  if (running.has(t.id)) return running.get(t.id);
  const job = (async () => {
    if (!(await ensureConsent())) { running.delete(t.id); return null; }
    const task = tasks.start({ label: `Đang tạo lời: ${t.title || 'bài hát'}`, cancellable: true, quiet, delay: quiet ? 0 : 300 });
    try {
      const text = await transcribe(t, { task });
      if (!text) {
        const m = (await getSetting(MISS, {})) || {}; m[t.id] = Date.now(); await setSetting(MISS, m);
        task.finish('Không nghe thấy lời hát trong bài này');
        return null;
      }
      await saveLyrics(t, { text, source: 'ai', offset: 0, updatedAt: Date.now() });
      task.finish(`Đã tạo lời cho “${t.title || 'bài hát'}”`);
      return db.lyrics.get(t.id);
    } catch (e) {
      if (task.cancelled || e?.name === 'AbortError') return null;
      task.fail(e);
      throw e;
    } finally { running.delete(t.id); }
  })();
  running.set(t.id, job);
  return job;
}
export const isGenerating = (id) => running.has(id);

// Automatic mode: a few seconds into a song with no lyrics anywhere (LRCLIB first when that is on),
// make them in the background. One song at a time; a song is not tried again once nothing was heard.
let timer = 0, watching = false;
export function watch(player) {
  if (watching) return;
  watching = true;
  player.addEventListener('track', () => {
    clearTimeout(timer);
    const t = player.track;
    if (!t || !autoOn()) return;
    timer = setTimeout(async () => {
      if (player.track?.id !== t.id || !player.playing || running.size || modelFailed === modelKey() || (!asr && !navigator.onLine)) return;
      if ((await getSetting(MISS, {}))?.[t.id]) return;
      if (await loadLyrics(t, { allowOnline: !!Y().online })) return;
      generate(t).catch(() => {});
    }, 4000);
  });
  bus.on('music:prefs', (p) => { if (String(p?.path).startsWith('lyrics.ai')) if (asrKey.split(':')[0] !== modelKey()) asr = null; });
}

// ── Word sync: give every word of the existing lyrics its own time, from the singing ──────────────
// Whisper hears the words with times; those are matched to the lyric's words (an alignment that tolerates
// misheard, missing and extra words). Matched words take the heard time; the rest are spread between their
// matched neighbours, never before their line's own time when the lyrics are line-synced.
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function sim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length, d = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= n; j++) { const tmp = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return 1 - d[n] / Math.max(m, n);
}
// → for each lyric word, the index of the heard word it matches, or -1 (global alignment).
function align(lyr, heard) {
  const n = lyr.length, m = heard.length, G = -0.4, W = m + 1;
  const S = new Float32Array((n + 1) * W), B = new Uint8Array((n + 1) * W);
  for (let i = 1; i <= n; i++) { S[i * W] = i * G; B[i * W] = 1; }
  for (let j = 1; j <= m; j++) { S[j] = j * G; B[j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const s = sim(lyr[i - 1], heard[j - 1]), ok = s >= 0.5;
    const dg = S[(i - 1) * W + j - 1] + (ok ? s : -0.6), up = S[(i - 1) * W + j] + G, lf = S[i * W + j - 1] + G;
    const k = i * W + j;
    if (dg >= up && dg >= lf) { S[k] = dg; B[k] = ok ? 0 : 3; } else if (up >= lf) { S[k] = up; B[k] = 1; } else { S[k] = lf; B[k] = 2; }
  }
  const out = new Int32Array(n).fill(-1);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const b = B[i * W + j];
    if (b === 0) { out[i - 1] = j - 1; i--; j--; } else if (b === 3) { i--; j--; } else if (b === 1) i--; else j--;
  }
  return out;
}

async function heardWords(t, task) {
  const audio = await samples(t);
  const asr = await recognizer(task, true);
  const n = Math.ceil(audio.length / (PIECE * RATE));
  const out = [];
  for (let i = 0; i < n; i++) {
    task.check();
    task.update({ done: i, total: n, unit: 'items', detail: `Đang nghe từng chữ · ${Math.round(i / n * 100)}%` });
    const piece = audio.subarray(i * PIECE * RATE, Math.min(audio.length, (i + 1) * PIECE * RATE));
    if (piece.length < RATE) continue;
    const r = await asr(piece, { return_timestamps: 'word', ...(Y().aiLang ? { language: Y().aiLang } : {}), task: 'transcribe' });
    for (const c of r.chunks || []) {
      const [a, b] = c.timestamp || [];
      for (const w of String(c.text || '').split(/\s+/).map(norm).filter(Boolean)) if (a != null) out.push({ w, t: i * PIECE + a, end: i * PIECE + (b ?? a + 0.3) });
    }
  }
  return out;
}

// Word-syncs the saved lyrics of t. → { matched, total } after saving, or null (cancelled / too few matched).
export function autoWordSync(t) {
  const key = 'w:' + t.id;
  if (running.has(key)) return running.get(key);
  const job = (async () => {
    if (!(await ensureConsent())) { running.delete(key); return null; }
    const row = await db.lyrics.get(t.id);
    const parsed = row?.text && parseLyrics(row.text, t.duration || 0);
    if (!parsed?.lines.some(l => l.text)) throw new Error('Bài này chưa có lời để đồng bộ');
    const lines = toModel(parsed);
    const task = tasks.start({ label: `Đang đồng bộ từng chữ: ${t.title || 'bài hát'}`, cancellable: true, delay: 300 });
    try {
      const heard = await heardWords(t, task);
      task.update({ detail: 'Đang khớp chữ với lời…' });
      const flat = [];
      lines.forEach((l, li) => {
        l.words = l.text.split(/\s+/).filter(Boolean).map(text => ({ t: null, text }));
        l.words.forEach((w, wi) => flat.push({ li, wi, w: norm(w.text) }));
      });
      const map = align(flat.map(x => x.w), heard.map(x => x.w));
      let matched = 0;
      const T = flat.map((x, k) => (map[k] >= 0 && x.w ? (matched++, { ...heard[map[k]] }) : null));
      if (!flat.length || matched / flat.length < 0.25) {
        task.finish(`Chỉ khớp được ${matched}/${flat.length} chữ, chưa đủ để đồng bộ (giọng hát chưa rõ hoặc lời khác bản thu)`);
        return null;
      }
      const dur = t.duration || heard.at(-1)?.end || 0;
      const lineStart = lines.map(l => l.t);
      // Unmatched words: spread evenly between the matched words around them.
      for (let k = 0; k < flat.length; k++) {
        if (T[k]) continue;
        let a = k - 1; while (a >= 0 && !T[a]) a--;
        let b = k + 1; while (b < flat.length && !T[b]) b++;
        const lo = a >= 0 ? T[a].end : (lineStart[flat[k].li] ?? 0);
        const hi = b < flat.length ? T[b].t : Math.max(lo + 0.5, dur);
        const span = Math.max(0, hi - lo) / (b - a - 1);
        for (let x = a + 1; x < b; x++) T[x] = { t: lo + span * (x - a - 1), end: lo + span * (x - a) };
      }
      // Monotonic, and never before the line's own time.
      let last = 0;
      flat.forEach((x, k) => { const v = Math.max(T[k].t, last, lineStart[x.li] ?? 0); x.t = v; x.end = Math.max(v + 0.05, T[k].end); last = v; });
      lines.forEach((l, li) => {
        const ws = flat.filter(x => x.li === li);
        if (!ws.length) return;
        ws.forEach(x => { l.words[x.wi].t = x.t; });
        if (l.t == null) l.t = ws[0].t;
        l.wend = Math.min(ws.at(-1).end, lines[li + 1]?.t ?? Infinity);
      });
      await saveLyrics(t, { text: toLrc(lines, { words: true, tr: true }), offset: 0, updatedAt: Date.now() });
      task.finish(`Đã đồng bộ từng chữ: khớp ${matched}/${flat.length} chữ`);
      return { matched, total: flat.length };
    } catch (e) {
      if (task.cancelled || e?.name === 'AbortError') return null;
      task.fail(e); throw e;
    } finally { running.delete(key); }
  })();
  running.set(key, job);
  return job;
}

// Speech of any audio (Podcast transcripts): [{ start, end, text }] in seconds. Same model, pieces and progress as the
// lyrics; lang '' lets Whisper detect the language.
export async function transcribeBlob(blob, { task, lang = '' } = {}) {
  task?.update({ detail: 'Đang giải mã âm thanh…' });
  const audio = await blobSamples(blob);
  const asr = await recognizer(task);
  const n = Math.ceil(audio.length / (PIECE * RATE));
  const cues = [];
  for (let i = 0; i < n; i++) {
    task?.check();
    task?.update({ done: i, total: n, unit: 'items', detail: `Đang chép lời · ${Math.round(i / n * 100)}%` });
    const piece = audio.subarray(i * PIECE * RATE, Math.min(audio.length, (i + 1) * PIECE * RATE));
    if (piece.length < RATE / 2) continue;
    const out = await asr(piece, { return_timestamps: true, ...(lang ? { language: lang } : {}), task: 'transcribe' });
    for (const c of out.chunks || [{ timestamp: [0, PIECE], text: out.text }]) {
      const text = String(c.text || '').replace(/\s+/g, ' ').trim();
      if (!text || JUNK.test(text)) continue;
      cues.push({ start: i * PIECE + (c.timestamp?.[0] || 0), end: i * PIECE + (c.timestamp?.[1] ?? PIECE), text, speaker: '' });
    }
  }
  return cues;
}
