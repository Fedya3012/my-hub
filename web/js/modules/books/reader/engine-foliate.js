// Reader engine on foliate-js: EPUB, MOBI/AZW3/KF8, FB2/FBZ, CBZ (fixed layout) and text books
// (TXT / MD / HTML / PDF reflow, through text-book.js). Locations are EPUB CFIs.
// Common engine interface (also implemented by engine-pdf.js):
//   open(host, source, { lastLocation, prefs }) · toc · goTo(loc) · goToFraction(f) · next() · prev()
//   onRelocate(fn({ fraction, loc, label, page, total, tocLabel, chapterFraction, index }))
//   onSelect(fn({ text, loc, label, rect, clear })) · onAnnotation(fn(loc)) · addAnnotation(a) · removeAnnotation(a)
//   search(query, onHit) · clearSearch() · applyPrefs(p) · tts { start() next() stop() } · destroy()
import { vendor } from '../lib/formats.js';
import { THEMES, FONTS, FONT_CSS } from '../lib/prefs.js';

// Fonts must be declared inside each book page (an iframe): OpenDyslexic ships with the app, the others come from
// Google Fonts on first use (offline the fallback fonts apply).
const OD = (f) => new URL(`../../../../vendor/fonts/opendyslexic/opendyslexic-latin-${f}.woff2`, import.meta.url).href;
const DYSLEXIC = [['400', 'normal'], ['400', 'italic'], ['700', 'normal'], ['700', 'italic']]
  .map(([w, st]) => `@font-face { font-family: 'OpenDyslexic'; font-style: ${st}; font-weight: ${w}; font-display: swap; src: url(${OD(`${w}-${st}`)}) format('woff2'); }`).join('\n');
const fontImport = (k) => (FONT_CSS[k] ? `@import url('https://fonts.googleapis.com/css2?family=${FONT_CSS[k]}&subset=vietnamese&display=swap');` : '');
import { COLORS } from '../lib/store.js';

