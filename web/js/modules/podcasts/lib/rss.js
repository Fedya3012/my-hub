// RSS / Atom podcast feed → { show, episodes }. Reads the iTunes tags and the Podcasting 2.0 namespace
// (podcast:chapters, podcast:transcript, podcast:person, podcast:funding) and Podlove Simple Chapters (psc:).
// Feed text is untrusted: only http(s) links reach href / src (a javascript: link would run on click).
const web = (u) => { const v = String(u || '').trim(); return /^https?:\/\//i.test(v) ? v : ''; };
const kids = (el, name) => el ? [...el.children].filter(c => c.localName === name || c.nodeName === name) : [];
const kid = (el, name) => kids(el, name)[0] || null;
const txt = (el, name) => (kid(el, name)?.textContent || '').trim();
// <itunes:image href> or <image><url> (either may come first)
const img = (el) => web(kids(el, 'image').map(i => web(i.getAttribute('href')) || web(txt(i, 'url'))).find(Boolean));

export function parseDuration(v) {
  if (v == null || v === '') return 0;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s);
  return s.split(':').map(Number).reduce((a, b) => a * 60 + (b || 0), 0);
}
// "00:01:02.500" | "62.5" → seconds
export const parseTime = (v) => { const s = String(v || '').trim(); return s.includes(':') ? s.split(':').map(parseFloat).reduce((a, b) => a * 60 + (b || 0), 0) : parseFloat(s) || 0; };

export function parseFeed(xml, feedUrl) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') && !doc.querySelector('channel, feed')) throw new Error('Không phải RSS podcast hợp lệ');
  const ch = doc.querySelector('channel') || doc.querySelector('feed');
  if (!ch) throw new Error('Không tìm thấy kênh trong RSS');
  const cats = new Set();
  for (const c of ch.getElementsByTagName('itunes:category')) { const t = c.getAttribute('text'); if (t) cats.add(t); }
  const show = {
    title: txt(ch, 'title') || 'Podcast',
    author: txt(ch, 'author') || txt(ch, 'managingEditor') || kid(kid(ch, 'owner'), 'name')?.textContent?.trim() || '',
    description: txt(ch, 'summary') || txt(ch, 'description') || txt(ch, 'subtitle'),
    image: img(ch),
    link: web(txt(ch, 'link') || kid(ch, 'link')?.getAttribute('href')),
    language: txt(ch, 'language'),
    categories: [...cats],
    explicit: /^(yes|true|explicit)$/i.test(txt(ch, 'explicit')),
    funding: kids(ch, 'funding').map(f => ({ url: web(f.getAttribute('url')), label: f.textContent.trim() })).filter(f => f.url),
    complete: /^yes$/i.test(txt(ch, 'complete')),
    newFeedUrl: txt(ch, 'new-feed-url'),
    feedUrl,
  };
  const items = kids(ch, 'item').length ? kids(ch, 'item') : kids(ch, 'entry');
  const episodes = items.map((it) => {
    const enc = kid(it, 'enclosure') || kids(it, 'link').find(l => l.getAttribute('rel') === 'enclosure');
    const url = web(enc?.getAttribute('url') || enc?.getAttribute('href'));
    if (!url) return null;
    const trs = kids(it, 'transcript').map(t => ({ url: web(t.getAttribute('url')), type: t.getAttribute('type') || '', lang: t.getAttribute('language') || '' })).filter(t => t.url);
    const rank = (t) => /vtt/.test(t.type) ? 0 : /srt|subrip/.test(t.type) ? 1 : /json/.test(t.type) ? 2 : /html|plain/.test(t.type) ? 3 : 4;
    trs.sort((a, b) => rank(a) - rank(b));
    const psc = kid(it, 'chapters') && kid(it, 'chapters').namespaceURI?.includes('podlove') ? kids(kid(it, 'chapters'), 'chapter') : [];
    const date = Date.parse(txt(it, 'pubDate') || txt(it, 'published') || txt(it, 'updated')) || 0;
    return {
      guid: txt(it, 'guid') || url,
      title: txt(it, 'title') || 'Tập không tên',
      description: txt(it, 'encoded') || txt(it, 'description') || txt(it, 'summary') || txt(it, 'content'),
      url, mime: enc?.getAttribute('type') || '', size: +enc?.getAttribute('length') || 0,
      pubDate: date, duration: parseDuration(txt(it, 'duration')),
      image: img(it),
      season: +txt(it, 'season') || null, episode: +txt(it, 'episode') || null,
      type: txt(it, 'episodeType') || 'full',
      explicit: /^(yes|true|explicit)$/i.test(txt(it, 'explicit')),
      link: web(txt(it, 'link')),
      chaptersUrl: web(kids(it, 'chapters').find(c => c.getAttribute('url'))?.getAttribute('url')),
      chapters: psc.map(c => ({ start: parseTime(c.getAttribute('start')), title: c.getAttribute('title') || '', url: web(c.getAttribute('href')) })),
      transcripts: trs,
      persons: kids(it, 'person').map(p => ({ name: p.textContent.trim(), role: (p.getAttribute('role') || 'host').toLowerCase(), img: web(p.getAttribute('img')) })),
    };
  }).filter(Boolean);
  // Persons listed on the channel are the hosts of every episode.
  const hosts = kids(ch, 'person').map(p => ({ name: p.textContent.trim(), role: (p.getAttribute('role') || 'host').toLowerCase(), img: web(p.getAttribute('img')) }));
  show.persons = hosts;
  return { show, episodes };
}

