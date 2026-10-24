// Builds a foliate-js "book" object from plain chapters, so TXT, Markdown, HTML and the PDF reflow
// mode get the same reader as EPUB (pagination, fonts, highlights, search, TTS).
//   makeTextBook({ title, author, language, chapters: [{ title, html }] })
//   bookFromText(file) -> parses TXT / MD / HTML into chapters (chapter headings detected).
const XHTML = 'application/xhtml+xml';
const ID = 'data-tb-id';
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, body, lang) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${esc(lang || '')}"><head><title>${esc(title)}</title>
<style>h1,h2{text-align:center;margin:1.2em 0 .8em;line-height:1.25}p{margin:0;text-indent:1.5em}p.nb{text-indent:0}h1+p,h2+p{text-indent:0}img{max-width:100%}pre{white-space:pre-wrap}</style></head>
<body>${body}</body></html>`;

// Valid XHTML from arbitrary HTML (the reader loads sections as XHTML).
function toXhtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // The section is shown in a same-origin iframe that allows scripts (foliate): strip everything that can run code.
  doc.querySelectorAll('script,style,link,iframe,object,embed,form,base,meta').forEach(e => e.remove());
  for (const n of doc.body.querySelectorAll('*')) {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      else if (/^(href|src|xlink:href|action|formaction|srcset)$/i.test(a.name) && !/^(https?:|#|data:image\/|blob:|mailto:)/i.test(a.value.trim())) n.removeAttribute(a.name);
    }
  }
  return new XMLSerializer().serializeToString(doc.body).replace(/^<body[^>]*>|<\/body>$/g, '');
}

export function makeTextBook({ title = '', author = '', language = '', chapters = [] }) {
  const urls = [];
  const sections = chapters.map((ch, index) => {
    const build = (html) => page(ch.title || title, `<section ${ID}="${index}">${ch.title && !ch.images ? `<h2>${esc(ch.title)}</h2>` : ''}${toXhtml(html)}</section>`, language);
    // A chapter with render() (pages drawn from images) is built the first time it is shown.
    if (ch.render) {
      let str = null, url = null;
      const make = async () => { if (str == null) { str = build(await ch.render()); url = URL.createObjectURL(new Blob([str], { type: XHTML })); urls.push(url); } return url; };
      return { id: index, load: make, unload: () => {}, createDocument: async () => { await make(); return new DOMParser().parseFromString(str, XHTML); }, size: (ch.pages || 1) * 4000, linear: 'yes' };
    }
    const str = build(ch.html);
    const blob = new Blob([str], { type: XHTML });
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return { id: index, load: () => url, unload: () => {}, createDocument: () => new DOMParser().parseFromString(str, XHTML), size: blob.size, linear: 'yes' };
  });
  return {
    metadata: { title, author: author ? [author] : [], language },
    rendition: { layout: 'reflowable' },
    dir: 'ltr',
    sections,
    toc: chapters.map((c, i) => ({ label: c.title || `Phần ${i + 1}`, href: String(i) })),
    resolveHref: (href) => { const [a] = String(href).split('#'); return { index: Number(a) || 0, anchor: (doc) => doc.body }; },
    splitTOCHref: (href) => [Number(String(href).split('#')[0]), null],
    getTOCFragment: (doc) => doc.body,
    isExternal: (href) => /^\w+:/i.test(href),
    getCover: () => null,
    destroy: () => urls.forEach(u => URL.revokeObjectURL(u)),
  };
}

// Text with an unknown encoding: UTF-8 first, Windows-1258 (Vietnamese) / 1252 as a fallback.
export async function readText(blob) {
  const buf = await blob.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { try { return new TextDecoder('windows-1258').decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); } }
}

const HEADING = /^\s*((chương|chapter|phần|part|hồi|quyển|tập|book|prologue|epilogue|lời mở đầu|lời kết|mở đầu|vĩ thanh)\b[^\n]{0,80}|[IVXLC]{1,7}\.\s.{0,60}|\d{1,4}\.\s{0,3}[^\n.]{1,60})$/i;

function txtChapters(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chapters = [];
  let cur = { title: '', paras: [] }, para = [];
  const flush = () => { if (para.length) { cur.paras.push(para.join(' ')); para = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (HEADING.test(line) && line.length < 90 && !para.length) {
      flush();
      if (cur.title || cur.paras.length) chapters.push(cur);
      cur = { title: line, paras: [] };
      continue;
    }
    // Hard-wrapped text: join lines; a short line ends a paragraph.
    para.push(line);
    if (line.length < 60 || /[.!?…”"»:]$/.test(line) && raw.length < 75) flush();
  }
  flush();
  if (cur.title || cur.paras.length) chapters.push(cur);
  // Very long single chapter: cut into ~40 KB parts so pages lay out fast.
  const out = [];
  for (const c of chapters) {
    let part = [], size = 0, n = 0;
    for (const p of c.paras) {
      part.push(p); size += p.length;
      if (size > 40000) { out.push({ title: c.title ? `${c.title}${n ? ` (${n + 1})` : ''}` : '', html: part.map(x => `<p>${esc(x)}</p>`).join('') }); part = []; size = 0; n++; }
    }
    if (part.length || !n) out.push({ title: c.title ? `${c.title}${n ? ` (${n + 1})` : ''}` : '', html: part.map(x => `<p>${esc(x)}</p>`).join('') });
  }
  return out.length ? out : [{ title: '', html: '' }];
}

function mdToHtml(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, '$1<i>$2</i>').replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2"/>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return md.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(b => {
    const h = /^(#{1,6})\s+(.*)$/.exec(b.trim());
    if (h) return `<h${Math.min(6, h[1].length + 1)}>${inline(h[2])}</h${Math.min(6, h[1].length + 1)}>`;
    if (/^\s*[-*]\s/.test(b)) return `<ul>${b.split('\n').map(l => `<li>${inline(l.replace(/^\s*[-*]\s/, ''))}</li>`).join('')}</ul>`;
    if (/^>\s?/.test(b)) return `<blockquote>${inline(b.replace(/^>\s?/gm, ''))}</blockquote>`;
    if (/^```/.test(b)) return `<pre>${esc(b.replace(/^```\w*\n?|```$/g, ''))}</pre>`;
    return `<p class="nb">${inline(b).replace(/\n/g, '<br/>')}</p>`;
  }).join('');
}

