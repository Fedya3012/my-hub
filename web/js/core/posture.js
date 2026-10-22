// Device posture for foldables (Galaxy Z Flip) and small windows. One place decides how the device is held and
// writes it to <body data-posture="…">; apps only style against it (css/foldable.css, docs/FOLDABLE.md).
//   open     main screen, flat (or any ordinary phone / desktop)
//   flex     main screen half-folded, crease horizontal: content above --fold-y, controls below
//   cover    cover screen (Flex Window) or any small near-square window: Quick View (core/cover.js)
// Also: body.tall (screen at least twice as tall as wide: one-handed layout), CSS vars --fold-y / --fold-h,
// and bus 'posture:change' { posture, prev, fold } for apps that need JS (e.g. the reader re-paginates).
// Sources, best first: the native Posture plugin (APK, Jetpack WindowManager), the web Viewport Segments /
// Device Posture APIs, then window size. Settings: ui.foldAuto (follow the device), ui.foldPreview (force one).
import { bus } from './bus.js';
import { debounce } from './perf.js';

const COVER_MAX_SIDE = 480;   // shorter side in CSS px below which a near-square window counts as a cover screen
const COVER_MAX_RATIO = 1.35; // long side / short side
const FOLD_PAD = 24;          // keep this far from the crease (CSS px each side)

let posture = 'open', fold = null, native = null, auto = true, preview = '';
let started = false;

export const currentPosture = () => posture;
export const foldInfo = () => fold;

function fromSize() {
  const w = innerWidth, h = innerHeight, short = Math.min(w, h), long = Math.max(w, h);
  return short <= COVER_MAX_SIDE && long / short <= COVER_MAX_RATIO ? 'cover' : 'open';
}

// The web Viewport Segments API: two stacked segments = folded with a horizontal crease.
function webFold() {
  try {
    const segs = window.viewport?.segments;
    if (segs?.length === 2 && segs[0].bottom <= segs[1].top) return { top: segs[0].bottom, bottom: segs[1].top };
  } catch { /* not supported */ }
  if (navigator.devicePosture?.type === 'folded' && matchMedia('(orientation: portrait)').matches) return { top: innerHeight / 2, bottom: innerHeight / 2 };
  return null;
}

function decide() {
  if (preview) return { p: preview, f: preview === 'flex' ? { top: innerHeight / 2, bottom: innerHeight / 2 } : null };
  if (!auto) return { p: 'open', f: null };
  if (native) {
    if (native.cover) return { p: 'cover', f: null };
    if (native.fold === 'half' && native.orientation === 'horizontal' && native.winH) {
      const k = innerHeight / native.winH;   // dp -> CSS px of this page
      return { p: 'flex', f: { top: native.top * k, bottom: native.bottom * k } };
    }
  }
  const wf = webFold();
  if (wf) return { p: 'flex', f: wf };
  return { p: fromSize(), f: null };
}

function apply() {
  const { p, f } = decide(), b = document.body, root = document.documentElement.style;
  b.classList.toggle('tall', innerHeight / Math.max(1, innerWidth) >= 2 && innerWidth <= 860);
  fold = f;
  if (f) {
    root.setProperty('--fold-y', Math.round(f.top) + 'px');
    root.setProperty('--fold-h', Math.round(f.bottom - f.top + FOLD_PAD * 2) + 'px');
  } else { root.removeProperty('--fold-y'); root.removeProperty('--fold-h'); }
  if (p === posture && b.dataset.posture === p) return;
  const prev = posture;
  posture = p; b.dataset.posture = p;
  bus.emit('posture:change', { posture: p, prev, fold: f });
}

// Settings hooks (core/params-core.js).
export function setFoldAuto(v) { auto = !!+v; if (started) apply(); }
export function setFoldPreview(v) { preview = ['open', 'flex', 'cover'].includes(v) ? v : ''; if (started) apply(); }

export function initPosture() {
  if (started) return;
  started = true;
  apply();
  const later = debounce(apply, 120);
  addEventListener('resize', later);
  screen.orientation?.addEventListener?.('change', later);
  navigator.devicePosture?.addEventListener?.('change', later);
  const P = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.Posture;
  if (P) {
    const take = (s) => { native = s; apply(); };
    P.addListener('change', take);
    P.getState().then(take).catch(() => { /* older APK without the plugin */ });
    // A move between screens resizes the page; the display id comes with getState.
    addEventListener('resize', debounce(() => P.getState().then(take).catch(() => {}), 200));
  }
}
