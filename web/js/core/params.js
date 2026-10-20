// Shared parameters ("thông số") for every module, current and future.
//
// One place where any module reads / writes namespaced values and subscribes to changes:
//
//   ctx.params.get('ui.motion')                       -> 'auto'
//   await ctx.params.set('audio.volume', 0.7)
//   const off = ctx.params.on('audio', (e) => …)      // e = { key: 'audio.volume', value, old, source }
//   ctx.params.on('*', fn)                            // every change
//   ctx.params.all('music')                           // { showBadges: 1, … }
//
// A module declares its parameters once (usually in its service or mount):
//
//   ctx.params.define('books', {
//     title: 'Đọc sách', icon: 'book', module: 'books',
//     params: {
//       fontSize: { type: 'number', default: 18, min: 12, max: 32, step: 1, label: 'Cỡ chữ', unit: 'px' },
//       theme:    { type: 'enum', default: 'paper', options: { paper: 'Giấy', dark: 'Tối' }, label: 'Nền trang' },
//       tts:      { type: 'bool', default: 0, label: 'Đọc to (TTS)', scope: 'sync' },
//     },
//   });
//
// Declared parameters automatically: appear in Cài đặt → "Thông số" (unless ui: false), are saved
// (scope 'device' = this device only, in db.settings; scope 'sync' = every device, in a synced
// db.collections row, so GitHub sync carries them), and are part of the JSON backup
// (both tables are exported). Types: bool | number | string | enum | color | json.
//
// Namespaces can also be backed by an adapter (existing storage keeps working: music prefs,
// theme, storage mode) or be live/read-only (device, account, playback, tasks), see core below.
import { db, getSetting, setSetting, now } from './db.js';
import { bus } from './bus.js';

const spaces = new Map();      // ns -> { title, icon, module, order, params: {key: def}, adapter, readonly }
const values = new Map();      // 'ns.key' -> value (plain stored namespaces)
const subs = new Map();        // pattern -> Set(fn)
const SYNC_ROW = 'params:sync';
let syncCache = null, loaded = false, loading = null;

const TYPES = {
  bool: (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0),
  number: (v, d) => { const n = +v; if (!Number.isFinite(n)) return d.default; return Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, n)); },
  string: (v) => (v == null ? '' : String(v)),
  enum: (v, d) => (v in (d.options || {}) ? v : d.default),
  color: (v, d) => (v == null || v === '' ? (d.nullable ? null : d.default) : /^#[0-9a-f]{3,8}$/i.test(v) ? v : d.default),
  json: (v) => v,
};
const coerce = (def, v) => (def.nullable && v == null ? null : (TYPES[def.type] || TYPES.json)(v, def));
const split = (key) => { const i = key.indexOf('.'); return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)]; };
// Nested path inside an adapter-backed object: 'playback.volume'
const dig = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

async function loadStored() {
  if (loaded) return;
  if (!loading) loading = (async () => {
    const rows = await db.settings.where('key').startsWith('params.').toArray();
    for (const r of rows) for (const [k, v] of Object.entries(r.value || {})) values.set(r.key.slice(7) + '.' + k, v);
    syncCache = (await db.collections.get(SYNC_ROW))?.values || {};
    for (const [ns, o] of Object.entries(syncCache)) for (const [k, v] of Object.entries(o || {})) values.set(ns + '.' + k, v);
    loaded = true;
  })();
  return loading;
}

function emit(key, value, old, source = 'local') {
  const [ns] = split(key);
  const e = { key, ns, value, old, source };
  for (const pat of [key, ns, '*']) for (const fn of subs.get(pat) || []) { try { fn(e); } catch (err) { console.error('[params]', key, err); } }
  bus.emit('params:changed', e);
}

async function persist(ns, key, value) {
  const def = spaces.get(ns)?.params?.[key];
  if (def?.scope === 'sync') {
    const row = (await db.collections.get(SYNC_ROW)) || { id: SYNC_ROW, kind: 'params', moduleId: 'core', name: 'Thông số đồng bộ', values: {}, createdAt: now(), deleted: 0 };
    row.values = { ...row.values, [ns]: { ...(row.values?.[ns] || {}), [key]: value } };
    row.updatedAt = now();
    syncCache = row.values;
    await db.collections.put(row);
  } else {
    const cur = await getSetting('params.' + ns, {});
    await setSetting('params.' + ns, { ...cur, [key]: value });
  }
}

