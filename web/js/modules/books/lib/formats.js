// Book file formats: detection, which reader engine opens them, and metadata / cover extraction
// at import time (foliate-js parses EPUB, MOBI/AZW3, FB2 and CBZ; pdf.js parses PDF).
const V = new URL('../../../../vendor/', import.meta.url).href;
export const vendor = (p) => V + p;

// engine: 'foliate' | 'pdf' | 'text' | null (imported and tracked, not readable yet: phase 2).
export const FORMATS = {
  epub: { label: 'EPUB', engine: 'foliate' },
  mobi: { label: 'MOBI', engine: 'foliate' },
  azw3: { label: 'AZW3', engine: 'foliate' },
  azw: { label: 'AZW', engine: 'foliate' },
  kf8: { label: 'KF8', engine: 'foliate' },
  prc: { label: 'PRC', engine: 'foliate' },
  fb2: { label: 'FB2', engine: 'foliate' },
  fbz: { label: 'FBZ', engine: 'foliate' },
  cbz: { label: 'CBZ', engine: 'foliate', comic: true },
  pdf: { label: 'PDF', engine: 'pdf' },
  txt: { label: 'TXT', engine: 'text' },
  md: { label: 'Markdown', engine: 'text' },
  html: { label: 'HTML', engine: 'text' },
  htm: { label: 'HTML', engine: 'text' },
  // PHASE 2: CBR/CB7 need an unrar / 7z WebAssembly decoder, DJVU a djvu.js renderer, DOCX a
  // converter (mammoth-like). They import, track and sync already; the reader explains it.
  cbr: { label: 'CBR', engine: null, comic: true, phase2: 'Đọc CBR cần bộ giải nén RAR (giai đoạn 2). Đổi đuôi tệp thành CBZ nếu thật ra là ZIP.' },
  cb7: { label: 'CB7', engine: null, comic: true, phase2: 'Đọc CB7 cần bộ giải nén 7z (giai đoạn 2).' },
  djvu: { label: 'DjVu', engine: null, phase2: 'Trình đọc DjVu sẽ có ở giai đoạn 2.' },
  docx: { label: 'DOCX', engine: null, phase2: 'Đọc DOCX (chuyển sang dạng sách) sẽ có ở giai đoạn 2.' },
  paper: { label: 'Sách giấy', engine: null },
  // Written in Xưởng Viết: no file, the reader asks the 'fanfic' service for the published chapters.
  fanfic: { label: 'Fanfic', engine: 'fanfic' },
};
export const BOOK_EXT = Object.keys(FORMATS).filter(k => k !== 'paper' && k !== 'fanfic');
export const ACCEPT = BOOK_EXT.map(e => '.' + e).join(',') + ',.fb2.zip';

export function formatOf(name = '') {
  const n = name.toLowerCase();
  if (n.endsWith('.fb2.zip')) return 'fbz';
  const ext = n.split('.').pop();
  return FORMATS[ext] && ext !== 'paper' && ext !== 'fanfic' ? ext : '';
}
export const isBookFile = (f) => !!formatOf(f.name);
export const engineOf = (fmt) => FORMATS[fmt]?.engine || null;

// foliate-js decides the type from the file name: give it one with the right extension.
export const asNamedFile = (blob, name) => (blob instanceof File && blob.name === name) ? blob : new File([blob], name, { type: blob.type });

let pdfjs = null;
export async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(vendor('pdfjs/pdf.min.js'));
  pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdfjs/pdf.worker.min.js');
  return pdfjs;
}

const langName = (x) => !x ? '' : typeof x === 'string' ? x : x[Object.keys(x)[0]] || '';
const contributor = (c) => !c ? [] : Array.isArray(c) ? c.flatMap(contributor) : [typeof c === 'string' ? c : langName(c.name)].filter(Boolean);
// Parsed inertly (DOMParser): a detached div's innerHTML still loads images and runs onerror handlers from the book.
const textOf = (html) => (new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '').replace(/\s+\n/g, '\n').trim();

// Read title, authors, series, ISBN, language, description, subjects, pages and the cover image.
// Never throws: a file that cannot be parsed still imports with its file name as the title.
export async function extractMeta(file, { signal } = {}) {
  const fmt = formatOf(file.name);
  const base = { title: file.name.replace(/\.fb2\.zip$/i, '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim(), format: fmt };
  try {
    if (FORMATS[fmt]?.engine === 'foliate') return { ...base, ...(await foliateMeta(file)) };
    if (fmt === 'pdf') return { ...base, ...(await pdfMeta(file, { signal })) };
    if (FORMATS[fmt]?.engine === 'text') {
      const text = await file.text();
      const words = (text.match(/\S+/g) || []).length;
      return { ...base, words, pages: Math.max(1, Math.round(words / 275)) };
    }
  } catch (e) { console.warn('[books] metadata', file.name, e); }
  return base;
}

async function foliateMeta(file) {
  const { makeBook } = await import(vendor('foliate/view.js'));
  const book = await makeBook(file);
  const m = book.metadata || {};
  const out = {};
  const title = langName(m.title);
  if (title) out.title = title;
  const authors = contributor(m.author);
  if (authors.length) out.authors = authors;
  if (m.language) out.language = Array.isArray(m.language) ? m.language[0] : m.language;
  if (m.publisher) out.publisher = contributor(m.publisher).join(', ');
  if (m.published) out.published = String(m.published).slice(0, 10);
  if (m.description) out.description = textOf(m.description);
  const subjects = (Array.isArray(m.subject) ? m.subject : m.subject ? [m.subject] : []).map(s => typeof s === 'string' ? s : langName(s?.name) || s?.code).filter(Boolean);
  if (subjects.length) out.genres = subjects.slice(0, 8);
  const ids = [m.identifier, ...(m.altIdentifier || [])].flat().filter(Boolean).map(String);
  const isbn = ids.map(x => x.replace(/^urn:isbn:/i, '').replace(/[^0-9Xx]/g, '')).find(x => x.length === 13 || x.length === 10);
  if (isbn) out.isbn = isbn;
  const coll = [m.belongsTo?.series, m.belongsTo?.collection].flat().filter(Boolean)[0];
  if (coll) { out.series = langName(coll.name) || ''; if (coll.position != null && coll.position !== '') out.seriesIndex = parseFloat(coll.position); }
  // Size-based page estimate (~2,400 characters of markup a page), refined by the reader later.
  const chars = (book.sections || []).reduce((s, x) => s + (x.size || 0), 0);
  if (/\.cbz$/i.test(file.name)) out.pages = (book.sections || []).length;
  else if (chars) { out.pages = Math.max(1, Math.round(chars / 2400)); out.words = Math.round(chars / 7.5); }
  try { const c = await book.getCover?.(); if (c && c.size) out.coverBlob = c.type ? c : new Blob([c], { type: 'image/jpeg' }); } catch { /* no cover */ }
  book.destroy?.();
  return out;
}

async function pdfMeta(file, { signal } = {}) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const out = { pages: doc.numPages };
  try {
    const { info } = await doc.getMetadata();
    if (info?.Title && info.Title.trim().length > 1) out.title = info.Title.trim();
    if (info?.Author) out.authors = [info.Author.trim()];
    if (info?.Subject) out.description = info.Subject.trim();
  } catch { /* no metadata */ }
  if (!signal?.aborted) out.coverBlob = await renderPdfPage(doc, 1, 360).catch(() => null);
  doc.destroy();
  return out;
}

export async function renderPdfPage(doc, n, width) {
  const page = await doc.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / vp1.width });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
}

// Colour for covers without an image (stable per title).
export function hue(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; }
