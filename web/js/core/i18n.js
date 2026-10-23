// Interface language (Vietnamese is the source language; English is layered on top).
// The app's text lives in the modules as Vietnamese. In English mode this file loads a phrase
// table (i18n-en.js) and translates what is rendered: text nodes, placeholder/title/aria-label
// attributes, document.title and the native alert/confirm/prompt boxes. A phrase that is not in
// the table simply stays Vietnamese. Changing the language reloads the page (setLang).
//
// Not translated on purpose: lyrics, anything inside [data-i18n="off"] and editable fields.
// To add a phrase, add it to tools/i18n/en.json (Vietnamese -> English) and run
// `node tools/build-i18n.js`; no module code needs to change.
const KEY = 'hub.lang';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export const LANGS = [{ id: 'vi', label: 'Tiếng Việt', locale: 'vi-VN' }, { id: 'en', label: 'English', locale: 'en-US' }];
export let lang = read();
if (!lang) lang = 'vi';
if (!LANGS.some(l => l.id === lang)) lang = 'vi';

globalThis.__LOCALE = LANGS.find(l => l.id === lang).locale;
globalThis.__LOCALE_SHORT = lang;
document.documentElement.lang = lang;

export function setLang(id) {
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
  location.reload();
}

const SKIP = 'script,style,textarea,input,[contenteditable="true"],[data-i18n="off"],.ly,.ly *';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip', 'data-label'];
const LETTER = /[\p{L}\p{N}]/u;
let table = null, big = null;
const cache = new Map();

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function build(dict) {
  table = new Map(Object.entries(dict));
  const keys = [...table.keys()].filter(k => k.length > 1).sort((a, b) => b.length - a.length);
  // Whole-word match: a key that starts/ends with a letter must not be glued to another letter.
  const part = (k) => (LETTER.test(k[0]) ? '(?<![\\p{L}\\p{N}])' : '') + esc(k) + (LETTER.test(k[k.length - 1]) ? '(?![\\p{L}\\p{N}])' : '');
  big = new RegExp(keys.map(part).join('|'), 'gu');
}

export function tr(s) {
  if (!table || !s) return s;
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  const t = s.trim();
  let out = s;
  if (t) {
    const exact = table.get(t.replace(/\s+/g, ' '));
    if (exact !== undefined) out = s.replace(t, exact);
    // Long text (guides, show notes, descriptions) is never one of the app's own phrases, and running the big
    // alternation over it froze the page for minutes: only short strings go through the phrase regex.
    else if (t.length <= 160 && (/[^\x00-\x7f]/.test(t) || /[a-zA-Z]/.test(t))) {
      // Single words ("bài", "lần") are only safe next to a number ("5 bài"); inside a sentence
      // they would produce a half-translated mix, so the sentence stays Vietnamese instead.
      const num = /\d/.test(t);
      out = s.replace(big, (m) => (num || /\s/.test(m.trim()) ? table.get(m) ?? m : m));
    }
  }
  if (cache.size > 6000) cache.clear();
  cache.set(s, out);
  return out;
}

const skipped = (el) => !!el && !!el.closest?.(SKIP);
const skippedAttr = (el) => !!el && !!el.closest?.('[data-i18n="off"],.ly');

function node(n) {
  if (n.nodeType === 3) {
    const v = n.nodeValue;
    if (v && v.trim() && !skipped(n.parentElement)) { const o = tr(v); if (o !== v) n.nodeValue = o; }
  } else if (n.nodeType === 1) attrs(n);
}
function attrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v && !skippedAttr(el)) { const o = tr(v); if (o !== v) el.setAttribute(a, o); }
  }
}
export function translateTree(root) {
  if (!table || !root) return;
  if (root.nodeType === 3) return node(root);
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) { if (skippedAttr(root)) return; attrs(root); }
  // Subtrees marked off (long content such as the guides) are not walked at all.
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.nodeType === 1 && n.getAttribute('data-i18n') === 'off' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) node(n);
    else if (n.nodeType === 1) { if (/^(SCRIPT|STYLE)$/.test(n.tagName)) continue; attrs(n); }
  }
}

if (lang !== 'vi') {
  try { build((await import('./i18n-en.js')).default); } catch (e) { console.warn('[i18n] no phrase table', e.message); }
}
if (table) {
  const pending = new Set(); let queued = false;
  const flush = () => { queued = false; const items = [...pending]; pending.clear(); for (const n of items) if (n.isConnected !== false) translateTree(n); };
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(n => pending.add(n));
      else if (m.type === 'characterData') pending.add(m.target);
      else if (m.type === 'attributes') pending.add(m.target);
    }
    if (!queued) { queued = true; queueMicrotask(flush); }
  });
  const start = () => {
    translateTree(document.body);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  document.body ? start() : document.addEventListener('DOMContentLoaded', start, { once: true });
  const title = () => { const t = tr(document.title); if (t !== document.title) document.title = t; };
  title();
  for (const f of ['alert', 'confirm', 'prompt']) { const o = window[f].bind(window); window[f] = (m, ...r) => o(tr(String(m ?? '')), ...r); }
}
