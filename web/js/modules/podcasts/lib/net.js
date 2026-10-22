// Network for Podcast: feeds, search APIs, chapters, transcripts. Most podcast hosts send no CORS headers, so:
//   Windows / Android app → through the shell (core/storage/http.js, no CORS);
//   browser               → plain fetch, then the CORS proxy from Cài đặt (podcasts.corsProxy) if one is set.
import { http, nativeShell } from '../../../core/storage/http.js';
import { get } from './prefs.js';

const err = (m, code) => Object.assign(new Error(m), { code });

export async function fetchText(url, { signal, json = false } = {}) {
  let r;
  if (nativeShell()) r = await http(url, { viaShell: true, signal });
  else {
    try { r = await http(url, { signal }); }
    catch (e) {
      if (e?.name === 'AbortError') throw e;
      const proxy = get('corsProxy');
      if (!proxy) throw err('Máy chủ này chặn trình duyệt (CORS). Dùng app Windows/Android, hoặc đặt Proxy CORS trong Cài đặt của Podcast.', 'cors');
      r = await http(proxy + encodeURIComponent(url), { signal });
    }
  }
  if (!r.ok) throw err(`Máy chủ trả lỗi ${r.status}`, 'http');
  const t = await r.text();
  if (!json) return t;
  try { return JSON.parse(t); } catch { throw err('Dữ liệu trả về không đọc được', 'parse'); }
}
export const fetchJson = (url, o = {}) => fetchText(url, { ...o, json: true });

// Short stable hash (FNV-1a 64 → base36) for ids made from feed URLs and guids.
export function hash(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
export const normFeed = (u) => String(u || '').trim().replace(/^feed:\/\//i, 'https://').replace(/^itpc:\/\//i, 'https://').replace(/^pcast:\/\//i, 'https://');
