// Minimal Word (.docx) writer: paragraphs, headings (Heading1/2), bold / italic runs, centred lines, scene breaks and
// page breaks before chapters. Enough for Amazon KDP and other upload forms that take .docx.
import { zipStore } from './io.js';

const x = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function runs(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let i = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > i) out.push([text.slice(i, m.index), '']);
    const t = m[0];
    out.push(t.startsWith('**') ? [t.slice(2, -2), '<w:b/>'] : [t.slice(1, -1), '<w:i/>']);
    i = m.index + t.length;
  }
  if (i < text.length) out.push([text.slice(i), '']);
  return out.map(([t, pr]) => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`).join('');
}
const para = (text, { style = '', center = false, pageBreak = false } = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${pageBreak ? '<w:pageBreakBefore/>' : ''}${center ? '<w:jc w:val="center"/>' : ''}</w:pPr>${runs(text)}</w:p>`;

// blocks: [{ kind: 'title'|'h1'|'h2'|'p'|'center'|'break', text, pageBreak }]
export function mdBlocks(md) {
  const out = [];
  for (const raw of String(md || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const t = raw.replace(/\s*\n\s*/g, ' ').trim();
    if (!t) continue;
    if (/^(\*\s*\*\s*\*|-{3,}|~{3,})$/.test(t)) out.push({ kind: 'break', text: '* * *' });
    else if (/^#\s/.test(t)) out.push({ kind: 'h1', text: t.replace(/^#\s+/, '') });
    else if (/^#{2,3}\s/.test(t)) out.push({ kind: 'h2', text: t.replace(/^#+\s+/, '') });
    else if (/^->.*<-$/.test(t)) out.push({ kind: 'center', text: t.replace(/^->\s*|\s*<-$/g, '') });
    else out.push({ kind: 'p', text: t.replace(/^>\s?/, '') });
  }
  return out;
}

export function docx({ title, author, blocks }) {
  const body = blocks.map(b => b.kind === 'title' ? para(b.text, { style: 'Title' })
    : b.kind === 'h1' ? para(b.text, { style: 'Heading1', pageBreak: b.pageBreak })
    : b.kind === 'h2' ? para(b.text, { style: 'Heading2' })
    : b.kind === 'break' || b.kind === 'center' ? para(b.text, { center: true })
    : para(b.text)).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="8640" w:h="12960"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="360"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="2400" w:after="480"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="720" w:after="360"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:ind w:firstLine="0"/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`;
  return zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
    ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['word/document.xml', doc],
    ['word/styles.xml', styles],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(title)}</dc:title>${author ? `<dc:creator>${x(author)}</dc:creator>` : ''}</cp:coreProperties>`],
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
