# Schema database (Dexie / IndexedDB)

Định nghĩa trong `js/core/db.js`. IndexedDB luôn là bản làm việc chính (offline-first); kho GitHub chỉ là bản sao đồng bộ.

## Nguyên tắc

- **ID dạng UUID** (không dùng số tự tăng) để bản ghi tạo trên điện thoại và máy tính không đụng nhau khi đồng bộ.
- Mỗi bản ghi đồng bộ có `updatedAt` (ms) và `rev`, do hook Dexie tự đóng dấu. Khi gộp, bản có `updatedAt` mới hơn thắng.
- **Xoá mềm**: `items.deleted = 1` (tombstone) để lệnh xoá lan sang thiết bị khác.
- Mọi nội dung nằm chung bảng `items`, phân biệt bằng `type` + `moduleId`. Vì vậy Thư viện thấy tất cả mà không cần biết từng module.
- Quan hệ giữa các module nằm trong một bảng đồ thị duy nhất: `links`.

## Bảng

| Bảng | Khoá & chỉ mục | Vai trò |
|---|---|---|
| `items` | `id, type, moduleId, title, *tags, status, favorite, createdAt, updatedAt, lastOpenedAt, deleted, [type+updatedAt]` | Mọi nội dung: nhạc, sách, video, podcast, ảnh, ghi chú |
| `files` | `id, itemId, role, hash, mime, syncStatus, updatedAt` | Tệp thật phía sau item, kèm nơi lưu |
| `blobs` | `id` | Bytes tệp khi máy không có OPFS |
| `handles` | `id` | FileSystemHandle cho tệp liên kết từ thư mục riêng của người dùng |
| `links` | `id, fromId, toId, relation, [fromId+relation], [toId+relation]` | Quan hệ giữa hai item bất kỳ, kể cả khác module |
| `collections` | `id, kind, moduleId, name, updatedAt, deleted` | Playlist, kệ sách, series, kênh podcast |
| `activity` | `++seq, itemId, moduleId, action, at` | Lịch sử mở/phát/xong, dùng cho thống kê và "Tiếp tục" |
| `modules` | `id, enabled, order` | Module đã cài: phiên bản, bật/tắt, thứ tự, cài đặt riêng |
| `settings` | `key` | Cài đặt dạng key/value |
| `themes` | `id` | Theme người dùng tạo hoặc nhập |
| `progress` (v2) | `itemId, moduleId, updatedAt, deviceId` | Dừng ở đâu: vị trí, tổng, %, trạng thái, máy nào, lúc nào. Một dòng mỗi item |
| `devices` (v2) | `id, lastSeenAt` | Các máy dùng chung thư viện (tên, nền tảng, lần cuối hoạt động) |
| `syncQueue` | `++seq, entity, entityId, op, createdAt` | Thay đổi chờ đẩy lên Drive |

Đồng bộ lên Drive: `items, files, links, collections, themes` (kênh đầy đủ, `hub-db.json`) và `progress, devices` (kênh nhanh, `hub-live.json`). Giữ cục bộ: `activity` (quá nhiều), `modules` (phiên bản code khác nhau theo máy), `settings`, `blobs`, `handles`.

## Bản ghi mẫu

```js
// items
{
  id: 'uuid', type: 'music', moduleId: 'music',
  title: 'Cornfield Chase', subtitle: 'Hans Zimmer',
  tags: ['nhạc phim'], status: 'new' | 'in-progress' | 'done',
  favorite: 0 | 1, rating: 0..5,
  progress: { percent: 42, position: 125.3, label: 'Trang 289 / 688' },
  coverFileId: 'uuid?',
  meta: { duration: 126, pages: 688, isbn, year, ... },   // riêng từng loại
  createdAt, updatedAt, lastOpenedAt, rev, deleted: 0 | 1
}

// files
{
  id: 'uuid', itemId: 'uuid', role: 'main' | 'cover' | 'subtitle' | 'chapter',
  name: 'track.mp3', mime: 'audio/mpeg', size: 4821733, hash: 'sha256…',
  locations: {
    local:  { kind: 'opfs' | 'idb' | 'handle' | 'url', ref: 'uuid' },
    gdrive: { fileId: '1AbC…', md5: '…', modifiedTime: '…' }
  },
  syncStatus: 'local-only' | 'pending-upload' | 'synced' | 'cloud',
  cachedAt
}

// progress (khoá = itemId; bản ghi mới nhất từ bất kỳ máy nào thắng)
{
  itemId, moduleId,
  position: 1008, total: 2880, unit: 'second' | 'page' | 'percent', percent: 35,
  label: '16:48 / 48:00', state: 'playing' | 'paused' | 'finished',
  deviceId: 'uuid của máy ghi', updatedAt
}

// links
{ id, fromId, toId, relation: 'soundtrack-of' | 'adapted-from' | 'discusses' | 'notes-on' | 'contains' | 'related', order? }
```

## Quan hệ liên module (ví dụ)

```
Dune: Part Two (video) ──adapted-from──▶ Xứ Cát (book)
A Time of Quiet… (music) ──soundtrack-of──▶ Dune: Part Two (video)
Podcast tập 87 (podcast) ──discusses──▶ Xứ Cát (book)
Playlist "Hans Zimmer" (collection) ──contains(order)──▶ các bài nhạc
```

Music Player chỉ cần đọc `links` với `relation = 'soundtrack-of'` để hiện "Nghe nhạc phim" trong trang video, và ngược lại.

## Đổi schema

Hiện tại là `db.version(4)` (v3 thêm bảng nhạc: tracks, albums, artists, plays, eqPresets, lyrics, chi tiết ở [MUSIC.md](MUSIC.md); v4 thêm bảng sách: books, authors, series, annotations, readingSessions, readingGoals, chi tiết ở [BOOKS.md](BOOKS.md)). Đổi tiếp thì thêm `db.version(5).stores({...}).upgrade(tx => ...)` trong `db.js`. Không sửa version cũ. Module cũng có thể tự migrate dữ liệu riêng qua hàm `migrate({ from, to, db })` khi được cập nhật.
