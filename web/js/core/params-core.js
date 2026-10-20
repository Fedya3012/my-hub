// Global parameters every module should honour (see core/params.js and docs/MODULES.md):
//   ui        skin, theme, accent, radius, text scale, density, motion        (adapter: core/theme.js)
//   locale    language, locale for numbers / dates                           (stored)
//   storage   storage mode, hybrid policy, cache on open                     (adapter: db.settings keys)
//   account   signed in, email, name, sync state                             (live, read-only)
//   device    id, name, platform, online, dark mode, reduced motion, memory  (live, read-only)
//   audio     volume, output device, Hi-Res rule, bit-perfect, speed          (stored; the music module
//             attaches an adapter so its engine and these values stay one and the same)
//   playback  what is playing now: item, title, state, position             (live, read-only, music)
//   tasks     running tasks, overall percent                                 (live, read-only)
import { params } from './params.js';
import { bus } from './bus.js';
import { getSetting, setSetting } from './db.js';
import { applyTheme, currentTheme, allThemes, setSkin } from './theme.js';
import { allSkins } from './skins.js';
import { account } from './account.js';
import { thisDevice } from './device.js';
import { tasks } from './tasks.js';

let started = false;

export async function initCoreParams() {
  if (started) return;
  started = true;
  await params.load();

  // ── ui ──
  const cur = await currentTheme();
  const themeState = { theme: cur.id, skin: await getSetting('theme.skin', 'classic'), ...cur.knobs };
  const themes = Object.fromEntries((await allThemes()).map(t => [t.id, t.name]));
  let skins = {};
  try { skins = Object.fromEntries(allSkins().map(s => [s.id, s.name])); } catch { skins = { classic: 'Cổ điển' }; }
  params.define('ui', {
    title: 'Giao diện', icon: 'palette', order: 1,
    params: {
      skin: { type: 'enum', default: 'classic', options: skins, label: 'Skin', ui: false },
      theme: { type: 'enum', default: 'system', options: themes, label: 'Theme', ui: false },
      accent: { type: 'color', default: null, nullable: true, label: 'Màu nhấn', ui: false },
      radius: { type: 'number', default: null, nullable: true, min: 0, max: 28, label: 'Bo góc', ui: false },
      scale: { type: 'number', default: 1, min: 0.85, max: 1.3, step: 0.05, label: 'Cỡ chữ', ui: false },
      density: { type: 'enum', default: 'comfortable', options: { comfortable: 'Thoải mái', compact: 'Gọn' }, label: 'Mật độ', ui: false },
      motion: { type: 'enum', default: 'auto', options: { auto: 'Theo hệ thống', full: 'Đầy đủ', reduced: 'Giảm chuyển động' }, label: 'Chuyển động', hint: 'Mọi module giảm hiệu ứng khi chọn "Giảm chuyển động".' },
      mode: { type: 'enum', default: 'light', options: { light: 'Sáng', dark: 'Tối' }, label: 'Sáng / tối hiện tại', readonly: true, ui: false },
    },
    adapter: {
      get: (k) => (k === 'motion' ? undefined : themeState[k]),
      async set(k, v) {
        if (k === 'motion') { applyMotion(v); return false; }
        if (k === 'skin') return setSkin(v);
        if (k === 'theme') return applyTheme(v);
        if (k === 'mode') return;
        return applyTheme(null, { [k]: v });
      },
    },
  });
  themeState.mode = document.documentElement.dataset.mode || 'light';
  bus.on('theme:changed', (e) => {
    const next = { theme: e.id, skin: e.skin, mode: e.mode, ...e.knobs };
    for (const [k, v] of Object.entries(next)) if (JSON.stringify(themeState[k]) !== JSON.stringify(v)) { const old = themeState[k]; themeState[k] = v; params.changed('ui.' + k, v, old, 'theme'); }
  });
  applyMotion(params.get('ui.motion'));

  // ── locale ──
  params.define('locale', {
    title: 'Ngôn ngữ & định dạng', icon: 'note', order: 2,
    params: {
      lang: { type: 'enum', default: 'vi', options: { vi: 'Tiếng Việt' }, label: 'Ngôn ngữ giao diện', hint: 'Hiện chỉ có tiếng Việt; module nên dùng giá trị này cho lời, phụ đề, TTS.' },
      locale: { type: 'enum', default: 'vi-VN', options: { 'vi-VN': 'Việt Nam (1.234,5)', 'en-US': 'Mỹ (1,234.5)', 'en-GB': 'Anh' }, label: 'Định dạng số & ngày' },
      weekStart: { type: 'enum', default: '1', options: { 1: 'Thứ Hai', 0: 'Chủ nhật' }, label: 'Tuần bắt đầu từ' },
    },
  });
  params.on('locale.lang', (e) => { document.documentElement.lang = e.value; });

  // ── storage ── (keys stay where they always were in db.settings)
  const st = { mode: await getSetting('storage.mode', 'local'), hybridPolicy: await getSetting('storage.hybridPolicy', 'all'), cacheOnOpen: (await getSetting('storage.cacheOnOpen', true)) ? 1 : 0 };
  params.define('storage', {
    title: 'Lưu trữ', icon: 'database', order: 3,
    params: {
      mode: { type: 'enum', default: 'local', options: { local: 'Chỉ trên máy', gdrive: 'Tài khoản Google', hybrid: 'Kết hợp' }, label: 'Chế độ lưu trữ', readonly: true, ui: false },
      hybridPolicy: { type: 'enum', default: 'all', options: { all: 'Dữ liệu và mọi tệp', 'db-only': 'Chỉ dữ liệu', 'small-files': 'Dữ liệu + tệp dưới 50 MB' }, label: 'Kết hợp: đồng bộ gì', ui: false },
      cacheOnOpen: { type: 'bool', default: 1, label: 'Giữ bản tạm khi mở tệp trên Drive', ui: false },
    },
    adapter: {
      get: (k) => st[k],
      async set(k, v) { st[k] = v; await setSetting('storage.' + k, k === 'cacheOnOpen' ? !!v : v); },
    },
  });
  bus.on('storage:mode', (e) => { const old = st.mode; st.mode = e?.mode ?? e; if (old !== st.mode) params.changed('storage.mode', st.mode, old, 'storage'); });

  // ── account (live) ──
  const acc = () => ({ signedIn: account.signedIn ? 1 : 0, email: account.email, name: account.signedIn ? account.displayName() : '', needsReconnect: account.needsReconnect ? 1 : 0 });
  let accState = acc(), syncState = 'idle';
  params.define('account', {
    title: 'Tài khoản & đồng bộ', icon: 'cloud', order: 4, readonly: true,
    params: {
      signedIn: { type: 'bool', default: 0, label: 'Đã đăng nhập' }, email: { type: 'string', default: '', label: 'Email' },
      name: { type: 'string', default: '', label: 'Tên' }, needsReconnect: { type: 'bool', default: 0, label: 'Cần kết nối lại' },
      sync: { type: 'enum', default: 'idle', options: { idle: 'Rảnh', syncing: 'Đang đồng bộ', error: 'Lỗi' }, label: 'Đồng bộ' },
    },
    adapter: { get: (k) => (k === 'sync' ? syncState : accState[k]) },
  });
  const accChanged = () => { const n = acc(); for (const k of Object.keys(n)) if (n[k] !== accState[k]) { const o = accState[k]; accState[k] = n[k]; params.changed('account.' + k, n[k], o, 'account'); } };
  bus.on('account:changed', accChanged);
  const setSync = (s) => { if (s !== syncState) { const o = syncState; syncState = s; params.changed('account.sync', s, o, 'sync'); } };
  bus.on('sync:start', () => setSync('syncing')); bus.on('sync:done', () => setSync('idle'));
  bus.on('sync:error', () => setSync('error')); bus.on('sync:cancelled', () => setSync('idle'));

  // ── device (live) ──
  const me = await thisDevice();
  const dark = matchMedia('(prefers-color-scheme: dark)'), rm = matchMedia('(prefers-reduced-motion: reduce)'), coarse = matchMedia('(pointer: coarse)');
  const dev = () => ({ id: me.id, name: me.name, platform: me.platform, online: navigator.onLine ? 1 : 0, prefersDark: dark.matches ? 1 : 0,
    reducedMotion: rm.matches ? 1 : 0, touch: coarse.matches ? 1 : 0, memoryGB: navigator.deviceMemory || 0, cores: navigator.hardwareConcurrency || 0,
    lowEnd: (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) ? 1 : 0 });
  let devState = dev();
  params.define('device', {
    title: 'Thiết bị này', icon: 'device', order: 5, readonly: true,
    params: Object.fromEntries(Object.keys(devState).map(k => [k, { type: typeof devState[k] === 'number' ? 'number' : 'string', default: devState[k], label: k }])),
    adapter: { get: (k) => devState[k] },
  });
  const devChanged = () => { const n = dev(); for (const k of Object.keys(n)) if (n[k] !== devState[k]) { const o = devState[k]; devState[k] = n[k]; params.changed('device.' + k, n[k], o, 'device'); } };
  addEventListener('online', devChanged); addEventListener('offline', devChanged);
  dark.addEventListener?.('change', devChanged); rm.addEventListener?.('change', () => { devChanged(); applyMotion(params.get('ui.motion')); });

  // ── audio (any module that plays media: music, video, podcast, book TTS…) ──
  params.define('audio', {
    title: 'Âm thanh', icon: 'music', order: 6,
    params: {
      volume: { type: 'number', default: 0.85, min: 0, max: 1, step: 0.01, label: 'Âm lượng', ui: false },
      outputDevice: { type: 'string', default: '', label: 'Thiết bị phát (sinkId)', ui: false },
      rate: { type: 'number', default: 1, min: 0.5, max: 2, step: 0.05, label: 'Tốc độ phát', ui: false },
      hiResRule: { type: 'enum', default: 'standard', options: { standard: 'Trên chuẩn CD (lossless, > 16-bit hoặc > 48 kHz)', strict: 'Nghiêm ngặt (lossless, ≥ 24-bit và ≥ 88.2 kHz)' }, label: 'Tiêu chí Hi-Res' },
      bitPerfect: { type: 'bool', default: 0, label: 'Bit-perfect (bỏ EQ/âm lượng số)' },
      duckOthers: { type: 'bool', default: 1, label: 'Giảm âm khi module khác phát tiếng', hint: 'Ví dụ: đọc sách TTS, video, thông báo.' },
    },
  });

  // ── playback (live: what is playing, from whichever module plays) ──
  params.define('playback', {
    title: 'Đang phát', icon: 'play', order: 7, readonly: true,
    params: {
      module: { type: 'string', default: '', label: 'Module' }, itemId: { type: 'string', default: '', label: 'Mục' },
      title: { type: 'string', default: '', label: 'Tên' }, state: { type: 'enum', default: 'stopped', options: { playing: 'Đang phát', paused: 'Tạm dừng', stopped: 'Dừng' }, label: 'Trạng thái' },
      position: { type: 'number', default: 0, label: 'Vị trí (giây)' }, duration: { type: 'number', default: 0, label: 'Thời lượng (giây)' },
    },
  });
  bus.on('progress:changed', (p) => {
    if (!p || p.extra?.virtual) return;   // the music session row is reported by the player itself
    const map = { itemId: p.itemId, module: p.moduleId, state: p.state, position: p.position, duration: p.total || p.duration };
    for (const [k, v] of Object.entries(map)) if (v != null) setLive('playback.' + k, v);
  });

  // ── tasks (live) ──
  let tk = { running: 0, failed: 0, percent: -1 };
  params.define('tasks', {
    title: 'Tác vụ', icon: 'list', order: 8, readonly: true,
    params: { running: { type: 'number', default: 0, label: 'Đang chạy' }, failed: { type: 'number', default: 0, label: 'Lỗi' }, percent: { type: 'number', default: -1, label: 'Tiến độ chung (%; -1 = không rõ)' } },
    adapter: { get: (k) => tk[k] },
  });
  bus.on('tasks:changed', (list) => {
    const run = list.filter(t => t.state === 'running'), known = run.filter(t => t.percent != null);
    const n = { running: run.length, failed: list.filter(t => t.state === 'failed').length, percent: known.length ? Math.floor(known.reduce((s, t) => s + t.percent, 0) / known.length) : -1 };
    for (const k of Object.keys(n)) if (n[k] !== tk[k]) { const o = tk[k]; tk = { ...tk, [k]: n[k] }; params.changed('tasks.' + k, n[k], o, 'tasks'); }
  });
  void tasks;
}

// Live values written by whoever owns them (e.g. the music player) without persisting.
const live = new Map();
export function setLive(key, value) {
  const old = live.get(key);
  if (old === value) return;
  live.set(key, value);
  params.changed(key, value, old, 'live');
}
// playback.* reads the live map.
params.define('playback', { adapter: { get: (k) => live.get('playback.' + k) } });

function applyMotion(v) {
  // 'auto' leaves each skin's own prefers-reduced-motion handling as it was.
  document.documentElement.dataset.motion = v === 'reduced' ? 'reduced' : v === 'full' ? 'full' : 'auto';
}
