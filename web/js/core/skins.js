// Skins: a whole look on top of the light/dark theme. A skin is a token set (palette for light
// and dark, fonts, radii, shadows, glass/blur, motion curves, card style, density, Now Playing
// layout) written as CSS custom properties, plus an optional stylesheet css/skins/<id>.css for
// decoration that tokens cannot express. <html data-skin data-mode> carries the active one; a
// module can override it (the module's root element then gets its own data-skin + vars).
// Only the fonts of skins actually on screen are loaded (Google Fonts, Vietnamese subset).
import { getSetting, setSetting, uid } from './db.js';
import { fontCss } from './fonts.js';

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Shared non-colour defaults. Every skin starts from these.
const BASE = {
  '--radius': '12px', '--blur': '18px', '--glass': '82%',
  '--ease-out': 'cubic-bezier(.2, .8, .2, 1)', '--ease-spring': 'cubic-bezier(.34, 1.4, .64, 1)',
  '--dur-1': '120ms', '--dur-2': '220ms', '--dur-3': '380ms',
  '--hover-lift': '-2px', '--press-scale': '.97',
  '--card-border': '1px', '--card-shadow': 'none', '--card-pad': '1',
  '--title-weight': '700', '--title-tracking': '-.02em', '--eyebrow-case': 'uppercase',
  '--page-glow': 'none', '--gap': '16px',
};

