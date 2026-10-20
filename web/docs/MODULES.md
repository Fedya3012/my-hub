# Thêm module mới

Ví dụ đầy đủ: module `music` (xem [MUSIC.md](MUSIC.md)).

1. Tạo `js/modules/music/index.js`:

```js
export async function mount(el, ctx, sub) { /* vẽ giao diện vào el; ctx = { db, bus, storage, tasks, toast, go, params, services }; sub = phần sau route, vd '#music/album/abc' → 'album/abc' */ }
export function navigate(sub) { /* tuỳ chọn: đổi trang con mà không mount lại */ }
export function unmount() { /* gỡ listener, dừng timer */ }
export async function migrate({ from, to, db }) { /* tuỳ chọn: chạy khi cập nhật module */ }
```

2. Sửa `js/modules/music/manifest.js`: đổi `status` thành `'available'`, đặt `version: '0.1.0'`, liệt kê `files`.
3. Thêm mục `music` trong `version.json` (version, files, changelog).
4. Module đã có sẵn trong `js/core/registry.js`; module khác thì thêm một dòng import ở đó.

## Dịch vụ chạy nền (tuỳ chọn)

Đặt `service: 'service.js'` trong manifest. File đó export `start(ctx)` và `stop()`; app gọi `start` lúc khởi động và khi bật/cập nhật module, `stop` khi tắt. Dùng cho thứ phải sống ngoài trang của module (Music Player: trình phát, mini player, phím tắt). Module chia nhiều file đặt `reloadOnUpdate: true` để app tải lại trang sau khi cập nhật.

## Điểm mở rộng

`extend('library.drawer', fn)` (`js/core/extensions.js`): thêm khối vào ngăn chi tiết của Thư viện. `fn({ item, el, ctx, refresh })`. Music dùng để hiện mục "Nhạc nền".

## Liên kết với các module khác

- Mở nội dung: Thư viện phát `bus.emit('item:open', { item })`; module sở hữu `item.moduleId` nhận và mở. Khi người dùng đóng mục, module phát `bus.emit('item:close', { item })` (để nhạc nền dừng).
- Điều khiển nhạc: `bus.emit('music:play', { kind: 'playlist'|'album'|'artist'|'track', id, shuffle })`, `music:pause`, `music:toggle`.
- Ghi lịch sử: `logActivity(itemId, 'music', 'play')` → thống kê và "Tiếp tục" của Thư viện tự cập nhật.
- Tiến độ (bắt buộc dùng để đồng bộ giữa các máy): `progress.track(item, audioOrVideoEl)` cho nhạc, video, podcast; `progress.save(item, { position, total, unit: 'page' })` cho sách. Khi mở item, đọc `progress.get(item.id)` để tiếp tục đúng chỗ.
- Quan hệ: `linkItems(fromId, toId, 'soundtrack-of')`, đọc bằng `relatedItems(id)`.
- Tệp: luôn dùng `storage`, không tự đọc OPFS, để cả hai chế độ lưu trữ đều chạy.

## Cập nhật module

Tăng `version` trong `version.json` (và manifest). App Manager phát hiện, Service Worker tải riêng tệp của module vào cache `hub-mod-<id>-<version>`, xoá cache cũ, nạp lại module và gọi `migrate`. Có nút quay lại bản trước. Thay đổi phần lõi (`js/core`, CSS, `index.html`) thì tăng `SW_VERSION` trong `sw.js` và `app` trong `version.json`.


## Thông số dùng chung (`ctx.params`, `js/core/params.js`)

Mọi module đọc/ghi cùng một lớp thông số, đặt tên theo không gian (`ui.motion`, `audio.volume`, `music.showBadges`, `books.fontSize`…), và đăng ký nghe thay đổi. Không cần import module khác.

