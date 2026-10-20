# Tài khoản Google & đồng bộ giữa các máy

Tài khoản của My Hub là **tài khoản Google** của bạn: đăng nhập Google, đăng xuất (máy này hoặc mọi thiết bị), danh sách thiết bị, đồng bộ thư viện, tiến độ và tệp giữa máy tính, điện thoại và bản APK qua **Google Drive của chính bạn**. Không có máy chủ riêng, không mật khẩu riêng, không build.

Code: `js/core/account.js` (phiên đăng nhập Google, token), `js/core/storage/gdrive.js` (Drive REST), `js/core/storage/index.js` (đồng bộ, thiết bị, xoá dữ liệu trên Drive), `js/core/account-ui.js` + `js/modules/account/` (giao diện, route `#account`), `css/account.css`.

## Cài đặt (một lần, khoảng 10 phút)

1. **Tạo project**: vào [console.cloud.google.com](https://console.cloud.google.com/projectcreate) → *New project* (ví dụ “My Hub”) → *Create*, rồi chọn project đó.
2. **Bật Drive API**: *APIs & Services → Library* → tìm **Google Drive API** → *Enable*.
3. **Màn hình đồng ý OAuth** (*APIs & Services → OAuth consent screen*, giao diện mới là *Google Auth Platform*):
   - Loại **External**, điền tên app, email hỗ trợ, email liên hệ.
   - *Data access / Scopes*: thêm `https://www.googleapis.com/auth/drive.appdata`, `https://www.googleapis.com/auth/drive.file`, `openid`, `email`, `profile`. Cả năm đều **không nhạy cảm**, không cần Google duyệt.
   - *Audience / Test users*: thêm Gmail của bạn (chế độ Testing), hoặc *Publish app* để ai cũng đăng nhập được.
4. **Tạo Client ID**: *APIs & Services → Credentials → Create credentials → OAuth client ID* → **Web application**. Trong **Authorized JavaScript origins** thêm:
   - địa chỉ app đã đăng, chỉ phần gốc, ví dụ `https://ten-ban.github.io` (không có `/my-hub/`, không dấu `/` cuối);
   - địa chỉ chạy thử, ví dụ `http://localhost:8080`.
   Không cần *Authorized redirect URIs*. Thay đổi có thể mất vài phút mới có hiệu lực.
5. **Dán Client ID** vào `js/config.js` rồi đăng lại app:
   ```js
   export const GOOGLE_CLIENT_ID = '1234-abc.apps.googleusercontent.com';
   ```
6. Mở app → huy hiệu cuối thanh bên (hoặc Cài đặt → Tài khoản Google) → **Đăng nhập bằng Google**. Làm tương tự trên điện thoại.

Chưa cấu hình (`GOOGLE_CLIENT_ID = ''`) thì trang Tài khoản hiện hướng dẫn này (kèm nút sao chép origin) và app chạy đầy đủ ở chế độ Trên máy.

## Dùng

- Đăng nhập mở cửa sổ Google (Google Identity Services, token client) xin quyền `drive.appdata` + `drive.file` + `openid email profile`. App hiện tên, email, ảnh đại diện.
- Lần đầu đăng nhập trên máy đã có dữ liệu, và tài khoản cũng đã có dữ liệu: app hỏi **Gộp** (mặc định), **Dùng dữ liệu của tài khoản** (thay thế, có xác nhận) hoặc **Để sau**. Nếu một bên trống thì gộp luôn, không hỏi.
- Đăng nhập xong, chế độ lưu trữ chuyển sang **Tài khoản Google** (hoặc giữ **Kết hợp** nếu đang dùng). Đăng xuất thì về **Trên máy**, dữ liệu vẫn còn (có tuỳ chọn xoá).
- **Giữ đăng nhập**: hồ sơ và token (hạn 1 giờ) lưu trong `localStorage`, nên tải lại trang hay offline vẫn thấy đã đăng nhập. Token hết hạn thì app xin lại im lặng (`prompt: ''` + `login_hint`). Trình duyệt chỉ cho mở cửa sổ đó khi người dùng bấm, nên nếu token hết hạn lúc mở app, huy hiệu ghi “Bấm để kết nối lại” và trang Tài khoản có nút **Kết nối lại** (một lần bấm, không chọn lại tài khoản). Bấm **Đồng bộ ngay** cũng tự kết nối lại.
- **Đăng xuất** (máy này): đồng bộ lần cuối rồi xoá phiên trên máy này; các máy khác không bị ảnh hưởng. Ô tuỳ chọn “Thu hồi quyền” (mặc định tắt) thu hồi token với Google; vì Google thu hồi theo *quyền của app với tài khoản*, các máy khác khi đó phải bấm “Kết nối lại” khi token hết hạn (tối đa 1 giờ).
- **Đăng xuất mọi thiết bị**: ghi yêu cầu `'*'` vào `hub-live.json`, rồi đăng xuất máy này và thu hồi quyền với Google. Mỗi máy khác bỏ phiên ở lần đồng bộ tiến độ kế tiếp khi có mạng (mở app, quay lại app, mỗi 45 giây).
- **Thiết bị**: danh sách máy (tên, lần hoạt động cuối, “Máy này”, “Đã đăng xuất”), đổi tên máy này, đăng xuất từng máy khác (có hiệu lực khi máy đó đồng bộ lần tới).
- **Đồng bộ ngay** hiện tiến độ ngay trong trang và ở khay tác vụ (`js/core/tasks.js`), huỷ được.
- **Xoá dữ liệu trên Drive** (gõ `XOÁ` để xác nhận): xoá mọi tệp trong `appDataFolder` và mọi tệp/thư mục app đã tạo trên Drive (`drive.file` chỉ liệt kê đúng những tệp đó), bỏ vị trí Drive khỏi bản ghi tệp trên máy, rồi đăng xuất (hoặc về Trên máy). Thư viện trên máy giữ nguyên; tệp chỉ có trên Drive thì mất.

## Dữ liệu trên Drive

| Nơi | Nội dung |
|---|---|
| `appDataFolder/hub-db.json` | Toàn bộ thư viện (các bảng `SYNCED_TABLES`) + `tombstones` `{ bảng: { id: thời điểm xoá } }` |
| `appDataFolder/hub-live.json` | Tiến độ nghe/đọc + thiết bị (`LIVE_TABLES`) + `signouts` `{ deviceId \| '*': thời điểm }` |
| Thư mục **My Hub** | Tệp nội dung (nhạc, sách…), vị trí ghi ở `files.locations.gdrive` |

## Quy tắc đồng bộ

- Gộp theo từng bản ghi: `updatedAt` mới hơn thắng, bằng nhau thì `rev` lớn hơn.
- Xoá: bản ghi bị xoá cứng trên một máy được ghi thành tombstone (từ hàng đợi `syncQueue`). Tombstone mới hơn hoặc bằng bản ghi thì bản ghi bị bỏ ở mọi máy; bản ghi đã xoá trên máy nhưng chưa gửi **không bị “hồi sinh”** bởi bản cũ trong snapshot. Tombstone giữ 120 ngày.
- Hàng đợi chỉ xoá đến mục đã gửi; thay đổi phát sinh trong lúc đồng bộ đi lần sau.
- Tự chạy: khi mở app, ~8 giây sau mỗi thay đổi, mỗi 2 phút khi app đang mở, khi có mạng trở lại. Tiến độ nghe/đọc + thiết bị đi kênh nhanh `hub-live.json`.
- Yêu cầu đăng xuất áp dụng cho máy có thời điểm đăng nhập cũ hơn yêu cầu; đăng nhập lại (bấm Đăng nhập) là phiên mới.

## Bảo mật

- Client ID công khai theo thiết kế; không có khoá bí mật trong app. Token chỉ nằm trong `localStorage` của trình duyệt (không vào bản sao lưu JSON), hạn 1 giờ.
- Quyền hẹp: `drive.appdata` (thư mục ẩn riêng của app) và `drive.file` (chỉ tệp app tạo). App không đọc được phần còn lại của Drive.
- Người dùng có thể thu hồi quyền bất cứ lúc nào tại [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
