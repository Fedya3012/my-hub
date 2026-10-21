# Hệ thống lưu trữ linh hoạt

Code: `js/core/storage/` (`index.js` = trình quản lý, `local.js`, `github.js`, `dropbox.js`, `onedrive.js`, `webdav.js`, `http.js`, `clouds.js`, `cloud-ui.js`). Module không gọi adapter trực tiếp, chỉ dùng:

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
| **Dropbox** (`dropbox`) | IndexedDB + `hub-db.json`, `hub-live.json` trong thư mục app | Tải lên Dropbox sau khi thêm, máy khác tải về khi mở | Đầy đủ (tệp đã tải về) |
| **OneDrive** (`onedrive`) | `hub-db.json`, `hub-live.json` trong `Apps/<tên app>/` (Microsoft Graph, `If-Match` theo eTag) | Như Dropbox; tệp > 4 MB tải theo phiên 10 MB | Đầy đủ |
| **WebDAV** (`webdav`), **pCloud** (`pcloud`) | Như Dropbox, trong một thư mục trên máy chủ WebDAV | Như Dropbox | Đầy đủ |

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


## Ổ đám mây: Dropbox, OneDrive, WebDAV, pCloud

- Ba chế độ này đẩy cùng dữ liệu như GitHub (snapshot + kênh tiến độ) **và** tệp nhạc/sách. `storage.syncFiles()` tải lên các tệp chưa có trên ổ (một tác vụ có thanh tiến trình theo byte, huỷ được), rồi ghi `locations.<chế độ> = { key }` vào hàng tệp. Máy khác gọi `storage.open(file)`: nếu máy chưa có thì tải về từ ổ (có tiến trình), giữ lại trên máy và lần sau mở thẳng. Xoá tệp cũng xoá bản trên ổ.
- Thông tin kết nối (mật khẩu, token) nằm trong `localStorage` của máy (`clouds.js`), không vào bản sao lưu JSON.
- **WebDAV / pCloud**: nhập địa chỉ một thư mục **có sẵn**, tên đăng nhập, mật khẩu (nên là mật khẩu ứng dụng). Chỉ dùng GET / PUT / DELETE trong đúng thư mục đó (không PROPFIND/MKCOL vì plugin HTTP của Android không gửi được). Chống mất cập nhật bằng `If-Match` theo ETag. Trình duyệt chỉ gọi được nếu máy chủ bật CORS; app Windows (qua tiến trình chính, `window.hubDesktop.http`) và Android (plugin `CapacitorHttp`) không bị CORS. **pCloud**: WebDAV chính thức của pCloud, `https://ewebdav.pcloud.com/` (tài khoản châu Âu) hoặc `https://webdav.pcloud.com/` (Mỹ) + tên thư mục có sẵn (ví dụ `/MyHub/`), đăng nhập bằng email và mật khẩu pCloud (bật xác thực hai bước thì WebDAV có thể không dùng được). Các chế độ `filejump` và `filen` cũ đã bỏ; ai đang dùng sẽ quay về chế độ trên máy.
- **OneDrive**: Microsoft Graph, thư mục riêng `Apps/…` (quyền `Files.ReadWrite.AppFolder`). Đăng nhập OAuth PKCE với redirect `nativeclient`: sau khi cho phép, trình duyệt tới trang trắng, dán cả địa chỉ (có `?code=`) vào app. Cần Client ID: https://entra.microsoft.com → App registrations → New registration → Accounts in any org directory and personal Microsoft accounts → Redirect URI loại *Mobile and desktop*: `https://login.microsoftonline.com/common/oauth2/nativeclient` → API permissions (Microsoft Graph, delegated) `Files.ReadWrite.AppFolder`, `offline_access` → chép *Application (client) ID* (dán vào hộp kết nối hoặc `ONEDRIVE_CLIENT_ID` trong `js/config.js`). Bước đổi mã/làm mới token đi qua shell (Windows/Android); trong trình duyệt thường bị CORS chặn.
- **Thư mục đồng bộ** (WebDAV, pCloud, trừ Android): trong Cài đặt → Lưu trữ chọn một hoặc nhiều thư mục trên ổ (`storage/folder-ui.js`). `storage/folders.js` (`syncFolders`) quét đệ quy, nhập tệp nhạc/sách mới (ghi nhớ theo đường dẫn + kích thước trong `sync.folderDone`). Liệt kê dùng WebDAV PROPFIND (Depth 1); plugin HTTP của Android không gửi được, nên cần API riêng của pCloud (chưa làm).
- **Dropbox**: OAuth PKCE **không cần trang chuyển hướng**, Dropbox hiện một mã để dán vào app nên chạy giống nhau ở trình duyệt, Windows và Android. Cần App key của một app Dropbox miễn phí: vào https://www.dropbox.com/developers/apps → *Create app* → *Scoped access* → *App folder* → đặt tên → tab *Permissions* bật `files.content.write` và `files.content.read` → *Submit* → chép **App key** ở tab *Settings*. Dán App key vào hộp kết nối (hoặc đặt `DROPBOX_APP_KEY` trong `js/config.js`). Tệp lớn tải lên theo phiên 8 MB, không giới hạn dung lượng ngoài hạn mức Dropbox (gói miễn phí 2 GB).
- Đổi sang ổ khác: bật chế độ mới, app hỏi Gộp / Dùng dữ liệu của ổ / Để sau như khi đăng nhập GitHub. Tệp trên máy được tải lên ổ mới ở lần đồng bộ đầu.
