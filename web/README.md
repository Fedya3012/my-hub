# My Hub (PWA)

Ứng dụng web cài được, offline-first: **Thư viện** (trang chủ tổng hợp mọi nội dung), **Quản lý ứng dụng** (module, phiên bản, cập nhật), **Cài đặt** (lưu trữ Local / Google Drive / Kết hợp, theme, sao lưu JSON). và **Trình phát nhạc** (Cover Flow, Now Playing CD/vinyl/cassette, karaoke từng chữ, EQ tham số + đồ hoạ, ReplayGain, gapless/crossfade, thông số Hi-Res, nhạc nền tự phát cho sách/fanfic/podcast; xem `docs/MUSIC.md`).

Đổi tên app: `js/config.js` (`APP_NAME`), `manifest.webmanifest`, `<title>` trong `index.html`.

## Chạy thử

Không cần build. Phục vụ thư mục này qua HTTP:

```bash
python3 -m http.server 8080   # rồi mở http://localhost:8080
```

## Cấu trúc

```
index.html            khung trang
manifest.webmanifest  thông tin cài đặt / APK
sw.js                 Service Worker: cache offline + kênh cập nhật
version.json          phiên bản lõi và từng module (App Manager đọc file này)
css/app.css           giao diện + token theme
vendor/dexie.min.js   Dexie 4.0.10 (đi kèm để chạy offline)
js/config.js          tên app, Google Client ID
js/app.js             khởi động, điều hướng
js/core/              db, storage/, theme, updater, registry, bus, ui, icons, seed
js/modules/<id>/      manifest.js + index.js cho từng module
docs/                 SCHEMA.md, STORAGE.md, MODULES.md, MUSIC.md
demo/music/           nhạc mẫu cho bản demo
tools/build-artifact.py  tạo artifact.html (bản xem thử nhúng)
```

## Triển khai

Đưa cả thư mục lên host HTTPS tĩnh bất kỳ (GitHub Pages, Netlify, Cloudflare Pages). Service Worker cần HTTPS (hoặc localhost).

## Đóng gói APK

**PWABuilder** (dễ nhất): vào pwabuilder.com, nhập URL đã triển khai → Package for stores → Android → tải gói, ký và cài.

**Bubblewrap** (dòng lệnh):

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://ten-ban.github.io/my-hub/manifest.webmanifest
bubblewrap build
```

Sau đó lấy SHA-256 của khoá ký, điền vào `.well-known/assetlinks.json` (và `package_name`) rồi đăng lại để APK chạy toàn màn hình, không hiện thanh địa chỉ. Trong APK, App Manager hiện "Đang chạy trong APK"; cập nhật vẫn qua Service Worker như bản web, không cần phát hành lại APK.
