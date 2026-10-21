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
export async function pdfToTextBook(blob, { title, author, onProgress } = {}) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const chapters = [];
  let paras = [], line = '', lastY = null, start = 1;
  const flushPara = () => { if (line.trim()) paras.push(line.trim()); line = ''; };
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    for (const it of c.items) {
      const y = it.transform?.[5];
      if (lastY != null && Math.abs(y - lastY) > (it.height || 10) * 1.8) flushPara();
      line = line.endsWith('-') ? line.slice(0, -1) + it.str : line + (line && !line.endsWith(' ') && it.str && !it.str.startsWith(' ') && lastY != null && Math.abs(y - lastY) > 1 ? ' ' : '') + it.str;
      lastY = y;
    }
    flushPara(); lastY = null;
    if (i % 10 === 0 || i === doc.numPages) { chapters.push({ title: `Trang ${start}–${i}`, html: paras.map(p => `<p>${esc(p)}</p>`).join('') }); paras = []; start = i + 1; }
    onProgress?.(i / doc.numPages);
  }
  doc.destroy();
  const { makeTextBook } = await import('./text-book.js');
  return makeTextBook({ title, author, chapters });
}
