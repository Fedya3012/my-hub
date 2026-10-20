// Now Playing effects layer: the visualizer theme behind the player / the lyrics, the small
// spectrum strip, and colour sync with the background video (dominant + accent colours sampled
// from the frames about once a second on a tiny offscreen canvas, smoothed, contrast-checked,
// then applied to waves, icons, text, progress bar and buttons).
import { Visualizer } from './visualizer.js';
import { player } from '../lib/player.js';
import { prefs } from '../lib/prefs.js';

const rgb = (h) => { const m = String(h || '').match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i); return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : null; };
const toHex = (c) => '#' + c.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, s, l];
}
function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
// Lighten until it reads on the darkened backdrop (WCAG AA 4.5:1 against near-black shade).
function readable(c, bg = [12, 12, 16], min = 4.5) {
  let [h, s, l] = hsl(c);
  s = Math.min(1, Math.max(s, 0.35));
  let out = fromHsl(h, s, Math.max(l, 0.45));
  for (let i = 0; i < 12 && contrast(out, bg) < min; i++) { l = Math.min(0.95, Math.max(l, 0.45) + 0.05 * (i + 1)); out = fromHsl(h, s, l); }
  return out;
}

// Dominant = most populated hue bucket (weighted by pixel count), accent = the most saturated,
// reasonably bright bucket with a different hue.
export function paletteOf(data) {
  const B = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const c = [data[i], data[i + 1], data[i + 2]], [h, s, l] = hsl(c);
    const key = s < 0.12 ? 'n' + Math.round(l * 4) : Math.round(h / 24) % 15 + ':' + (l < 0.35 ? 0 : 1);
    const b = B.get(key) || { n: 0, r: 0, g: 0, b: 0, s: 0 };
    b.n++; b.r += c[0]; b.g += c[1]; b.b += c[2]; b.s += s * (1 - Math.abs(l - 0.55));
    B.set(key, b);
  }
  const list = [...B.values()].map(b => ({ c: [b.r / b.n, b.g / b.n, b.b / b.n], n: b.n, s: b.s / b.n }));
  if (!list.length) return null;
  list.sort((a, b) => b.n - a.n);
  const dom = list[0].c, dh = hsl(dom)[0];
  const acc = [...list].filter(x => x.n > 2).sort((a, b) => (b.s * Math.sqrt(b.n)) - (a.s * Math.sqrt(a.n)))
    .find(x => Math.abs(hsl(x.c)[0] - dh) > 25 || hsl(dom)[1] < 0.15) || list[1] || list[0];
  return { dom, acc: acc.c };
}

