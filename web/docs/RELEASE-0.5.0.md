# My Hub 0.5.0: tóm tắt thay đổi

## Đã làm
| Mục | Kết quả |
|---|---|
| Tài khoản Google | Bỏ Supabase. Đăng nhập Google, đồng bộ qua Google Drive của bạn; gộp/thay dữ liệu lần đầu; danh sách thiết bị; đăng xuất máy này hoặc mọi máy; xoá dữ liệu trên Drive. Hướng dẫn: docs/ACCOUNT.md |
| Hi-Res | Chế độ bit-perfect bỏ mọi xử lý, mở âm thanh đúng tần số mẫu của bài; bảng "đường đi tín hiệu" ghi rõ chỗ nào không còn nguyên bản |
| EQ 31 dải | 20 Hz–20 kHz, ±12 dB, preset, hồ sơ theo thiết bị ra, tự chống vỡ tiếng |
| 2 tai nghe | Phát ra 2 thiết bị cùng lúc, chỉnh âm lượng và độ trễ riêng; tách kênh trái/phải |
| Hẹn giờ & âm nền | Hẹn giờ ngủ (nhỏ dần, chậm dần), tập luyện, Pomodoro; mưa, tiếng ồn trắng/hồng/nâu, biển, lửa, gió, chim |
| Sửa thẻ | Sửa 1 hoặc nhiều bài, công cụ dọn thẻ (sửa lỗi font tiếng Việt, tách feat., điền từ tên tệp), ghi thẳng vào tệp MP3/FLAC |
| Ảnh bìa | Mọi bài, album, nghệ sĩ, danh sách, thể loại, năm, hãng, nhạc sĩ, thư mục đều có ảnh; "Đổi ảnh…" ở mọi nơi |
| Duyệt theo thư mục | Tuỳ chọn trong Cài đặt; phát thẳng từ thư mục máy, thẻ SD, USB, không quét |
| Lời bài hát | TTML, song ca, bè, bản dịch, SRT; cuộn mượt, toàn màn hình, lời trên mini player; trình sửa có dạng sóng, kéo mốc thời gian, hoàn tác; tìm lời trên LRCLIB (tắt sẵn) |
| Thống kê | Tab "Thống kê": thời gian nghe, top bài/nghệ sĩ/album, chuỗi ngày, bản đồ giờ nghe, bài hay bị bỏ qua |
| Skin | 5 skin: Kệ sách, Aurora Glass, Kẹo dẻo, Neon Noir, Tạp chí; mỗi module chọn skin riêng; xuất/nhập skin |
| Hiệu ứng & font | Chuyển trang, hiện danh sách lần lượt, bìa phóng thành màn Đang phát; font hỗ trợ tiếng Việt |
| Visualizer | Chất lỏng, hạt neon, cầu 3D, cột 3D, dải sóng, cột; phản ứng khi chạm/kéo |
| Video nền | Hiện ở Nền / Lời / Cả hai; màu chữ, nút, sóng tự lấy theo video; video được chép vào app kèm bài nên vẫn chạy khi xoá tệp gốc |
| Hiệu năng | Thư viện 2.000 bài: cuộn 35 → 60 fps; tab Nghệ sĩ 1,2 s → 0,17 s; 10.000 bài vẫn mượt |
| Thông số dùng chung | Mọi module (hiện tại và sau này) đọc/ghi chung giao diện, âm thanh, lưu trữ, tài khoản; tự hiện trong Cài đặt, đồng bộ và sao lưu |
| Không giới hạn | Bỏ mọi giới hạn số bài/album/nghệ sĩ và dung lượng do app đặt; hiện dung lượng thật của trình duyệt và Drive |
| Kéo-thả | Thả tệp/thư mục để thêm nhạc; kéo bài vào danh sách/hàng chờ; sắp xếp lại; thả ảnh lên bìa; thả video hoặc lời lên Đang phát |
| Vòng tròn tác vụ | Thu khay tác vụ thành vòng tròn % nhỏ, kéo tới mép màn hình |

## Giới hạn của trình duyệt (app không vượt được)
- Không có chế độ độc quyền hay xuất thẳng USB DAC; trình duyệt vẫn đổi về tần số của thiết bị.
- 2 tai nghe cùng lúc chỉ có trên Chrome máy tính; Android/iOS chỉ chọn được 1 thiết bị ra.
- Video không nhúng được vào bên trong tệp nhạc; nó nằm trong kho của app, đi theo bài và đồng bộ cùng.
- Hạn mức dung lượng của trình duyệt và Google Drive do họ quyết định.
- Kéo-thả trên điện thoại: dùng nút ⠿ và menu ⋯.

## Chưa thử với thật
Đăng nhập Google thật, 2 tai nghe/DAC thật, iPhone, tra lời LRCLIB thật, chọn thư mục SD/USB lâu dài.
Các skin theo mẫu Pinterest/Dribbble được dựng theo mô tả vì không mở được các trang đó từ đây.
