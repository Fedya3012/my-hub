# Android: cài và cập nhật bằng Obtainium

My Hub cho Android là một tệp APK đăng trên trang GitHub Releases của repo. **Obtainium** là một app miễn phí theo dõi trang đó: nó báo khi có bản mới và cài giúp bạn, không cần Google Play.

## Chuẩn bị

- Điện thoại Android 7 trở lên (đã thử trên Samsung Galaxy Z Flip).
- Có mạng khi cài và khi cập nhật. Dùng app thì không cần mạng.

## Cài Obtainium

1. Trên điện thoại, mở https://github.com/ImranR98/Obtainium/releases
2. Ở bản mới nhất, mục **Assets**, tải tệp APK có chữ `arm64-v8a` trong tên (hợp với đa số điện thoại hiện nay).
3. Mở tệp vừa tải. Android hỏi quyền **Cài ứng dụng không rõ nguồn gốc** cho trình duyệt: bật, rồi bấm **Cài đặt**.

> Có thể cài Obtainium từ F-Droid hoặc IzzyOnDroid nếu bạn đã dùng các kho đó.

## Thêm My Hub vào Obtainium

1. Mở Obtainium, bấm **Add App** (dấu cộng ở thanh dưới).
2. Ô **App Source URL**, dán: `https://github.com/Fedya3012/my-hub`
3. Các tuỳ chọn khác để mặc định. Nếu muốn chắc chắn Obtainium chỉ lấy APK, điền ô **Filter APKs by regular expression**: `MyHub-.*\.apk$`
4. Bấm **Add**. Obtainium đọc trang Releases và hiện phiên bản mới nhất.
5. Bấm **Install**. Lần đầu Android hỏi quyền cài app cho Obtainium: cho phép.
6. Mở **My Hub** từ màn hình chính.

## Nhận bản mới

- Trong Obtainium, vào **Settings → Background update checking** và bật lên (ví dụ kiểm tra mỗi 6 giờ). Bật luôn thông báo để biết khi có bản mới.
- Khi có bản mới, Obtainium gửi thông báo. Mở Obtainium, bấm **Update** cạnh My Hub. Dữ liệu trong My Hub giữ nguyên.
- Muốn kiểm tra ngay: trong Obtainium kéo danh sách xuống để làm mới.
- Trong My Hub, **Quản lý ứng dụng → Kiểm tra cập nhật** cũng báo có bản mới. Trên Android, bấm **Cập nhật** chỉ nhắc bạn mở Obtainium, vì APK không tự thay được chính nó.

## Khi gặp lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| **App not installed** hoặc báo chữ ký không khớp | Máy đang có bản My Hub cài từ nguồn khác (ví dụ bản thử). Sao lưu dữ liệu trước (**Cài đặt → Sao lưu dữ liệu**, hoặc đồng bộ lên GitHub / Dropbox / OneDrive), gỡ bản cũ, rồi cài lại qua Obtainium. |
| Obtainium không thấy bản mới | Bản mới chỉ có sau khi GitHub build xong, khoảng 10 đến 15 phút sau khi phát hành. Đợi rồi làm mới lại. |
| Obtainium báo lỗi giới hạn GitHub (rate limit) | Đợi một giờ, hoặc thêm GitHub token trong **Obtainium → Settings**. |