export const BUILTIN_SKINS = [
  {
    id: 'classic', name: 'Kệ sách', desc: 'Mặc định: phẳng, yên tĩnh, chữ có chân cho tiêu đề',
    ref: null, np: 'classic', vis: 'bars',
    fonts: { families: ['Be Vietnam Pro:wght@400;500;600;700', 'Literata:opsz,wght@7..72,600;7..72,700'],
      display: "'Literata', Georgia, serif", body: `'Be Vietnam Pro', ${SANS}` },
    tokens: {},
    palette: null,   // keeps the colours of the chosen theme (Sáng, Tối, Giấy…)
    preview: { light: ['#eef1f4', '#ffffff', '#1d6f8f', '#17202b'], dark: ['#0f1419', '#171e26', '#5cb8d6', '#e6ebf1'] },
  },
  {
    id: 'aurora', name: 'Aurora Glass', desc: 'Web app nghe nhạc tối, kính mờ, bìa lớn, thẻ bo tròn, dải màu tím hồng',
    ref: 'Dribbble · Music Streaming Web App Design', np: 'hero', vis: 'fluid', prefer: 'dark',
    fonts: { families: ['Plus Jakarta Sans:wght@400;500;600;700;800'],
      display: `'Plus Jakarta Sans', ${SANS}`, body: `'Plus Jakarta Sans', ${SANS}` },
    tokens: { '--radius': '20px', '--blur': '24px', '--glass': '62%', '--hover-lift': '-4px',
      '--card-shadow': '0 10px 30px rgb(0 0 0 / .18)', '--title-weight': '800', '--title-tracking': '-.03em', '--eyebrow-case': 'none',
      '--ease-out': 'cubic-bezier(.16, 1, .3, 1)', '--dur-3': '460ms' },
    palette: {
      dark: { '--bg': '#0a0a14', '--surface': '#14142a', '--surface-2': '#1f1f3a', '--line': '#2a2a4a', '--fg': '#f4f2ff', '--muted': '#a5a3c7',
        '--accent': '#a78bfa', '--accent-2': '#f472b6', '--accent-fg': '#140a2e',
        '--page-glow': 'radial-gradient(60% 50% at 85% -10%, rgb(167 139 250 / .22), transparent 70%), radial-gradient(50% 40% at 0% 100%, rgb(244 114 182 / .14), transparent 70%)' },
      light: { '--bg': '#f3f1fb', '--surface': '#ffffff', '--surface-2': '#ebe7f8', '--line': '#ddd7f0', '--fg': '#1a1530', '--muted': '#625d80',
        '--accent': '#7c3aed', '--accent-2': '#db2777', '--accent-fg': '#ffffff',
        '--page-glow': 'radial-gradient(60% 50% at 85% -10%, rgb(124 58 237 / .14), transparent 70%), radial-gradient(50% 40% at 0% 100%, rgb(219 39 119 / .08), transparent 70%)' },
    },
    preview: { light: ['#f3f1fb', '#ffffff', '#7c3aed', '#1a1530'], dark: ['#0a0a14', '#1f1f3a', '#a78bfa', '#f4f2ff'] },
  },
  {
    id: 'pop', name: 'Kẹo dẻo', desc: 'Prototype vui nhộn: màu cam chanh, góc bo to, chuyển động nảy',
    ref: 'Dribbble · Music App Prototype', np: 'card', vis: 'ribbons',
    fonts: { families: ['Lexend:wght@400;500;600;700;800'],
      display: `'Lexend', ${SANS}`, body: `'Lexend', ${SANS}` },
    tokens: { '--radius': '26px', '--hover-lift': '-6px', '--press-scale': '.94', '--card-border': '2px', '--glass': '90%',
      '--card-shadow': '0 6px 0 rgb(0 0 0 / .08)', '--title-weight': '800', '--title-tracking': '-.035em', '--eyebrow-case': 'none',
      '--ease-out': 'cubic-bezier(.34, 1.56, .64, 1)', '--ease-spring': 'cubic-bezier(.34, 1.8, .64, 1)', '--dur-2': '260ms', '--dur-3': '520ms' },
    palette: {
      light: { '--bg': '#fff6ea', '--surface': '#ffffff', '--surface-2': '#ffecd6', '--line': '#f2dcc2', '--fg': '#231a14', '--muted': '#7a6656',
        '--accent': '#d63d17', '--accent-2': '#ffc23d', '--accent-fg': '#ffffff',
        '--page-glow': 'radial-gradient(40% 30% at 100% 0%, rgb(255 194 61 / .35), transparent 70%)' },
      dark: { '--bg': '#1b1410', '--surface': '#271d17', '--surface-2': '#33271f', '--line': '#43342a', '--fg': '#fff1e4', '--muted': '#c2a893',
        '--accent': '#ff8a5c', '--accent-2': '#ffd166', '--accent-fg': '#2a1206',
        '--page-glow': 'radial-gradient(40% 30% at 100% 0%, rgb(255 138 92 / .18), transparent 70%)' },
    },
    preview: { light: ['#fff6ea', '#ffffff', '#e8461f', '#231a14'], dark: ['#1b1410', '#33271f', '#ff8a5c', '#fff1e4'] },
  },
  {
    id: 'noir', name: 'Neon Noir', desc: 'Đen sâu, viền neon xanh lơ và hồng, chữ gọn chặt, phổ âm phát sáng',
    ref: 'Pinterest · dark neon music player', np: 'immersive', vis: 'neon', prefer: 'dark',
    fonts: { families: ['Inter Tight:wght@400;500;600;700;800'],
      display: `'Inter Tight', ${SANS}`, body: `'Inter Tight', ${SANS}` },
    tokens: { '--radius': '10px', '--blur': '16px', '--glass': '70%', '--title-weight': '800', '--title-tracking': '-.04em',
      '--card-shadow': '0 0 0 1px rgb(0 229 255 / .06), 0 10px 30px rgb(0 0 0 / .35)', '--dur-2': '180ms', '--dur-3': '320ms' },
    palette: {
      dark: { '--bg': '#05050a', '--surface': '#0d0d16', '--surface-2': '#161624', '--line': '#232338', '--fg': '#e9fbff', '--muted': '#8a96ad',
        '--accent': '#22e1ff', '--accent-2': '#ff3bd4', '--accent-fg': '#001a20',
        '--page-glow': 'radial-gradient(50% 40% at 100% 0%, rgb(34 225 255 / .12), transparent 70%), radial-gradient(40% 40% at 0% 100%, rgb(255 59 212 / .1), transparent 70%)' },
      light: { '--bg': '#eef2f7', '--surface': '#ffffff', '--surface-2': '#e2e8f0', '--line': '#cfd8e3', '--fg': '#0b1220', '--muted': '#55627a',
        '--accent': '#007a96', '--accent-2': '#c0179b', '--accent-fg': '#ffffff' },
    },
    preview: { light: ['#eef2f7', '#ffffff', '#0087a6', '#0b1220'], dark: ['#05050a', '#161624', '#22e1ff', '#ff3bd4'] },
  },
  {
    id: 'editorial', name: 'Tạp chí', desc: 'Kiểu trang chủ tạp chí: tiêu đề serif lớn, nền giấy kem, đường kẻ mảnh',
    ref: 'Pinterest · editorial homepage typography', np: 'editorial', vis: 'ribbons',
    fonts: { families: ['Fraunces:opsz,wght@9..144,500;9..144,700', 'Manrope:wght@400;500;600;700'],
      display: "'Fraunces', Georgia, serif", body: `'Manrope', ${SANS}` },
    tokens: { '--radius': '6px', '--title-weight': '600', '--title-tracking': '-.025em', '--card-border': '1px', '--hover-lift': '-1px',
      '--ease-out': 'cubic-bezier(.25, .1, .25, 1)', '--dur-3': '420ms', '--glass': '94%' },
    palette: {
      light: { '--bg': '#f4efe6', '--surface': '#fbf8f2', '--surface-2': '#ebe4d6', '--line': '#d9cfbd', '--fg': '#1d1a16', '--muted': '#6b6256',
        '--accent': '#b5400f', '--accent-2': '#1d4e89', '--accent-fg': '#ffffff' },
      dark: { '--bg': '#14120f', '--surface': '#1d1a16', '--surface-2': '#29251f', '--line': '#3a342b', '--fg': '#f1ebe0', '--muted': '#a99f8f',
        '--accent': '#f08a4b', '--accent-2': '#8fb4e3', '--accent-fg': '#1f0e04' },
    },
    preview: { light: ['#f4efe6', '#fbf8f2', '#b5400f', '#1d1a16'], dark: ['#14120f', '#29251f', '#f08a4b', '#f1ebe0'] },
  },
];

