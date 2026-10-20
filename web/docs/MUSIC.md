# Music Player (module `music`, v0.2.0)

Trình phát nhạc của My Hub: bố cục và trải nghiệm lấy từ Noctis, phần thông tin kỹ thuật kiểu Symfonium, gắn chặt với Thư viện.

## 1. Schema bổ sung (Dexie `db.version(3)`)

Mỗi bài nhạc vẫn là một `items` (type `music` hoặc `podcast`, moduleId `music`), nên tự hiện trong Thư viện, tìm kiếm, thẻ, yêu thích, sao lưu. Phần riêng của nhạc nằm ở các bảng mới, đều được đồng bộ Drive (trừ ghi chú bên dưới).

| Bảng | Khoá / chỉ mục | Nội dung |
|---|---|---|
| `tracks` | `itemId`, albumId, artistId, *artistIds, albumArtistId, *genres, folder, codec, hiRes, lossless, addedAt | Thẻ (title qua item, artist, album, albumArtist, trackNo/discNo, year, genres, composer, bpm, isrc, label, comment), `duration`, `tech` (xem dưới), `rg` (ReplayGain track/album + peak), `rating` 0–5, `folder`, `fileId`, `coverFileId` riêng nếu khác bìa album, `bgVideoFileId` (video nền sau lời) |
| `albums` | `id` = hash(albumArtist + title) | title, artist, artistId, year, `coverFileId`, `thumbFileId` (webp 360px), `colors` {bg, accent, light, dark} lấy từ bìa, `rg` album, `bgVideoFileId` |
| `artists` | `id` = hash(tên chuẩn hoá) | name, ảnh (tuỳ chọn) |
| `plays` | `id`, itemId, at, deviceId | Lịch sử nghe: ms đã nghe, completed. Tính một lượt khi nghe ≥ 50% hoặc ≥ 4 phút |
| `eqPresets` | `id`, name | Preset EQ người dùng: `bands[]` {type, freq, gain, q, on}, preampDb, mode |
| `lyrics` | `itemId` | `text` (LRC, LRC nâng cao từng chữ, TTML Apple, SRT/VTT hoặc văn bản thường), `trText` (bản dịch, mỗi dòng ứng với một dòng lời, hoặc LRC), `source` user/lrc/ttml/srt/tag/lrclib, `offset`, `lrclibId` |

`tech` của mỗi bài (đọc trực tiếp từ tệp, không cần máy chủ):

```js
{ container: 'FLAC', codec: 'FLAC', codecLabel: 'FLAC', lossless: true, floatPCM: false,
  bitDepth: 24, sampleRate: 96000, dsdRate: null, channels: 2, bitrate: 2304000, vbr: true,
  duration: 13.0, encoder: 'reference libFLAC 1.4.3' }
```

Id album và nghệ sĩ là hash của tên đã chuẩn hoá, nên hai máy nhập cùng một album tạo ra cùng một bản ghi và đồng bộ không bị trùng.

Dùng lại bảng có sẵn:

- **Playlist**: `collections` với `kind: 'playlist'` (thứ tự qua `links` relation `contains` + `order`) hoặc `kind: 'smart'` (`rules: { match: 'all'|'any', rules: [{field, op, value}], sort, limit }`).
- **Nhạc gắn với sách / fanfic / podcast / video**: `links` relation `soundtrack-of`, `fromId` là bài, album, nghệ sĩ hoặc playlist, `toId` là mục được gắn. Thêm `source` (track/album/artist/playlist), `autoplay`, `shuffle`.
- **Phiên nghe đồng bộ giữa máy**: bản ghi ảo `progress['music:session']` (hàng chờ, bài, vị trí, nguồn, máy) đi theo kênh live `hub-live.json`. Podcast và bài dài hơn 10 phút còn lưu tiến độ riêng theo item.
- **Tệp**: `files` qua `storage` như mọi module, nên chạy ở cả ba chế độ Local / Google Drive / Kết hợp. Thư mục liên kết (Chrome/Edge máy tính) giữ handle, không chép tệp.

Video nền là một `files` (role `bgvideo`), chủ sở hữu là bài hoặc album, nên đồng bộ như mọi tệp. Video mặc định cho mọi bài nằm ở `settings['music.bgVideoDefault']`, chỉ trên máy đó.