export function attachFx(el) {
  const fxCv = el.querySelector('.mnp-fx'), stripCv = el.querySelector('.mnp-vis');
  const analyser = () => player.engine.analyser || null, playing = () => player.playing;
  const fx = { base: null, vid: null, theme: null };
  fx.strip = stripCv ? new Visualizer(stripCv, { theme: 'bars', analyser, playing, mode: 'strip' }) : null;
  fx.bg = null;

  // Which theme? the pref, else the skin's own (data-skin on Now Playing or the app).
  const skinTheme = () => ({ classic: 'bars', aurora: 'fluid', pop: 'ribbons', noir: 'neon', editorial: 'ribbons' }[(el.dataset.skinBase || document.documentElement.dataset.skinBase)] || 'bars');

  fx.update = (panel) => {
    const P = prefs().np;
    const theme = P.fx === 'off' ? null : (P.fx || skinTheme());
    const where = P.fxWhere || 'both';
    const show = !!theme && (where === 'both' || (where === 'lyrics' ? panel === 'lyrics' : panel !== 'lyrics' || matchMedia('(min-width: 1000px)').matches));
    el.dataset.fx = show ? theme : '';
    el.dataset.fxWhere = where;
    el.style.setProperty('--fx-o', P.fxIntensity ?? 0.8);
    if (show) {
      if (!fx.bg) { const cv = el.querySelector('.mnp-fx'); fx.bg = new Visualizer(cv, { theme, analyser, playing, input: el }); fx.applyColors(); }
      else fx.bg.setTheme(theme);
      fx.bg.start();
    } else fx.bg?.stop();
    if (fx.strip) P.visualizer ? fx.strip.start() : fx.strip.stop();
  };

  // Colours: album palette by default, the video's when it is showing (and the option is on).
  fx.setBase = (c) => { fx.base = c; fx.applyColors(); };
  fx.applyColors = () => {
    const v = fx.vid, b = fx.base;
    const list = v ? [v.acc, v.dom, readable(v.dom)] : b ? [b.light, b.accent, b.dark].map(rgb).filter(Boolean) : null;
    const fallback = getComputedStyle(el).getPropertyValue('--accent').trim();
    const cols = list?.length ? list : [rgb(fallback) || [167, 139, 250], [244, 114, 182], [34, 225, 255]];
    fx.bg?.setColors(cols); fx.strip?.setColors([cols[0], cols[1] || cols[0]]);
  };

  // ── Video colour sampler (≈1 Hz, 32×18 px, exponentially smoothed) ──
  const cnv = document.createElement('canvas'); cnv.width = 32; cnv.height = 18;
  const g = cnv.getContext('2d', { willReadFrequently: true });
  let timer = 0, sm = null;
  const sample = () => {
    const video = el.querySelector('.mnp-video video');
    if (!video || video.readyState < 2 || document.hidden || el.dataset.video !== '1') return;
    try { g.drawImage(video, 0, 0, 32, 18); } catch { return; }
    let d; try { d = g.getImageData(0, 0, 32, 18).data; } catch { return; }   // cross-origin clip: no colour sync
    const p = paletteOf(d);
    if (!p) return;
    const k = sm ? 0.35 : 1;
    sm = sm ? { dom: sm.dom.map((x, i) => x + (p.dom[i] - x) * k), acc: sm.acc.map((x, i) => x + (p.acc[i] - x) * k) } : p;
    paint(sm);
  };
  const paint = (s) => {
    const acc = readable(s.acc), tint = fromHsl(hsl(s.dom)[0], Math.min(0.35, hsl(s.dom)[1]), 0.93);
    const bg = fromHsl(hsl(s.dom)[0], Math.min(0.5, hsl(s.dom)[1]), 0.12);
    el.style.setProperty('--np-acc', toHex(acc));
    el.style.setProperty('--np-bg', toHex(bg));
    el.style.setProperty('--np-fg', toHex(contrast(tint, [0, 0, 0]) > 7 ? tint : [255, 255, 255]));
    el.style.setProperty('--np-acc-fg', lum(acc) > 0.35 ? '#0b0b0f' : '#ffffff');
    el.dataset.vcolors = '1';
    document.querySelector('.mdock')?.style.setProperty('--m-acc', toHex(acc));
    fx.vid = s; fx.applyColors();
  };
  fx.video = (on) => {
    const want = on && !!prefs().np.videoColors;
    if (want && !timer) { timer = setInterval(sample, 1000); setTimeout(sample, 250); }
    if (!want && timer) {
      clearInterval(timer); timer = 0; sm = null;
      if (fx.vid) { fx.vid = null; delete el.dataset.vcolors; for (const p of ['--np-fg', '--np-acc-fg']) el.style.removeProperty(p); fx.restore?.(); fx.applyColors(); }
    }
  };
  fx.destroy = () => { fx.video(false); fx.bg?.destroy(); fx.strip?.destroy(); };
  return fx;
}

// Ambient backdrop, pre-blurred once into a 64 px image: the browser's smooth upscale does the
// blur, so the drifting layer no longer runs a 70 px CSS blur on every composited frame.
const blurCache = new Map();
export function preblur(url) {
  if (!url) return Promise.resolve(null);
  if (blurCache.has(url)) return blurCache.get(url);
  const p = new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d');
        g.filter = 'blur(3px) saturate(1.7) brightness(.75)';
        g.drawImage(img, -6, -6, 76, 76);
        res(c.toDataURL('image/jpeg', 0.85));
      } catch { res(null); }
    };
    img.onerror = () => res(null);
    img.src = url;
  });
  blurCache.set(url, p);
  if (blurCache.size > 12) blurCache.delete(blurCache.keys().next().value);
  return p;
}
