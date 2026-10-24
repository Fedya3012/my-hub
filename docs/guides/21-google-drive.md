# Google Drive: kết nối và dùng nhạc, sách

Google Drive dùng được theo hai cách, độc lập với nhau:

- **Thư mục đồng bộ** (Cài đặt → Thư mục đồng bộ): chọn thư mục nhạc, sách trên Drive. Nhạc phát thẳng từ Drive, sách mở khi cần, không sao chép cả thư mục vào máy. App chỉ có quyền **đọc** Drive, không sửa hay xoá gì.
- **Tài khoản đồng bộ** (tuỳ chọn): lưu thư viện và tiến độ vào một thư mục ẩn của app trên Drive. Bạn đang dùng Tài khoản My Hub thì không cần bật cách này.

Phần 1 chỉ làm **một lần** trên máy tính, khoảng 10 phút. Phần 2 làm trên mỗi máy dùng My Hub.

---

## Phần 1. Tạo "chìa khoá" Google (OAuth client) cho My Hub

My Hub không qua máy chủ trung gian nào. Bạn tự tạo một client miễn phí trong Google Cloud, và chỉ tài khoản của bạn dùng được client đó.

### Bước 1. Tạo project

1. Mở https://console.cloud.google.com và đăng nhập bằng tài khoản Google chứa nhạc và sách.
2. Lần đầu vào, Google hỏi quốc gia và điều khoản: chọn Việt Nam, tích đồng ý, bấm **Agree and continue**.
3. Bấm ô chọn project ở thanh trên cùng (cạnh logo Google Cloud) → **New project**.
4. Project name: `My Hub` → **Create**. Đợi vài giây rồi chọn project vừa tạo ở ô đó.

### Bước 2. Bật Google Drive API

1. Menu ☰ → **APIs & Services** → **Library**.
2. Tìm `Google Drive API` → bấm vào → **Enable**.

### Bước 3. Màn hình xin quyền (OAuth consent screen)

1. Menu ☰ → **APIs & Services** → **OAuth consent screen** (giao diện mới gọi là **Google Auth Platform**). Bấm **Get started** nếu có.
2. **App information**: App name `My Hub`, User support email chọn email của bạn → **Next**.
3. **Audience**: chọn **External** → **Next**.
4. **Contact information**: nhập email của bạn → **Next**.
5. Tích đồng ý chính sách → **Continue** → **Create**.
6. Vào mục **Audience** (hoặc **Test users** ở giao diện cũ) → **Add users** → nhập **chính email Google của bạn** → **Save**.
   - Bắt buộc. App đang ở chế độ *Testing*, Google chỉ cho các email trong danh sách này đăng nhập.
7. Không cần bấm *Publish app*.

### Bước 4. Khai báo quyền (Data access / Scopes)

Không bắt buộc (app tự xin quyền khi đăng nhập), nhưng khai báo cho rõ thì làm như sau:

1. Mục **Data access** → **Add or remove scopes**.
2. Tích `.../auth/drive.readonly` (xem tệp Drive, chỉ đọc) và `.../auth/drive.appdata` (thư mục ẩn của app) → **Update** → **Save**.

### Bước 5. Tạo OAuth client loại "Desktop app"

1. Mục **Clients** (giao diện cũ: **APIs & Services → Credentials → Create credentials → OAuth client ID**) → **Create client**.
2. Application type: **Desktop app**. Name: `My Hub` → **Create**.
3. Google hiện **Client ID** (đuôi `.apps.googleusercontent.com`) và **Client secret** (bắt đầu `GOCSPX-`).
   - Bấm **Download JSON** hoặc chép cả hai vào chỗ an toàn.
   - Giao diện mới chỉ hiện secret **một lần**. Lỡ mất thì vào client đó → **Add secret** để tạo cái mới.
4. Không cần khai báo redirect URI: client loại Desktop app tự chấp nhận `http://127.0.0.1`.

> Client secret của Desktop app không phải mật khẩu tài khoản. Google coi nó là thông tin không bí mật tuyệt đối. Dù vậy, đừng đăng công khai.

---

## Phần 2. Kết nối trong My Hub (làm trên mỗi máy)

Cách làm giống nhau trên Android, Windows và trình duyệt.

### Bước 1. Bật Google Drive làm nơi lấy thư mục

1. My Hub → **Cài đặt** → **Thư mục đồng bộ**.
2. Tích ô **Google Drive**. Có thể giữ cả **Trong máy**, ví dụ nhạc trong máy còn sách trên Drive.
3. Hộp **Kết nối Google Drive** hiện ra.