Chỉ lưu trên từng máy (không đồng bộ): tuỳ chọn hiển thị và phát (`settings['music.prefs']`), trạng thái EQ đang dùng (`settings['music.eq']`, vì mỗi máy nối loa/tai nghe khác nhau), và bộ nhớ đệm giải mã (Cache Storage `hub-music-decoded`).

## 2. UI/UX

**Bố cục chung.** Desktop (≥ 1000px): thanh điều hướng bên trái của app, nội dung ở giữa, thanh phát đầy đủ ở đáy. Điện thoại: tab dưới cùng của app, mini player nổi ngay trên tab (vuốt ngang để đổi bài, vuốt lên hoặc chạm để mở Now Playing). Hai bố cục được thiết kế riêng, không thu nhỏ từ nhau.

**Thư viện nhạc** (`#music`, `#music/<tab>`, `#music/album/<id>` …)

- Tab: Trang chủ, Bài hát, Album, Nghệ sĩ, Thể loại, Thư mục, Danh sách phát. Bật/tắt và sắp xếp lại tab trong Tuỳ chỉnh.
- Trang chủ: Cover Flow album, thống kê (số bài, tổng thời lượng, số bài Hi-Res, thanh tỷ lệ định dạng), lối tắt playlist thông minh, nghe gần đây, album mới, yêu thích, nhạc nền đang gắn với sách và podcast.
- Mỗi tab có chế độ xem lưới / danh sách / Cover Flow, cỡ lưới, sắp xếp (tên, nghệ sĩ, năm, ngày thêm, lượt nghe, đánh giá, thời lượng, định dạng…), bộ lọc nhanh (Lossless, Hi-Res, Yêu thích, theo định dạng).
- Trang album: phần đầu nhuộm màu theo bìa, dòng kỹ thuật tổng hợp ("FLAC 24/96 · Stereo · ReplayGain album −4.0 dB"), nút Phát / Ngẫu nhiên / Gắn vào sách…, danh sách theo đĩa.
- Dòng bài: huy hiệu định dạng (FLAC 24/96, MP3 320k, DSD64…), Hi-Res, thời lượng, menu (phát tiếp, thêm vào hàng chờ / playlist, đánh giá, sửa thẻ, sửa lời, thông tin tệp, gắn vào mục khác, xoá).

**Now Playing** (toàn màn hình)

- Nền ambient lấy từ bìa (làm mờ, chuyển động chậm), màu nhấn lấy theo album (tắt được).
- Kiểu artwork: bìa phẳng, CD (đĩa quay), vinyl (đĩa than + cần đọc), cassette (băng quay). Visualizer dạng cột phía trên tiêu đề.
- Thông tin: huy hiệu định dạng + dòng kỹ thuật (codec · bit depth · sample rate · kênh · bitrate), Hi-Res, yêu thích, đánh giá sao.
- Bảng bên (desktop) hoặc ngăn kéo (điện thoại): Lời karaoke từng chữ (chạm dòng để tua, chỉnh cỡ chữ, sửa lời và chế độ chấm nhịp), Hàng chờ (kéo thả), Album.
- **Video nền sau lời** (như Noctis): nút máy quay cạnh tab Lời. Chọn video cho bài này, cho cả album, hoặc một video mặc định cho mọi bài chưa có; gỡ, ẩn/hiện. Ưu tiên: bài > album > mặc định. Video tắt tiếng, lặp, phủ toàn màn hình Đang phát khi xem lời (hoặc luôn hiện, tuỳ chỉnh), được làm tối để lời dễ đọc, và dừng cùng nhạc. Khi nhập thư mục, `canvas.mp4` / `background.mp4` / `bg.mp4` / `video.mp4` / `loop.mp4` (hoặc .webm, .mov) thành video của album, còn video trùng tên bài (vd `01 Gió đồng.mp4` cạnh `01 Gió đồng.flac`) thành video của bài đó.
- Hàng nút dưới: EQ, hẹn giờ ngủ, tốc độ, thiết bị ra (nếu trình duyệt cho chọn), âm lượng. Nút Back của hệ thống đóng Now Playing.

**Thông tin tệp** (kiểu Symfonium): định dạng, loại (lossless / lossy / DSD), bit depth, sample rate, bitrate (CBR/VBR), kênh, container, encoder, Hi-Res theo quy tắc đã chọn, và **đường tín hiệu**: nguồn → giải mã (trình duyệt hoặc bộ giải mã của app) → ReplayGain → EQ → chuyển bài (gapless / crossfade) → đầu ra (Web Audio 32-bit float ở tần số của thiết bị).