export function themeColors(p) {
  if (p.theme === 'custom') return { bg: p.customBg, fg: p.customFg, link: p.customFg };
  if (p.theme !== 'auto' && THEMES[p.theme]) return THEMES[p.theme];
  const dark = document.documentElement.dataset.hubBase === 'dark' || (document.documentElement.dataset.hubBase !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? THEMES.night : THEMES.day;
}

function css(p) {
  const t = themeColors(p);
  const font = FONTS[p.font]?.[1];
  return `${fontImport(p.font)}
    @namespace epub "http://www.idpf.org/2007/ops";
    ${p.font === 'dyslexic' ? DYSLEXIC : ''}
    html { color-scheme: ${t.bg === '#ffffff' || /^#[ef]/i.test(t.bg) ? 'light' : 'dark'}; }
    html, body { background: ${t.bg} !important; color: ${t.fg} !important; }
    body * { color: inherit; background-color: transparent; }
    a:link, a:visited { color: ${t.link} !important; }
    html { font-size: ${p.fontSize}px !important; }
    ${font ? `body, p, li, blockquote, dd, div, span { font-family: ${font} !important; }` : ''}
    p, li, blockquote, dd { line-height: ${p.lineHeight} !important; text-align: ${p.justify ? 'justify' : 'start'}; hyphens: ${p.hyphenate ? 'auto' : 'manual'}; -webkit-hyphens: ${p.hyphenate ? 'auto' : 'manual'}; widows: 2; orphans: 2; }
    [align="left"] { text-align: left; } [align="right"] { text-align: right; } [align="center"] { text-align: center; }
    pre { white-space: pre-wrap !important; }
    img, svg { max-width: 100%; height: auto; }
    ${p.theme === 'night' || p.theme === 'black' || p.theme === 'contrast' ? 'img { filter: brightness(.85); }' : ''}
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }`;
}

export async function open(host, source, { lastLocation = null, prefs, rtl = false } = {}) {
  const { makeBook } = await import(vendor('foliate/view.js'));
  const { Overlayer } = await import(vendor('foliate/overlayer.js'));
  const book = typeof source?.sections === 'object' ? source : await makeBook(source);
  if (rtl && book.rendition?.layout === 'pre-paginated') book.dir = 'rtl';
  const view = document.createElement('foliate-view');
  host.append(view);
  await view.open(book);
  const fixed = view.isFixedLayout;
  const ann = new Map();   // cfi -> annotation
  const byIndex = (cfi) => { try { return view.resolveNavigation(cfi)?.index; } catch { return undefined; } };
  let relocateFn = () => {}, selectFn = () => {}, annFn = () => {};
  let lastDetail = null, lastOut = null;

  view.addEventListener('relocate', (e) => {
    const d = e.detail;
    lastDetail = d;
    const total = d.location?.total || 0;
    relocateFn(lastOut = {
      fraction: d.fraction ?? 0, loc: d.cfi, page: d.location ? d.location.current + 1 : null, total,
      label: d.pageItem ? `Trang ${d.pageItem.label}` : total ? `Vị trí ${d.location.current + 1} / ${total}` : `${Math.round((d.fraction || 0) * 100)}%`,
      tocLabel: d.tocItem?.label?.trim() || '', chapterFraction: d.section ? (d.section.current + 1) / (d.section.total || 1) : null, index: d.index ?? null,
    });
  });
  view.addEventListener('create-overlay', (e) => {
    for (const a of ann.values()) if (byIndex(a.loc) === e.detail.index) view.addAnnotation({ value: a.loc, color: a.color, kind: a.kind });
  });
  view.addEventListener('draw-annotation', (e) => {
    const { draw, annotation } = e.detail;
    const a = ann.get(annotation.value);
    const color = COLORS[a?.color] || COLORS.yellow;
    if (a?.kind === 'underline') draw(Overlayer.underline, { color });
    else if (a?.kind === 'search') draw(Overlayer.outline, { color: 'orange' });
    else draw(Overlayer.highlight, { color });
  });
  view.addEventListener('show-annotation', (e) => annFn(e.detail.value, e.detail.range));
  // Footnotes in a popup instead of jumping away.
  const { FootnoteHandler } = await import(vendor('foliate/footnotes.js'));
  const notes = new FootnoteHandler();
  view.addEventListener('link', (e) => { notes.handle(view.book, e)?.catch(() => {}); });
  notes.addEventListener('before-render', (e) => { e.detail.view.renderer?.setStyles?.(css(prefs)); });
  notes.addEventListener('render', (e) => showFootnote(host, e.detail.view));
  // Selection inside each section document.
  view.addEventListener('load', (e) => {
    const { doc, index } = e.detail;
    const fire = () => {
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const text = sel.toString().trim();
      if (!text) return;
      const frame = doc.defaultView.frameElement;
      const fr = frame?.getBoundingClientRect() || { left: 0, top: 0 };
      const r = range.getBoundingClientRect();
      const rect = { left: fr.left + r.left, top: fr.top + r.top, right: fr.left + r.right, bottom: fr.top + r.bottom, width: r.width };
      let cfi = null; try { cfi = view.getCFI(index, range); } catch { /* no cfi */ }
      selectFn({ text, loc: cfi, label: lastDetail?.tocItem?.label?.trim() || '', rect, range, clear: () => sel.removeAllRanges() });
    };
    doc.addEventListener('pointerup', () => setTimeout(fire, 10));
    doc.addEventListener('keyup', (ev) => { if (ev.shiftKey) fire(); });
    doc.addEventListener('keydown', (ev) => host.dispatchEvent(new KeyboardEvent('keydown', { key: ev.key, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, bubbles: true })));
    doc.addEventListener('click', (ev) => { if (!doc.getSelection()?.toString()) host.dispatchEvent(new CustomEvent('bk-tap', { detail: { x: ev.clientX + (doc.defaultView.frameElement?.getBoundingClientRect().left || 0), y: ev.clientY } })); });
  });

  const applyPrefs = (p) => {
    prefs = p;
    const r = view.renderer;
    if (fixed) { r.setAttribute('zoom', p.comicFit || 'fit-page'); return; }
    r.setAttribute('flow', p.flow);
    r.setAttribute('gap', Math.round(p.margin / Math.max(320, host.clientWidth) * 100) + '%');
    r.setAttribute('margin', '44px');
    r.setAttribute('max-inline-size', p.maxWidth + 'px');
    r.setAttribute('max-column-count', p.columns === 'auto' ? '2' : String(p.columns));
    if (p.animated && !matchMedia('(prefers-reduced-motion: reduce)').matches) r.setAttribute('animated', ''); else r.removeAttribute('animated');
    r.setStyles?.(css(p));
  };
  applyPrefs(prefs);
  await view.init({ lastLocation, showTextStart: !lastLocation });

  // TTS: foliate splits the visible section into SSML blocks; we speak their text.
  const ssmlText = (s) => s ? new DOMParser().parseFromString(s, 'application/xml').documentElement.textContent.replace(/\s+/g, ' ').trim() : null;
  const tts = {
    async start() { await view.initTTS('sentence'); return ssmlText(view.tts.start()); },
    async next() {
      let t = ssmlText(view.tts?.next());
      if (t == null) { await view.renderer.nextSection?.(); await view.initTTS('sentence'); t = ssmlText(view.tts.start()); }
      return t;
    },
    stop() {},
  };

  return {
    kind: fixed ? 'fixed' : 'reflow', book, view, toc: book.toc || [], dir: book.dir,
    sectionFractions: () => view.getSectionFractions(),
    goTo: (loc) => view.goTo(loc).catch(() => {}), goToFraction: (f) => view.goToFraction(f),
    next: () => view.next(), prev: () => view.prev(), left: () => view.goLeft(), right: () => view.goRight(),
    onRelocate: (fn) => { relocateFn = fn; if (lastOut) fn(lastOut); }, onSelect: (fn) => { selectFn = fn; }, onAnnotation: (fn) => { annFn = fn; },
    addAnnotation(a) { if (!a.loc || a.kind === 'bookmark' || a.kind === 'note' && !a.text) return; ann.set(a.loc, a); view.addAnnotation({ value: a.loc, color: a.color }).catch?.(() => {}); },
    removeAnnotation(a) { if (!a.loc) return; ann.delete(a.loc); try { view.deleteAnnotation({ value: a.loc }); } catch { /* not drawn */ } },
    annotationAt: (loc) => ann.get(loc),
    async search(query, onHit) {
      for await (const r of view.search({ query, matchCase: false, matchDiacritics: false })) {
        if (r === 'done') break;
        if (r.subitems) for (const s of r.subitems) onHit({ loc: s.cfi, label: r.label || '', excerpt: s.excerpt });
        else if (r.cfi) onHit({ loc: r.cfi, label: r.label || '', excerpt: r.excerpt });
      }
    },
    clearSearch: () => view.clearSearch(),
    applyPrefs, tts,
    // Words before the current location (for WPM): estimated from the fraction and the book size.
    progressWords: (words) => Math.round((lastDetail?.fraction || 0) * words),
    destroy() { try { view.close(); } catch { /* ignore */ } view.remove(); book.destroy?.(); },
  };
}

function showFootnote(host, fnView) {
  host.querySelector('.bk-footnote')?.remove();
  const box = document.createElement('div');
  box.className = 'bk-footnote';
  box.innerHTML = '<button class="icon-btn sm" aria-label="Đóng">×</button>';
  box.append(fnView);
  fnView.style.cssText = 'display:block;height:180px;width:100%';
  host.append(box);
  box.querySelector('button').onclick = () => box.remove();
}
