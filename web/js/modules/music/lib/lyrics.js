// Lyrics: parsers for LRC (line-synced, enhanced "<mm:ss.xx>" stamps per word / syllable / letter,
// "[offset:±ms]", several [time] tags per line, "v1:/v2:" duet agents, "[bg:…]" background vocals,
// bilingual files where a translation repeats the timestamp), Apple TTML (word timing, ttm:agent
// duets, x-bg background vocals, x-translation / x-roman and iTunesMetadata translations) and
// SRT / WebVTT. A karaoke view that fills every character on its own, scrolls with a spring, dims
// / blurs distant lines, shows translation and romanisation under each line and right-aligns the
// second singer. Serialisers back to LRC / enhanced LRC / TTML / SRT for the lyrics editor.
import { esc } from '../../../core/ui.js';
import { registerIcons } from '../../../core/icons.js';

registerIcons({
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  translate: '<path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 5.5 6 7M11 5c-.5 3-3 6.5-7 8M13 21l4-9 4 9M14.5 18h5"/>',
  'text-size': '<path d="M4 7V5h10v2M9 5v14M7 19h4M14 12v-1h6v1M17 11v8M16 19h2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
});

const TS = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
const sec = (m, s) => +m * 60 + parseFloat(String(s).replace(':', '.'));

export function isLrc(text) { return /^\s*\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/m.test(text || ''); }
export const isTtml = (text) => /<tt[\s>]/.test(text || '');
export const isSrt = (text) => /^[^\n]*\d{1,2}:\d{2}[,.]\d{1,3}\s*-->\s*/m.test(text || '');
export function lyricsKind(text) {
  if (!text?.trim()) return '';
  return isTtml(text) ? 'ttml' : isLrc(text) ? 'lrc' : isSrt(text) ? 'srt' : 'plain';
}

// Load lyrics.css once (next to music.css; the module service only loads music.css).
let cssDone = false;
export function ensureLyricsCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = Object.assign(new URL('../lyrics.css', import.meta.url), { search: new URL(import.meta.url).search }).href; l.dataset.lyricsCss = '1';
  document.head.appendChild(l);
}

// Split segments ([{ t, end, text }]) into words and characters. Characters of a segment share its
// time span, weighted by count (spaces get no time). Words carry their trailing whitespace in .text.
function build(L, segs) {
  const chars = [];
  for (const s of segs) {
    const n = [...s.text].filter(c => c.trim()).length || 1;
    const d = Math.max(0, s.end - s.t) / n;
    let t = s.t;
    for (const ch of s.text) {
      if (ch.trim()) { chars.push({ ch, t, end: t + d }); t += d; } else chars.push({ ch, t, end: t, sp: true });
    }
  }
  const words = [];
  let w = null;
  for (const c of chars) {
    if (c.sp) { if (w) w.text += c.ch; else if (words.length) words[words.length - 1].text += c.ch; continue; }
    if (!w || (w.text && /\s$/.test(w.text))) { w = { text: '', chars: [], t: c.t, end: c.end }; words.push(w); }
    w.text += c.ch; w.chars.push(c); w.end = c.end;
  }
  L.segments = segs; L.words = words;
  return L;
}

// Segments from an enhanced-LRC body ("<00:01.20>Hel<00:01.50>lo <00:02.00>") starting at `t0`.
function lrcSegs(body, t0, shift, offset, endCap) {
  const parts = body.split(WORD);
  const raws = [];
  if (parts[0]) raws.push({ t: null, text: parts[0] });
  for (let i = 1; i < parts.length; i += 3) raws.push({ t: sec(parts[i], parts[i + 1]) + shift - offset, text: parts[i + 2] || '' });
  while (raws.length && !raws[0].text.trim() && raws[0].t == null) raws.shift();
  if (!raws.some(r => r.t != null && r.text.trim())) return null;
  if (raws[0].t == null) raws[0].t = t0;
  raws[0].text = raws[0].text.replace(/^\s+/, '');
  const segs = [];
  for (let j = 0; j < raws.length; j++) {
    if (!raws[j].text) continue;          // a bare trailing stamp only marks an end
    const nextT = raws[j + 1]?.t;
    const end = nextT ?? Math.min(endCap, raws[j].t + Math.max(0.6, [...raws[j].text.trim()].length * 0.12));
    segs.push({ t: raws[j].t, end: Math.max(raws[j].t, Math.min(end, Math.max(endCap, raws[j].t))), text: raws[j].text });
  }
  if (segs.length) segs[segs.length - 1].text = segs[segs.length - 1].text.replace(/\s+$/, '');
  return segs.length ? segs : null;
}

