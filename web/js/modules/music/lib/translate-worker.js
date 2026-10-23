// Translation models (transformers.js + ONNX Runtime wasm) in a Web Worker, so the UI and the music never wait.
// The library ships with the app (web/vendor/transformers); the model files come from huggingface.co once and
// stay in the browser cache.
//   load { lib, wasm, mid, tries } → { ok } (progress messages { progress } while it loads)
//   run  { texts, opts }           → { result }
let T = null, tr = null, curId = '';
const out = (msg) => postMessage(msg);

async function load({ lib, wasm, mid, tries }) {
  if (tr && curId === mid) return { errs: [] };
  T ||= await import(lib);
  T.env.allowLocalModels = false;
  T.env.useBrowserCache = true;
  T.env.useWasmCache = false;
  const wa = T.env.backends?.onnx?.wasm;
  if (wa) { wa.proxy = false; wa.numThreads = 1; wa.wasmPaths = wasm; }
  const progress_callback = (p) => { if (p.status === 'progress' && p.total) out({ progress: { file: p.file, loaded: p.loaded || 0, total: p.total } }); };
  const errs = [];
  for (const opt of tries) {
    try { tr = await T.pipeline('translation', mid, { device: 'wasm', progress_callback, ...opt }); curId = mid; return { errs }; }
    catch (e) { tr = null; errs.push(String(e?.message || e).split('\n')[0].slice(0, 160)); }
  }
  const err = new Error('load failed'); err.errs = errs; throw err;
}

onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'load') out({ id, ...(await load(e.data)) });
    else if (type === 'run') {
      if (!tr) throw new Error('Mô hình dịch chưa được nạp');
      out({ id, result: await tr(e.data.texts, e.data.opts) });
    }
  } catch (err) { out({ id, error: String(err?.message || err), errs: err?.errs }); }
};
