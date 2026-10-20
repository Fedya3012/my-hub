// Fallback decoders: formats the browser can't play (DSD, ALAC, AIFF) become a WAV Blob
// via one shared worker. Everything else plays natively.

// Formats we show info for but can't decode yet.
export const UNSUPPORTED = {
  WavPack: 'Trình duyệt chưa giải mã được WavPack. Thông tin tệp vẫn hiển thị đầy đủ.',
  APE: 'Trình duyệt chưa giải mã được Monkey’s Audio (APE). Thông tin tệp vẫn hiển thị đầy đủ.',
  DST: 'DSD nén DST chưa được hỗ trợ. Thông tin tệp vẫn hiển thị đầy đủ.',
  TAK: 'Trình duyệt chưa giải mã được TAK. Thông tin tệp vẫn hiển thị đầy đủ.',
  MQA: 'Phát MQA ở chế độ thường (không giải gấp).',
};

// meta = { container, codec } from the metadata parser; canPlay(mime) -> bool.
// Returns the worker kind, or null when the browser plays it (or we can't help).
export function decoderFor(meta, canPlay = () => false) {
  const container = String(meta?.container || '').toLowerCase();
  const codec = String(meta?.codec || '').toUpperCase();
  if (codec === 'DST') return null;
  if (container === 'dsf') return 'dsf';
  if (container === 'dff' || container === 'dsdiff') return 'dff';
  if (codec === 'ALAC' && ['mp4', 'm4a', 'mov'].includes(container))
    return canPlay('audio/mp4; codecs="alac"') ? null : 'alac';
  if (container === 'aiff' || container === 'aifc' || container === 'aif')
    return canPlay('audio/aiff') || canPlay('audio/x-aiff') ? null : 'aiff';
  return null;
}

let worker = null, seq = 0;
const jobs = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./decode-worker.js', import.meta.url));
  worker.onmessage = ({ data }) => {
    const job = jobs.get(data.id);
    if (!job) return;
    if (data.type === 'progress') return job.onProgress?.(data.value);
    jobs.delete(data.id);
    if (data.type === 'done') {
      const blob = new Blob([data.wav], { type: 'audio/wav' });
      blob.info = data.info;
      job.resolve(blob);
    } else job.reject(new Error(data.message || 'Lỗi giải mã'));
  };
  worker.onerror = e => { // worker died: fail everything queued, start fresh next time
    const err = new Error(e.message || 'Lỗi giải mã');
    for (const job of jobs.values()) job.reject(err);
    jobs.clear();
    worker.terminate();
    worker = null;
  };
  return worker;
}

// Decodes a Blob/File to a WAV Blob (blob.info = { sampleRate, bitDepth, channels, duration }).
// Jobs queue in the worker and run one at a time.
export async function decodeToWav(blob, kind, { onProgress } = {}) {
  const buffer = await blob.arrayBuffer();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, kind, buffer, options: {} }, [buffer]);
  });
}
