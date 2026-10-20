// Lists every Vietnamese phrase found in string literals / templates / HTML fragments of web/js.
// Usage: node tools/extract-i18n.js [out.json]   (output: sorted unique phrases)
const fs = require('fs'), path = require('path');
const VI = /[àáâãèéêìíòóôõùúăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]/;
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } })(path.join(__dirname, '..', 'web', 'js'));

function exprs(t) { const r = []; for (let i = 0; i < t.length; i++) { if (t[i] === '\\') { i++; continue; } if (t[i] === '$' && t[i + 1] === '{') { let d = 1, j = i + 2; while (j < t.length && d) { if (t[j] === '{') d++; else if (t[j] === '}') d--; j++; } r.push(t.slice(i + 2, j - 1)); i = j - 1; } } return r; }
function literals(src) {
  const out = []; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
    if (c === '\'' || c === '"') { let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1; out.push(src.slice(i + 1, j)); i = j + 1; continue; }
    if (c === '`') { let j = i + 1, depth = 0; while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (!depth && src[j] === '`') break; if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; } if (depth && src[j] === '{') depth++; if (depth && src[j] === '}') depth--; j++; } const body = src.slice(i + 1, j); out.push(body);
      for (const e of exprs(body)) out.push(...literals(e));   // strings nested in ${ ... }
      i = j + 1; continue; }
    i++;
  }
  return out;
}
const stripExpr = (s) => { let out = '', depth = 0; for (let i = 0; i < s.length; i++) { if (!depth && s[i] === '$' && s[i + 1] === '{') { depth = 1; i++; out += '\u0000'; continue; } if (depth) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; continue; } out += s[i]; } return out; };
const unesc = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, '\n').replace(/\\(['"`\\])/g, '$1');
const set = new Set();
for (const f of files) for (let lit of literals(fs.readFileSync(f, 'utf8'))) {
  if (!VI.test(lit)) continue;
  lit = unesc(stripExpr(lit));
  for (const piece of lit.split(/<[^>]*>|\u0000|&[a-z]+;|\n/)) { const t = piece.replace(/\s+/g, ' ').trim(); if (t && VI.test(t) && t.length < 400) set.add(t); }
}
const list = [...set].sort((a, b) => a.localeCompare(b, 'vi'));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(list, null, 1)); 
console.log(list.length, 'phrases');
