// Theme system: built-in themes + user themes (db.themes), each a set of CSS variables.
// 'system' follows the OS light/dark setting (handled purely in CSS).
// Extra knobs on top of any theme: accent colour, corner radius, text size, density.
import { db, uid, getSetting, setSetting } from './db.js';
import { bus } from './bus.js';
import { getSkin, skinVars, currentSkinId, moduleOverrides, ensureSkinAssets, loadCustomSkins, bootSkin, rememberBoot } from './skins.js';

bootSkin();   // cached skin attributes + font links before the DB opens

const LIGHT = {
  '--bg': '#eef1f4', '--surface': '#ffffff', '--surface-2': '#e4e8ee', '--line': '#d3d9e1',
  '--fg': '#17202b', '--muted': '#5b6878', '--accent': '#1d6f8f', '--accent-fg': '#ffffff',
};
const DARK = {
  '--bg': '#0f1419', '--surface': '#171e26', '--surface-2': '#202a35', '--line': '#2c3845',
  '--fg': '#e6ebf1', '--muted': '#94a2b3', '--accent': '#5cb8d6', '--accent-fg': '#06222d',
};

export const BUILTIN_THEMES = [
  { id: 'system', name: 'Theo hệ thống', base: 'auto', vars: {} },
  { id: 'light', name: 'Sáng', base: 'light', vars: LIGHT },
  { id: 'dark', name: 'Tối', base: 'dark', vars: DARK },
  { id: 'paper', name: 'Giấy đọc sách', base: 'light', vars: { ...LIGHT,
    '--bg': '#ece6da', '--surface': '#f7f3ea', '--surface-2': '#e2dacb', '--line': '#d2c8b5',
    '--fg': '#2b241a', '--muted': '#6e6352', '--accent': '#7a4f2a', '--accent-fg': '#fff8ee' } },
  { id: 'amoled', name: 'AMOLED đen', base: 'dark', vars: { ...DARK,
    '--bg': '#000000', '--surface': '#0b0d10', '--surface-2': '#15191e', '--line': '#232931' } },
  { id: 'dusk', name: 'Hoàng hôn', base: 'dark', vars: { ...DARK,
    '--bg': '#17131c', '--surface': '#211b29', '--surface-2': '#2c2436', '--line': '#3a3047',
    '--fg': '#efe7f4', '--muted': '#a99bb6', '--accent': '#f0a35e', '--accent-fg': '#2a1606' } },
];

// radius null = the skin's own corner radius.
const KNOBS = { accent: null, radius: null, scale: 1, density: 'comfortable' };

export async function allThemes() {
  return [...BUILTIN_THEMES, ...(await db.themes.toArray()).map(t => ({ ...t, custom: true }))];
}

export async function currentTheme() {
  return { id: await getSetting('theme.id', 'system'), knobs: { ...KNOBS, ...(await getSetting('theme.knobs', {})) } };
}

const darkMQ = matchMedia('(prefers-color-scheme: dark)');
let applied = new Set();   // inline vars this module set (others, e.g. --dock-h, are left alone)
let lastScope = null;

// Resolved light/dark of a theme ('auto' follows the OS).
export const modeOf = (theme) => theme.base === 'auto' ? (darkMQ.matches ? 'dark' : 'light') : theme.base;

