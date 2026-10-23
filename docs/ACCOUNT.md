# Thiết kế: tài khoản tự tạo (email + mật khẩu) với Supabase

Trạng thái: đã duyệt (2026-10-23). Đã tạo bảng `hub_data` và hàm `delete_my_account` trên Supabase. Mã 6 số qua email tạm hoãn (xác nhận bằng link trước); chưa viết code app.

## Quyết định đã chốt
- Đăng ký và đăng nhập bằng email + mật khẩu, dùng Supabase Auth.
- **Bật xác nhận email.** Đăng ký xong phải bấm link trong email mới đăng nhập được.
- **Không** đưa tệp nhạc và sách lên Supabase. Các tệp ở lại máy hoặc trên Dropbox/OneDrive như hiện nay.
- Project: `lxyrelwykdkbrpnbvfcn` (gói miễn phí). Anon key là khoá công khai, dùng được trong app. **Khoá service_role không bao giờ đưa vào app.**

## 1. Đăng ký, xác nhận, đăng nhập

Luồng:
1. Người dùng nhập email và mật khẩu (tối thiểu 10 ký tự), bấm Tạo tài khoản.
2. App gọi `auth.signUp`. Supabase băm mật khẩu và gửi email xác nhận.
3. Màn hình hiện "Hãy mở email và bấm Xác nhận".
4. Người dùng bấm link trong email. Link mở trang của app kèm phiên đã xác nhận; app nhận phiên và vào thẳng thư viện.
5. Những lần sau: đăng nhập bằng email và mật khẩu (`auth.signInWithPassword`). Supabase giới hạn số lần thử sai.

Cấu hình trong Supabase (Authentication → Sign In / Providers → Email):
- Bật Email provider, **bật "Confirm email"**.
- Đặt "Site URL" là địa chỉ thật của app (cần Fedya xác nhận, ví dụ trang GitHub Pages hoặc domain) và thêm vào "Redirect URLs" các địa chỉ mà app dùng, gồm bản Windows (`http://localhost:<cổng>/`) nếu có.
- Mật khẩu tối thiểu 10 ký tự, bật kiểm tra mật khẩu bị lộ (leaked password protection) nếu gói cho phép.
- Email mặc định của Supabase có giới hạn số lượng gửi mỗi giờ. Đủ cho một người, nhưng nếu nhiều người đăng ký thì cần SMTP riêng (để sau).

Quên mật khẩu: `auth.resetPasswordForEmail` gửi link đặt lại. Làm ở bước sau.

Đăng xuất: `auth.signOut` xoá phiên trên máy này, không xoá dữ liệu trên Supabase. Trùng với nút "Đăng xuất khỏi máy này" đã có.

## 2. Bảo mật theo dòng (RLS)

Bảng dữ liệu của người dùng: **một bảng `hub_data`**, mỗi người dùng một dòng.

```sql
create table public.hub_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,   -- toàn bộ dữ liệu đồng bộ (cùng dạng với hub-db.json hiện nay)
  version bigint not null default 0,             -- tăng mỗi lần ghi, dùng để tránh ghi đè nhau
  updated_at timestamptz not null default now(),
  updated_by text                                 -- mã máy ghi lần cuối (để hiện "lần cuối từ máy …")
);

alter table public.hub_data enable row level security;

create policy "own row can read" on public.hub_data
  for select to authenticated using (auth.uid() = user_id);
create policy "own row can insert" on public.hub_data
  for insert to authenticated with check (auth.uid() = user_id);
create policy "own row can update" on public.hub_data
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Không có policy delete: người dùng không tự xoá được dòng; xoá tài khoản đi qua hàm riêng (mục 5).
```

Ý nghĩa: `auth.uid()` lấy từ token của người đăng nhập, người dùng không sửa được. Dù app có lỗi, một người không thể đọc hay ghi dòng của người khác. `anon` (chưa đăng nhập) không có quyền gì trên bảng.

Ghi chú: `snapshot` là JSON một cục nên đơn giản. Với thư viện lớn (hàng nghìn mục) sẽ nặng dần; khi đó chuyển sang nhiều bảng theo từng loại dữ liệu, mỗi bảng có `user_id` và cùng policy. Đây là bước sau, không cần cho bản đầu.

Kiểm tra: sau khi tạo bảng, chạy `get_advisors` (bảo mật) để xem có thiếu policy không, và thử đọc bảng bằng hai tài khoản khác nhau để chắc chắn mỗi người chỉ thấy dòng của mình.

## 3. Đồng bộ trong app

Tận dụng khung hiện có (`storage/index.js`, `drives`). Thêm một adapter `supabase` cùng giao diện với GitHub/Dropbox/OneDrive:

- `readSnapshot()`: đọc dòng của người dùng, trả về `{ id: version, data: snapshot }`. Không có dòng thì trả `null` (lần đầu).
- `writeSnapshot(rid, data)`: ghi với điều kiện `version = rid` (kiểu If-Match). Nếu không khớp (máy khác vừa ghi) thì báo xung đột và đồng bộ lại. Cách làm: `update hub_data set snapshot=…, version=version+1 where user_id=auth.uid() and version=$rid`; nếu không có dòng nào được sửa thì xung đột.
- Dữ liệu tiến độ nghe đọc (`progress`, `devices`) đi qua cùng dòng này, nhưng lấy cả khi `snapshot` đổi nhỏ. Nếu làm nhiều, tách thành cột riêng `live jsonb` để tránh xung đột với thư viện.
- `files` (tệp): **không đồng bộ**. Các hàng `files` có `linked` hoặc `locations.supabase` không được tạo, vì không có nơi lưu tệp. Đây là lựa chọn của Fedya.

Các điểm cần lưu ý:
- Gói miễn phí giới hạn 500 MB dữ liệu và 5 GB băng thông mỗi tháng. Một thư viện chỉ có thông tin (không có tệp) thường chỉ vài MB, nên đủ dùng.
- Dự án miễn phí tự tạm dừng sau một tuần không có hoạt động. Khi đó đồng bộ báo lỗi cho đến khi khởi động lại trong trang quản trị. Dữ liệu không mất.

## 4. Giao diện trong app

- **Trang Tài khoản**: thêm thẻ "Tài khoản My Hub" với nút Đăng ký / Đăng nhập. Khi đã đăng nhập: email, nút Đăng xuất khỏi máy này, nút Đổi mật khẩu, nút Xoá tài khoản.
- **Cài đặt → Tài khoản đồng bộ**: thêm ô "My Hub (email và mật khẩu)" cùng các ô GitHub/Dropbox/OneDrive. Bấm vào thì mở form đăng nhập; đã đăng nhập thì giống các ô khác.
- Thông báo lỗi bằng tiếng Việt: email sai định dạng, mật khẩu quá ngắn, email chưa xác nhận, nhập sai quá nhiều lần, không có mạng.
- Mật khẩu không bao giờ hiện trong log, không lưu trong localStorage. Phiên đăng nhập (token làm mới) lưu trong localStorage của trình duyệt, cùng cách với token GitHub hiện nay; Supabase tự làm mới token.

## 5. Xoá tài khoản

Người dùng không tự xoá được dòng (không có policy delete), nên làm bằng một hàm trên Supabase:

```sql
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();   -- cascade xoá hub_data
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
```

Trong app: hai lần xác nhận, ghi rõ "Dữ liệu trên Supabase sẽ bị xoá vĩnh viễn; dữ liệu trên máy và trên GitHub/Dropbox/OneDrive không bị xoá".

## 6. Những việc không làm ở bản đầu (để sau)
- Đăng nhập bằng Google hay Apple.
- Đặt lại mật khẩu qua SMS.
- Đồng bộ tệp nhạc và sách (đã chốt là không).
- Chia sẻ dữ liệu giữa các tài khoản.
- SMTP riêng cho email (chỉ cần khi có nhiều người đăng ký).

## 7. Kế hoạch triển khai
1. Fedya duyệt tài liệu này.
2. Tạo bảng `hub_data`, RLS, hàm xoá tài khoản. Chạy `get_advisors` và kiểm tra bằng hai tài khoản.
3. Bật Email provider và xác nhận email trong cấu hình Auth; đặt Site URL và Redirect URLs.
4. Viết adapter `supabase`, màn hình đăng ký/đăng nhập, trang tài khoản, xoá tài khoản. Kiểm tra trình duyệt với hai tài khoản.
5. Kiểm tra trên bản Windows và Android (cần build). Chỉ tăng phiên bản khi Fedya nói "cập nhật".

## Kiểm tra cần làm
- Đăng ký, nhận email, bấm xác nhận, đăng nhập được.
- Đăng nhập sai nhiều lần thì bị chặn tạm thời.
- Hai tài khoản không đọc được dữ liệu của nhau (thử bằng API với token của tài khoản kia).
- Hai máy cùng tài khoản: sửa ở máy A, máy B đồng bộ và thấy thay đổi; sửa đồng thời thì có xung đột và không mất dữ liệu.
- Xoá tài khoản: dòng `hub_data` và tài khoản đều mất, dữ liệu trên máy vẫn còn.
- Hết mạng giữa chừng: thay đổi được giữ và gửi lại khi có mạng.
