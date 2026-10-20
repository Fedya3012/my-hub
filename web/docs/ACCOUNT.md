# Tài khoản GitHub & đồng bộ giữa các máy

Tài khoản của My Hub là **tài khoản GitHub** của bạn (dán một token một lần). Từ 0.8.0 không còn đăng nhập Google hay Google Drive. Thư viện và tiến độ nghe/đọc đồng bộ qua một kho **riêng tư** `my-hub-data` trên GitHub của chính bạn; tệp nhạc/sách ở lại trên từng máy. Không có máy chủ riêng, không mật khẩu riêng.

Code: `js/core/account.js` (phiên, token), `js/core/storage/github.js` (GitHub REST), `js/core/storage/index.js` (đồng bộ, thiết bị, xoá dữ liệu), `js/core/account-ui.js` + `js/modules/account/` (giao diện, route `#account`).

## Đăng nhập

1. Trang Tài khoản (hoặc huy hiệu cuối thanh bên) → **Đăng nhập bằng GitHub**.
2. Mở trang tạo token, giữ ô `repo`, bấm *Generate token*, sao chép chuỗi `ghp_…`, dán vào app.
3. My Hub tạo kho riêng tư `my-hub-data` và đồng bộ. Làm tương tự trên máy khác với **cùng** tài khoản GitHub.

Token chỉ lưu trên máy (localStorage), không nằm trong bản sao lưu JSON. Token hết hạn hoặc bị thu hồi thì trang Tài khoản báo "Nhập token mới".

## Dùng

- Lần đầu đăng nhập trên máy đã có dữ liệu, và kho cũng đã có dữ liệu: app hỏi **Gộp** (mặc định), **Dùng dữ liệu của tài khoản** hoặc **Để sau**.
- Thiết bị: danh sách máy dùng chung, đổi tên, "Đăng xuất" từ xa một máy hoặc mọi máy (có hiệu lực lần đồng bộ tới).
- Xoá dữ liệu trên GitHub: xoá `hub-db.json` và `hub-live.json` trong kho (kho vẫn còn, tự xoá trên GitHub nếu muốn). Thư viện trên máy giữ nguyên.
- Đăng xuất không xoá thư viện trên máy; app về chế độ Trên máy.

## Nâng cấp từ bản dùng Google Drive

Máy đang ở chế độ Tài khoản Google hoặc Kết hợp tự về **Trên máy** (hoặc GitHub nếu đã đăng nhập GitHub). Phiên Google cũ bị bỏ. Dữ liệu trên máy giữ nguyên; tệp chỉ nằm trên Drive không còn mở được, hãy thêm lại tệp vào app. Dữ liệu cũ trên Google Drive không bị xoá, bạn có thể tự xoá trong myaccount.google.com → Bảo mật → Kết nối của bên thứ ba.
