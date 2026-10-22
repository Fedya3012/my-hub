// Podcast parameters (shared params layer, namespace 'podcasts'): shown in Cài đặt → Thông số and on the module's
// own Cài đặt tab, saved, backed up, and (scope 'sync') following the account to every device.
import { params } from '../../../core/params.js';

export const NAME = 'Podcast';
export const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2, 2.5, 3];

export function definePrefs() {
  return params.define('podcasts', {
    title: NAME, icon: 'podcast', module: 'podcasts', order: 22,
    params: {
      speed: { type: 'number', default: 1, min: 0.5, max: 3, step: 0.05, label: 'Tốc độ phát mặc định', unit: '×', scope: 'sync' },
      skipBack: { type: 'number', default: 15, min: 5, max: 120, step: 5, label: 'Nút lùi', unit: 'giây', scope: 'sync' },
      skipFwd: { type: 'number', default: 30, min: 5, max: 300, step: 5, label: 'Nút tới', unit: 'giây', scope: 'sync' },
      skipSilence: { type: 'bool', default: 0, label: 'Bỏ qua khoảng lặng (Smart Speed)', scope: 'sync' },
      voiceBoost: { type: 'bool', default: 0, label: 'Tăng cường giọng nói (Voice Boost)', scope: 'sync' },
      autoplayNext: { type: 'bool', default: 1, label: 'Hết tập thì phát tập kế tiếp trong hàng chờ' },
      markPlayedAt: { type: 'number', default: 95, min: 80, max: 100, step: 1, label: 'Đánh dấu đã nghe khi tới', unit: '%' },
      autoDownload: { type: 'bool', default: 0, label: 'Tự tải tập mới của podcast đã đăng ký' },
      autoDownloadWifi: { type: 'bool', default: 1, label: 'Chỉ tải khi có Wi-Fi' },
      autoDownloadCharging: { type: 'bool', default: 0, label: 'Chỉ tải khi đang sạc' },
      keepDownloads: { type: 'number', default: 5, min: 1, max: 100, step: 1, label: 'Giữ tối đa mỗi podcast', unit: 'tập' },
      autoDelete: { type: 'bool', default: 1, label: 'Tự xoá bản tải của tập đã nghe xong' },
      refreshEvery: { type: 'enum', default: '360', options: { 0: 'Chỉ khi bấm làm mới', 60: 'Mỗi giờ', 360: 'Mỗi 6 giờ', 1440: 'Mỗi ngày' }, label: 'Tự kiểm tra tập mới' },
      newToQueue: { type: 'bool', default: 0, label: 'Thêm tập mới vào cuối hàng chờ' },
      aiTranscript: { type: 'bool', default: 0, label: 'Tự tạo bản chép lời bằng AI khi tập không có (tốn pin)' },
      country: { type: 'enum', default: 'vn', options: { vn: 'Việt Nam', us: 'Mỹ', gb: 'Anh', jp: 'Nhật', kr: 'Hàn', fr: 'Pháp', de: 'Đức' }, label: 'Quốc gia cho bảng xếp hạng', scope: 'sync' },
      piKey: { type: 'string', default: '', label: 'Podcast Index API key (chỉ lưu trên máy này)' },
      piSecret: { type: 'string', default: '', label: 'Podcast Index API secret (chỉ lưu trên máy này)' },
      corsProxy: { type: 'string', default: '', label: 'Proxy CORS cho bản web (ví dụ https://corsproxy.io/?url=)' },
      subsView: { type: 'string', default: 'grid', ui: false },
      subsSort: { type: 'string', default: 'recent', ui: false },
      sleepMin: { type: 'number', default: 30, ui: false },
    },
  });
}
export const get = (k) => params.get('podcasts.' + k);
export const set = (k, v) => params.set('podcasts.' + k, v);
