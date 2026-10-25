// Cover OCR: read the title and author off a photo of a book cover (tesseract.js, Vietnamese + English).
// The library (~3 MB) and the Vietnamese language data (~2 MB) download from jsDelivr the first time and the
// browser keeps them. Runs on this device: the photo is not sent anywhere.
const LIB = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading = null;
const load = () => loading ||= new Promise((ok, fail) => {
  if (window.Tesseract) return ok(window.Tesseract);
  const s = document.createElement('script');
  s.src = LIB; s.onload = () => ok(window.Tesseract); s.onerror = () => { loading = null; fail(new Error('Không tải được bộ đọc chữ (cần mạng lần đầu)')); };
  document.head.append(s);
});

// -> { title, author, lines } ; lines sorted top to bottom with their text height.
export async function readCover(image, { onProgress } = {}) {
  const T = await load();
  const worker = await T.createWorker(['vie', 'eng'], 1, { logger: (m) => m.status === 'recognizing text' && onProgress?.(m.progress) });
  try {
    const { data } = await worker.recognize(image);
    const lines = (data.lines || [])
      .map(l => ({ text: l.text.replace(/\s+/g, ' ').trim(), h: l.bbox.y1 - l.bbox.y0, y: l.bbox.y0, conf: l.confidence }))
      .filter(l => l.text.length >= 2 && l.conf > 45 && /\p{L}{2}/u.test(l.text));
    // The title is the biggest lettering (neighbouring lines of the same size join); the author is often a
    // smaller line on its own, or one introduced by "Tác giả".
    const max = Math.max(0, ...lines.map(l => l.h));
    const big = lines.filter(l => l.h >= max * 0.7);
    const title = big.map(l => l.text).join(' ').replace(/[|_~“”"]+/g, '').trim();
    const rest = lines.filter(l => !big.includes(l) && !/nhà xuất bản|nxb|publishing|tái bản|isbn|giá/i.test(l.text));
    const marked = rest.find(l => /tác giả|author/i.test(l.text));
    const author = (marked ? marked.text.replace(/.*(tác giả|author)\s*[:\-]?\s*/i, '') : rest.sort((a, b) => b.h - a.h)[0]?.text || '').trim();
    return { title, author, lines };
  } finally { await worker.terminate(); }
}
