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
import { prefs } from './prefs.js';
import { saveLyrics, loadLyrics } from './lyrics-sources.js';
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
export const autoOn = () => Y().aiAuto !== 0;
const modelKey = () => (AI_MODELS[Y().aiModel] ? Y().aiModel : 'base');

let asr = null, asrKey = '';
async function recognizer(task) {
  const key = modelKey();
  if (asr && asrKey === key) return asr;
  const T = await import(LIB);
  T.env.allowLocalModels = false;
  const files = new Map();
  asr = await T.pipeline('automatic-speech-recognition', AI_MODELS[key].id, {
    device: 'wasm', dtype: 'q8',
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, [p.loaded || 0, p.total]);
      let done = 0, total = 0;
      for (const [a, b] of files.values()) { done += a; total += b; }
      task.update({ done, total, unit: 'bytes', detail: `Đang tải mô hình nhận dạng giọng hát (${AI_MODELS[key].label}, chỉ lần đầu)…` });
    },
  });
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
      if (player.track?.id !== t.id || !player.playing || running.size) return;
      if ((await getSetting(MISS, {}))?.[t.id]) return;
      if (await loadLyrics(t, { allowOnline: !!Y().online })) return;
      generate(t).catch(() => {});
    }, 4000);
  });
  bus.on('music:prefs', (p) => { if (String(p?.path).startsWith('lyrics.ai')) if (asrKey !== modelKey()) asr = null; });
}
