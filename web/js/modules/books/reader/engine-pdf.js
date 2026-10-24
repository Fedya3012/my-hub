// Reader engine for PDF (pdf.js): continuous vertical scroll or page-by-page (two pages side by
// side on wide screens), zoom (fit width / fit page / custom), selectable text layer, highlights
// stored as page + normalised rectangles, outline (TOC), search, TTS by page.
// The reflow mode (re-flowed text, adjustable font) is built in reader.js from pdfToTextBook().
// Same interface as engine-foliate.js. Locations: 'pdf:<page>' (1-based).
import { loadPdfjs } from '../lib/formats.js';
import { COLORS } from '../lib/store.js';

export async function open(host, blob, { lastLocation = null, prefs }) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  const n = doc.numPages;
  const wrap = document.createElement('div');
  wrap.className = 'bk-pdf';
  host.append(wrap);
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  let mode = prefs.pdfMode === 'page' ? 'page' : 'scroll', zoom = 'width', scale = 1, cur = 1;
  let relocateFn = () => {}, selectFn = () => {}, annFn = () => {};
  const ann = new Map();   // id -> { page, rects, color, kind }
  const pages = [];        // { el, canvasWrap, rendered, task }
  const rendering = new Set();

  const computeScale = () => {
    const w = wrap.clientWidth - 24, h = wrap.clientHeight - 24;
    const spread = mode === 'page' && w > 1000;
    const fitW = (spread ? w / 2 - 8 : w) / base.width, fitP = Math.min(fitW, h / base.height);
    scale = typeof zoom === 'number' ? zoom : zoom === 'page' ? fitP : Math.min(fitW, 2.5);
    return spread;
  };

  function build() {
    wrap.innerHTML = '';
    pages.length = 0;
    const spread = computeScale();
    wrap.dataset.mode = mode;
    wrap.classList.toggle('spread', spread);
    for (let i = 1; i <= n; i++) {
      const el = document.createElement('div');
      el.className = 'bk-pdf-page';
      el.dataset.page = i;
      el.style.width = Math.floor(base.width * scale) + 'px';
      el.style.height = Math.floor(base.height * scale) + 'px';
      el.innerHTML = `<div class="bk-pdf-c"></div><div class="textLayer"></div><div class="bk-pdf-hl"></div><span class="bk-pdf-n">${i}</span>`;
      wrap.append(el);
      pages.push({ el, rendered: 0 });
    }
    if (mode === 'page') showPage(cur, spread); else observe();
  }

  async function render(i) {
    const p = pages[i - 1];
    if (!p || p.rendered === scale || rendering.has(i)) return;
    rendering.add(i);
    try {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale });
      const dpr = Math.min(2, devicePixelRatio || 1);
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      c.style.width = Math.floor(vp.width) + 'px'; c.style.height = Math.floor(vp.height) + 'px';
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      p.el.querySelector('.bk-pdf-c').replaceChildren(c);
      const tl = p.el.querySelector('.textLayer');
      tl.replaceChildren();
      tl.style.setProperty('--scale-factor', scale);
      await new lib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp }).render();
      p.rendered = scale;
      drawHl(i);
    } catch (e) { console.warn('[pdf] page', i, e); } finally { rendering.delete(i); }
  }

  let io = null, scrollT = 0;
  // Current page in scroll mode = the page that covers the middle of the viewport.
  function track() {
    if (mode !== 'scroll') return;
    const r0 = wrap.getBoundingClientRect(), mid = r0.top + wrap.clientHeight / 2;
    let best = cur;
    for (const p of pages) { const r = p.el.getBoundingClientRect(); if (r.top <= mid && r.bottom >= mid - 12) { best = +p.el.dataset.page; break; } }
    if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 4) best = n;
    if (best !== cur) { cur = best; emit(); }
  }
  wrap.addEventListener('scroll', () => { clearTimeout(scrollT); scrollT = setTimeout(track, 120); }, { passive: true });
  function observe() {
    io?.disconnect();
    io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) render(+e.target.dataset.page);
      track();
    }, { root: wrap, rootMargin: '600px 0px', threshold: [0, 0.5] });
    pages.forEach(p => io.observe(p.el));
    pages[cur - 1]?.el.scrollIntoView({ block: 'start' });
  }

  function showPage(i, spread = wrap.classList.contains('spread')) {
    cur = Math.max(1, Math.min(n, i));
    const shown = spread ? [cur % 2 ? cur : cur - 1, (cur % 2 ? cur : cur - 1) + 1] : [cur];
    pages.forEach((p, k) => { p.el.hidden = !shown.includes(k + 1); });
    shown.forEach(render);
    if (cur < n) render(shown[shown.length - 1] + 1);
    emit();
  }

  const emit = () => relocateFn({ fraction: n > 1 ? (cur - 1) / (n - 1) : 1, loc: 'pdf:' + cur, page: cur, total: n, label: `Trang ${cur} / ${n}`, tocLabel: tocLabelAt(cur) });

  // Highlights: rectangles normalised to the page box (0..1), so they survive zoom changes.
  function drawHl(i) {
    const p = pages[i - 1];
    if (!p) return;
    const box = p.el.querySelector('.bk-pdf-hl');
    box.innerHTML = '';
    for (const [id, a] of ann) if (a.page === i) for (const r of a.rects) {
      const d = document.createElement('i');
      d.className = 'k-' + (a.kind || 'highlight');
      d.dataset.ann = id;
      d.style.cssText = `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%;--hl:${COLORS[a.color] || COLORS.yellow}`;
      d.onclick = () => annFn(id);
      box.append(d);
    }
  }

  const onUp = () => setTimeout(() => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !wrap.contains(sel.anchorNode)) return;
    const pageEl = sel.anchorNode.parentElement?.closest('.bk-pdf-page');
    if (!pageEl) return;
    const range = sel.getRangeAt(0), pr = pageEl.getBoundingClientRect();
    const rects = [...range.getClientRects()].filter(r => r.width > 1).map(r => [(r.left - pr.left) / pr.width, (r.top - pr.top) / pr.height, r.width / pr.width, r.height / pr.height]);
    const page = +pageEl.dataset.page;
    selectFn({ text: sel.toString().trim(), loc: 'pdf:' + page, page, rects, label: `Trang ${page}`, rect: range.getBoundingClientRect(), clear: () => sel.removeAllRanges() });
  }, 10);
  wrap.addEventListener('pointerup', onUp);
  wrap.addEventListener('click', (e) => { if (!getSelection()?.toString()) host.dispatchEvent(new CustomEvent('bk-tap', { detail: { x: e.clientX, y: e.clientY } })); });

  // Outline -> TOC with page numbers.
  const toc = [];
  const tocPages = [];
  try {
    const outline = await doc.getOutline();
    const walk = async (items, out) => {
      for (const it of items || []) {
        let page = null;
        try { const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest; if (dest) page = (await doc.getPageIndex(dest[0])) + 1; } catch { /* no page */ }
        const node = { label: it.title, href: page ? 'pdf:' + page : '', subitems: [] };
        if (page) tocPages.push([page, it.title]);
        out.push(node);
        await walk(it.items, node.subitems);
      }
    };
    await walk(outline, toc);
    tocPages.sort((a, b) => a[0] - b[0]);
  } catch { /* no outline */ }
  // No outline: find the chapter headings from the text (same smart detection as the reflow mode).
  if (!toc.length && n <= 800) for (const [page, title] of await detectHeads(doc)) { toc.push({ label: title, href: 'pdf:' + page, subitems: [] }); tocPages.push([page, title]); }
  function tocLabelAt(p) { let l = ''; for (const [pg, t] of tocPages) { if (pg <= p) l = t; else break; } return l; }

  const textCache = new Map();
  const pageText = async (i) => {
    if (!textCache.has(i)) { const c = await (await doc.getPage(i)).getTextContent(); textCache.set(i, c.items.map(x => x.str + (x.hasEOL ? '\n' : '')).join('').replace(/[ \t]+/g, ' ')); }
    return textCache.get(i);
  };

  const ro = new ResizeObserver(() => { const s = scale; computeScale(); if (Math.abs(s - scale) > 0.01) build(); });
  ro.observe(wrap);
  const startPage = /^pdf:(\d+)/.exec(lastLocation || '')?.[1];
  cur = startPage ? +startPage : 1;
  build();
  let ttsPage = cur;

  return {
    kind: 'pdf', toc, doc,
    goTo(loc) { const p = +(/^pdf:(\d+)/.exec(loc || '')?.[1] || 0); if (!p) return; if (mode === 'page') showPage(p); else { cur = p; pages[p - 1]?.el.scrollIntoView({ block: 'start' }); emit(); } },
    goToFraction(f) { this.goTo('pdf:' + Math.max(1, Math.round(1 + f * (n - 1)))); },
    next() { if (mode === 'page') showPage(cur + (wrap.classList.contains('spread') ? 2 : 1)); else wrap.scrollBy({ top: wrap.clientHeight * 0.9, behavior: 'smooth' }); },
    prev() { if (mode === 'page') showPage(cur - (wrap.classList.contains('spread') ? 2 : 1)); else wrap.scrollBy({ top: -wrap.clientHeight * 0.9, behavior: 'smooth' }); },
    left() { this.prev(); }, right() { this.next(); },
    onRelocate: (fn) => { relocateFn = fn; emit(); }, onSelect: (fn) => { selectFn = fn; }, onAnnotation: (fn) => { annFn = fn; },
    addAnnotation(a) { if (!a.rects?.length) return; ann.set(a.id, { page: a.page || +(/\d+/.exec(a.loc)?.[0]), rects: a.rects, color: a.color, kind: a.kind }); drawHl(ann.get(a.id).page); },
    removeAnnotation(a) { const x = ann.get(a.id); ann.delete(a.id); if (x) drawHl(x.page); },
    async search(query, onHit) {
      const q = query.toLowerCase();
      for (let i = 1; i <= n; i++) {
        const t = await pageText(i), low = t.toLowerCase();
        let at = low.indexOf(q);
        while (at >= 0) { onHit({ loc: 'pdf:' + i, label: `Trang ${i}`, excerpt: { pre: t.slice(Math.max(0, at - 40), at), match: t.slice(at, at + q.length), post: t.slice(at + q.length, at + q.length + 40) } }); at = low.indexOf(q, at + q.length); }
      }
    },
    clearSearch() {},
    applyPrefs(p) { prefs = p; const m = p.pdfMode === 'page' ? 'page' : 'scroll'; if (m !== mode) { mode = m; build(); } },
    zoom(z) { zoom = z === 'in' ? scale * 1.2 : z === 'out' ? scale / 1.2 : z; build(); },
    tts: { async start() { ttsPage = cur; return pageText(ttsPage); }, async next() { if (ttsPage >= n) return null; ttsPage++; return pageText(ttsPage); }, stop() {} },
    pageText,
    destroy() { io?.disconnect(); ro.disconnect(); wrap.removeEventListener('pointerup', onUp); wrap.remove(); doc.destroy(); },
  };
}

