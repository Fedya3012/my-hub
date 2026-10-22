# Nhật ký phiên bản My Hub

Mỗi phiên bản ghi theo từng ứng dụng. Số phiên bản là phiên bản lõi (`APP_VERSION` trong `web/js/config.js`); số trong ngoặc là phiên bản riêng của ứng dụng khi nó thay đổi.
Nhóm: **Trình phát nhạc**, **Sách**, **Thư viện**, **Quản lý ứng dụng**, **Cài đặt**, **Tài khoản**, **Tối ưu hiệu năng**, **Lõi** (đồng bộ, giao diện chung, bản Windows và Android).

---

## Chưa phát hành (trên `main`, sau 0.9.9.0)

### Cài đặt
- Trang "Thư mục đồng bộ" theo màu của giao diện đang chọn (trước đây cố định nền trắng).
- Chỉ còn một cách kết nối Dropbox / OneDrive (bỏ hàng nút kết nối trùng lặp).
- Dùng tên chính thức "Trình phát nhạc" trong các hướng dẫn; mô tả ứng dụng Cài đặt cập nhật đủ Local, GitHub, Dropbox, OneDrive.
- Lời nhắc đồng bộ tiến độ và hộp "Xoá toàn bộ dữ liệu" nhắc tới cả Dropbox và OneDrive, không chỉ GitHub.

---

## 0.9.9.0 — 22/10/2026
### Trình phát nhạc (0.6.1)
- Sửa giật lag ở trang chủ nhạc.
- Nhấn giữ trên trang chủ để mở menu nhanh.
### Sách (0.1.1)
- Nhấn giữ trên trang chủ Sách để mở menu nhanh.
### Lõi
- Cỡ chữ và khoảng cách dòng trên điện thoại đồng đều giữa các ứng dụng.

## 0.9.8.0 — 21/10/2026
### Trình phát nhạc (0.6.0)
- Mỗi chế độ lặp / trộn bài có biểu tượng riêng, hiện ngay trên nút.
- Menu xếp chồng gọn hơn.
- Vuốt để chuyển tab và quay lại.
- Phím tắt bàn phím.

## 0.9.7.2 — 21/10/2026
### Lõi
- Sửa `version.json` lệch phiên bản ở 0.9.7.1.

## 0.9.7.1 — 21/10/2026
### Trình phát nhạc (0.5.1)
- Phát / lặp toàn bộ một danh mục (album, nghệ sĩ, danh sách phát), thứ tự danh mục ngẫu nhiên.
- Menu dùng dấu tích thật cho chế độ đang chọn.
### Tối ưu hiệu năng
- Trang chủ nhạc: tính thống kê thư viện một lần cho mỗi lần tải, tải song song, hoãn dải bìa (cover flow).

## 0.9.7.0 — 21/10/2026
### Trình phát nhạc (0.5.0)
- Nhấn giữ / chuột phải trên các nút ở màn Đang phát (trộn, lặp…) để mở menu; thêm chế độ "phát một bài rồi dừng".
- "Chọn nhiều…" trong menu bài hát.
- Bỏ tính năng "thiết bị đang nghe".
### Lõi
- Chọn nhiều: nhấn giữ để chọn bài hát và sách, thao tác hàng loạt.

## 0.9.6.7 — 21/10/2026
### Trình phát nhạc (0.4.1)
- Hết tiếng "tách" khi tạm dừng.
### Cài đặt
- "Dọn dữ liệu" xoá các tệp đã nhập từ một "Thư mục đồng bộ" đã gỡ; gỡ thư mục rồi thêm lại sẽ nhập sạch.

## 0.9.6.6 — 21/10/2026
### Trình phát nhạc
- Trang chi tiết ẩn đầu trang thư viện cả trên màn hình rộng (tiêu đề không bị che).
### Cài đặt
- Dọn dữ liệu: xin lại quyền thư mục khi trình duyệt quên, báo các tệp không kiểm tra được.

## 0.9.6.5 — 21/10/2026
### Lõi
- Ảnh bìa album và ảnh thu nhỏ chỉ lưu trên từng máy: không tải lên ổ đám mây, xoá các tệp bìa do app tạo trên ổ, dựng lại bìa thiếu từ thẻ bài hát.

## 0.9.6.4 — 21/10/2026
### Trình phát nhạc
- Trang danh sách phát, nghệ sĩ, nhóm gọn nhẹ trên điện thoại, nút yêu thích tất cả.
- Cuộn trên điện thoại không còn kéo giãn, chừa chỗ trên các thanh dưới.
### Cài đặt
- Tuỳ chọn tự ẩn thanh tab dưới khi cuộn, chọn theo từng ứng dụng (Trình phát nhạc, Sách).
- Chế độ Local có trang "Thư mục đồng bộ" với thư mục trên máy (máy tính và Android).
- Sửa liên kết tới trang Thư mục đồng bộ (trước đây mở nhầm Thư viện).
### Lõi
- Android: plugin chọn thư mục gốc, giữ quyền truy cập, liệt kê tệp nhạc / sách không sao chép.
- Dùng tên chính thức "Trình phát nhạc" ở các nhãn.

