// Xưởng Viết parameters (shared params layer, namespace 'fanfic'): shown in Cài đặt → Thông số, saved, backed up,
// and (scope 'sync') following the account to every device.
import { params } from '../../../core/params.js';
import { fontCss } from '../../../core/fonts.js';

export const FONTS = {
  serif: ['Có chân (Literata)', "'Literata', Georgia, serif"],
  sans: ['Không chân (Be Vietnam Pro)', "'Be Vietnam Pro', system-ui, sans-serif"],
  mono: ['Đơn cách (máy chữ)', "'JetBrains Mono', ui-monospace, monospace"],
  hyper: ['Dễ đọc (Atkinson Hyperlegible)', "'Atkinson Hyperlegible', 'Be Vietnam Pro', sans-serif"],
  lora: ['Lora (văn chương)', "'Lora', Georgia, serif"],
  merri: ['Merriweather (dễ đọc lâu)', "'Merriweather', Georgia, serif"],
  noto: ['Noto Serif', "'Noto Serif', Georgia, serif"],
  plex: ['IBM Plex Mono (máy chữ)', "'IBM Plex Mono', ui-monospace, monospace"],
  lexend: ['Lexend (cho người khó đọc)', "'Lexend', 'Be Vietnam Pro', sans-serif"],
};
// Paper colours of the writer (bg, fg, dim = faded text in dimming mode).
export const PAPERS = {
  app: { label: 'Theo app' },
  light: { label: 'Sáng', bg: '#fdfcfa', fg: '#1d1b19' },
  sepia: { label: 'Sepia', bg: '#f4ecd8', fg: '#433422' },
  warm: { label: 'Giấy ấm (mờ)', bg: '#e9e1d3', fg: '#3a332a' },
  green: { label: 'Dịu mắt', bg: '#dfe8d9', fg: '#22301f' },
  dark: { label: 'Tối', bg: '#1e1f24', fg: '#d6d2ca' },
  black: { label: 'Đen OLED', bg: '#000000', fg: '#bdbdbd' },
};

// Google Fonts families the writer loads on demand (regular + italic + semibold, Vietnamese subset).
export const FONT_CSS = {
  serif: 'Literata:ital,wght@0,400;0,600;1,400', sans: 'Be+Vietnam+Pro:ital,wght@0,400;0,600;1,400',
  mono: 'JetBrains+Mono:ital,wght@0,400;0,600;1,400', lora: 'Lora:ital,wght@0,400;0,600;1,400', merri: 'Merriweather:ital,wght@0,400;0,700;1,400',
  noto: 'Noto+Serif:ital,wght@0,400;0,600;1,400', plex: 'IBM+Plex+Mono:ital,wght@0,400;0,600;1,400', lexend: 'Lexend:wght@400;600', hyper: 'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400',
};
export function loadFont(k) {
  const fam = FONT_CSS[k];
  if (!fam || document.querySelector(`link[data-fx-font="${k}"]`)) return;
  const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: fontCss(fam) });
  l.dataset.fxFont = k;
  document.head.append(l);
}

export function definePrefs() {
  return params.define('fanfic', {
    title: 'Xưởng Viết', icon: 'quill', module: 'fanfic', order: 25,
    params: {
      font: { type: 'enum', default: 'serif', options: Object.fromEntries(Object.entries(FONTS).map(([k, [l]]) => [k, l])), label: 'Phông chữ khi viết' },
      fontSize: { type: 'number', default: 19, min: 13, max: 32, step: 1, label: 'Cỡ chữ khi viết', unit: 'px' },
      lineHeight: { type: 'number', default: 1.7, min: 1.2, max: 2.4, step: 0.05, label: 'Giãn dòng khi viết' },
      width: { type: 'number', default: 720, min: 420, max: 1200, step: 20, label: 'Độ rộng dòng', unit: 'px' },
      paper: { type: 'enum', default: 'app', options: Object.fromEntries(Object.entries(PAPERS).map(([k, p]) => [k, p.label])), label: 'Nền trang viết', scope: 'sync' },
      margin: { type: 'number', default: 22, min: 0, max: 120, step: 2, label: 'Lề hai bên khi viết', unit: 'px' },
      dim: { type: 'enum', default: 'off', options: { off: 'Tắt', paragraph: 'Làm mờ trừ đoạn đang viết', sentence: 'Làm mờ trừ câu đang viết' }, label: 'Làm mờ chữ đã viết' },
      keySound: { type: 'enum', default: 'off', options: { off: 'Tắt', typewriter: 'Máy chữ cơ', soft: 'Bàn phím êm' }, label: 'Âm thanh gõ phím' },
      keyVolume: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.05, label: 'Âm lượng tiếng gõ' },
      longSentence: { type: 'number', default: 35, min: 15, max: 80, step: 1, label: 'Câu dài khi có trên', unit: 'từ' },
      typewriter: { type: 'bool', default: 1, label: 'Kiểu máy chữ (dòng đang gõ luôn ở giữa)' },
      spellcheck: { type: 'bool', default: 0, label: 'Kiểm tra chính tả' },
      dailyGoal: { type: 'number', default: 500, min: 0, max: 20000, step: 50, label: 'Mục tiêu viết mỗi ngày', unit: 'từ', scope: 'sync' },
      autoSnapshot: { type: 'bool', default: 1, label: 'Tự chụp phiên bản trước khi xoá hoặc dán đè nhiều chữ' },
      penName: { type: 'string', default: '', label: 'Bút danh (hiện bên Sách khi xuất bản)', scope: 'sync' },
      worksView: { type: 'string', default: 'list', ui: false },
      worksSort: { type: 'string', default: 'edited', ui: false },
      binderOpen: { type: 'bool', default: 1, ui: false },
      pinOpen: { type: 'bool', default: 0, ui: false },
    },
  });
}
export const get = (k) => params.get('fanfic.' + k);
export const set = (k, v) => params.set('fanfic.' + k, v);