const byId = (list, id) => list.find(s => s.id === id);
let custom = [];   // user skins (settings 'theme.customSkins')
const LS = 'hub.skin.boot';   // tiny sync cache so the right fonts/attributes are set before the DB opens

export async function loadCustomSkins() { custom = await getSetting('theme.customSkins', []); return custom; }
export function allSkins() { return [...BUILTIN_SKINS, ...custom.map(s => ({ ...s, custom: true }))]; }
export function getSkin(id) { return byId(allSkins(), id) || BUILTIN_SKINS[0]; }
export const currentSkinId = () => getSetting('theme.skin', 'classic');
export const moduleOverrides = () => getSetting('theme.skinByModule', {});

// Full var map for a skin in a mode. themeVars are the active theme's colours (used when the
// skin keeps the theme palette). Custom skins inherit their 'extends' skin.
export function skinVars(skin, mode, themeVars = {}) {
  const parent = skin.extends ? byId(BUILTIN_SKINS, skin.extends) : null;
  const pal = skin.palette || parent?.palette;
  const colours = pal ? { ...(pal[mode] || pal.dark || pal.light) } : { ...themeVars };
  const v = { ...BASE, ...(parent?.tokens || {}), ...skin.tokens, ...colours,
    '--font-display': skin.fonts?.display || parent?.fonts.display, '--font-body': skin.fonts?.body || parent?.fonts.body };
  if (!v['--accent-2']) v['--accent-2'] = 'var(--accent)';
  return v;
}

// ── Asset loading: fonts + skin stylesheet, only for skins in use ──

export function ensureSkinAssets(ids) {
  const want = new Set(ids);
  for (const id of want) {
    const s = getSkin(id), base = s.extends ? byId(BUILTIN_SKINS, s.extends) : s;
    const fam = s.fonts?.families?.length ? s.fonts.families : base.fonts.families;
    // One local stylesheet per family (web/vendor/fonts); a family that does not ship falls back to the CSS stack.
    fam.map(fontCss).forEach((href, i) => { if (href) link(`skin-font-${s.id}~${i}`, href); });
    if (base.id !== 'classic') link('skin-css-' + base.id, new URL(`../../css/skins/${base.id}.css`, import.meta.url).href);
  }
  // Drop links of skins no longer on screen.
  for (const l of document.querySelectorAll('link[data-skin-asset]')) {
    const id = l.dataset.skinAsset;
    if (id === 'preview') continue;
    const used = [...want].some(w => { const s = getSkin(w); return id === s.id || id === (s.extends || s.id); });
    if (!used) l.remove();
  }
}
function link(key, href) {
  const id = key.replace(/^skin-(font|css)-/, '').replace(/~\d+$/, '');
  let l = document.getElementById(key);
  if (l) return l;
  l = Object.assign(document.createElement('link'), { id: key, rel: 'stylesheet', href });
  l.dataset.skinAsset = id;
  document.head.appendChild(l);
  return l;
}