### Bước 2. Đăng nhập Google

1. Dán **Client ID** và **Client secret** từ Phần 1.
2. Bấm **Mở Google để cấp quyền**. Trình duyệt mở trang đăng nhập Google.
3. Chọn đúng tài khoản đã thêm vào danh sách người dùng thử.
4. Google cảnh báo **"Google hasn't verified this app"**: bấm **Advanced** (Nâng cao) → **Go to My Hub (unsafe)**. Đây là app của chính bạn nên an toàn.
5. Tích **cả hai** quyền (xem tệp Google Drive, và dữ liệu cấu hình của app) → **Continue**.
6. Trình duyệt chuyển tới một trang **không mở được**, địa chỉ dạng `http://127.0.0.1/?code=4/0Ab...&scope=...`. **Đây là bình thường.**
7. Chạm vào thanh địa chỉ và **sao chép toàn bộ địa chỉ** đó.
   - Android (Chrome): chạm thanh địa chỉ → biểu tượng sao chép, hoặc giữ ngón tay → Chọn tất cả → Sao chép.
8. Quay lại My Hub, dán vào ô **Địa chỉ trang không mở được** → **Kết nối**.
   - Mã chỉ dùng được một lần và hết hạn sau vài phút. Báo lỗi mã sai thì bấm lại **Mở Google để cấp quyền** và làm lại từ bước 3.

### Bước 3. Chọn thư mục

1. Vẫn ở **Thư mục đồng bộ**, bấm **Chọn thư mục, đồng bộ, tạm dừng, huỷ**.
2. Ở khu Google Drive, mở cây thư mục và tích các thư mục cần dùng.
3. Mỗi thư mục chọn **Trình phát nhạc**, **Sách** hoặc cả hai. Ví dụ thư mục `Sách` trên Drive chỉ tích Sách.
4. Bấm **Đồng bộ ngay**. App quét thư mục rồi thêm bài nhạc, sách vào thư viện; tiến độ hiện trong khay tác vụ.
   - Để đọc tên bài và nghệ sĩ, app tải tạm từng tệp **một lần** trong lúc quét rồi bỏ đi, không lưu lại trên máy.
5. Từ giờ, mỗi lần đồng bộ app chỉ thêm tệp mới. Tệp đã xoá trên Drive cũng bị gỡ khỏi thư viện (tắt được trong trang chọn thư mục).

### (Tuỳ chọn) Dùng Google Drive làm tài khoản đồng bộ

Cài đặt → **Tài khoản đồng bộ** → chọn **Google Drive**. Thư viện và tiến độ nằm trong thư mục ẩn của app trên Drive, bạn không thấy và không xoá nhầm được. Bạn đang dùng Tài khoản My Hub thì không cần làm.

---

## Câu hỏi thường gặp

**Bài hát có bị chép về máy không?**
Không. Khi phát, app lấy thẳng từ Drive theo từng đoạn, như xem video trực tuyến. Lúc quét thư mục để đọc thông tin bài, app chỉ tải tạm từng bài rồi bỏ.

**Lỗi "Access blocked: My Hub has not completed the Google verification process"**
Email chưa có trong danh sách người dùng thử. Làm lại Phần 1, Bước 3, mục 6.

**Lỗi "Google không trả về quyền dùng lâu dài"**
Vào https://myaccount.google.com/permissions → My Hub → **Xoá quyền truy cập**, rồi kết nối lại.

**Một tuần sau app bắt đăng nhập lại**
Client đang ở chế độ *Testing* nên Google cho quyền hết hạn sau 7 ngày. Để không phải đăng nhập lại: Google Cloud → **Audience** → **Publish app** → xác nhận. Quyền `drive.readonly` là quyền nhạy cảm nên Google vẫn cảnh báo "chưa xác minh", nhưng bạn vẫn dùng được như ở Phần 2, Bước 2 mục 4. Riêng tài khoản của bạn thì không cần xin Google xét duyệt.

**Nhạc không phát mà chỉ tải về**
Lần đầu mở app sau khi cập nhật, phần nền của app (service worker) có thể chưa chạy. Tắt hẳn app rồi mở lại.

**Gỡ kết nối**
Cài đặt → Thư mục đồng bộ → bỏ tích Google Drive. Muốn thu hồi hẳn quyền thì vào https://myaccount.google.com/permissions.