export const params = {
  // Register (or extend) a namespace. Returns a scoped helper { get, set, on, all }.
  define(ns, { title, icon, module, order = 50, params: defs = {}, adapter = null, readonly = false, describe } = {}) {
    const cur = spaces.get(ns) || { ns, params: {} };
    spaces.set(ns, { ...cur, title: title ?? cur.title ?? ns, icon: icon ?? cur.icon, module: module ?? cur.module, order: order ?? cur.order,
      params: { ...cur.params, ...defs }, adapter: adapter ?? cur.adapter, readonly: readonly || cur.readonly, describe: describe ?? cur.describe });
    bus.emit('params:defined', { ns });
    return params.scope(ns);
  },

  scope(ns) {
    return {
      get: (k) => params.get(ns + '.' + k),
      set: (k, v, o) => params.set(ns + '.' + k, v, o),
      on: (fn) => params.on(ns, fn),
      all: () => params.all(ns),
    };
  },

  // Synchronous read: adapter value, stored value, or the declared default.
  get(key) {
    const [ns, k] = split(key);
    const sp = spaces.get(ns);
    const def = sp?.params?.[k];
    if (sp?.adapter?.get) { const v = sp.adapter.get(k); if (v !== undefined) return v; }
    if (values.has(key)) return def ? coerce(def, values.get(key)) : values.get(key);
    return def ? def.default : undefined;
  },

  all(ns) {
    const sp = spaces.get(ns);
    const out = {};
    for (const k of Object.keys(sp?.params || {})) out[k] = params.get(ns + '.' + k);
    for (const [key, v] of values) if (key.startsWith(ns + '.') && !(key.slice(ns.length + 1) in out)) out[key.slice(ns.length + 1)] = v;
    return out;
  },

  async set(key, value, { source = 'local', silent = false } = {}) {
    await loadStored();
    const [ns, k] = split(key);
    const sp = spaces.get(ns);
    const def = sp?.params?.[k];
    if (sp?.readonly || def?.readonly) throw new Error(`Thông số chỉ đọc: ${key}`);
    const v = def ? coerce(def, value) : value;
    const old = params.get(key);
    // An adapter stores the value itself; returning false means "store it the normal way".
    const handled = sp?.adapter?.set ? (await sp.adapter.set(k, v)) !== false : false;
    if (!handled) { values.set(key, v); await persist(ns, k, v); }
    if (!silent && JSON.stringify(old) !== JSON.stringify(v)) emit(key, v, old, source);
    return v;
  },

  async reset(ns) {
    const sp = spaces.get(ns);
    for (const [k, d] of Object.entries(sp?.params || {})) if (!d.readonly && !sp.readonly) await params.set(ns + '.' + k, d.default);
  },

  // Subscribe to 'ns.key', 'ns' or '*'. Returns an unsubscribe function.
  on(pattern, fn) {
    if (!subs.has(pattern)) subs.set(pattern, new Set());
    subs.get(pattern).add(fn);
    return () => subs.get(pattern)?.delete(fn);
  },

  // Adapters / live namespaces call this when their value changed outside params.set().
  changed(key, value, old, source = 'external') { emit(key, value ?? params.get(key), old, source); },

  // Registry for Settings, docs and tools: namespaces with their declared parameters.
  registry() {
    return [...spaces.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
      .map(sp => ({ ns: sp.ns, title: sp.title, icon: sp.icon, module: sp.module, readonly: !!sp.readonly,
        params: Object.entries(sp.params).map(([k, d]) => ({ key: k, ...d, value: params.get(sp.ns + '.' + k) })) }));
  },

  // Plain JSON of every stored namespace (adapters keep their own storage, already in the backup).
  snapshot() {
    const out = {};
    for (const sp of spaces.values()) if (!sp.readonly) out[sp.ns] = params.all(sp.ns);
    return out;
  },

  async load() { await loadStored(); },

  // A synced row arrived from another device (storage sync) or a backup import: reload + notify.
  async reload() {
    const before = new Map(values);
    loaded = false; loading = null; values.clear();
    await loadStored();
    for (const [key, v] of values) if (JSON.stringify(before.get(key)) !== JSON.stringify(v)) emit(key, v, before.get(key), 'sync');
  },
};

// Read a nested path of an object-valued setting (helper for adapters).
export const pathOf = dig;

// ── Services: functions a module offers to the others (player, art resolver, timers…) ──
// services.provide('art', { url(fileId), html(fileId, seed) }); services.get('art')?.url(id)
const svc = new Map();
export const services = {
  provide(name, api) { svc.set(name, api); bus.emit('services:changed', { name }); return () => { if (svc.get(name) === api) { svc.delete(name); bus.emit('services:changed', { name }); } }; },
  get: (name) => svc.get(name) || null,
  list: () => [...svc.keys()],
  // Resolves when a service becomes available (e.g. a module waiting for the music engine).
  when(name, timeout = 0) {
    if (svc.has(name)) return Promise.resolve(svc.get(name));
    return new Promise((res) => {
      const off = bus.on('services:changed', (e) => { if (e.name === name && svc.has(name)) { off(); res(svc.get(name)); } });
      if (timeout) setTimeout(() => { off(); res(null); }, timeout);
    });
  },
};

// Sync / backup import touched the synced row or settings: refresh values.
bus.on('sync:done', (r) => { if (!r || r.pulled) params.reload(); });
bus.on('backup:imported', () => params.reload());
