# Windows: cài đặt và cập nhật

## Chọn tệp nào

Mỗi bản phát hành có hai tệp Windows trên https://github.com/Fedya3012/my-hub/releases/latest

| Tệp | Dùng khi | Cập nhật |
|---|---|---|
| `MyHub-x.y.z.w-x64-Setup.exe` | Dùng hằng ngày (**nên chọn**) | Tự tải bản mới ở nền, hỏi **Khởi động lại ngay** hoặc **Để sau** |
| `MyHub-x.y.z.w-portable.exe` | Chạy không cần cài, ví dụ từ USB | Không tự cập nhật: chỉ báo **Có phiên bản mới**, bấm **Mở trang tải** để tải tay |

## Cài bản Setup

1. Mở trang Releases ở trên, mục **Assets**, tải `MyHub-…-x64-Setup.exe`.
2. Chạy tệp vừa tải.
3. Windows SmartScreen có thể báo **"Windows protected your PC"** vì app chưa mua chứng chỉ ký số. Bấm **More info**, rồi **Run anyway**.
4. App tự cài và mở ra. Lối tắt **My Hub** có ở Start menu và màn hình nền.

## Cập nhật

- Mỗi lần mở, bản Setup tự hỏi GitHub có bản mới không, rồi tải ở nền.
- Tải xong, hộp thoại **Đã tải xong phiên bản …** hiện ra:
  - **Khởi động lại ngay**: app đóng, cài bản mới, mở lại.
  - **Để sau**: bản mới được cài khi bạn đóng app.
- Muốn kiểm tra ngay: **Quản lý ứng dụng → Kiểm tra cập nhật**, rồi **Cập nhật**.
- Nếu hiện **Không tự cập nhật được**: bấm **Mở trang tải**, tải bản Setup mới và chạy đè lên. Dữ liệu giữ nguyên.

## Bản portable

- Chạy thẳng tệp `.exe`, không cần cài. Dữ liệu vẫn lưu trong máy, giống bản Setup.
- Có bản mới thì app hiện **Có phiên bản mới**. Bấm **Mở trang tải**, tải bản portable mới và dùng tệp đó thay tệp cũ.

## Vì sao nên dùng app Windows thay vì trình duyệt

- Đủ codec nhạc: AAC, FLAC, Opus, ALAC…
- Đọc thẳng thư mục nhạc và sách trên ổ cứng, không sao chép (xem [Đồng bộ](20-dong-bo.md)).
- Tự cập nhật, chạy được khi không có mạng.
