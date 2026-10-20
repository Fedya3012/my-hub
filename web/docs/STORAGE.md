# Hệ thống lưu trữ linh hoạt

Code: `js/core/storage/` (`index.js` = trình quản lý, `local.js`, `gdrive.js`). Module không gọi adapter trực tiếp, chỉ dùng:

```js
const file = await storage.addFile(itemId, fileOrBlob, { role: 'main' });
const blob = await storage.open(file);       // tự lấy từ máy hoặc Drive
const url  = await storage.objectUrl(file);  // cho <audio>/<video>/<img>
await storage.sync();                          // đồng bộ ngay
```

## Các chế độ (Cài đặt → Lưu trữ & đồng bộ)

| | Dữ liệu (database) | Tệp nội dung | Offline |
|---|---|---|---|
| **Chỉ trên máy** | IndexedDB | OPFS, dự phòng IndexedDB; hoặc liên kết thẳng tới thư mục (desktop) | Đầy đủ |
| **Tài khoản Google** (`gdrive`) | IndexedDB + snapshot trong `appDataFolder` | Lưu trên Drive, tải khi mở, giữ bản tạm trên máy | Thư viện đầy đủ; tệp nào đã mở thì có |
| **Kết hợp** (`hybrid`) | IndexedDB + snapshot trên Drive | Trên máy là chính, tự tải lên Drive nền | Đầy đủ |

Hai chế độ đám mây cần đăng nhập **tài khoản Google** (đăng nhập, đăng xuất, thiết bị, xoá dữ liệu trên Drive); xem [ACCOUNT.md](ACCOUNT.md). Đăng xuất thì về Chỉ trên máy. Chế độ cũ `account` (Supabase) được đọc thành `gdrive`.

Chế độ Kết hợp có thêm chính sách: đồng bộ mọi tệp / chỉ sao lưu dữ liệu / dữ liệu + tệp dưới 50 MB (tiết kiệm 4G).

## Đồng bộ

1. Mỗi thay đổi ở bảng đồng bộ được đóng dấu `updatedAt`, `rev` và ghi vào `syncQueue`.
2. `storage.sync()` đọc `hub-db.json` trong `appDataFolder`, gộp từng bản ghi (mới hơn thắng), áp dụng `tombstones` (bản ghi xoá cứng; xoá trên máy chưa gửi không bị hồi sinh), ghi lại cục bộ và lên Drive.
3. Tệp `pending-upload` được tải lên thư mục **My Hub** trên Drive (tệp lớn hơn 5 MB dùng resumable upload chia khúc), rồi danh sách tệp được cập nhật lại trong snapshot.
4. Tự chạy khi mở app, khi có mạng trở lại, ~8 giây sau mỗi thay đổi, mỗi 2 phút khi app mở. Tiến độ hiện ở khay tác vụ và trang Tài khoản.
5. "Giải phóng bộ nhớ máy" xoá bản tạm của tệp đã an toàn trên Drive.

## Tiến độ theo bạn qua mọi thiết bị

Ví dụ: đang nghe dở trên Windows, mở app trên điện thoại thì nghe tiếp đúng chỗ đó.

- Mọi module lưu vị trí qua `js/core/progress.js` (`progress.save`, `progress.track(item, audioEl)`), không tự giữ vị trí riêng. Tiến độ nằm trong bảng `progress`, kèm máy nào ghi và lúc nào.
- Tiến độ đi trên **kênh nhanh** riêng: tệp nhỏ `hub-live.json` trong `appDataFolder`, tách khỏi snapshot thư viện lớn. Tệp này cũng mang danh sách thiết bị và yêu cầu đăng xuất (`signouts`).
  - Đang phát: lưu vào máy mỗi 5 giây, đẩy lên Drive sau khoảng 8 giây.
  - Bấm dừng, chuyển app xuống nền, đóng tab: đẩy lên ngay.
  - Mở app hoặc quay lại app: kéo về ngay, rồi cứ 45 giây kéo lại một lần khi app đang mở.
- Gộp theo bản ghi: lần dừng mới nhất thắng. "Tiếp tục" trong Thư viện xếp theo lần dừng gần nhất trên mọi máy và ghi rõ dừng ở máy nào.
- Ở chế độ **Chỉ trên máy** thì tiến độ chỉ nằm trên máy đó. Muốn đồng bộ giữa các máy phải đăng nhập Google (Tài khoản Google hoặc Kết hợp).
- Đồng hồ các máy có thể lệch nhau vài giây. Hai máy cùng phát một bài một lúc thì máy dừng sau cùng thắng.

## Bật đăng nhập Google

Một lần: tạo project Google Cloud, bật Google Drive API, cấu hình màn hình đồng ý OAuth, tạo OAuth Client ID loại *Web application* với *Authorized JavaScript origins* là địa chỉ app (và `http://localhost:8080`), dán vào `GOOGLE_CLIENT_ID` trong `js/config.js`. Từng bước chi tiết: [ACCOUNT.md](ACCOUNT.md) (trang `#account` cũng hiện hướng dẫn khi chưa cấu hình).

Phạm vi quyền: `drive.appdata`, `drive.file`, `openid email profile`. App chỉ thấy tệp do chính nó tạo, không đọc được phần còn lại của Drive.

## Ghi chú nền tảng

- **Android / APK (TWA)**: chạy trong Chrome nên OPFS, IndexedDB, Service Worker và đăng nhập Google đều hoạt động. Không có chọn thư mục, nên tệp được sao chép vào app.
- **Windows (Chrome/Edge)**: có thêm `showDirectoryPicker`, có thể liên kết thư mục nhạc sẵn có mà không sao chép (`local.link`).
- Bấm "Yêu cầu lưu trữ bền vững" để trình duyệt không tự xoá dữ liệu khi máy đầy.
