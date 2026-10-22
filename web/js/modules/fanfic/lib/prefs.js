// Xưởng Viết parameters (shared params layer, namespace 'fanfic'): shown in Cài đặt → Thông số, saved, backed up,
// and (scope 'sync') following the account to every device.
import { params } from '../../../core/params.js';

export const FONTS = {
  serif: ['Có chân (Literata)', "'Literata', Georgia, serif"],
  sans: ['Không chân (Be Vietnam Pro)', "'Be Vietnam Pro', system-ui, sans-serif"],
  mono: ['Đơn cách (máy chữ)', "'JetBrains Mono', ui-monospace, monospace"],
  hyper: ['Dễ đọc (Atkinson Hyperlegible)', "'Atkinson Hyperlegible', 'Be Vietnam Pro', sans-serif"],
};

// Google Fonts families the writer loads on demand (regular + italic + semibold, Vietnamese subset).
export const FONT_CSS = {
  serif: 'Literata:ital,wght@0,400;0,600;1,400', sans: 'Be+Vietnam+Pro:ital,wght@0,400;0,600;1,400',
  mono: 'JetBrains+Mono:ital,wght@0,400;0,600;1,400', hyper: 'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400',
};
export function loadFont(k) {
  const fam = FONT_CSS[k];
  if (!fam || document.querySelector(`link[data-fx-font="${k}"]`)) return;
  const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${fam}&subset=vietnamese&display=swap` });
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
      typewriter: { type: 'bool', default: 1, label: 'Kiểu máy chữ (dòng đang gõ luôn ở giữa)' },
      spellcheck: { type: 'bool', default: 0, label: 'Kiểm tra chính tả' },
      dailyGoal: { type: 'number', default: 500, min: 0, max: 20000, step: 50, label: 'Mục tiêu viết mỗi ngày', unit: 'từ', scope: 'sync' },
      autoSnapshot: { type: 'bool', default: 1, label: 'Tự chụp phiên bản trước khi xoá hoặc dán đè nhiều chữ' },
      penName: { type: 'string', default: '', label: 'Bút danh (hiện bên Sách khi xuất bản)', scope: 'sync' },
      worksView: { type: 'string', default: 'list', ui: false },
      worksSort: { type: 'string', default: 'edited', ui: false },
      binderOpen: { type: 'bool', default: 1, ui: false },
    },
  });
}
export const get = (k) => params.get('fanfic.' + k);
export const set = (k, v) => params.set('fanfic.' + k, v);
