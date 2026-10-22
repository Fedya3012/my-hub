// Text helpers for Xưởng Viết: word count, a small Markdown renderer (the editor writes Markdown; Books reads
// the HTML), and plain/HTML -> Markdown for imports.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Words: runs of letters/digits (Vietnamese syllables count as words, like Word and AO3 do).
export function countWords(s) {
  const m = String(s || '').replace(/[#>*_~`\-]+/g, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}

export const SCENE_BREAK = /^\s*(\*\s*\*\s*\*|-{3,}|#{3}\s*$|~{3,}|◇+|❖+)\s*$/;

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/ {2}$/g, '<br>');
}

// Markdown subset: paragraphs, headings, scene breaks, quotes, lists, bold/italic/strike, links, centred lines (-> text <-).
export function mdToHtml(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null, quote = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${mdToHtml(quote.join('\n'))}</blockquote>`); quote = []; } };
  const flush = () => { flushPara(); flushList(); flushQuote(); };
  for (const line of lines) {
    if (/^\s*>/.test(line)) { flushPara(); flushList(); quote.push(line.replace(/^\s*>\s?/, '')); continue; }
    flushQuote();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (SCENE_BREAK.test(line)) { flush(); out.push('<hr class="scene">'); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flush(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    const c = line.match(/^\s*->\s*(.*?)\s*<-\s*$/);
    if (c) { flush(); out.push(`<p class="center">${inline(c[1])}</p>`); continue; }
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const tag = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(li[2]); continue;
    }
    flushList();
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

// HTML (AO3 download, Word "save as web page", pasted rich text) -> Markdown.
export function htmlToMd(html) {
  const doc = typeof html === 'string' ? new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body : html;
  const walk = (n) => {
    if (n.nodeType === 3) return n.textContent.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const t = n.tagName.toLowerCase(), inner = () => [...n.childNodes].map(walk).join('');
    switch (t) {
      case 'script': case 'style': return '';
      case 'br': return '  \n';
      case 'hr': return '\n\n* * *\n\n';
      case 'strong': case 'b': { const s = inner().trim(); return s ? `**${s}**` : ''; }
      case 'em': case 'i': case 'cite': { const s = inner().trim(); return s ? `*${s}*` : ''; }
      case 's': case 'del': case 'strike': return `~~${inner()}~~`;
      case 'a': return n.getAttribute('href')?.startsWith('http') ? `[${inner()}](${n.getAttribute('href')})` : inner();
      case 'h1': case 'h2': return `\n\n# ${inner().trim()}\n\n`;
      case 'h3': case 'h4': case 'h5': case 'h6': return `\n\n## ${inner().trim()}\n\n`;
      case 'li': return `\n- ${inner().trim()}`;
      case 'blockquote': return '\n\n' + inner().trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      case 'p': case 'div': case 'section': case 'ul': case 'ol': case 'dd': case 'dt': case 'tr': {
        const s = inner();
        const align = (n.getAttribute('align') || n.style?.textAlign || '').toLowerCase();
        return align === 'center' && s.trim() && !SCENE_BREAK.test(s) ? `\n\n-> ${s.trim()} <-\n\n` : `\n\n${s.trim()}\n\n`;
      }
      default: return inner();
    }
  };
  return walk(doc).replace(/[ \t]+\n/g, (m) => (m.endsWith('  \n') ? '  \n' : '\n')).replace(/\n{3,}/g, '\n\n').trim();
}

// Plain text -> Markdown paragraphs (hard-wrapped lines are joined; blank line = new paragraph).
export function txtToMd(txt) {
  return String(txt || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.split('\n').map(l => l.trim()).join(' ').trim()).filter(Boolean).join('\n\n');
}

// Markdown -> plain text (export .txt).
export function mdToTxt(md) {
  return String(md || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2').replace(/~~(.+?)~~/g, '$1')
    .replace(/^#{1,3}\s+/gm, '').replace(/^\s*->\s*(.*?)\s*<-\s*$/gm, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export { esc };