## 0.9.6.3 — 21/10/2026
### Trình phát nhạc
- Hàng tiêu đề không tràn trên điện thoại, khoá thu phóng màn hình.
### Cài đặt
- Dọn dữ liệu xoá mục của các thư mục đã xoá trên ổ (cả thư mục đã bỏ chọn); OneDrive báo 404 được coi là đã mất.

## 0.9.6.2 — 21/10/2026
### Trình phát nhạc
- Thiết kế lại trang album trên điện thoại (hết dải trống), ghim thanh dưới, không kéo giãn khi cuộn quá.

## 0.9.6.1 — 21/10/2026
### Trình phát nhạc
- Trang thể loại, năm, hãng, nhạc sĩ, nghệ sĩ album ẩn đầu trang thư viện như trang album.
### Lõi
- Sửa lỗi trang không cuộn được trên điện thoại.

## 0.9.6.0 — 21/10/2026
### Trình phát nhạc
- Menu theo mục, thanh dưới có Mới / Thống kê / Cài đặt.
### Sách
- Trang chủ và mục tiêu đọc làm mới (lời chào, sách đang đọc, thanh mục tiêu, chấm theo tuần, ô số liệu).
### Thư viện
- Nút "Dọn dữ liệu" ngay trong Trình phát nhạc, Sách và Thư viện.

## 0.9.5.9 — 21/10/2026
### Cài đặt
- "Thư mục đồng bộ" thành trang riêng: thẻ trạng thái có nút đồng bộ, cây thư mục có mũi tên mở rộng, chọn tất cả, biểu tượng loại tệp, dung lượng và số tệp mỗi thư mục, thẻ tiến độ trực tiếp.
- "Dọn dữ liệu" theo từng ứng dụng, xoá mục mất tệp.
### Lõi
- Ẩn mọi thanh cuộn.

## 0.9.5.8 — 21/10/2026
### Cài đặt
- Tự gỡ mục thư viện khi tệp trên ổ đã bị xoá (tuỳ chọn, mặc định bật).
- Chọn thư mục đồng bộ dạng thẻ; bỏ qua thư mục không còn trên ổ (sửa lỗi Dropbox 409).

## 0.9.5.7 — 21/10/2026
### Trình phát nhạc
- Thanh tab dưới (điện thoại: thanh; Windows: viên nổi trên thanh điều khiển), thanh tiến độ trên dock, bớt thanh cuộn.
### Cài đặt
- Chọn cho từng thư mục đồng bộ: tệp vào Trình phát nhạc, Sách hay cả hai.
### Lõi
- Việc đã xong rời khay ngay.
- Android: ẩn thanh điều hướng hệ thống khi dùng app.

## 0.9.5.6 — 21/10/2026
### Sách
- Dock nhạc nằm trên thanh dưới của Sách; nhấn giữ một cuốn để mở thao tác nhanh.

## 0.9.5.5 — 21/10/2026
### Sách
- Dock nhạc nằm trên trình đọc sách; menu thêm sách trong thư viện.

## 0.9.5.4 — 21/10/2026
### Sách
- Thanh tab dưới trên điện thoại, lưới bìa sát hơn.

## 0.9.5.3 — 21/10/2026
### Sách
- Tab "Thịnh hành": sách đang hot theo ngày / tuần / tháng / năm từ Open Library; chạm để thêm vào "Muốn đọc".
### Cài đặt
- Tiến độ thư mục đồng bộ hiện phần trăm và số thư mục / tệp khi quét và nhập.

## 0.9.5.2 — 21/10/2026
### Cài đặt
- Sửa bố cục chọn thư mục; một lựa chọn duy nhất quyết định tài khoản đồng bộ.

## 0.9.5.1 — 21/10/2026
### Tài khoản
- Thẻ đăng nhập Dropbox và OneDrive cạnh GitHub.
### Lõi
- Chỉ giữ Dropbox và OneDrive (bỏ pCloud / WebDAV); nhạc trong thư mục đã chọn phát thẳng từ ổ, không sao chép.

## 0.9.5.0 — 21/10/2026
### Cài đặt
- Chọn thư mục đồng bộ trên WebDAV / pCloud; tệp ở lại trên ổ, không tải lên lại.
### Lõi
- Android: quyền camera (quét mã vạch sách).

## 0.9.4.3 — 21/10/2026
### Lõi
- Android: sửa lỗi kết nối pCloud / WebDAV.

## 0.9.4.2 — 21/10/2026
### Lõi
- Lỗi kết nối ổ đám mây kèm lý do cụ thể.

## 0.9.4.1 — 21/10/2026
### Lõi
- Giải mã base64 lệch chuẩn, báo lỗi có vị trí.

## 0.9.4.0 — 21/10/2026
### Lõi
- Thay Filen bằng pCloud (WebDAV).