// PDF -> chapters of re-flowed text (one chapter per outline entry, or per 10 pages), for the
// reflow mode. Lines are joined into paragraphs; hyphenated line ends are re-joined.
// Chapters are found from the page layout (smart detection, on this device): a line that reads like a heading
// ("Chương 12", "Chapter IV", "Hồi 3", "Phần 2"…) or is set clearly larger than the body text and short.
// With fewer than 2 such headings it falls back to the PDF outline, then to one chapter per 10 pages.
const HEAD_RE = /^\s*(chương|chuong|chapter|chap\.?|hồi|hoi|phần|phan|quyển|quyen|tập|tap|part|book|volume|prologue|epilogue|mở đầu|lời mở đầu|vĩ thanh|ngoại truyện|phiên ngoại)\b[\s.:\-–—]*([0-9]+|[ivxlcdm]+\b)?/i;
// A scanned PDF (manga, comics: pages are pictures, almost no text) as one chapter of page images for a
// volume. Pages are drawn only when the chapter is first shown; null when the PDF has real text.
export async function pdfImagePart(blob) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  let chars = 0;
  for (let i = 1; i <= Math.min(doc.numPages, 6); i++) chars += (await (await doc.getPage(i)).getTextContent()).items.reduce((a, it) => a + it.str.trim().length, 0);
  if (chars / Math.min(doc.numPages, 6) > 80) { doc.destroy(); return null; }
  const pages = doc.numPages;
  return {
    pages,
    async render() {
      const out = [];
      for (let i = 1; i <= pages; i++) {
        const pg = await doc.getPage(i), vp = pg.getViewport({ scale: Math.min(2, 1600 / pg.getViewport({ scale: 1 }).height) });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
        out.push(`<p class="tb-pg"><img src="${URL.createObjectURL(b)}" alt="Trang ${i}"/></p>`);
      }
      return out.join('');
    },
  };
}

