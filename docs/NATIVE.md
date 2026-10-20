# My Hub: app Windows + Android

## Stack

| Phần | Công cụ | Vì sao |
|---|---|---|
| Code app | `web/` (HTML/CSS/JS thuần, Dexie) | Giữ nguyên toàn bộ PWA: App Manager, Library, Music Player, Local + GitHub, theme, Import/Export. Một code cho cả 2 nền tảng. |
| Windows `.exe` | **Electron** (`electron/main.js`) | Chạy Chromium đầy đủ: đủ codec nhạc (AAC, FLAC, Opus…), chọn thư mục nhạc, tự cập nhật từ GitHub Releases. |
| Android `.apk` | **Capacitor** (`android/`) | Bọc `web/` thành APK thật, có sẵn plugin cho các tính năng native (phát nhạc nền). |
| Build + phát hành | **GitHub Actions** (`.github/workflows/build.yml`) | Mỗi lần push lên `main`: build `.exe` + `.apk`; nếu có phiên bản mới thì tạo GitHub Release. |

Cả hai lớp bọc chỉ là JavaScript, không có Rust/Kotlin để bảo trì. Claude chỉ cần sửa `web/` cho gần như mọi thay đổi.

## Phát hành một phiên bản

Phiên bản duy nhất nằm ở `APP_VERSION` trong `web/js/config.js`.

1. Claude sửa code, tăng `APP_VERSION` (4 số x.x.x.x, vd. `0.7.0.1` → `0.7.0.2`; số cuối cho bản nhỏ), thêm ghi chú vào `web/version.json` (`changelog`), push lên `main`.
2. GitHub Actions build và tạo Release `v0.5.2` gồm:
   - `MyHub-0.5.2.apk` (Android)
   - `MyHub-0.5.2-x64-Setup.exe` (Windows, cài đặt, tự cập nhật)
   - `MyHub-0.5.2-portable.exe` (Windows, chạy không cần cài)
3. Android: Obtainium thấy bản mới và cập nhật. Windows: bản cài đặt tự tải bản mới, cài khi mở lại app.

Push mà không đổi `APP_VERSION` thì chỉ build để kiểm tra (tải ở tab Actions → lần chạy → Artifacts), không tạo Release.

## Khoá ký Android (làm một lần)

Android chỉ cho cập nhật khi mọi bản APK được ký bằng **cùng một khoá**. Khoá nằm trong GitHub Secrets của repo:

Settings → Secrets and variables → Actions → New repository secret, tạo 4 secret:

| Tên | Giá trị |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | nội dung tệp `ANDROID_KEYSTORE_BASE64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | nội dung `ANDROID_KEYSTORE_PASSWORD.txt` |
| `ANDROID_KEY_ALIAS` | `myhub` |
| `ANDROID_KEY_PASSWORD` | nội dung `ANDROID_KEY_PASSWORD.txt` |

Giữ bản sao `myhub-release.jks` + mật khẩu ở nơi an toàn (vd. trình quản lý mật khẩu). Mất khoá thì phải gỡ app và cài lại từ đầu.
Không có secret: workflow vẫn build APK debug để thử, nhưng không tạo Release.

## Obtainium (Android)

1. Cài Obtainium: tải APK mới nhất ở https://github.com/ImranR98/Obtainium/releases (hoặc từ F-Droid / IzzyOnDroid).
2. Mở Obtainium → **Add App**.
3. **App Source URL**: `https://github.com/<tên-github>/<tên-repo>` (repo phải để Public; repo Private cần thêm GitHub token trong Obtainium → Settings).
4. Để mặc định các tuỳ chọn khác. Nếu Obtainium hỏi chọn tệp, chọn `MyHub-x.y.z.apk` (có thể điền **Filter APKs by regular expression**: `MyHub-.*\.apk$`).
5. Bấm **Add** → **Install**. Lần đầu Android hỏi quyền "Cài ứng dụng không rõ nguồn gốc" cho Obtainium: cho phép.
6. Từ đó Obtainium tự kiểm tra bản mới (Settings → Background update checking) và báo để cập nhật.

## Windows

Tải `MyHub-x.y.z-x64-Setup.exe` ở trang Releases rồi chạy. Windows SmartScreen có thể báo "Windows protected your PC" vì app chưa có chứng chỉ ký số: bấm **More info → Run anyway**. Bản cài đặt tự cập nhật từ các Release sau.

## Đăng nhập trong app

App chỉ có đăng nhập **GitHub** (dán token, xem `web/docs/ACCOUNT.md`), dùng được như nhau trên Windows và Android. Không cần OAuth Client ID, trang GitHub Pages hay liên kết sâu.

## Chạy thử trên máy (tuỳ chọn)

```bash
npm ci
npm start                # mở app Windows/Linux/macOS
npx cap sync android     # chép web/ vào android/, rồi mở android/ bằng Android Studio
```

## Cấu trúc

```
web/                 toàn bộ app (trước đây là thư mục pwa/)
electron/main.js     vỏ Windows: phục vụ web/ ở localhost:47821, cửa sổ, tự cập nhật
electron-builder.yml cấu hình đóng gói .exe
android/             dự án Android do Capacitor tạo (khoá ký + versionCode lấy từ CI)
capacitor.config.json
scripts/sync-version.js  đọc APP_VERSION → package.json, versionCode Android
.github/workflows/build.yml
```
