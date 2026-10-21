// One HTTP function for the cloud drives (WebDAV, Dropbox). Where the page can use plain fetch it does;
// WebDAV servers rarely send CORS headers, so the apps route those calls through the shell:
//   Windows app  → main process (window.hubDesktop.http, no CORS)
//   Android app  → Capacitor's native HTTP plugin (no CORS; GET / PUT / DELETE only, which is all we use)
// Result: { status, ok, header(name), text(), blob() }. Progress: onProgress(done, total) where available.
const err = (message, code) => Object.assign(new Error(message), { code });

const wrap = (status, headers, buf, type) => {
  const h = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status, ok: status >= 200 && status < 300, header: (n) => h.get(n.toLowerCase()) ?? null,
    text: async () => new TextDecoder().decode(buf), blob: async () => new Blob([buf], { type: type || h.get('content-type') || 'application/octet-stream' }) };
};
const toBuf = async (body) => body == null ? null : typeof body === 'string' ? body : await body.arrayBuffer();
const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;

export const nativeShell = () => !!window.hubDesktop?.http || !!(window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.CapacitorHttp);

// opts: { method, headers, body (string | Blob), signal, onProgress(done,total), viaShell }
export async function http(url, { method = 'GET', headers = {}, body, signal, onProgress, viaShell = false } = {}) {
  if (signal?.aborted) throw Object.assign(new Error('Đã huỷ'), { name: 'AbortError' });
  try {
    if (viaShell && window.hubDesktop?.http) {
      const r = await window.hubDesktop.http({ url, method, headers, body: await toBuf(body) });
      onProgress?.(1, 1);
      return wrap(r.status, r.headers, r.body);
    }
    if (viaShell && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.CapacitorHttp) {
      const isBlobBody = body != null && typeof body !== 'string';
      const r = await window.Capacitor.Plugins.CapacitorHttp.request({
        url, method, headers, responseType: method === 'GET' ? 'blob' : 'text',
        ...(body == null ? {} : isBlobBody ? { data: b64(await body.arrayBuffer()), dataType: 'file' } : { data: body }),
      });
      onProgress?.(1, 1);
      const raw = r.data;
      // Only a successful GET comes back as base64 (responseType 'blob'); error bodies such as a 404 are plain text or JSON.
      const asText = () => new TextEncoder().encode(typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw)).buffer;
      const buf = method !== 'GET' || raw == null || r.status < 200 || r.status >= 300 ? asText() : (() => { try { return unb64(raw); } catch { return asText(); } })();
      return wrap(r.status, r.headers, buf);
    }
    const res = await fetch(url, { method, headers, body, signal, cache: 'no-store' });
    return {
      status: res.status, ok: res.ok, header: (n) => res.headers.get(n),
      text: () => res.text(),
      blob: async () => {   // streamed so a big download can report progress
        const total = +res.headers.get('content-length') || 0;
        if (!res.body || !onProgress || !total) return res.blob();
        const parts = []; let done = 0;
        const rd = res.body.getReader();
        for (;;) { const { value, done: end } = await rd.read(); if (end) break; parts.push(value); done += value.length; onProgress(done, total); }
        return new Blob(parts, { type: res.headers.get('content-type') || 'application/octet-stream' });
      },
    };
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    if (e?.code) throw e;
    const why = String(e?.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '').slice(0, 160);
    throw err(viaShell && !nativeShell()
      ? 'Trình duyệt không cho gọi máy chủ này (thiếu CORS). Dùng app Windows hoặc Android, hoặc bật CORS cho máy chủ WebDAV.'
      : `Không kết nối được máy chủ. Kiểm tra mạng và địa chỉ. (${why})`, 'offline');
  }
}
