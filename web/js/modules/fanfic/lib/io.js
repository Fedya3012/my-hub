// Import and export for Xưởng Viết.
//   Import: TXT, Markdown, HTML (an AO3 "Download → HTML" keeps rating, warnings, fandoms, relationships,
//           characters, tags, summary, notes and chapters). DOCX / EPUB import: phase 2.
//   Export: Markdown, TXT, HTML, EPUB 3 (zip written here, no library), PDF (print dialog).
import { tasks } from '../../../core/tasks.js';
import { toast } from '../../../core/ui.js';
import * as store from './store.js';
import { htmlToMd, txtToMd, mdToHtml, mdToTxt, esc } from './text.js';
import { AUDIENCE, WARNINGS, CATEGORIES, STATUSES } from './vocab.js';

export const ACCEPT = '.txt,.md,.markdown,.html,.htm';
const HEADING = /^\s*(chương|chapter|phần|part|hồi|prologue|epilogue|lời mở đầu|ngoại truyện|phiên ngoại)\b.{0,80}$/i;

async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1258').decode(buf); }
}

export function pickFiles() {
  return new Promise((res) => {
    const i = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: ACCEPT });
    i.onchange = () => res([...i.files]);
    i.click();
  });
}

export async function importFiles(files, ctx, { origin = null } = {}) {
  files = files.filter(f => /\.(txt|md|markdown|html?)$/i.test(f.name));
  if (!files.length) { toast('Chỉ nhập được TXT, Markdown hoặc HTML (DOCX, EPUB sẽ có sau)', 'warn'); return []; }
  const task = tasks.start({ label: 'Nhập truyện vào Xưởng Viết', total: files.length, delay: 300 });
  const ids = [];
  for (const f of files) {
    try {
      const text = await readText(f);
      const data = /\.html?$/i.test(f.name) ? parseHtml(text) : parsePlain(text, /\.(md|markdown)$/i.test(f.name), f.name);
      if (origin) data.origin = origin;
      ids.push(await store.createFanfic(data, { quiet: true }));
    } catch (e) { console.warn('[fanfic import]', f.name, e); toast(`Không nhập được ${f.name}`, 'error'); }
    task.step(1);
  }
  task.finish(`Đã nhập ${ids.length} truyện`);
  store.changed(ids);
  if (ids.length === 1) ctx?.go?.('fanfic/work/' + ids[0]);
  return ids;
}