```js
export async function mount(el, ctx) {
  const P = ctx.params;
  P.get('ui.motion');                       // 'auto' | 'full' | 'reduced'
  P.get('locale.locale');                   // 'vi-VN' → dùng cho toLocaleString
  P.get('audio.volume');                    // âm lượng chung (Nhạc giữ cùng giá trị)
  const off = P.on('audio', (e) => { /* e = { key, value, old, source } */ });
  P.on('*', fn);                            // mọi thay đổi; trả về hàm huỷ — gọi trong unmount()
  await P.set('audio.volume', 0.6);         // module Nhạc sẽ đổi âm lượng thật
}
```

### Khai báo thông số của module (tự hiện trong Cài đặt, tự lưu, tự sao lưu, tự đồng bộ)

```js
// thường đặt trong service.js start(ctx) hoặc đầu mount()
const my = ctx.params.define('books', {
  title: 'Đọc sách', icon: 'book', module: 'books', order: 30,
  params: {
    fontSize: { type: 'number', default: 18, min: 12, max: 32, step: 1, label: 'Cỡ chữ', unit: 'px' },
    pageTheme: { type: 'enum', default: 'paper', options: { paper: 'Giấy', dark: 'Tối' }, label: 'Nền trang' },
    tts: { type: 'bool', default: 0, label: 'Đọc to (TTS)', scope: 'sync', hint: 'Theo tài khoản, mọi máy' },
    lastShelf: { type: 'string', default: '', ui: false },      // không hiện trong Cài đặt
  },
});
my.get('fontSize'); await my.set('fontSize', 20); my.on(e => …);
```