// Transcript files → [{ start, end, text, speaker }]
export function parseTranscript(body, type = '') {
  const s = String(body || '');
  if (/json/.test(type) || /^\s*\{/.test(s)) {
    try {
      const j = JSON.parse(s);
      return (j.segments || []).map(x => ({ start: +x.startTime || 0, end: +x.endTime || 0, text: String(x.body || '').trim(), speaker: x.speaker || '' })).filter(c => c.text);
    } catch { /* fall through */ }
  }
  if (/-->/.test(s)) {
    const out = [];
    for (const block of s.replace(/\r/g, '').split(/\n\n+/)) {
      const lines = block.split('\n');
      const i = lines.findIndex(l => l.includes('-->'));
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->').map(x => parseTime(x.trim().split(' ')[0].replace(',', '.')));
      let text = lines.slice(i + 1).join(' ').trim(), speaker = '';
      const v = text.match(/^<v\s+([^>]+)>/); if (v) { speaker = v[1]; }
      text = text.replace(/<[^>]+>/g, '').trim();
      const sp = !speaker && text.match(/^([A-ZÀ-Ỹ][\wÀ-ỹ .'-]{1,30}):\s/); if (sp) { speaker = sp[1]; text = text.slice(sp[0].length); }
      if (text) out.push({ start: a, end: b, text, speaker });
    }
    return out;
  }
  // Plain text / HTML: one cue per paragraph, no times.
  const plain = s.replace(/<\/p>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  return plain.split(/\n+/).map(t => t.trim()).filter(Boolean).map(text => ({ start: -1, end: -1, text, speaker: '' }));
}

// podcast:chapters JSON → [{ start, title, img, url }]
export const parseChapters = (j) => (j?.chapters || []).filter(c => c.toc !== false).map(c => ({ start: +c.startTime || 0, title: c.title || '', img: web(c.img), url: web(c.url) }));

// OPML import / export (the standard way to move subscriptions between podcast apps).
export function parseOpml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]')].map(o => ({ title: o.getAttribute('title') || o.getAttribute('text') || '', feedUrl: o.getAttribute('xmlUrl') || o.getAttribute('xmlurl') }));
}
export function toOpml(shows) {
  const e = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>My Hub — Podcast</title></head><body>\n${shows.map(s => `  <outline type="rss" text="${e(s.title)}" title="${e(s.title)}" xmlUrl="${e(s.feedUrl)}"/>`).join('\n')}\n</body></opml>\n`;
}
