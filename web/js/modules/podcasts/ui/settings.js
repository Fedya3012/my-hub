// Podcast → Cài đặt: playback, downloads, new episodes, online search (Podcast Index key), and files: import audio /
// audiobooks, OPML import / export. Same params as Cài đặt → Podcast, so both stay in sync.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import { namespaceHtml, bindParams } from '../../../core/params-ui.js';
import * as store from '../lib/store.js';
import { parseOpml, toOpml } from '../lib/rss.js';
import { NAME } from '../lib/prefs.js';

const GROUPS = [
  ['pc-speed', 'Phát', ['speed', 'skipBack', 'skipFwd', 'skipSilence', 'silenceLevel', 'voiceBoost', 'autoplayNext', 'markPlayedAt']],
  ['download', 'Tải về', ['autoDownload', 'autoDownloadWifi', 'autoDownloadCharging', 'keepDownloads', 'autoDelete']],
  ['pc-inbox', 'Tập mới', ['refreshEvery', 'newToQueue']],
  ['pc-transcript', 'Bản chép lời', ['aiTranscript']],
  ['pc-discover', 'Tìm kiếm online', ['searchSource', 'country', 'piKey', 'piSecret', 'corsProxy']],
];

export async function render(el) {
  el.innerHTML = `<div class="stack pc-settings">
    <h2 class="section-title">${icon('settings')}Cài đặt ${esc(NAME)}</h2>
    ${GROUPS.map(([ic, title, keys]) => `<details class="panel prm-ns" open><summary>${icon(ic)}<b>${esc(title)}</b></summary>${namespaceHtml('podcasts', keys)}
      ${title === 'Tìm kiếm online' ? '<p class="hint">Podcast Index miễn phí: đăng ký khoá ở <a href="https://api.podcastindex.org/signup" target="_blank" rel="noopener">api.podcastindex.org</a>. Không có khoá vẫn tìm được qua Apple Podcasts. Khoá chỉ lưu trên máy này, không đồng bộ.</p><p class="hint">Proxy CORS chỉ cần cho bản web. Nếu đặt, máy chủ proxy sẽ thấy link mọi feed và tập bạn mở, kể cả feed riêng có mã truy cập trong link. Chỉ dùng proxy bạn tin tưởng; app Windows và Android không cần proxy.</p>' : ''}</details>`).join('')}
    <details class="panel prm-ns" open><summary>${icon('pc-upload')}<b>Tệp và dữ liệu</b></summary>
      <div class="row-actions" style="flex-wrap:wrap">
        <label class="btn">${icon('pc-upload')}Nhập tệp âm thanh / sách nói<input type="file" accept="audio/*,.m4b,.mp3,.m4a,.opus,.ogg,.flac,.wav" multiple hidden data-audio></label>
        <label class="btn">${icon('pc-rss')}Nhập OPML<input type="file" accept=".opml,.xml,text/xml" hidden data-opml></label>
        <button class="btn" data-a="export">${icon('download')}Xuất OPML</button>
        <a class="btn" href="#settings/storage">${icon('refresh')}Đồng bộ</a>
      </div>
      <p class="hint">Đăng ký, tiến độ nghe, hàng chờ, danh sách, dấu trang và bản chép lời đồng bộ theo chế độ lưu trữ bạn chọn. Tệp đã tải và tệp tự nhập chỉ nằm trên máy này.</p>
    </details>
  </div>`;
  el.querySelector('[data-audio]').onchange = (e) => importAny(e.target.files);
  el.querySelector('[data-opml]').onchange = (e) => importAny(e.target.files);
  el.querySelector('[data-a="export"]').onclick = async () => {
    const shows = (await store.shows()).filter(s => !s.feedUrl.startsWith('local:'));
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([toOpml(shows)], { type: 'text/x-opml' })), download: 'my-hub-podcasts.opml' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return bindParams(el, toast);
}

// Dropped or picked files: OPML → subscribe to each feed; audio → "Tệp âm thanh của tôi".
export async function importAny(files) {
  files = [...files];
  const opml = files.filter(f => /\.(opml|xml)$/i.test(f.name));
  const audio = files.filter(f => !opml.includes(f));
  if (audio.length) {
    try { const n = await tasks.run({ label: 'Nhập tệp âm thanh', unit: 'items', cancellable: true }, (t) => store.importFiles(audio, t)); toast(n ? `Đã thêm ${n} tệp vào “Tệp âm thanh của tôi”` : 'Không có tệp âm thanh nào'); }
    catch (e) { if (e?.name !== 'AbortError') toast(e.message, 'error'); }
  }
  for (const f of opml) {
    const feeds = parseOpml(await f.text());
    if (!feeds.length) { toast('Tệp OPML không có podcast nào', 'warn'); continue; }
    let ok = 0;
    await tasks.run({ label: 'Nhập OPML', total: feeds.length, unit: 'items', cancellable: true }, async (t) => {
      await store.pool(feeds, 4, async (x) => {
        t.check(); t.update({ detail: x.title || x.feedUrl });
        try { await store.subscribe({ feedUrl: x.feedUrl, title: x.title }, { signal: t.signal }); ok++; } catch (e) { if (e?.name === 'AbortError') throw e; console.warn('[podcasts] opml', x.feedUrl, e); }
        t.step();
      });
    }).catch(() => {});
    toast(ok === feeds.length ? `Đã đăng ký ${ok} podcast từ OPML` : `Đã đăng ký ${ok}/${feeds.length} podcast từ OPML. ${feeds.length - ok} feed không đọc được (link hỏng hoặc bị chặn).`, ok === feeds.length ? 'info' : 'warn');
  }
}
