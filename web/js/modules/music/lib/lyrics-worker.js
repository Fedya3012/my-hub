// Whisper (transformers.js + ONNX Runtime wasm) in a Web Worker, so listening and the UI never wait for the
// model: lyrics-ai.js sends 28-second pieces of audio and gets the text back. The library and the models ship
// with the app (web/vendor/transformers, web/vendor/whisper = Base); the other models come from Hugging Face once.
//   load { lib, local, wasm, mid, tries }  → { ok } (progress messages { progress } while it loads)
//   run  { audio, opts }                   → { result }
let T = null, asr = null;
const out = (msg) => postMessage(msg);

// A model file bigger than GitHub's 100 MB limit is stored as "<file>.parts.json" ({ size, parts: [...] }) next to
// its pieces; this cache answers the library's lookup for the whole file by joining the pieces. Everything else
// goes to the browser cache, except files that already ship with the app (they would only be stored twice).
const BROWSER = 'transformers-cache';
const ours = (url) => url.startsWith(location.origin);
const customCache = {
  async match(key) {
    const url = typeof key === 'string' ? key : key.url;
    if (ours(url) && url.endsWith('.onnx')) {
      const m = await fetch(url + '.parts.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (m?.parts?.length) {
        const blobs = [];
        for (const p of m.parts) {
          const r = await fetch(new URL(p, url));
          if (!r.ok) throw new Error('Thiếu một phần của mô hình: ' + p);
          blobs.push(await r.blob());
        }
        const whole = new Blob(blobs);
        if (m.size && whole.size !== m.size) throw new Error('Mô hình bị thiếu dữ liệu: ' + url);
        return new Response(whole, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(whole.size) } });
      }
    }
    return (await caches.open(BROWSER)).match(key);
  },
  async put(key, response) {
    const url = typeof key === 'string' ? key : key.url;
    if (ours(url)) return;
    try { await (await caches.open(BROWSER)).put(key, response); } catch { /* storage full or blocked: loads again next time */ }
  },
};

async function load({ lib, local, wasm, mid, tries, remote }) {
  T ||= await import(lib);
  T.env.allowLocalModels = !remote;   // models that ship with the app are read from the app; the big one only from Hugging Face
  T.env.localModelPath = local;
  T.env.useCustomCache = true;
  T.env.customCache = customCache;
  T.env.useWasmCache = false;
  const wa = T.env.backends?.onnx?.wasm;
  if (wa) { wa.proxy = false; wa.numThreads = 1; wa.wasmPaths = wasm; }   // already off the page's thread: no nested worker
  const progress_callback = (p) => { if (p.status === 'progress' && p.total) out({ progress: { file: p.file, loaded: p.loaded || 0, total: p.total } }); };
  const errs = [];
  for (const opt of tries) {
    try { asr = await T.pipeline('automatic-speech-recognition', mid, { device: 'wasm', progress_callback, ...opt }); return { errs }; }
    catch (e) { asr = null; errs.push(String(e?.message || e).split('\n')[0].slice(0, 160)); }
  }
  const err = new Error('load failed'); err.errs = errs; throw err;
}

onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'load') out({ id, ...(await load(e.data)) });
    else if (type === 'run') {
      if (!asr) throw new Error('Mô hình chưa được nạp');
      out({ id, result: await asr(e.data.audio, e.data.opts) });
    }
  } catch (err) { out({ id, error: String(err?.message || err), errs: err?.errs }); }
};