**Bộ chỉnh âm**: đường đáp tuyến tần số vẽ trực tiếp, kéo điểm để chỉnh; chế độ đồ hoạ 10 dải và chế độ tham số (thêm dải, đổi loại bộ lọc peaking / shelf / pass / notch, chỉnh Q). Preset có sẵn, lưu preset riêng, nhập/xuất định dạng AutoEQ / Equalizer APO, tự hạ preamp để không vỡ tiếng.

**Tuỳ chỉnh** (nút bánh răng): Thư viện (tab, chế độ xem, huy hiệu, quy tắc Hi-Res, Cover Flow trang chủ), Now Playing (kiểu artwork, ambient, màu theo album, visualizer, karaoke giả lập cho lời theo dòng; video nền: bật/tắt, khi nào hiện, độ tối, độ mờ, dừng theo nhạc), Phát (gapless, crossfade và crossfade thông minh, bỏ khoảng lặng, ReplayGain auto/track/album/tắt + preamp + chống clip, tần số đầu ra, thiết bị ra), Liên kết (tự phát khi mở mục, dừng khi đóng), Dữ liệu (xuất JSON nhạc, xuất M3U8, xoá bộ đệm giải mã).

**Trong Thư viện chính**: ngăn chi tiết của sách / fanfic / podcast / video có mục "Nhạc nền" để gắn bài, album, nghệ sĩ hoặc playlist, bật tự phát và ngẫu nhiên. Mở mục đó là nhạc tự phát; đóng thì nhạc dừng nếu bật tuỳ chọn.

## 2b. Sửa thẻ, ảnh, duyệt thư mục, thống kê

- **Sửa thẻ** (`ui/tageditor.js`, một bài hoặc nhiều bài): tên, nghệ sĩ, album, nghệ sĩ album, sáng tác, hãng đĩa, loại phát hành, bài/tổng, đĩa/tổng, năm, thể loại, BPM, ISRC, ghi chú, ReplayGain, lời. Dọn thẻ (`lib/tagclean.js`): bỏ khoảng trắng, đổi hoa/thường, tách “feat.”, sửa lỗi mã hoá (UTF-8 hoặc Windows-1258 bị đọc thành Latin-1/CP1252), xoá URL/rác, số bài và tên bài từ tên tệp, điền theo mẫu `%artist%/%album%/%track% - %title%`. Lời đồng bộ từng dòng: `editor.js → editLyrics`.
- **Ghi vào tệp** (`lib/tagwriter.js`): MP3 → ID3v2.4 (giữ khung lạ của thẻ cũ, bỏ ID3v1); FLAC → VORBIS_COMMENT + PICTURE (giữ STREAMINFO, SEEKTABLE, CUESHEET, APPLICATION và các comment khác). Tệp đã lưu được thay bằng bản có thẻ (tệp liên kết thư mục thành bản sao trong app, tệp gốc không bị sửa); “Tải tệp kèm thẻ” để tải về. M4A/ALAC/AAC, Opus/Ogg, WAV, AIFF, DSD, WavPack, APE: thẻ chỉ lưu trong thư viện.
- **Ảnh mọi nơi**: bài → ảnh riêng → bìa album → ảnh thư mục → ảnh tạo sẵn; nghệ sĩ → ảnh tự chọn → ghép 4 bìa album (hoặc bìa phổ biến nhất); danh sách phát, thể loại, năm, hãng đĩa, nhạc sĩ, thư mục → ảnh tự chọn → ghép 2×2 bìa. Ảnh tự chọn là `files` role `artwork` + `artwork-thumb`, `itemId` = `<loại>:<id>` (đồng bộ như tệp khác); ảnh ghép lưu ở Cache Storage `hub-music-art`. Menu ⋯ / chuột phải → “Đổi ảnh…”: chọn tệp, dán, kéo thả, lấy ảnh nhúng trong tệp, cắt vuông, về tự động.
- **Duyệt theo thư mục** (Tuỳ chỉnh → Thư viện → “Duyệt theo thư mục (không quét thư viện)”): tab “Duyệt thư mục”, thêm thư mục máy / thẻ SD / USB bằng `showDirectoryPicker`, handle giữ trong bảng `handles` (chỉ máy này, hỏi lại quyền sau khi mở lại app). Phát thẳng từ handle (bài “ảo” `vt:…`, không nhập). Trình duyệt không có API này: chọn bằng `<input webkitdirectory>`, chỉ trong phiên. Không gõ được đường dẫn trực tiếp.
- **Thống kê** (tab “Thống kê”): thời gian nghe theo ngày/tuần/tháng, bài/nghệ sĩ/album/thể loại nghe nhiều, chuỗi ngày, giờ nghe trong tuần, định dạng, chất lượng thư viện, thư viện tăng dần, bài hay bỏ qua. `plays` có thêm dòng `skip: 1` (nghe chưa tới ngưỡng tính lượt) và `ms` đã nghe; dòng skip không tính vào số lượt nghe.
- **Video nền đi cùng bài**: video được chép vào bộ nhớ app (`files` role `bgvideo`, chủ là bài/album, không giữ đường dẫn gốc), nên xoá tệp video gốc không ảnh hưởng; đồng bộ qua Drive/tài khoản như tệp khác. Video không được nhúng vào chính tệp nhạc (trình duyệt không mux được MP4/MKV đủ tin cậy); xuất JSON nhạc chỉ chứa tham chiếu, bản thân video đi theo bộ nhớ app và đồng bộ tệp.