// TXT / Markdown: split on chapter headings ("# …", "Chương 3", "Chapter 3: …").
export function parsePlain(text, isMd, name = '') {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chapters = [];
  let cur = null, title = name.replace(/\.[^.]+$/, '');
  const titleLine = isMd && lines.findIndex(l => /^#\s+/.test(l));
  const h1count = isMd ? lines.filter(l => /^#\s+/.test(l)).length : 0;
  for (const raw of lines) {
    const isH = isMd ? (h1count > 1 ? /^#\s+/.test(raw) : /^##\s+/.test(raw)) : HEADING.test(raw.trim()) && raw.trim().length < 90;
    if (isMd && h1count === 1 && /^#\s+/.test(raw)) { title = raw.replace(/^#\s+/, '').trim(); continue; }
    if (isH) { cur = { title: raw.replace(/^#+\s+/, '').trim(), body: [] }; chapters.push(cur); continue; }
    if (!cur) { cur = { title: 'Chương 1', body: [] }; chapters.push(cur); }
    cur.body.push(raw);
  }
  void titleLine;
  return {
    title, origin: 'mine', status: 'wip',
    chapters: chapters.map(c => ({ title: c.title, body: isMd ? c.body.join('\n').trim() : txtToMd(c.body.join('\n')) })).filter(c => c.body || c.title),
  };
}

// HTML; recognises AO3 downloads (#preface dl.tags, #chapters).
export function parseHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const dd = (label) => { const dt = [...doc.querySelectorAll('dl.tags dt')].find(x => x.textContent.trim().toLowerCase().startsWith(label)); return dt?.nextElementSibling || null; };
  const list = (label) => { const d = dd(label); return d ? [...d.querySelectorAll('a')].map(a => a.textContent.trim()).filter(Boolean) : []; };
  const isAo3 = !!doc.querySelector('#preface') || /archiveofourown/i.test(html);
  const title = doc.querySelector('#preface h1, h1')?.textContent.trim() || doc.title || 'Truyện nhập';
  const data = { title, origin: isAo3 ? 'saved' : 'mine', status: 'wip' };
  if (isAo3) {
    data.author = [...doc.querySelectorAll('#preface .byline a[rel="author"], .byline a')].map(a => a.textContent.trim()).join(', ');
    const rating = (list('rating')[0] || '').toLowerCase();
    data.audience = rating.startsWith('general') ? 'g' : rating.startsWith('teen') ? 't' : rating.startsWith('mature') ? 'm' : rating.startsWith('explicit') ? 'e' : 'nr';
    const W = { 'no archive warnings apply': 'none', 'creator chose not to use archive warnings': 'choose', 'graphic depictions of violence': 'violence', 'major character death': 'death', 'rape/non-con': 'noncon', underage: 'underage', 'underage sex': 'underage' };
    data.warnings = list('archive warning').map(w => W[w.toLowerCase()]).filter(Boolean);
    const C = { gen: 'gen', 'f/m': 'fm', 'm/m': 'mm', 'f/f': 'ff', multi: 'multi', other: 'other' };
    data.categories = list('categor').map(c => C[c.toLowerCase()]).filter(Boolean);
    data.fandoms = list('fandom');
    data.relationships = list('relationship');
    data.characters = list('character');
    data.tags = list('additional tag');
    data.language = dd('language')?.textContent.trim() || '';
    const stats = dd('stats')?.textContent || '';
    const ch = stats.match(/Chapters:\s*(\d+)\/(\d+|\?)/i);
    if (ch) { data.plannedChapters = ch[2] === '?' ? null : +ch[2]; data.status = ch[2] !== '?' && ch[1] === ch[2] ? 'complete' : 'wip'; }
    data.sourceUrl = [...doc.querySelectorAll('a[href*="archiveofourown.org/works/"]')][0]?.href || '';
    const pre = doc.querySelector('#preface');
    const summary = [...(pre?.querySelectorAll('p') || [])].find(p => /^summary/i.test(p.textContent.trim()))?.nextElementSibling;
    if (summary) data.summary = htmlToMd(summary);
    const notes = [...(pre?.querySelectorAll('p') || [])].find(p => /^notes/i.test(p.textContent.trim()))?.nextElementSibling;
    if (notes) data.notesStart = htmlToMd(notes);
    const heads = [...doc.querySelectorAll('#chapters h2.heading, #chapters .meta h2')];
    if (heads.length) {
      data.chapters = heads.map((h, i) => {
        let n = h.closest('.meta') || h, body = null;
        while ((n = n.nextElementSibling)) { if (n.classList.contains('userstuff')) { body = n; break; } if (n.matches('.meta, h2')) break; }
        return { title: h.textContent.replace(/\s+/g, ' ').trim() || `Chương ${i + 1}`, body: body ? htmlToMd(body) : '' };
      });
    } else {
      const body = doc.querySelector('#chapters .userstuff, #chapters') || doc.body;
      data.chapters = [{ title: 'Chương 1', body: htmlToMd(body) }];
    }
  } else {
    const parts = [];
    let cur = null;
    for (const n of doc.body.children) {
      if (/^H[12]$/.test(n.tagName) && n.textContent.trim() !== title) { cur = { title: n.textContent.trim(), nodes: [] }; parts.push(cur); continue; }
      if (/^H1$/.test(n.tagName)) continue;
      if (!cur) { cur = { title: 'Chương 1', nodes: [] }; parts.push(cur); }
      cur.nodes.push(n.outerHTML);
    }
    data.chapters = parts.map(p => ({ title: p.title, body: htmlToMd(p.nodes.join('')) }));
  }
  return data;
}

// ── Export ──
async function gather(id) {
  const v = await store.get(id);
  const all = v.chapters;
  return { v, parts: v.tops.map(c => ({ c, md: store.composeMd(c, all) })) };
}
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'fanfic';

function headerMd(v) {
  const f = v.fic, a = AUDIENCE[v.audience];
  const row = (k, val) => val && (Array.isArray(val) ? val.length : true) ? `- **${k}:** ${Array.isArray(val) ? val.join(', ') : val}\n` : '';
  return `# ${v.title}\n\n${f.author ? `*${f.author}*\n\n` : ''}${row('Fandom', v.fandoms.map(x => x.name))}${row('Xếp hạng', a?.label)}${row('Cảnh báo', (f.warnings || []).map(w => WARNINGS[w]))}${row('Thể loại', (f.categories || []).map(c => CATEGORIES[c]))}${row('Cặp đôi', v.relationships.map(t => t.name))}${row('Nhân vật', v.characters.map(t => t.name))}${row('Tag', v.tags)}${row('Trạng thái', STATUSES[v.status])}${row('Số từ', String(v.words))}\n${f.summary ? `## Tóm tắt\n\n${f.summary}\n\n` : ''}${f.notesStart ? `## Lời tác giả\n\n${f.notesStart}\n\n` : ''}`;
}

export async function exportWork(id, fmt) {
  const { v, parts } = await gather(id);
  const { download } = await import('../ui/common.js');
  const name = safeName(v.title);
  const md = headerMd(v) + parts.map(({ c, md: body }) => `\n## ${c.title}\n\n${c.notesStart ? `> ${c.notesStart.replace(/\n/g, '\n> ')}\n\n` : ''}${body}\n${c.notesEnd ? `\n> ${c.notesEnd.replace(/\n/g, '\n> ')}\n` : ''}`).join('\n') + (v.fic.notesEnd ? `\n## Lời cuối\n\n${v.fic.notesEnd}\n` : '');
  if (fmt === 'md') return download(name + '.md', md, 'text/markdown');
  if (fmt === 'txt') return download(name + '.txt', mdToTxt(md), 'text/plain');
  const html = `<!doctype html><html lang="${esc(v.fic.language || 'vi')}"><head><meta charset="utf-8"><title>${esc(v.title)}</title>
<style>body{font:18px/1.7 Georgia,serif;max-width:40em;margin:2em auto;padding:0 1em}h1,h2{text-align:center}hr.scene{border:0;text-align:center}hr.scene:after{content:"* * *"}p.center{text-align:center}blockquote{color:#555;border-left:3px solid #ccc;margin-left:0;padding-left:1em}@media print{h2{page-break-before:always}}</style></head><body>${mdToHtml(md)}</body></html>`;
  if (fmt === 'html') return download(name + '.html', html, 'text/html');
  if (fmt === 'pdf') {
    const f = Object.assign(document.createElement('iframe'), { title: 'In truyện' });
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.append(f);
    f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
    setTimeout(() => { f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 300);
    return;
  }
  if (fmt === 'epub' || fmt === 'kdp') return download(name + (fmt === 'kdp' ? ' (KDP)' : '') + '.epub', await epub(v, parts, { kdp: fmt === 'kdp' }), 'application/epub+zip');
  if (fmt === 'docx') {
    const { docx, mdBlocks } = await import('./docx.js');
    const blocks = [{ kind: 'title', text: v.title }, ...(v.fic.author ? [{ kind: 'center', text: v.fic.author }] : []),
      ...parts.flatMap(({ c, md: body }) => [{ kind: 'h1', text: c.title, pageBreak: true }, ...mdBlocks(body)])];
    return download(name + '.docx', docx({ title: v.title, author: v.fic.author, blocks }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }
}

export async function exportMany(ids, fmt) {
  for (const id of ids) await exportWork(id, fmt);
}

// EPUB 3: mimetype (stored first), container, OPF, nav, one XHTML per chapter.
async function epub(v, parts, { kdp = false } = {}) {
  const id = 'urn:uuid:' + v.id, lang = v.fic.language || 'vi';
  const x = (s) => esc(s).replace(/'/g, '&#39;');
  const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}"><head><title>${x(title)}</title><link rel="stylesheet" href="style.css"/></head><body>${toXhtml(body)}</body></html>`;
  const files = [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['OEBPS/style.css', 'body{font-family:serif;line-height:1.6}h1,h2{text-align:center}p{margin:0;text-indent:1.4em}h1+p,h2+p,hr+p{text-indent:0}hr.scene{border:0;margin:1em 0;text-align:center}hr.scene:after{content:"* * *"}.center{text-align:center;text-indent:0}aside{font-size:.9em;color:#555;margin:1em 0}'],
    ['OEBPS/title.xhtml', xhtml(v.title, kdp ? `<h1 class="center">${x(v.title)}</h1>${v.fic.author ? `<p class="center">${x(v.fic.author)}</p>` : ''}` : mdToHtml(headerMd(v)))],
    ...parts.map(({ c, md }, i) => [`OEBPS/c${i + 1}.xhtml`, xhtml(c.title, `<h2>${x(c.title)}</h2>${c.notesStart ? `<aside>${mdToHtml(c.notesStart)}</aside>` : ''}${mdToHtml(md)}${c.notesEnd ? `<aside>${mdToHtml(c.notesEnd)}</aside>` : ''}`)]),
  ];
  const nav = xhtml('Mục lục', `<nav epub:type="toc"><h1>Mục lục</h1><ol><li><a href="title.xhtml">${x(v.title)}</a></li>${parts.map(({ c }, i) => `<li><a href="c${i + 1}.xhtml">${x(c.title)}</a></li>`).join('')}</ol></nav>`);
  files.push(['OEBPS/nav.xhtml', nav]);
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${id}</dc:identifier><dc:title>${x(v.title)}</dc:title><dc:language>${lang}</dc:language>${v.fic.author ? `<dc:creator>${x(v.fic.author)}</dc:creator>` : ''}${v.fic.summary ? `<dc:description>${x(v.fic.summary)}</dc:description>` : ''}${[...v.fandoms.map(f => f.name), ...v.tags].map(s => `<dc:subject>${x(s)}</dc:subject>`).join('')}
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>${parts.map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine><itemref idref="title"/>${parts.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`;
  files.push(['OEBPS/content.opf', opf]);
  return zipStore(files);
}
function toXhtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return new XMLSerializer().serializeToString(doc.body).replace(/^<body[^>]*>|<\/body>$/g, '');
}

// Minimal ZIP writer (stored, no compression): enough for EPUB, which requires 'mimetype' stored first anyway.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zipStore(files, type = 'application/epub+zip') {
  const enc = new TextEncoder(), chunks = [], central = [];
  let off = 0;
  for (const [name, data] of files) {
    const n = enc.encode(name), d = typeof data === 'string' ? enc.encode(data) : data, c = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, c, true);
    h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    chunks.push(new Uint8Array(h.buffer), n, d);
    const ce = new DataView(new ArrayBuffer(46));
    ce.setUint32(0, 0x02014b50, true); ce.setUint16(4, 20, true); ce.setUint16(6, 20, true); ce.setUint16(8, 0x0800, true); ce.setUint32(16, c, true);
    ce.setUint32(20, d.length, true); ce.setUint32(24, d.length, true); ce.setUint16(28, n.length, true); ce.setUint32(42, off, true);
    central.push(new Uint8Array(ce.buffer), n);
    off += 30 + n.length + d.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type });
}