## 0.9.3.0 — 21/10/2026
### Lõi
- Bỏ FileJump, thêm OneDrive và Filen.

## 0.9.2.0 — 21/10/2026
### Tài khoản / Cài đặt
- Nút kết nối Dropbox / WebDAV / FileJump.

## 0.9.1.0 — 21/10/2026
### Lõi
- Đồng bộ qua Dropbox (đăng nhập PKCE, tải lên từng phần 8 MB), WebDAV và FileJump: thư viện, tiến độ và tệp nhạc / sách.
- Sửa service worker không cài được bản mới (danh sách tệp còn tên `gdrive.js` đã xoá).

## 0.9.0.0 — 21/10/2026
### Sách (0.1.0, ứng dụng mới)
- Thư viện, trình đọc (EPUB, MOBI, AZW3, FB2, CBZ, PDF, TXT/MD/HTML), đánh dấu, ghi chú, từ điển, dịch, đọc to, tiến độ đa thiết bị.
- Theo dõi đọc, kệ sách, metadata Open Library / Google Books, nhập / xuất Goodreads, StoryGraph, CSV, JSON.
- Thống kê, mục tiêu, thử thách, huy hiệu.

## 0.8.0.2 — 20/10/2026
### Quản lý ứng dụng
- Windows: cập nhật lõi đọc phiên bản mới từ GitHub và cài qua trình cập nhật.

## 0.8.0.1 — 20/10/2026
### Quản lý ứng dụng
- Windows: hiện lỗi tự cập nhật thật.

## 0.8.0.0 — 20/10/2026
### Lõi
- Bỏ đăng nhập Google và đồng bộ Google Drive, chỉ giữ GitHub. Chế độ cũ tự chuyển sang GitHub hoặc Local.

## 0.7.1.1 — 20/10/2026
### Lõi
- Ẩn Google Picker trên Android, cây thư mục cấp cao tải theo khối.

## 0.7.1.0 — 20/10/2026
### Trình phát nhạc
- Nhập nhạc chọn từ Google Drive; sửa trang chi tiết bị đầu trang che trên điện thoại.

## 0.7.0.9 / 0.7.0.8 — 20/10/2026
### Cài đặt
- Luôn hiện cài đặt thư mục Drive, có nút chọn thư mục cả trên Android.

## 0.7.0.7 — 20/10/2026
### Cài đặt
- Chọn thư mục Drive có sẵn bằng Google Picker.

## 0.7.0.6 — 20/10/2026
### Cài đặt
- Chọn tên thư mục Drive dùng để đồng bộ.

## 0.7.0.5 — 20/10/2026
### Trình phát nhạc
- Gỡ một thư mục nhạc khỏi thư viện.
### Cài đặt
- Ngắt Drive / GitHub hoặc xoá dữ liệu trên đám mây.

## 0.7.0.4 — 20/10/2026
### Trình phát nhạc
- Sửa trạng thái nút trộn bài ở Đang phát và nút phát trên dải bìa trang chủ.

## 0.7.0.3 — 20/10/2026
### Lõi
- Đăng nhập Google qua trình duyệt hệ thống (Android, Windows).

## 0.7.0.2 — 20/10/2026
### Trình phát nhạc
- Mờ dần khi dừng / phát để bớt tiếng tách.
### Tối ưu hiệu năng
- Sắp xếp nhanh hơn, cây thư mục tải dần, danh sách chỉ vẽ phần đang thấy.

## 0.7.0.1 — 20/10/2026
### Lõi
- Số phiên bản 4 phần (x.y.z.w); sửa bản dựng Windows.

## 0.7.0 — 20/10/2026
### Tài khoản
- Đăng nhập GitHub (token) để đồng bộ thư viện và tiến độ qua repo riêng.

## 0.6.1 — 20/10/2026
### Trình phát nhạc
- Android: nhập thư mục nhạc bằng trình chọn thư mục gốc của máy.

## 0.6.0 — 20/10/2026
### Trình phát nhạc
- Màn Đang phát rõ hơn, các kiểu hiển thị lời bài hát.
### Lõi
- Giao diện tiếng Anh; Android có ngăn kéo điều hướng bên trái.

## 0.5.3 — 20/10/2026
### Quản lý ứng dụng
- Tự cập nhật trong app từ GitHub Releases.
### Lõi
- Sửa bố cục chồng lấn trên Windows.

## 0.5.2 — 20/10/2026
### Lõi
- Giao diện giống ứng dụng hơn, bỏ toàn bộ dữ liệu mẫu.

## 0.5.1 — 20/10/2026
### Lõi
- Bản Windows (Electron) và Android (Capacitor) đầu tiên, quy trình phát hành tự động trên GitHub.
- Ứng dụng có sẵn: Quản lý ứng dụng (0.1.0), Thư viện (0.3.0), Trình phát nhạc (0.4.0), Cài đặt (0.2.0), Tài khoản (0.1.0).
