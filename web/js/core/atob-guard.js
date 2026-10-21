// atob() is strict: it throws on whitespace, URL-safe characters ("-" "_") and missing padding, which some
// servers and tokens produce. Accept those, and when the text is really not base64 say where it was
// called from, so the error can be traced instead of a bare "Failed to execute 'atob'".
const native = window.atob.bind(window);
window.atob = (s) => {
  try { return native(s); } catch (e) {
    const t = String(s).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    try { return native(t + '='.repeat((4 - t.length % 4) % 4)); } catch { /* fall through */ }
    const where = (new Error().stack || '').split('\n').slice(2, 4).map(l => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '')).join(' < ');
    throw Object.assign(new Error(`${e.message} (${String(s).length} ký tự, gọi từ ${where || '?'})`), { name: e.name });
  }
};
