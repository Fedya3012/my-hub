// Content Security Policy, added as a <meta> tag at the very start of app.js. Added from script, not written in
// index.html, because the Android shell (Capacitor) injects its bridge as an inline script into the page on some
// WebViews: by the time this runs the bridge has already run, and from here on the policy blocks injected or
// inline scripts, plugins and foreign forms. Network hosts stay open (https:, and http: for podcast feeds and
// covers) because podcasts, covers and lyrics come from any server.
const POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",   // blob: because the on-device lyrics AI library imports its own modules from blob URLs
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https: http:",
  "connect-src 'self' data: blob: https: http:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: about:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

if (!document.querySelector('meta[http-equiv="Content-Security-Policy"]')) {
  const m = document.createElement('meta');
  m.httpEquiv = 'Content-Security-Policy';
  m.content = POLICY;
  document.head.prepend(m);
}