export async function applyTheme(id, knobs, { skin: skinId } = {}) {
  const cur = await currentTheme();
  id = id ?? cur.id;
  knobs = { ...cur.knobs, ...(knobs || {}) };
  await loadCustomSkins();
  skinId = skinId ?? await currentSkinId();
  const theme = (await allThemes()).find(t => t.id === id) || BUILTIN_THEMES[0];
  const skin = getSkin(skinId);
  const root = document.documentElement;
  const mode = modeOf(theme);
  // 'system' + classic keeps the pure-CSS light/dark; any other combination writes the colours inline.
  const themeVars = theme.base === 'auto' ? (mode === 'dark' ? DARK : LIGHT) : theme.vars;
  const vars = skinVars(skin, mode, theme.base === 'auto' && !skin.palette && !skin.extends ? {} : themeVars);
  if (knobs.accent) vars['--accent'] = knobs.accent;
  if (knobs.radius != null) vars['--radius'] = knobs.radius + 'px';
  if (knobs.density === 'compact') vars['--gap'] = '10px';
  vars['--scale'] = knobs.scale;
  for (const p of applied) if (!(p in vars)) root.style.removeProperty(p);
  for (const [k, v] of Object.entries(vars)) if (v != null) root.style.setProperty(k, v);
  applied = new Set(Object.keys(vars));
  root.dataset.density = knobs.density;
  root.dataset.skin = skin.id;
  root.dataset.skinBase = skin.extends || skin.id;
  root.dataset.mode = mode;
  root.dataset.npLayout = skin.np || getSkin(skin.extends).np || 'classic';
  root.dataset.hubBase = skin.palette || theme.base !== 'auto' ? mode : 'auto';
  root.style.colorScheme = mode;
  const over = await moduleOverrides();
  ensureSkinAssets([skin.id, ...Object.values(over).filter(Boolean)]);
  rememberBoot(skin.id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--surface').trim() || '#ffffff';
  await setSetting('theme.id', theme.id);
  await setSetting('theme.knobs', knobs);
  await setSetting('theme.skin', skin.id);
  lastScope = { theme, knobs, over };
  applyModuleScopes();
  bus.emit('theme:changed', { id: theme.id, knobs, skin: skin.id, mode });
}
darkMQ.addEventListener?.('change', () => applyTheme());

// The var map of a module's override skin (or null = follows the app skin).
export function scopeFor(moduleId) {
  const sid = lastScope?.over?.[moduleId];
  if (!sid) return null;
  const { theme, knobs } = lastScope, mode = modeOf(theme), skin = getSkin(sid);
  const vars = skinVars(skin, mode, theme.base === 'auto' ? (mode === 'dark' ? DARK : LIGHT) : theme.vars);
  if (knobs.accent) vars['--accent'] = knobs.accent;
  return { skin, vars, mode, np: skin.np || getSkin(skin.extends).np };
}

// Paint (or clear) a module override on an element: data-skin + vars, so @scope'd skin CSS and
// every var() inside follow it.
export function applyScope(el, moduleId) {
  if (!el) return;
  const sc = scopeFor(moduleId);
  for (const p of (el._skinVars || [])) el.style.removeProperty(p);
  el._skinVars = [];
  if (!sc) { delete el.dataset.skin; delete el.dataset.skinBase; delete el.dataset.mode; delete el.dataset.npLayout; return null; }
  for (const [k, v] of Object.entries(sc.vars)) if (v != null) { el.style.setProperty(k, v); el._skinVars.push(k); }
  el.dataset.skin = sc.skin.id; el.dataset.skinBase = sc.skin.extends || sc.skin.id; el.dataset.mode = sc.mode; el.dataset.npLayout = sc.np;
  return sc;
}

// The page area follows the override of whichever module is mounted (app.js sets data-module).
let viewObs = null;
function applyModuleScopes() {
  const view = document.getElementById('view');
  if (!view) return;
  const run = () => applyScope(view, view.dataset.module);
  run();
  applyScope(document.getElementById('dock'), 'music');
  if (!viewObs) { viewObs = new MutationObserver(run); viewObs.observe(view, { attributes: true, attributeFilter: ['data-module'] }); }
}

export async function setSkin(id) { await applyTheme(null, { radius: null }, { skin: id }); }
export async function setModuleSkin(moduleId, skinId) {
  const over = { ...(await moduleOverrides()) };
  if (skinId) over[moduleId] = skinId; else delete over[moduleId];
  await setSetting('theme.skinByModule', over);
  await applyTheme();
}

// Snapshot whatever is on screen now as a new custom theme.
export async function saveCurrentAsTheme(name) {
  const cs = getComputedStyle(document.documentElement);
  const vars = {};
  for (const k of Object.keys(LIGHT)) vars[k] = cs.getPropertyValue(k).trim();
  const base = document.documentElement.dataset.hubBase === 'dark' ||
    (document.documentElement.dataset.hubBase === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  const t = { id: 'custom-' + uid().slice(0, 8), name, base, vars };
  await db.themes.put(t);
  return t;
}

export async function exportTheme(id) {
  const t = (await allThemes()).find(x => x.id === id);
  const { knobs } = await currentTheme();
  return { format: 'my-hub-theme', version: 1, theme: { name: t.name, base: t.base, vars: t.vars }, knobs };
}

export async function importTheme(json) {
  if (json?.format !== 'my-hub-theme' || !json.theme?.vars) throw new Error('Tệp không phải theme My Hub.');
  const allowed = Object.fromEntries(Object.entries(json.theme.vars).filter(([k, v]) =>
    k.startsWith('--') && typeof v === 'string' && /^[#\w(),.%\s-]+$/.test(v)));
  const t = { id: 'custom-' + uid().slice(0, 8), name: String(json.theme.name || 'Theme nhập'), base: json.theme.base === 'dark' ? 'dark' : 'light', vars: allowed };
  await db.themes.put(t);
  await applyTheme(t.id, json.knobs || {});
  return t;
}
