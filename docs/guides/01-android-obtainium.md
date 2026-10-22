# Android: cài và cập nhật bằng Obtainium

My Hub cho Android là một tệp APK trên trang GitHub Releases. Obtainium là app theo dõi trang đó, báo khi có bản mới và cài giúp bạn.

## Cài lần đầu

1. Cài **Obtainium**: tải APK mới nhất ở https://github.com/ImranR98/Obtainium/releases (hoặc từ F-Droid / IzzyOnDroid).
2. Mở Obtainium, bấm **Add App**.
3. Ô **App Source URL**: `https://github.com/Fedya3012/my-hub`
4. Để các tuỳ chọn khác như mặc định. Nếu Obtainium hỏi chọn tệp, chọn `MyHub-x.y.z.w.apk`. Có thể điền **Filter APKs by regular expression**: `MyHub-.*\.apk$`
5. Bấm **Add**, rồi **Install**. Lần đầu Android hỏi quyền cài app không rõ nguồn gốc cho Obtainium: cho phép.

## Nhận bản mới

- Bật **Settings → Background update checking** trong Obtainium để nó tự kiểm tra.
- Khi có bản mới, Obtainium báo, bạn bấm **Update**. Dữ liệu trong My Hub giữ nguyên.
- Trong My Hub, **Quản lý ứng dụng → Kiểm tra cập nhật** cũng báo có bản mới, nhưng trên Android app sẽ nhắc bạn mở Obtainium để cài (APK không tự thay chính nó).

## Khi gặp lỗi

- **"App not installed" / chữ ký không khớp**: mọi bản APK đều ký bằng cùng một khoá. Nếu máy đang có bản cài từ nguồn khác (ví dụ bản debug), phải gỡ bản đó rồi cài lại qua Obtainium. Gỡ app là mất dữ liệu trên máy, nên sao lưu trước (**Cài đặt → Sao lưu dữ liệu**) hoặc đồng bộ qua GitHub / Dropbox / OneDrive.
- **Obtainium không thấy bản mới**: bản mới chỉ xuất hiện sau khi GitHub build xong (khoảng 10 đến 15 phút sau khi phát hành). Kéo xuống để làm mới trong Obtainium.
