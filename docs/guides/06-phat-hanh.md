# Phát hành phiên bản mới

## Quy tắc

- Mọi yêu cầu (thêm, bỏ, sửa) ở các thread được commit lên `main` nhưng **chưa phát hành**. Số phiên bản giữ nguyên.
- Thread **Nhật ký phiên bản / Changelog** giữ danh sách "Chưa phát hành".
- Khi bạn nói **"cập nhật"** trong thread Changelog, mọi thay đổi tới lúc đó được phát hành **cùng một lần**. Bạn có thể nói luôn số phiên bản muốn dùng (ví dụ "cập nhật 0.9.10.0").

## Sau khi bạn nói "cập nhật"

1. Claude tăng `APP_VERSION` trong `web/js/config.js` (dạng x.y.z.w), ghi changelog, đẩy lên `main`.
2. GitHub Actions build trong khoảng 10 đến 15 phút và tạo Release `v<phiên bản>` gồm:
   - `MyHub-<phiên bản>.apk` (Android)
   - `MyHub-<phiên bản>-x64-Setup.exe` (Windows, tự cập nhật)
   - `MyHub-<phiên bản>-portable.exe` (Windows, không cài)
3. Nhận bản mới:
   - Android: Obtainium báo, bấm **Update** (xem [Android](01-android-obtainium.md)).
   - Windows Setup: tự tải và hỏi khởi động lại (xem [Windows](02-windows.md)).

Đẩy lên `main` mà không đổi phiên bản thì GitHub chỉ build để kiểm tra, không có Release mới, nên điện thoại và máy tính không nhận gì.

## Xem lại

- Các bản đã phát hành: https://github.com/Fedya3012/my-hub/releases
- Tiến trình build: tab **Actions** của repo.
- Khoá ký Android cố định, không bao giờ đổi; đổi khoá thì phải gỡ app và cài lại.
