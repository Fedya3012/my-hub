# Phát hành phiên bản mới

## Quy tắc

- Mọi yêu cầu (thêm, bỏ, sửa) ở các thread được làm và đẩy lên `main`, nhưng **chưa phát hành**. Số phiên bản giữ nguyên, điện thoại và máy tính chưa nhận gì.
- Thread **Nhật ký phiên bản / Changelog** giữ danh sách "Chưa phát hành".
- Khi bạn nói **"cập nhật"** trong thread Changelog, mọi thay đổi tới lúc đó được phát hành **cùng một lần**. Có thể nói luôn số phiên bản, ví dụ "cập nhật 0.9.10.0".

## Số phiên bản

Dạng `x.y.z.w`, ví dụ `0.9.12.0`:

| Số | Tăng khi |
|---|---|
| x | Thay đổi rất lớn |
| y | Thêm app hoặc tính năng lớn |
| z | Thêm tính năng nhỏ |
| w | Sửa lỗi, chỉnh nhỏ |

## Sau khi bạn nói "cập nhật"

1. Claude tăng `APP_VERSION`, ghi changelog, đẩy lên `main`.
2. GitHub Actions build trong khoảng 10 đến 15 phút, rồi tạo Release `v<phiên bản>` gồm:
   - `MyHub-<phiên bản>.apk` (Android)
   - `MyHub-<phiên bản>-x64-Setup.exe` (Windows, tự cập nhật)
   - `MyHub-<phiên bản>-portable.exe` (Windows, không cài)
3. Nhận bản mới:
   - Android: Obtainium báo, bấm **Update** (xem [Android](10-android.md)).
   - Windows Setup: tự tải và hỏi khởi động lại (xem [Windows](11-windows.md)).

## Theo dõi

- Các bản đã phát hành: https://github.com/Fedya3012/my-hub/releases
- Tiến trình build: tab **Actions** của repo; dấu xanh là xong, dấu đỏ là lỗi (Claude sẽ sửa).
- Khoá ký Android cố định, không bao giờ đổi. Đổi khoá thì phải gỡ app và cài lại.