const AGENT_RE = /^((?:\s*<[^>]*>)*)\s*(v\d{1,4}|duet)\s*:\s*/i;
const agentOf = (a) => { a = a.toLowerCase(); return a === 'duet' ? 'v1000' : a; };

function parseLrc(text, duration) {
  let offset = 0;
  const m = text.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/mi);
  if (m) offset = +m[1] / 1000;
  const lines = [];
  const pendingBg = [];
  for (const raw of text.split('\n')) {
    const bg = raw.match(/^\s*\[bg:\s*(.*)\]\s*$/i);
    if (bg) { pendingBg.push({ after: lines[lines.length - 1], body: bg[1] }); continue; }
    const stamps = [...raw.matchAll(TS)];
    if (!stamps.length) continue;
    let body = raw.replace(TS, '');
    let agent = null;
    const am = body.match(AGENT_RE);
    if (am) { agent = agentOf(am[2]); body = body.replace(AGENT_RE, '$1'); }
    const base = sec(stamps[0][1], stamps[0][2]);
    const clean = body.replace(WORD, '').trim();
    for (const s of stamps) {
      const t0 = sec(s[1], s[2]);
      lines.push({ t: t0 - offset, text: clean, body, shift: t0 - base, agent });
    }
  }
  lines.sort((a, b) => a.t - b.t);
  // Bilingual LRC: a second line with the same timestamp is the translation of the first.
  const out = [];
  for (const L of lines) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.t - L.t) < 0.005 && L.text && prev.text && prev.tr == null) { prev.tr = L.text; continue; }
    out.push(L);
  }
  for (let i = 0; i < out.length; i++) {
    const L = out[i];
    L.end = out[i + 1]?.t ?? Math.max(L.t + 5, duration || 0);
    const segs = lrcSegs(L.body, L.t, L.shift, offset, L.end);
    L.wordSynced = !!segs;
    if (segs) build(L, segs); else L.words = [];
    delete L.body; delete L.shift;
  }
  for (const b of pendingBg) {
    const L = b.after && out.includes(b.after) ? b.after : null;
    if (!L) continue;
    const clean = b.body.replace(WORD, '').trim().replace(/^\((.*)\)$/, '$1');
    const segs = lrcSegs(b.body, L.t, 0, offset, L.end);
    L.bg = segs ? build({ text: clean, t: segs[0].t, end: segs[segs.length - 1].end }, segs) : { text: clean, words: [], t: L.t, end: L.end };
  }
  return { synced: true, offset, words: out.some(l => l.wordSynced), lines: out.filter(l => l.text || l.t != null) };
}

// "1:02.5", "00:01:02.500", "62.5s", "62500ms", "2.1"
export function ttmlTime(v) {
  if (v == null || v === '') return null;
  v = String(v).trim();
  let m;
  if ((m = v.match(/^([\d.]+)(h|m|s|ms)$/))) return +m[1] * { h: 3600, m: 60, s: 1, ms: 0.001 }[m[2]];
  const p = v.split(':').map(Number);
  if (p.some(isNaN)) return null;
  return p.reduce((a, x) => a * 60 + x, 0);
}