// Split HTML into chapters at <h1>/<h2>.
function htmlChapters(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.title || '';
  const parts = [];
  let cur = { title: '', nodes: [] };
  for (const n of [...doc.body.childNodes]) {
    if (n.nodeType === 1 && /^H[12]$/.test(n.tagName) && cur.nodes.length) { parts.push(cur); cur = { title: n.textContent.trim(), nodes: [] }; continue; }
    if (n.nodeType === 1 && /^H[12]$/.test(n.tagName)) { cur.title = n.textContent.trim(); continue; }
    cur.nodes.push(n);
  }
  parts.push(cur);
  const ser = (nodes) => nodes.map(n => n.nodeType === 1 ? n.outerHTML : n.nodeType === 3 ? esc(n.textContent) : '').join('');
  return { title, chapters: parts.map(p => ({ title: p.title, html: ser(p.nodes) })) };
}

export async function textChapters(blob, name = '') {
  const text = await readText(blob);
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'html' || ext === 'htm') return htmlChapters(text);
  if (ext === 'md') return htmlChapters(`<body>${mdToHtml(text)}</body>`);
  return { title: '', chapters: txtChapters(text) };
}

export async function bookFromText(blob, { name = '', title = '', author = '' } = {}) {
  const r = await textChapters(blob, name);
  return makeTextBook({ title: title || r.title, author, chapters: r.chapters });
}

// A volume: every part (one chapter file, or a book with chapters of its own) in order, one TOC.
// A part with a single chapter takes the part's title; EPUB-like parts keep their text (not images).
export async function volumeBook({ title, author, parts, open }) {
  const chapters = [];
  for (const p of parts) {
    const file = await open(p);
    if (!file) { chapters.push({ title: p.title, html: '<p>(Không mở được tệp của chương này trên máy này.)</p>' }); continue; }
    let list, found = false;
    if (p.engine === 'pdf') {
      const img = await (await import('./engine-pdf.js')).pdfImagePart(file);
      if (img) { chapters.push({ title: p.title, images: true, pages: img.pages, render: img.render }); continue; }
    }
    if (p.engine === 'text') list = (await textChapters(file, p.name)).chapters;
    else {
      // PDF parts are reflowed to text first (engine-pdf), other formats go through foliate.
      const bk = p.engine === 'pdf' ? await (await import('./engine-pdf.js')).pdfToTextBook(file, { title: p.title })
        : await (await import(p.vendor)).makeBook(file);
      list = [];
      for (const s of bk.sections || []) {
        if (s.linear === 'no') continue;
        const doc = await s.createDocument?.();
        const html = doc?.body ? doc.body.innerHTML : '';
        if (html.replace(/<[^>]+>|\s/g, '')) list.push({ title: '', html });
      }
      found = !!bk.chaptersFound;
      if (found) list.forEach((c, i) => { c.title = bk.toc?.[i]?.label || ''; c.html = c.html.replace(/<h2>[\s\S]*?<\/h2>/, ''); });
      bk.destroy?.();
    }
    if (list.length <= 1 || (p.engine === 'pdf' && !found)) chapters.push({ title: p.title, html: list.map(c => c.html).join('') });
    else list.forEach((c, i) => chapters.push({ title: c.title || `${p.title} (${i + 1})`, html: c.html }));
  }
  return makeTextBook({ title, author, chapters });
}
