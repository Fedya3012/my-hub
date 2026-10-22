# Đồng bộ: tài khoản và thư mục

Trong **Cài đặt** có hai lựa chọn riêng biệt:

- **Tài khoản đồng bộ**: nơi thư viện, cài đặt và tiến độ nghe/đọc đi giữa các máy.
- **Thư mục đồng bộ**: nơi lấy nhạc và sách (thư mục trong máy, hoặc trên Dropbox / OneDrive).

Ví dụ: đồng bộ bằng GitHub nhưng lấy nhạc từ Dropbox, hoặc dùng Dropbox cho cả hai.

## 1. Tài khoản đồng bộ

| Chế độ | Đồng bộ gì | Tệp nhạc/sách |
|---|---|---|
| **Chỉ trên máy** | Không đồng bộ, không cần mạng | Ở lại máy này |
| **Tài khoản GitHub** | Thư viện + tiến độ, qua kho riêng tư `my-hub-data` | Ở lại từng máy (không tải lên) |
| **Dropbox** | Thư viện + tiến độ + tệp, trong thư mục riêng của app | Tự tải lên, máy khác tải về khi mở |
| **OneDrive** | Như Dropbox, trong `Apps/…` | Như Dropbox |

Cách bật: **Cài đặt → Tài khoản đồng bộ**, chọn một ô.

- **GitHub**: vào trang **Tài khoản → Đăng nhập bằng GitHub**, tạo token (giữ ô `repo`), dán chuỗi `ghp_…` vào app. Làm y hệt trên máy khác với cùng tài khoản.
- **Dropbox**: hộp **Kết nối Dropbox** mở ra. Điền **App key** (nếu app chưa có sẵn), cấp quyền trên trang Dropbox, rồi dán mã vào ô **Mã Dropbox**.
- **OneDrive**: hộp **Kết nối OneDrive** mở ra. Điền **Client ID** (nếu chưa có), cấp quyền; trình duyệt chuyển tới một trang trắng, chép cả địa chỉ trang đó dán vào ô **Địa chỉ trang trắng (hoặc mã)**.
- Nếu máy và tài khoản đều đã có dữ liệu, app hỏi **Gộp** (nên chọn), **Dùng dữ liệu của …** hoặc **Để sau**.

Trong bảng bên dưới có **Đồng bộ ngay**, **Đổi tài khoản**, **Ngừng dùng … (về Local)** và **Xoá dữ liệu trên …**. App tự đồng bộ khi mở, khi có mạng lại, vài giây sau mỗi thay đổi và mỗi 2 phút. Tiến độ nghe/đọc đồng bộ vài giây sau mỗi lần dừng, nên mở máy khác là nghe/đọc tiếp đúng chỗ.

## 2. Thư mục đồng bộ (nhạc và sách)

1. **Cài đặt → Thư mục đồng bộ**, chọn nơi lấy: **Trong máy**, **Dropbox** hoặc **OneDrive** (chọn ổ chưa kết nối thì app mở hộp đăng nhập, không đổi tài khoản đồng bộ).
2. Bấm **Chọn thư mục, đồng bộ, tạm dừng, huỷ**.
3. Tích một hoặc nhiều thư mục. Có thể chọn app nhận tệp của từng thư mục (**Trình phát nhạc**, **Sách**).
4. Bấm **Đồng bộ ngay**. Thẻ tiến trình hiện đang quét/nhập bao nhiêu tệp. Lần sau chỉ nhập tệp mới.

Tệp được xử lý thế nào:

- **Dropbox / OneDrive**: không sao chép vào app. Nhạc phát thẳng từ ổ; sách được tải về khi mở.
- **Trong máy, trên Windows**: đọc thẳng từ ổ cứng, không sao chép.
- **Trong máy, trên Android**: mỗi tệp mới được sao chép vào app một lần.

## 3. Tạm dừng, huỷ, dọn

- **Tạm dừng**: dừng lượt đang chạy, giữ nguyên những gì đã nhập. App không tự đồng bộ thư mục nữa cho tới khi bạn bấm **Đồng bộ ngay** (tiếp tục từ chỗ đã dừng).
- **Huỷ đồng bộ**: dừng và **xoá khỏi thư viện** mọi bài nhạc, sách đã nhập từ các thư mục đã chọn, đặt lại tiến trình từ đầu. Tệp gốc trên ổ hoặc trong máy không bị đụng tới, danh sách thư mục vẫn giữ.
- **Dọn mục đã mất tệp**: xoá khỏi thư viện những mục mà tệp gốc đã bị xoá.
- Mọi tác vụ dài (đồng bộ, tải lên, tải về) cũng hiện ở **khay tác vụ**, có nút huỷ từng tác vụ.

## Mẹo

- Token và mật khẩu kết nối chỉ nằm trên từng máy, không vào bản sao lưu JSON: máy mới phải đăng nhập lại.
- Dùng GitHub mà muốn có nhạc trên điện thoại: chọn Thư mục đồng bộ là Dropbox hoặc OneDrive, hoặc thêm tệp trực tiếp trên điện thoại.
- Bấm **Yêu cầu lưu trữ bền vững** trong Cài đặt để trình duyệt không tự xoá dữ liệu khi máy đầy.