function parseTtml(text, duration) {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const attr = (el, name) => {
    const local = name.split(':').pop();
    return el.getAttribute(name) ?? [...el.attributes].find(a => a.localName === local)?.value ?? null;
  };
  // Agents: first person on the left, the next on the right, groups centred.
  const agents = {};
  let persons = 0;
  for (const a of doc.getElementsByTagNameNS('*', 'agent')) {
    const id = attr(a, 'xml:id');
    const type = a.getAttribute('type');
    agents[id] = type === 'group' || type === 'other' ? 'v1000' : (persons++ === 0 ? 'v1' : 'v2');
  }
  // Translations / transliterations in <head><iTunesMetadata>: <text for="L12">…</text>
  const side = { tr: {}, roman: {} };
  for (const [tag, key] of [['translation', 'tr'], ['transliteration', 'roman']]) {
    for (const tn of doc.getElementsByTagNameNS('*', tag)) for (const x of tn.getElementsByTagNameNS('*', 'text')) {
      const f = x.getAttribute('for');
      if (f && !side[key][f]) side[key][f] = [...x.childNodes].filter(n => !(n.nodeType === 1 && /x-bg/.test(attr(n, 'ttm:role') || ''))).map(n => n.textContent).join('').trim();
    }
  }
  const lines = [];
  for (const p of doc.getElementsByTagNameNS('*', 'p')) {
    let agent = attr(p, 'ttm:agent') || (p.parentNode?.nodeType === 1 ? attr(p.parentNode, 'ttm:agent') : null);
    agent = agent ? agents[agent] || (/2$/.test(agent) ? 'v2' : 'v1') : null;
    const t = ttmlTime(attr(p, 'begin')), end = ttmlTime(attr(p, 'end'));
    if (t == null) continue;
    const L = { t, end: end ?? null, agent, tr: null, roman: null };
    const key = attr(p, 'itunes:key');
    const segs = [], bgSegs = [];
    const walk = (node, into, inh) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          const s = n.textContent.replace(/\s+/g, ' ');
          if (!s) continue;
          if (into.length) into[into.length - 1].text += s;
          else if (s.trim()) into.push({ t: inh.t, end: inh.end, text: s, untimed: true });
          continue;
        }
        if (n.nodeType !== 1) continue;
        if (n.localName === 'br') { if (into.length) into[into.length - 1].text += ' '; continue; }
        const role = attr(n, 'ttm:role') || '';
        if (role === 'x-translation') { L.tr = n.textContent.trim(); continue; }
        if (role === 'x-roman') { L.roman = n.textContent.trim(); continue; }
        const b = ttmlTime(attr(n, 'begin')), e = ttmlTime(attr(n, 'end'));
        if (role === 'x-bg') { walk(n, bgSegs, { t: b ?? inh.t, end: e ?? inh.end }); continue; }
        if (b != null && !n.children.length) into.push({ t: b, end: e ?? b, text: n.textContent.replace(/\s+/g, ' ') });
        else walk(n, into, { t: b ?? inh.t, end: e ?? inh.end });
      }
    };
    walk(p, segs, { t, end: end ?? t + 4 });
    const fix = (ss) => {
      ss = ss.filter(s => s.text);
      if (ss.length) { ss[0].text = ss[0].text.replace(/^\s+/, ''); ss[ss.length - 1].text = ss[ss.length - 1].text.replace(/\s+$/, ''); }
      return ss.filter(s => s.text);
    };
    const S = fix(segs), B = fix(bgSegs);
    L.text = S.map(s => s.text).join('').trim();
    L.wordSynced = S.some(s => !s.untimed) && S.length > 0;
    if (L.wordSynced) build(L, S); else L.words = [];
    if (B.length) {
      const bs = B.map(s => ({ ...s, text: s.text.replace(/[()]/g, '') })).filter(s => s.text);
      const bt = bs.map(s => s.text).join('').trim();
      L.bg = build({ text: bt, t: B[0].t, end: B[B.length - 1].end }, bs);
      if (!B.some(s => !s.untimed)) L.bg.words = [];
    }
    if (key) { L.tr ||= side.tr[key] || null; L.roman ||= side.roman[key] || null; }
    if (L.text || L.bg) lines.push(L);
  }
  lines.sort((a, b) => a.t - b.t);
  for (let i = 0; i < lines.length; i++) lines[i].end ??= lines[i + 1]?.t ?? Math.max(lines[i].t + 5, duration || 0);
  if (!lines.length) return null;
  return { synced: true, offset: 0, words: lines.some(l => l.wordSynced), lines, format: 'ttml' };
}

