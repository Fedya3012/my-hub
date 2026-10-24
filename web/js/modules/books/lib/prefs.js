// Books parameters (shared params layer, namespace 'books'): they show in Cài đặt → Thông số,
// are saved, backed up and (scope 'sync') follow the account to every device.
import { params } from '../../../core/params.js';

export const FONTS = {
  publisher: ['Theo sách', ''],
  serif: ['Có chân (Literata)', "'Literata', Georgia, serif"],
  sans: ['Không chân (Be Vietnam Pro)', "'Be Vietnam Pro', system-ui, sans-serif"],
  hyper: ['Dễ đọc (Atkinson Hyperlegible)', "'Atkinson Hyperlegible', 'Be Vietnam Pro', sans-serif"],
  lexend: ['Cho người khó đọc (Lexend)', "'Lexend', 'Be Vietnam Pro', sans-serif"],
  dyslexic: ['OpenDyslexic (cho người khó đọc)', "'OpenDyslexic', 'Lexend', 'Be Vietnam Pro', sans-serif"],
  mono: ['Đơn cách', "'JetBrains Mono', ui-monospace, monospace"],
};
// Google Fonts families the reader loads on demand (Vietnamese subset).
export const FONT_CSS = {
  serif: 'Literata:ital,wght@0,400;0,600;1,400', sans: 'Be+Vietnam+Pro:ital,wght@0,400;0,600;1,400',
  hyper: 'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400', lexend: 'Lexend:wght@400;600',
};
export const THEMES = {
  day: { label: 'Ngày', bg: '#ffffff', fg: '#1b1b1b', link: '#1d5fa8' },
  sepia: { label: 'Sepia', bg: '#f4ecd8', fg: '#433422', link: '#8a4b14' },
  paper: { label: 'Giấy', bg: '#ece6da', fg: '#2a2620', link: '#6b4a1a' },
  gray: { label: 'Xám', bg: '#e4e4e2', fg: '#26282b', link: '#2a5d8f' },
  green: { label: 'Dịu mắt', bg: '#d8e8d3', fg: '#20301e', link: '#1f5a2a' },
  night: { label: 'Đêm', bg: '#1d1f23', fg: '#c9c5bd', link: '#8ab4f8' },
  black: { label: 'Đen OLED', bg: '#000000', fg: '#b8b8b8', link: '#8ab4f8' },
  contrast: { label: 'Tương phản cao', bg: '#000000', fg: '#ffff00', link: '#00ffff' },
};

export function definePrefs() {
  return params.define('books', {
    title: 'Sách & trình đọc', icon: 'book', module: 'books', order: 20,
    params: {
      font: { type: 'enum', default: 'publisher', options: Object.fromEntries(Object.entries(FONTS).map(([k, [l]]) => [k, l])), label: 'Phông chữ' },
      fontSize: { type: 'number', default: 18, min: 12, max: 40, step: 1, label: 'Cỡ chữ', unit: 'px' },
      lineHeight: { type: 'number', default: 1.55, min: 1, max: 2.6, step: 0.05, label: 'Giãn dòng' },
      margin: { type: 'number', default: 40, min: 0, max: 160, step: 4, label: 'Lề hai bên', unit: 'px' },
      maxWidth: { type: 'number', default: 720, min: 360, max: 1600, step: 20, label: 'Độ rộng dòng tối đa', unit: 'px' },
      justify: { type: 'bool', default: 1, label: 'Căn đều hai bên' },
      hyphenate: { type: 'bool', default: 1, label: 'Ngắt chữ' },
      theme: { type: 'enum', default: 'auto', options: { auto: 'Theo app', ...Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, t.label])), custom: 'Tuỳ chỉnh' }, label: 'Nền trang', scope: 'sync' },
      customBg: { type: 'color', default: '#fbf7ee', label: 'Màu nền tuỳ chỉnh', scope: 'sync' },
      customFg: { type: 'color', default: '#2b2b2b', label: 'Màu chữ tuỳ chỉnh', scope: 'sync' },
      flow: { type: 'enum', default: 'paginated', options: { paginated: 'Lật trang', scrolled: 'Cuộn liên tục' }, label: 'Kiểu đọc' },
      readMode: { type: 'enum', default: 'continuous', options: { continuous: 'Đọc liền một lượt', chapter: 'Từng chương (dừng ở cuối mỗi chương)' }, label: 'Đọc liền hay từng chương' },
      wheelTurns: { type: 'bool', default: 1, label: 'Lăn chuột để lật trang (khi lật trang)' },
      columns: { type: 'enum', default: 'auto', options: { auto: 'Tự động (2 trang khi màn rộng)', 1: 'Một trang', 2: 'Hai trang' }, label: 'Số trang trên màn hình' },
      animated: { type: 'bool', default: 1, label: 'Hiệu ứng lật trang' },
      brightness: { type: 'number', default: 100, min: 30, max: 100, step: 5, label: 'Độ sáng trang', unit: '%' },
      warmth: { type: 'number', default: 0, min: 0, max: 100, step: 5, label: 'Độ ấm (giảm ánh sáng xanh)', unit: '%' },
      tapZones: { type: 'bool', default: 1, label: 'Chạm cạnh màn hình để lật trang' },
      comicFit: { type: 'enum', default: 'fit-page', options: { 'fit-page': 'Vừa trang', 'fit-width': 'Vừa chiều ngang' }, label: 'Truyện tranh: cách hiển thị' },
      comicRtl: { type: 'bool', default: 0, label: 'Truyện tranh: đọc phải sang trái (manga)' },
      panelZoom: { type: 'enum', default: '2x2', options: { '2x2': '4 ô (2 × 2)', '2x3': '6 ô (2 × 3)', '1x3': '3 dải ngang', '3x3': '9 ô (3 × 3)' }, label: 'Phóng từng ô: cách chia trang' },
      pdfMode: { type: 'enum', default: 'scroll', options: { scroll: 'Cuộn dọc', page: 'Từng trang', reflow: 'Dàn lại chữ (reflow)' }, label: 'PDF: kiểu xem' },
      ttsRate: { type: 'number', default: 1, min: 0.5, max: 2.5, step: 0.1, label: 'Đọc to: tốc độ', unit: '×' },
      ttsVoice: { type: 'string', default: '', ui: false },
      translateTo: { type: 'string', default: 'vi', label: 'Dịch sang (mã ngôn ngữ)', scope: 'sync' },
      trackSessions: { type: 'bool', default: 1, label: 'Tự ghi phiên đọc (thời gian, tốc độ)', scope: 'sync' },
      idleMinutes: { type: 'number', default: 3, min: 1, max: 30, step: 1, label: 'Dừng tính giờ khi không thao tác', unit: 'phút', scope: 'sync' },
      wpm: { type: 'number', default: 230, min: 60, max: 900, step: 10, label: 'Tốc độ đọc ước tính (khi chưa đủ dữ liệu)', unit: 'từ/phút', scope: 'sync' },
      halfStars: { type: 'bool', default: 1, label: 'Cho phép nửa sao', scope: 'sync' },
      customColumns: { type: 'json', default: [], ui: false, scope: 'sync' },
      libView: { type: 'string', default: 'grid', ui: false },
      libSort: { type: 'string', default: 'added', ui: false },
      library: { type: 'string', default: '', ui: false },   // active virtual library (collection id)
    },
  });
}

export const get = (k) => params.get('books.' + k);
export const set = (k, v) => params.set('books.' + k, v);
export const on = (fn) => params.on('books', fn);