// Headings on the first lines of each page: [[page, title]] (only when at least 2 are found).
async function detectHeads(doc) {
  const tops = [], sizes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const items = (await (await doc.getPage(i)).getTextContent()).items.filter(it => it.str.trim());
    for (const it of items) sizes.push(Math.abs(it.transform?.[3] || it.height || 10));
    const lines = [];
    for (const it of items.slice(0, 12)) {
      const y = it.transform?.[5], hgt = Math.abs(it.transform?.[3] || it.height || 10), last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < hgt * 0.5) { last.text += (last.text.endsWith(' ') ? '' : ' ') + it.str; last.size = Math.max(last.size, hgt); }
      else lines.push({ text: it.str, size: hgt, y });
      if (lines.length > 3) break;
    }
    tops.push({ page: i, lines });
  }
  sizes.sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 10, out = [];
  for (const { page, lines } of tops) {
    const l = lines.slice(0, 3).find(l => { const t = l.text.trim(); return t.length <= 90 && (HEAD_RE.test(t) || (l.size >= body * 1.3 && t.length <= 60 && /\p{L}/u.test(t))); });
    if (l) out.push([page, l.text.trim()]);
  }
  return out.length >= 2 ? out : [];
}

export async function pdfToTextBook(blob, { title, author, onProgress } = {}) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const lines = [];   // { text, size, page, first } one per paragraph
  let line = '', size = 0, lastY = null, first = true;
  const flush = (page) => { if (line.trim()) { lines.push({ text: line.trim(), size, page, first }); first = false; } line = ''; size = 0; };
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    first = true;
    for (const it of c.items) {
      const y = it.transform?.[5], hgt = Math.abs(it.transform?.[3] || it.height || 10);
      if (lastY != null && Math.abs(y - lastY) > (it.height || 10) * 1.8) flush(i);
      // A change of font size starts a new paragraph too (a heading over its first line of text).
      if (line && size && it.str.trim() && Math.abs(hgt - size) / size > 0.25) flush(i);
      line = line.endsWith('-') ? line.slice(0, -1) + it.str : line + (line && !line.endsWith(' ') && it.str && !it.str.startsWith(' ') && lastY != null && Math.abs(y - lastY) > 1 ? ' ' : '') + it.str;
      if (it.str.trim()) size = Math.max(size, hgt);
      lastY = y;
    }
    flush(i); lastY = null;
    onProgress?.(i / doc.numPages * 0.9);
  }
  const sizes = lines.map(l => l.size).filter(Boolean).sort((a, b) => a - b), body = sizes[Math.floor(sizes.length / 2)] || 10;
  const isHead = (l) => l.text.length <= 90 && (HEAD_RE.test(l.text) || (l.size >= body * 1.3 && l.text.length <= 60 && /\p{L}/u.test(l.text)));
  let chapters = [];
  const heads = lines.filter(isHead);
  if (heads.length >= 2) {
    let cur = null;
    for (const l of lines) {
      if (isHead(l) && !(cur && !cur.html && cur.title.length < 40)) { cur = { title: l.text, html: '' }; chapters.push(cur); continue; }
      if (isHead(l) && cur && !cur.html) { cur.title += ' · ' + l.text; continue; }   // "Chương 3" + its name on the next line
      if (!cur) { cur = { title: 'Mở đầu', html: '' }; chapters.push(cur); }
      cur.html += `<p>${esc(l.text)}</p>`;
    }
  } else {
    const outline = await doc.getOutline().catch(() => null);
    const marks = [];
    for (const o of outline || []) {
      try { const dest = typeof o.dest === 'string' ? await doc.getDestination(o.dest) : o.dest; if (dest) marks.push({ title: o.title, page: (await doc.getPageIndex(dest[0])) + 1 }); } catch {}
    }
    marks.sort((a, b) => a.page - b.page);
    if (marks.length >= 2) {
      if (marks[0].page > 1) marks.unshift({ title: 'Mở đầu', page: 1 });
      chapters = marks.map((m, k) => ({ title: m.title, html: lines.filter(l => l.page >= m.page && l.page < (marks[k + 1]?.page ?? 1e9)).map(l => `<p>${esc(l.text)}</p>`).join('') }));
    } else {
      for (let a = 1; a <= doc.numPages; a += 10) { const b = Math.min(doc.numPages, a + 9); chapters.push({ title: `Trang ${a}–${b}`, html: lines.filter(l => l.page >= a && l.page <= b).map(l => `<p>${esc(l.text)}</p>`).join(''), pages: true }); }
    }
  }
  doc.destroy();
  onProgress?.(1);
  const { makeTextBook } = await import('./text-book.js');
  const book = makeTextBook({ title, author, chapters });
  book.chaptersFound = !chapters[0]?.pages;
  return book;
}