function parseSrt(text) {
  const lines = [];
  const T = (s) => { const m = s.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000 : null; };
  for (const block of text.replace(/^WEBVTT[^\n]*\n/, '').split(/\n\s*\n/)) {
    const rows = block.split('\n').map(r => r.trim()).filter(Boolean);
    const k = rows.findIndex(r => r.includes('-->'));
    if (k < 0) continue;
    const [a, b] = rows[k].split('-->');
    const t = T(a), end = T(b);
    if (t == null) continue;
    const body = rows.slice(k + 1).map(r => r.replace(/<[^>]+>/g, ''));
    if (!body.length) continue;
    lines.push({ t, end: end ?? t + 4, text: body[0], tr: body.length > 1 ? body.slice(1).join(' ') : null, words: [] });
  }
  lines.sort((a, b) => a.t - b.t);
  return lines.length ? { synced: true, offset: 0, words: false, lines, format: 'srt' } : null;
}

// -> { synced, words: bool, offset, format, lines: [{ t, end, text, agent, tr, roman, bg: { text, words }, words: [{ t, end, text, chars: [{ ch, t, end }] }], wordSynced }] }
export function parseLyrics(text, duration = 0) {
  text = (text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  if (isTtml(text)) { const r = parseTtml(text, duration); if (r) return r; }
  if (isLrc(text)) return { ...parseLrc(text, duration), format: 'lrc' };
  if (isSrt(text)) { const r = parseSrt(text); if (r) return r; }
  return { synced: false, words: false, format: 'plain', lines: text.split('\n').map(l => ({ t: null, text: l.trim(), words: [] })) };
}

// A separate translation (LRC or plain lines) laid under the lyrics: synced by nearest time,
// otherwise line by line over the non-empty lines.
export function mergeTranslation(parsed, trText) {
  if (!parsed || !trText?.trim()) return parsed;
  const tr = parseLyrics(trText);
  const target = parsed.lines.filter(l => l.text);
  if (tr.synced && parsed.synced) {
    for (const x of tr.lines) {
      if (!x.text) continue;
      let best = null, bd = 1.2;
      for (const L of target) { const d = Math.abs(L.t - x.t); if (d < bd) { bd = d; best = L; } }
      if (best) best.tr = x.text;
    }
  } else {
    const src = tr.lines.filter(l => l.text);
    target.forEach((L, i) => { if (src[i]) L.tr = src[i].text; });
  }
  return parsed;
}

// Line-synced only: spread the line's time over its characters (approximate karaoke).
// Each word gets time by its length (vowels count more: they are held when sung), plus a short gap after
// it; the last word of the line is held longer. The line fills most of its slot, like a real singer.
function fakeWords(L) {
  const parts = L.text.match(/\S+\s*/g) || [L.text];
  const weight = (w) => [...w.trim()].reduce((a, c) => a + (/[aeiouyàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i.test(c) ? 1.6 : /[\p{L}\p{N}]/u.test(c) ? 1 : 0.3), 0) || 1;
  const ws = parts.map((p, i) => weight(p) * (i === parts.length - 1 ? 1.5 : 1));
  const total = ws.reduce((a, b) => a + b, 0);
  const slot = Number.isFinite(L.end) && L.end > L.t ? L.end - L.t : 4;
  const span = Math.min(slot * 0.92, Math.max(1.2, total * 0.17 + 0.3));
  const gap = parts.length > 1 ? Math.min(0.08, span * 0.04) : 0;
  const per = (span - gap * (parts.length - 1)) / total;
  let t = L.t;
  build(L, parts.map((text, i) => { const s = { t, end: t + ws[i] * per, text }; t = s.end + gap; return s; }));
}

const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
export const lrcTime = fmt;

// ── Editor model + serialisers ───────────────────────────────────
// Model line: { t, end?, text, words: [{ t, text }], wend, agent, tr, roman, bg: { text, words, wend } | null }
export function toModel(parsed) {
  const wordsOf = (x, stamped) => stamped ? x.words.map(w => ({ t: w.t, text: w.text.trim() })).filter(w => w.text) : (x.text || '').split(/\s+/).filter(Boolean).map(text => ({ t: null, text }));
  return parsed.lines.filter(l => l.text).map(l => {
    const stamped = parsed.synced && l.wordSynced;
    const last = stamped ? l.words[l.words.length - 1] : null;
    const bgStamped = l.bg?.words?.length > 0;
    return {
      t: parsed.synced ? l.t : null, end: parsed.format === 'ttml' || parsed.format === 'srt' ? l.end : null, text: l.text,
      words: wordsOf(l, stamped), wend: last ? last.end : null, agent: l.agent || null, tr: l.tr || null, roman: l.roman || null,
      bg: l.bg ? { text: l.bg.text, words: wordsOf(l.bg, bgStamped), wend: bgStamped ? l.bg.words.at(-1).end : null } : null,
    };
  });
}

const enh = (words, wend) => {
  let s = words.map(w => (w.t != null ? `<${fmt(Math.max(0, w.t))}>` : '') + w.text).join(' ');
  if (wend != null) s += ` <${fmt(Math.max(0, wend))}>`;
  return s;
};
// opts: { words: enhanced stamps, tr: translation as a second line with the same time, agents: "v1:" prefixes }
export function toLrc(lines, { words = true, tr = false, agents = true } = {}) {
  const out = [];
  const duet = agents && lines.some(l => l.agent && l.agent !== 'v1');
  for (const l of lines) {
    const head = l.t != null ? `[${fmt(Math.max(0, l.t))}]` : '';
    const ag = duet && l.agent ? `${l.agent}: ` : '';
    const body = words && l.words?.some(w => w.t != null) ? enh(l.words, l.wend) : l.text;
    out.push(head + ag + body);
    if (l.bg?.text) out.push(`[bg: ${words && l.bg.words?.some(w => w.t != null) ? enh(l.bg.words, l.bg.wend) : l.bg.text}]`);
    if (tr && l.tr && head) out.push(head + l.tr);
  }
  return out.join('\n');
}

const tt = (x) => { x = Math.max(0, x || 0); const m = Math.floor(x / 60); return `${m}:${(x - m * 60).toFixed(3).padStart(6, '0')}`; };
const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function toTtml(lines, { duration = 0, lang = 'vi' } = {}) {
  const L = lines.filter(l => l.t != null);
  const ends = L.map((l, i) => l.end ?? l.wend ?? L[i + 1]?.t ?? l.t + 5);
  const duet = L.some(l => l.agent && l.agent !== 'v1');
  const spans = (words, wend, lineEnd) => words.map((w, j) => (w.t == null ? xe(w.text) :
    `<span begin="${tt(w.t)}" end="${tt(words[j + 1]?.t ?? wend ?? lineEnd)}">${xe(w.text)}</span>`) + (j < words.length - 1 ? ' ' : '')).join('');
  const body = L.map((l, i) => {
    const e = ends[i];
    let inner = l.words?.some(w => w.t != null) ? spans(l.words, l.wend, e) : xe(l.text);
    if (l.bg?.text) inner += l.bg.words?.some(w => w.t != null)
      ? `<span ttm:role="x-bg">${spans(l.bg.words.map((w, j, a) => ({ ...w, text: (j === 0 ? '(' : '') + w.text + (j === a.length - 1 ? ')' : '') })), l.bg.wend, e)}</span>`
      : `<span ttm:role="x-bg">(${xe(l.bg.text)})</span>`;
    if (l.tr) inner += `<span ttm:role="x-translation" xml:lang="und">${xe(l.tr)}</span>`;
    if (l.roman) inner += `<span ttm:role="x-roman">${xe(l.roman)}</span>`;
    return `      <p begin="${tt(l.t)}" end="${tt(e)}" itunes:key="L${i + 1}"${duet ? ` ttm:agent="${l.agent || 'v1'}"` : ''}>${inner}</p>`;
  }).join('\n');
  const timing = L.some(l => l.words?.some(w => w.t != null)) ? 'Word' : 'Line';
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="${timing}" xml:lang="${lang}">
  <head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/><ttm:agent type="group" xml:id="v1000"/></metadata></head>
  <body dur="${tt(duration || ends.at(-1) || 0)}">
    <div>
${body}
    </div>
  </body>
</tt>`;
}

export function toSrt(lines, { tr = true } = {}) {
  const s = (x) => { x = Math.max(0, x || 0); const ms = Math.round(x * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, ss = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  const L = lines.filter(l => l.t != null);
  return L.map((l, i) => `${i + 1}\n${s(l.t)} --> ${s(l.end ?? l.wend ?? L[i + 1]?.t ?? l.t + 4)}\n${l.text}${tr && l.tr ? '\n' + l.tr : ''}`).join('\n\n') + '\n';
}

// Current line for compact views (mini player, lock-screen style).
export function lineAt(parsed, time) {
  if (!parsed?.synced) return null;
  const ls = parsed.lines;
  let lo = 0, hi = ls.length - 1, i = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ls[mid].t <= time) { i = mid; lo = mid + 1; } else hi = mid - 1; }
  return i < 0 ? null : { i, line: ls[i] };
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Karaoke view ────────────────────────────────────────────────
// opts: { onSeek(t), onLong(line, index, el), fake, duration }; .autoScroll for plain lyrics.
// Display mode: 'word' = as stored (per-word/letter karaoke where timed), 'line' = whole line lights up,
// 'plain' = static text without timing (no highlight, no auto-follow).
export const LY_MODES = ['word', 'line', 'plain'];
export function lyricsView(parsed, mode = 'word') {
  if (!parsed || mode === 'word' || !LY_MODES.includes(mode)) return parsed;
  if (mode === 'line') {
    if (!parsed.synced) return parsed;
    const strip = (L) => ({ ...L, words: [], wordSynced: false, bg: L.bg ? { ...L.bg, words: [] } : L.bg });
    return { ...parsed, words: false, lines: parsed.lines.map(strip) };
  }
  if (!parsed.synced) return parsed;
  return { synced: false, words: false, offset: 0, format: 'plain', lines: parsed.lines.filter(l => l.text || l.t != null)
    .map(l => ({ t: null, text: l.text || '', words: [], tr: l.tr, roman: l.roman, agent: l.agent, bg: l.bg?.text ? { text: l.bg.text, words: [] } : null })) };
}

export class KaraokeView {
  constructor(el, { onSeek, onLong, fake = true, duration = 0 } = {}) {
    ensureLyricsCss();
    this.el = el; this.onSeek = onSeek; this.onLong = onLong; this.fake = fake; this.duration = duration; this.autoScroll = true;
    el.classList.add('ly2');
    this.cur = -1; this.userScrollUntil = 0; this.active = []; this.lineChars = new Map();
    this.sp = { pos: 0, vel: 0, target: null, last: 0 };
    const user = () => { this.userScrollUntil = performance.now() + 3500; this.sp.target = null; };
    el.addEventListener('wheel', user, { passive: true });
    el.addEventListener('touchmove', user, { passive: true });
    el.addEventListener('keydown', (e) => { if (/Arrow|Page|Home|End/.test(e.key)) user(); });
    let timer = 0, longed = false, sx = 0, sy = 0;
    const fire = (line) => { longed = true; navigator.vibrate?.(12); this.onLong(this.data?.lines[+line.dataset.i] || { text: line.textContent }, +line.dataset.i, line); };
    el.addEventListener('pointerdown', (e) => {
      longed = false;
      const line = e.target.closest('.ly-line');
      if (!line || !this.onLong || e.button > 0) return;
      sx = e.clientX; sy = e.clientY;
      timer = setTimeout(() => { timer = 0; fire(line); }, 520);
    });
    el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { clearTimeout(timer); timer = 0; } });
    const stop = () => { clearTimeout(timer); timer = 0; };
    el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop);
    el.addEventListener('contextmenu', (e) => {
      const line = e.target.closest('.ly-line');
      if (!line || !this.onLong) return;
      e.preventDefault(); stop();
      if (!longed) fire(line);
    });
    el.addEventListener('click', (e) => {
      if (longed) { longed = false; e.preventDefault(); return; }
      const line = e.target.closest('[data-t]');
      if (line && this.onSeek) { this.userScrollUntil = 0; this.onSeek(+line.dataset.t); }
    });
  }

  set(parsed, emptyHtml = '') {
    this.data = parsed; this.cur = -1; this.active = []; this.lineChars = new Map(); this.dist = null;
    this.sp.target = null; this.sp.vel = 0;
    if (!parsed || !parsed.lines.some(l => l.text)) { this.el.innerHTML = emptyHtml; this.el.classList.remove('synced'); this.lineEls = []; return; }
    this.el.classList.toggle('synced', parsed.synced);
    if (parsed.synced) for (const L of parsed.lines) if (!L.words.length && this.fake && L.text) fakeWords(L), L.approx = true;
    const word = (w) => {
      const m = w.text.match(/^(\S*)(\s*)$/s) || [w.text, w.text, ''];
      return `<span class="ly-w${w.end - w.t >= 1 && w.chars.length <= 14 ? ' ly-long' : ''}">${w.chars.map(c => `<span class="ly-c">${esc(c.ch)}</span>`).join('')}</span>${m[2] ? ' ' : ''}`;
    };
    const persons = new Set(parsed.lines.map(l => l.agent).filter(a => a && a !== 'v1000'));
    const side = (a) => !a || persons.size < 2 ? '' : a === 'v1000' ? ' ly-group' : a === 'v1' ? ' ly-v1' : ' ly-v2';
    const extra = (L) => (L.tr ? `<span class="ly-tr">${esc(L.tr)}</span>` : '') + (L.roman ? `<span class="ly-ro">${esc(L.roman)}</span>` : '');
    this.el.innerHTML = `<div class="ly-pad"></div>` + parsed.lines.map((L, i) => parsed.synced
      ? `<div class="ly-line${L.text ? '' : ' ly-gap'}${L.approx ? ' ly-approx' : ''}${side(L.agent)}" data-i="${i}" data-t="${L.t}" data-d="4"><span class="ly-main">${L.words.length
        ? L.words.map(word).join('') : (esc(L.text) || '♪')}</span>${L.bg ? `<span class="ly-bg">${L.bg.words?.length ? L.bg.words.map(word).join('') : esc(L.bg.text)}</span>` : ''}${extra(L)}</div>`
      : `<div class="ly-line ly-plain" data-i="${i}"><span class="ly-main">${esc(L.text) || '&nbsp;'}</span>${extra(L)}</div>`).join('') + `<div class="ly-pad"></div>`;
    this.lineEls = [...this.el.querySelectorAll('.ly-line')];
    this.sp.pos = this.el.scrollTop;
  }

  index(time) { return lineAt(this.data, time)?.i ?? -1; }

  // Characters of line i (main + background), cached with their last painted progress.
  chars(i) {
    let c = this.lineChars.get(i);
    if (!c) {
      const L = this.data.lines[i], el = this.lineEls[i];
      const list = [...(L.words || []), ...(L.bg?.words || [])].flatMap(w => w.chars);
      const els = el ? [...el.querySelectorAll('.ly-c')] : [];
      const words = [...(L.words || []), ...(L.bg?.words || [])];
      const wels = el ? [...el.querySelectorAll('.ly-w')] : [];
      c = { list, els, p: new Float32Array(els.length).fill(-1), words, wels, ws: new Int8Array(wels.length).fill(-1) };
      this.lineChars.set(i, c);
    }
    return c;
  }

  // Spring scroll toward sp.target (critically damped, frame-rate independent). Writes only.
  scrollStep() {
    const s = this.sp, now = performance.now();
    const dt = Math.min(0.05, (now - (s.last || now)) / 1000); s.last = now;
    if (s.target == null || now < this.userScrollUntil) return;
    if (reduced()) { this.el.scrollTop = s.target; s.pos = s.target; s.target = null; return; }
    const k = 110, c = 2 * Math.sqrt(k);
    s.vel += (k * (s.target - s.pos) - c * s.vel) * dt;
    s.pos += s.vel * dt;
    if (Math.abs(s.target - s.pos) < 0.5 && Math.abs(s.vel) < 4) { s.pos = s.target; s.target = null; s.vel = 0; }
    this.el.scrollTop = s.pos;
  }

  aim(top) {
    const max = this.el.scrollHeight - this.el.clientHeight;
    top = Math.max(0, Math.min(max, top));
    if (this.sp.target == null) { this.sp.pos = this.el.scrollTop; this.sp.vel = 0; }
    this.sp.target = top;
  }

  // Re-centre on the current line now (after a font size / layout change).
  recenter() { const k = this.cur; this.cur = -2; if (k >= -1) this.update(this.lastTime ?? 0); }

  update(time) {
    const d = this.data;
    this.lastTime = time;
    if (!d || !this.lineEls?.length) return;
    if (!d.synced) {
      // Plain lyrics: follow the song's progress, leaving the intro and outro alone.
      const dur = this.duration;
      if (this.autoScroll && dur > 30 && performance.now() > this.userScrollUntil && this.sp.target == null) {
        const p = Math.max(0, Math.min(1, (time - 12) / (dur - 30)));
        const max = this.el.scrollHeight - this.el.clientHeight;
        if (max > 0 && Math.abs(max * p - this.sp.pos) > 24) this.aim(max * p);
      }
      this.scrollStep();
      return;
    }
    const i = this.index(time);
    if (i !== this.cur) {
      const n = this.lineEls.length;
      this.dist ||= new Int8Array(n).fill(-1);
      for (let k = 0; k < n; k++) {
        const dd = k === i ? 0 : Math.min(4, Math.abs(k - i)), c = this.lineEls[k];
        if (this.dist[k] !== dd) { this.dist[k] = dd; c.dataset.d = dd; }
        if ((k < i) !== c.classList.contains('past')) c.classList.toggle('past', k < i);
        if ((k === i + 1) !== c.classList.contains('next')) c.classList.toggle('next', k === i + 1);
      }
      this.cur = i;
      const el = this.lineEls[Math.max(0, i)];
      if (el && performance.now() > this.userScrollUntil) this.aim(el.offsetTop - this.el.clientHeight * 0.36 + el.offsetHeight / 2);
    }
    this.scrollStep();
    // Active lines: the current one plus earlier lines still being sung (duets, overlaps).
    const act = [];
    if (i >= 0) for (let k = Math.max(0, i - 3); k <= i; k++) if (k === i || (d.lines[k].end > time + 0.05 && d.format === 'ttml')) act.push(k);
    for (const k of this.active) if (!act.includes(k)) {
      this.lineEls[k]?.classList.remove('on');
      const c = this.lineChars.get(k); if (c) { c.els.forEach(x => x.style.removeProperty('--p')); c.p.fill(-1); c.wels.forEach(x => x.classList.remove('act', 'done')); c.ws.fill(-1); }
    }
    for (const k of act) if (!this.active.includes(k)) this.lineEls[k]?.classList.add('on');
    this.active = act;
    for (const k of act) {
      const c = this.chars(k);
      const m = Math.min(c.list.length, c.els.length);
      for (let j = 0; j < m; j++) {
        const ch = c.list[j];
        let p = time <= ch.t ? 0 : time >= ch.end ? 1 : (time - ch.t) / (ch.end - ch.t);
        p = Math.round(p * 50) / 50;   // 2 % steps: fewer style writes
        if (c.p[j] !== p) { c.p[j] = p; c.els[j].style.setProperty('--p', p); }
      }
      // Word state: 1 = being sung (lifts), 2 = sung.
      const wm = Math.min(c.words.length, c.wels.length);
      for (let j = 0; j < wm; j++) {
        const w = c.words[j], s = time < w.t ? 0 : time < w.end ? 1 : 2;
        if (c.ws[j] !== s) { c.ws[j] = s; c.wels[j].classList.toggle('act', s === 1); c.wels[j].classList.toggle('done', s === 2); }
      }
    }
  }
}
