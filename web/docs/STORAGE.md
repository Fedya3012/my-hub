# Hệ thống lưu trữ linh hoạt

Code: `js/core/storage/` (`index.js` = trình quản lý, `local.js`, `github.js`). Module không gọi adapter trực tiếp, chỉ dùng:

```js
const file = await storage.addFile(itemId, fileOrBlob, { role: 'main' });
const blob = await storage.open(file);       // lấy từ máy
const url  = await storage.objectUrl(file);  // cho <audio>/<video>/<img>
await storage.sync();                          // đồng bộ ngay
```

## Các chế độ (Cài đặt → Lưu trữ & đồng bộ)

| | Dữ liệu (database) | Tệp nội dung | Offline |
|---|---|---|---|
| **Chỉ trên máy** | IndexedDB | OPFS, dự phòng IndexedDB; hoặc liên kết thẳng tới thư mục (desktop) | Đầy đủ |
| **Tài khoản GitHub** (`github`) | IndexedDB + snapshot trong kho riêng tư `my-hub-data` | Luôn ở lại trên máy (không tải lên) | Đầy đủ |

Chế độ GitHub cần đăng nhập **tài khoản GitHub** (đăng nhập, đăng xuất, thiết bị, xoá dữ liệu); xem [ACCOUNT.md](ACCOUNT.md). Đăng xuất thì về Chỉ trên máy. Các chế độ cũ (`gdrive`, `hybrid`, `account`) được đọc thành `github` nếu đã đăng nhập GitHub, nếu không thì `local`.

## Đồng bộ

1. Mỗi thay đổi ở bảng đồng bộ được đóng dấu `updatedAt`, `rev` và ghi vào `syncQueue`.
2. `storage.sync()` đọc `hub-db.json` trong kho GitHub, gộp từng bản ghi (mới hơn thắng), áp dụng `tombstones` (bản ghi xoá cứng; xoá trên máy chưa gửi không bị hồi sinh), ghi lại cục bộ và lên kho.
3. Tự chạy khi mở app, khi có mạng trở lại, ~8 giây sau mỗi thay đổi, mỗi 2 phút khi app mở. Tiến độ hiện ở khay tác vụ và trang Tài khoản.

## Tiến độ theo bạn qua mọi thiết bị

Ví dụ: đang nghe dở trên Windows, mở app trên điện thoại thì nghe tiếp đúng chỗ đó.

- Mọi module lưu vị trí qua `js/core/progress.js` (`progress.save`, `progress.track(item, audioEl)`), không tự giữ vị trí riêng. Tiến độ nằm trong bảng `progress`, kèm máy nào ghi và lúc nào.
- Tiến độ đi trên **kênh nhanh** riêng: tệp nhỏ `hub-live.json` trong kho, tách khỏi snapshot thư viện lớn. Tệp này cũng mang danh sách thiết bị và yêu cầu đăng xuất (`signouts`).
  - Đang phát: lưu vào máy mỗi 5 giây, đẩy lên GitHub sau khoảng 8 giây.
  - Bấm dừng, chuyển app xuống nền, đóng tab: đẩy lên ngay.
  - Mở app hoặc quay lại app: kéo về ngay, rồi cứ 45 giây kéo lại một lần khi app đang mở.
- Gộp theo bản ghi: lần dừng mới nhất thắng. "Tiếp tục" trong Thư viện xếp theo lần dừng gần nhất trên mọi máy và ghi rõ dừng ở máy nào.
- Ở chế độ **Chỉ trên máy** thì tiến độ chỉ nằm trên máy đó. Muốn đồng bộ giữa các máy phải đăng nhập GitHub.
- Đồng hồ các máy có thể lệch nhau vài giây. Hai máy cùng phát một bài một lúc thì máy dừng sau cùng thắng.

## Ghi chú nền tảng

- **Android / APK (TWA)**: chạy trong Chrome nên OPFS, IndexedDB, Service Worker đều hoạt động. Không có chọn thư mục, nên tệp được sao chép vào app.
- **Windows (Chrome/Edge)**: có thêm `showDirectoryPicker`, có thể liên kết thư mục nhạc sẵn có mà không sao chép (`local.link`).
- Bấm "Yêu cầu lưu trữ bền vững" để trình duyệt không tự xoá dữ liệu khi máy đầy.
