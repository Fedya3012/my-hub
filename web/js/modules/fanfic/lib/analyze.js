// Prose checks for the writer: repeated words close together, long sentences, word frequency, sentence rhythm.
import { countWords } from './text.js';

// Function words that repeat naturally (Vietnamese + English); not reported as repetitions.
const STOP = new Set(('và là của có không được một những các cho với thì mà này đó khi đã đang sẽ cũng như để từ trong ra vào lại rồi nữa thế nào gì ai đâu '
  + 'anh em cô cậu nó họ tôi mình ta chúng bạn ông bà hắn nàng chàng y người lên xuống đi đến về theo bị nên nhưng hay hoặc vì nếu thật rất quá vẫn còn chỉ '
  + 'the a an and or but of to in on at for with is was are were be been it he she they i you we his her their my your our that this as by from not had have has do did so then').split(' '));
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;

export function sentences(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split(/(?<=[.!?…]["”»)]?)\s+|\n+/).map(s => s.trim()).filter(s => countWords(s) > 0);
}

// Words used 3+ times inside one paragraph, or twice within `near` words of each other.
export function repetitions(text, { near = 12 } = {}) {
  const out = new Map();
  for (const para of String(text || '').split(/\n\s*\n/)) {
    const words = (para.match(WORD) || []).map(w => w.toLowerCase());
    const last = new Map(), count = new Map();
    words.forEach((w, i) => {
      if (w.length < 3 || STOP.has(w)) return;
      count.set(w, (count.get(w) || 0) + 1);
      if (last.has(w) && i - last.get(w) <= near) out.set(w, Math.max(out.get(w) || 0, 2));
      last.set(w, i);
    });
    for (const [w, n] of count) if (n >= 3) out.set(w, Math.max(out.get(w) || 0, n));
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

export function longSentences(text, limit = 35) {
  return sentences(text).map(s => ({ s, n: countWords(s) })).filter(x => x.n > limit).sort((a, b) => b.n - a.n);
}

export function frequency(text, top = 30) {
  const m = new Map();
  for (const w of (String(text || '').match(WORD) || []).map(x => x.toLowerCase())) if (w.length > 2 && !STOP.has(w)) m.set(w, (m.get(w) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
}

// Sentence lengths in order (for the rhythm strip) and simple summary numbers.
export function rhythm(text) {
  const lens = sentences(text).map(s => countWords(s));
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const sd = lens.length ? Math.sqrt(lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length) : 0;
  return { lens, avg, sd, count: lens.length };
}