// Picker previews: the local stylesheet of every skin's families (unicode-range keeps the download to the glyphs shown).
export function previewFonts() {
  const fams = [...new Set(allSkins().flatMap(s => s.fonts?.families || []))];
  fams.map(fontCss).filter(Boolean).forEach((href, i) => link(`skin-font-preview~${i}`, href));
}

// Boot: apply cached skin attributes + font links synchronously (no flash of the wrong font).
export function bootSkin() {
  try {
    const c = JSON.parse(localStorage.getItem(LS) || 'null');
    if (!c) return;
    document.documentElement.dataset.skin = c.id;
    // Only local font files (a cache written by an older version may still name Google Fonts).
    if (c.fonts) for (const [k, href] of Object.entries(c.fonts)) if (new URL(href, location.href).origin === location.origin) link(k, href);
  } catch {}
}
export function rememberBoot(id) {
  try {
    const fonts = {};
    document.querySelectorAll('link[data-skin-asset]').forEach(l => { if (l.dataset.skinAsset !== 'preview') fonts[l.id] = l.href; });
    localStorage.setItem(LS, JSON.stringify({ id, fonts }));
  } catch {}
}

// ── Import / export ──
const SAFE = /^[#\w(),.%\s'"/+*:-]+$/;
const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => /^--[\w-]+$/.test(k) && typeof v === 'string' && v.length < 400 && SAFE.test(v) && !/url\s*\(|expression|javascript:/i.test(v)));
const famOk = (f) => typeof f === 'string' && /^[A-Za-z0-9 ]+(:[\w@;.,]+)?$/.test(f);

export function exportSkin(id) {
  const s = getSkin(id), parent = s.extends ? byId(BUILTIN_SKINS, s.extends) : null;
  return { format: 'my-hub-skin', version: 1, skin: {
    name: s.name, desc: s.desc || '', extends: s.extends || s.id, np: s.np || parent?.np, vis: s.vis || parent?.vis,
    fonts: s.fonts || parent.fonts, tokens: { ...(parent?.tokens || {}), ...s.tokens }, palette: s.palette || parent?.palette || null } };
}

export async function importSkin(json) {
  const j = json?.skin;
  if (json?.format !== 'my-hub-skin' || !j) throw new Error('Tệp không phải skin My Hub.');
  const ext = byId(BUILTIN_SKINS, j.extends) ? j.extends : 'classic';
  const fams = (j.fonts?.families || []).filter(famOk).slice(0, 3);
  const fontStack = (v, fb) => typeof v === 'string' && /^[\w\s'",.-]+$/.test(v) ? v : fb;
  const parent = byId(BUILTIN_SKINS, ext);
  const s = {
    id: 'skin-' + uid().slice(0, 8), name: String(j.name || 'Skin nhập').slice(0, 40), desc: String(j.desc || '').slice(0, 140), extends: ext,
    np: ['classic', 'hero', 'card', 'immersive', 'editorial'].includes(j.np) ? j.np : parent.np,
    vis: ['bars', 'fluid', 'neon', 'sphere', 'bars3d', 'ribbons'].includes(j.vis) ? j.vis : parent.vis,
    fonts: fams.length ? { families: fams, display: fontStack(j.fonts.display, parent.fonts.display), body: fontStack(j.fonts.body, parent.fonts.body) } : null,
    tokens: clean(j.tokens),
    palette: j.palette && (j.palette.light || j.palette.dark) ? { light: clean(j.palette.light || j.palette.dark), dark: clean(j.palette.dark || j.palette.light) } : null,
  };
  const P = s.palette || parent.palette;
  const pv = (m) => P ? [P[m]['--bg'], P[m]['--surface-2'] || P[m]['--surface'], P[m]['--accent'], P[m]['--fg']] : parent.preview[m];
  s.preview = { light: pv('light'), dark: pv('dark') };
  custom = [...(await loadCustomSkins()), s];
  await setSetting('theme.customSkins', custom);
  return s;
}

export async function deleteSkin(id) {
  custom = (await loadCustomSkins()).filter(s => s.id !== id);
  await setSetting('theme.customSkins', custom);
}
