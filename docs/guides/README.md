# Hướng dẫn sử dụng My Hub / Guides

Hướng dẫn cho người dùng. Mở bản đẹp có hình và mục lục: https://claude.ai/artifact/JVnWU1v2T4t2Y9WtUU1DUL

1. Bắt đầu
   1. [Android: cài và cập nhật bằng Obtainium](10-android.md)
   2. [Windows: cài đặt và cập nhật](11-windows.md)
2. [Đồng bộ: tài khoản và thư mục](20-dong-bo.md)
3. Ứng dụng
   1. [Thư viện](30-thu-vien.md)
   2. [Quản lý ứng dụng](31-quan-ly-ung-dung.md)
   3. [Trình phát nhạc](32-trinh-phat-nhac.md)
   4. [Sách](33-sach.md)
   5. [Xưởng Viết](34-xuong-viet.md)
   6. [Cài đặt](35-cai-dat.md)
4. [Phát hành phiên bản mới](40-phat-hanh.md)

Thêm app mới: tạo `3x-<tên>.md`, thêm vào danh sách trên và vào `PAGES` trong `/mnt/project-files/guides/build.py`.
Cập nhật lần cuối: 2026-10-22, theo app 0.9.9.1.

Trong app: mục **Hướng dẫn sử dụng** trên thanh bên (module `guides`). Sau khi sửa `.md` hoặc ảnh: `python3 tools/build-guides.py && node tools/sync-versions.js`.