## 3. Định dạng và giới hạn trình duyệt

| Định dạng | Phát | Ghi chú |
|---|---|---|
| FLAC, WAV, MP3, Opus, Vorbis | Trình duyệt | Hi-Res FLAC/WAV phát đủ bit depth vào Web Audio |
| AAC / M4A | Trình duyệt | Chrome, Edge, Safari, Android. Chromium tự build không có AAC |
| ALAC | Trình duyệt (Safari) hoặc bộ giải mã của app | Giải mã ra WAV, bit-exact |
| AIFF / AIFC | Bộ giải mã của app | Bit-exact |
| DSD (DSF / DFF) | Bộ giải mã của app | DSD → PCM 24-bit (DSD64 → 88.2 kHz, DSD128+ → 176.4 kHz), −6 dB như DoP |
| WavPack, APE, DST, MQA | Không | Vẫn nhập, đọc đủ thông số và hiện trong thư viện, nhưng chưa phát |

Bản giải mã được lưu trong Cache Storage của máy, lần sau phát ngay.

- Trình duyệt luôn trộn âm qua hệ điều hành ở dạng 32-bit float, nên **không có bit-perfect / exclusive mode** như ứng dụng gốc. App hiện rõ điều này trong "Đường tín hiệu".
- Gapless dùng hai deck chuyển chính xác vài mili giây trước khi hết bài: liền mạch với tai, không phải mẫu-chính-xác như giải mã liên tục.
- iPhone / iPad: Safari dừng Web Audio khi tắt màn hình, nên module tự dùng chế độ "trực tiếp": vẫn phát nền và điều khiển ở màn hình khoá, nhưng không có EQ, crossfade và visualizer.
- Chọn thiết bị ra (`setSinkId`) chỉ có ở Chrome / Edge máy tính.

## 4. Mã nguồn

```
js/modules/music/
  manifest.js  index.js (thư viện nhạc)  service.js (chạy nền: player, liên kết, phím tắt)  music.css
  lib/  meta.js (đọc thẻ + thông số)  decode.js decode-worker.js (DSD/ALAC/AIFF)  engine.js (Web Audio 2 deck)
        player.js (hàng chờ, ReplayGain, crossfade thông minh, phiên đồng bộ)  store.js (nhập, thư viện, playlist, liên kết)
        format.js (huy hiệu, Hi-Res)  art.js (bìa, thumbnail, màu)  lyrics.js (LRC, karaoke)  eq.js  prefs.js  icons.js
  ui/   dock.js  nowplaying.js  sheets.js  eq-panel.js  coverflow.js  editor.js  customize.js
demo/music/   7 bài mẫu (FLAC 24/96, FLAC 16/44.1, ALAC 24/48, MP3 320, AAC 256, Opus, DSD64) + lời LRC + video nền mẫu cho album "Đường về"
```

API cho module khác: `bus.emit('music:play', { kind: 'playlist'|'album'|'artist'|'track', id })`, `music:pause`, `music:toggle`. Mở mục từ module của nó (`item:open`) sẽ tự phát nhạc đã gắn; module đóng mục thì phát `item:close`.