| Trường | Ý nghĩa |
|---|---|
| `type` | `bool` (0/1) · `number` (kẹp theo `min`/`max`) · `string` · `enum` (`options: {giá trị: nhãn}`) · `color` (#hex, `nullable`) · `json` |
| `default` | giá trị khi chưa lưu gì |
| `label` | có nhãn và `ui !== false` → tự hiện ở **Cài đặt → Thông số dùng chung** |
| `scope` | `'device'` (mặc định, chỉ máy này, bảng `settings` khoá `params.<ns>`) · `'sync'` (mọi thiết bị: dòng `collections` id `params:sync`, đi theo đồng bộ GitHub) |
| `readonly`, `hint`, `unit`, `step`, `section` | phụ |

Cả hai nơi lưu đều nằm trong bản **xuất/nhập JSON**; sau khi nhập hoặc đồng bộ kéo về, `params` tự đọc lại và phát sự kiện (`source: 'sync'`). Không gian đã có kho riêng (Nhạc: `music.prefs`, theme, chế độ lưu trữ) dùng `adapter: { get(k), set(k, v) }` nên giá trị cũ giữ nguyên chỗ; `set` trả `false` = để params tự lưu.

### Không gian toàn cục mọi module nên tôn trọng (`js/core/params-core.js`)

| ns | Thông số | Ghi chú |
|---|---|---|
| `ui` | `skin, theme, accent, radius, scale, density, mode`, `motion` | đổi qua `set` gọi `applyTheme`; `motion: 'reduced'` đặt `html[data-motion=reduced]` (CSS lõi tắt animation) |
| `locale` | `lang, locale, weekStart` | dùng cho định dạng số/ngày, ngôn ngữ lời/TTS |
| `storage` | `mode` (chỉ đọc), `hybridPolicy, cacheOnOpen` | khoá cũ `storage.*` trong `settings` |
| `account` | `signedIn, email, name, needsReconnect, sync` | trực tiếp, chỉ đọc |
| `device` | `id, name, platform, online, prefersDark, reducedMotion, touch, memoryGB, cores, lowEnd` | trực tiếp, chỉ đọc — module nặng nên giảm hiệu ứng khi `lowEnd` |
| `audio` | `volume, outputDevice, rate, hiResRule, bitPerfect, duckOthers` | module phát media (video, podcast, sách nói/TTS) dùng chung; Nhạc gắn adapter nên đây chính là âm lượng/thiết bị phát của trình phát |
| `playback` | `module, itemId, title, state, position, duration` | đang phát gì (Nhạc báo; module khác gọi `setLive('playback.x', v)` từ `params-core.js`) |
| `tasks` | `running, failed, percent` | tiến độ chung của khay tác vụ |
| `music` | toàn bộ `prefs.DEFAULTS` theo đường dẫn (`playback.gapless`, `np.art`, `lyrics.online`…) | mục có nhãn hiện trong Cài đặt |

### Dịch vụ (`ctx.services`)

Hàm một module cho module khác dùng, không import chéo:

```js
const player = ctx.services.get('player') || await ctx.services.when('player', 3000);
player?.duck(true);  /* đọc TTS */  player?.duck(false);
const art = ctx.services.get('art');   // { url(fileId), html(fileId, seed, opts), hydrate(el), palette(blob) }
const timers = await ctx.services.get('timers')?.load();   // hẹn giờ ngủ/tập/tập trung của Nhạc
const ambient = await ctx.services.get('ambient')?.load(); // bộ trộn âm thanh nền
ctx.services.provide('reader', { open(id) { … } });          // module của bạn cung cấp
```

`player`: `play(kind, id)`, `playIds(ids)`, `pause()`, `toggle()`, `next()`, `prev()`, `playing`, `track`, `on(event, fn)`, `duck(on)`.

## Hiệu năng (`js/core/perf.js`)

- Danh sách dài: `incremental(box, list, html, { chunk, onChunk })` vẽ theo đoạn khi cuộn — **không giới hạn số mục**, DOM chỉ lớn dần. Dùng cho mọi danh sách có thể > 100 mục.
- `debounce`, `rafThrottle`, `idle(fn)` (requestIdleCallback), `yieldToMain()` giữa các bước nặng.
- Đừng vẽ lại cả trang khi một thông số đổi: chỉ nghe đúng khoá (`P.on('music.gridSize', …)`).
- Ghi hàng loạt (`bulkPut` hàng chục nghìn dòng) an toàn: hàng đợi đồng bộ được gom thành một lần ghi.

## Kéo thả (`js/core/dnd.js`)

- `dropFiles(window | el, { onFiles, overlay, when })`: nhận tệp **và thư mục** (đi đệ quy, giữ `relPath`), có lớp phủ khi kéo.
- `setPayload(e, 'music', data)` / `getPayload(e, 'music')` / `hasPayload(e, type)`: kéo nội dung giữa các phần của app.
- Nhạc: thả tệp/thư mục vào trang Nhạc để nhập; kéo bài/album/nghệ sĩ → thanh đích (Phát tiếp, Cuối hàng chờ, danh sách phát, danh sách mới), thả lên thẻ danh sách phát, mini player hoặc hàng chờ; thả ảnh lên thẻ album/nghệ sĩ/danh sách phát để đổi ảnh; thả video / .lrc / .ttml / .srt lên Now Playing. Sắp xếp hàng chờ và danh sách phát bằng tay cầm ⠿ (chuột, cảm ứng) hoặc Alt + ↑/↓ trên tay cầm.

## Khay tác vụ

Nút thu nhỏ (⌄) biến khay thành vòng tròn 48 px: vòng tiến độ chung (xoay khi không rõ %), số tác vụ đang chạy, màu đỏ khi lỗi; bấm để mở lại; kéo tới cạnh bất kỳ (tự hít vào cạnh, nhớ vị trí trong `localStorage`; phím mũi tên đưa tới cạnh). Trạng thái thu nhỏ được nhớ; chỉ tự mở rộng khi có tác vụ lỗi.

## Dung lượng

App không đặt giới hạn số bài/album/tệp hay kích thước tệp. Giới hạn thật là hạn mức trình duyệt (`navigator.storage.estimate`) và dung lượng còn lại trên máy, hiện trong Cài đặt với cảnh báo khi ≥ 85 %. Lần nhập đầu tiên app xin `navigator.storage.persist()`. Muốn không tốn chỗ: “Liên kết thư mục (không sao chép)” (File System Access, máy tính).
