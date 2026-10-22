// "Tuỳ chỉnh": library layout & tabs, Now Playing look, playback (gapless, crossfade,
// ReplayGain, engine, output), linked music, music data import/export.
import { db } from '../../../core/db.js';
import { icon } from '../../../core/icons.js';
import { esc, toast, saveJson } from '../../../core/ui.js';
import { tasks } from '../../../core/tasks.js';
import { prefs, setPref, resetPrefs, TABS } from '../lib/prefs.js';
import { player, clearDecodeCache } from '../lib/player.js';
import { HIRES_RULES } from '../lib/format.js';
import { canSetSink, isIOS } from '../lib/engine.js';
import * as store from '../lib/store.js';
import { sheet } from './sheets.js';
import { VIS_THEMES } from './visualizer.js';
import { skinPickerHtml, bindSkins } from '../../../core/skin-ui.js';

const SECTIONS = { library: 'Thư viện', np: 'Đang phát', playback: 'Phát & âm thanh', links: 'Liên kết', data: 'Dữ liệu' };

export function customizeSheet(onChange, start = 'library') {
  const s = sheet({ title: 'Tuỳ chỉnh nhạc', wide: true, cls: 'as-custom', body: `<div class="mcus">
    <nav class="mcus-nav" role="tablist">${Object.entries(SECTIONS).map(([k, v]) => `<button role="tab" data-sec="${k}">${v}</button>`).join('')}</nav>
    <div class="mcus-body"></div></div>` });
  const body = s.el.querySelector('.mcus-body');
  let sec = start;
  const show = async (k) => {
    sec = k;
    s.el.querySelectorAll('[data-sec]').forEach(b => b.setAttribute('aria-selected', b.dataset.sec === k));
    body.innerHTML = await RENDER[k]();
    bind(body);
    body.scrollTop = 0;
  };
  s.el.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => show(b.dataset.sec));

  // Generic binding: [data-pref] switches / selects / ranges write straight to prefs.
  function bind(root) {
    root.querySelectorAll('.switch[data-pref]').forEach(b => b.onclick = async () => {
      const v = b.getAttribute('aria-checked') === 'true' ? 0 : 1;
      b.setAttribute('aria-checked', !!v);
      await setPref(b.dataset.pref, v); after(b.dataset.pref);
    });
    root.querySelectorAll('select[data-pref], input[data-pref]').forEach(i => {
      const out = root.querySelector(`[data-out="${i.dataset.pref}"]`);
      i.oninput = () => { if (out) out.textContent = fmtOut(i.dataset.pref, i.value); };
      i.onchange = async () => { const v = i.type === 'range' || i.dataset.num ? +i.value : i.value; await setPref(i.dataset.pref, v); after(i.dataset.pref); };
    });
    root.querySelectorAll('[data-tab-move]').forEach(b => b.onclick = async () => {
      const tabs = [...prefs().tabs], i = +b.dataset.i, j = i + +b.dataset.tabMove;
      if (j < 0 || j >= tabs.length) return;
      [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
      await setPref('tabs', tabs); show('library'); onChange?.();
    });
    root.querySelectorAll('[data-tab-on]').forEach(b => b.onclick = async () => {
      const tabs = prefs().tabs.map(t => [...t]), i = +b.dataset.i;
      if (tabs[i][1] && tabs.filter(t => t[1]).length === 1) return toast('Cần giữ ít nhất một tab', 'warn');
      tabs[i][1] = tabs[i][1] ? 0 : 1;
      await setPref('tabs', tabs); show('library'); onChange?.();
    });
    root.querySelector('[data-act="reset"]')?.addEventListener('click', async () => { await resetPrefs(); player.applyPrefs(); show(sec); onChange?.(); toast('Đã khôi phục mặc định'); });
    root.querySelector('[data-act="clear-cache"]')?.addEventListener('click', () => busy(
      { label: 'Đang xoá bộ đệm giải mã', delay: 300 }, async () => { await clearDecodeCache(); toast('Đã xoá bộ đệm giải mã'); }));
    root.querySelector('[data-act="export"]')?.addEventListener('click', () => busy({ label: 'Đang xuất dữ liệu nhạc', delay: 300 }, exportMusic));
    root.querySelector('[data-act="m3u"]')?.addEventListener('click', () => busy({ label: 'Đang xuất danh sách phát', delay: 300 }, exportM3u));
    if (root.querySelector('[data-skin-host]')) bindSkins(root, () => show(sec));
    root.querySelector('[data-act="lb"]')?.addEventListener('click', async () => {
      const { ask } = await import('./sheets.js');
      const tok = (await ask('User token ListenBrainz', prefs().qol?.lbToken || ''))?.trim();
      if (!tok) return;
      {
        const { testToken } = await import('../lib/qol.js');
        const user = await testToken(tok).catch(() => null);
        if (!user) { toast('Token không hợp lệ hoặc không có mạng', 'warn'); return; }
        toast('Đã kết nối ListenBrainz: ' + user);
      }
      await setPref('qol.lbToken', tok); show(sec);
    });
    root.querySelector('[data-act="lb-off"]')?.addEventListener('click', async () => { await setPref('qol.lbToken', ''); toast('Đã ngắt ListenBrainz'); show(sec); });
    root.querySelector('[data-act="sinks"]')?.addEventListener('click', () => pickSink(root));
  }

  async function after(path) {
    if (path.startsWith('playback.engine') || path === 'playback.outputRate') {
      const pb = prefs().playback;
      await player.setEngineOpts({ engine: pb.engine, outputRate: pb.outputRate });
      toast('Đã áp dụng cho bộ phát');
    } else if (path.startsWith('playback.')) player.applyPrefs();
    if (path === 'hiResRule' || path.startsWith('art.')) store.invalidate();
    onChange?.(path);
  }

  show(sec);
}

const sw = (path, on) => `<button class="switch" role="switch" aria-checked="${!!on}" data-pref="${path}"><i></i></button>`;
const row = (label, ctl, hint = '') => `<div class="mcus-row"><div><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div>${ctl}</div>`;
const sel = (path, val, opts, num = false) => `<select data-pref="${path}" ${num ? 'data-num="1"' : ''}>${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${String(k) === String(val) ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
function fmtOut(path, v) {
  if (path === 'playback.crossfade') return +v ? (+v).toFixed(1) + ' s' : 'Tắt';
  if (path.startsWith('playback.rg')) return (+v > 0 ? '+' : '') + (+v).toFixed(1) + ' dB';
  if (path === 'np.videoDim') return Math.round(v * 100) + '%';
  if (path === 'np.fxIntensity') return Math.round(v * 100) + '%';
  if (path === 'np.videoBlur') return +v ? v + ' px' : 'Không';
  return v;
}
const range = (path, val, min, max, step) => `<span class="mcus-range"><input type="range" data-pref="${path}" min="${min}" max="${max}" step="${step}" value="${val}"><output class="num" data-out="${path}">${fmtOut(path, val)}</output></span>`;

const RENDER = {
  async library() {
    const p = prefs();
    return `<h3>Tab & thứ tự</h3><ul class="mcus-tabs">${p.tabs.map(([id, on], i) => `<li class="${on ? '' : 'off'}">
        <button class="switch sm" role="switch" aria-checked="${!!on}" data-tab-on data-i="${i}" aria-label="Hiện ${TABS[id]}"><i></i></button>
        <span>${TABS[id]}</span>
        <button class="icon-btn sm" data-tab-move="-1" data-i="${i}" aria-label="Lên">${icon('chev-left')}</button>
        <button class="icon-btn sm" data-tab-move="1" data-i="${i}" aria-label="Xuống">${icon('chev-right')}</button></li>`).join('')}</ul>
      <h3>Hiển thị</h3>
      ${row('Kiểu xem Album', sel('view.albums', p.view.albums, { grid: 'Lưới', list: 'Danh sách', coverflow: 'Cover Flow' }))}
      ${row('Kiểu xem Nghệ sĩ', sel('view.artists', p.view.artists, { grid: 'Lưới', list: 'Danh sách' }))}
      ${row('Kiểu xem Danh sách phát', sel('view.playlists', p.view.playlists, { grid: 'Lưới', list: 'Danh sách' }))}
      ${row('Kích thước ô lưới', sel('gridSize', p.gridSize, { s: 'Nhỏ', m: 'Vừa', l: 'Lớn' }))}
      ${row('Cover Flow ở Trang chủ', sw('homeCoverFlow', p.homeCoverFlow))}
      ${row('Hiện định dạng tệp', sw('showBadges', p.showBadges), 'Ví dụ FLAC 24/96, MP3 320k')}
      ${row('Hiện huy hiệu Hi-Res', sw('showHiRes', p.showHiRes))}
      ${row('Tiêu chuẩn Hi-Res', sel('hiResRule', p.hiResRule, HIRES_RULES))}
      <h3>Nguồn nhạc</h3>
      ${row('Duyệt theo thư mục (không quét thư viện)', sw('folderMode', p.folderMode), 'Thêm tab “Duyệt thư mục”: mở thẳng thư mục trên máy, thẻ SD, ổ USB và phát ngay, không nhập hay quét. Giữ thư mục giữa các lần mở trên Chrome/Edge máy tính; trình duyệt khác chỉ trong phiên.')}
      <h3>Ảnh tự động</h3>
      ${row('Ảnh nghệ sĩ', sel('art.artist', p.art?.artist || 'collage', { collage: 'Ghép 4 bìa album', single: 'Bìa album phổ biến nhất' }), 'Ảnh bạn tự chọn (menu ⋯ → Đổi ảnh…) luôn được ưu tiên')}
      ${row('Ảnh thể loại, năm, hãng đĩa, thư mục', sel('art.groups', p.art?.groups || 'collage', { collage: 'Ghép 4 bìa album', single: 'Bìa album mới nhất' }))}`;
  },
  async np() {
    const n = prefs().np;
    return `${row('Kiểu bìa', sel('np.art', n.art, { cover: 'Bìa vuông', cd: 'Đĩa CD', vinyl: 'Đĩa than (vinyl)', cassette: 'Băng cassette' }))}
      ${row('Nền ambient', sw('np.ambient', n.ambient), 'Nền mờ chuyển động lấy từ ảnh bìa')}
      ${row('Màu theo ảnh bìa', sw('np.albumTheme', n.albumTheme), 'Màu nhấn của Đang phát và mini player lấy từ bìa album')}
      ${row('Đổi màu nhấn cả app theo bài đang phát', sw('np.appAccent', n.appAccent), 'Tắt thì app giữ màu nhấn của theme')}
      ${row('Phổ âm thanh', sw('np.visualizer', n.visualizer))}
      ${row('Karaoke giả lập', sw('np.fakeKaraoke', n.fakeKaraoke), 'Lời chỉ có mốc theo dòng vẫn tô sáng từng chữ (ước lượng)')}
      ${row('Cỡ chữ lời bài hát', sel('np.lyricsSize', n.lyricsSize, { s: 'Nhỏ', m: 'Vừa', l: 'Lớn' }))}
      <h3>Hiệu ứng nền (visualizer)</h3>
      ${row('Kiểu', sel('np.fx', n.fx, { '': 'Theo skin', off: 'Tắt', ...VIS_THEMES }), 'Phản ứng theo nhạc; chạm/kéo để khuấy, xoay')}
      ${row('Hiện ở', sel('np.fxWhere', n.fxWhere, { bg: 'Nền Đang phát', lyrics: 'Lời bài hát', both: 'Cả hai' }))}
      ${row('Cường độ', range('np.fxIntensity', n.fxIntensity, 0.2, 1, 0.05))}
      <h3>Skin cho Nhạc</h3>
      <div data-skin-host>${await skinPickerHtml('music')}</div>
      <h3>Video nền</h3>
      ${row('Hiện video nền', sw('np.video', n.video), 'Chọn video trong Đang phát, nút máy quay cạnh tab Lời: cho một bài, cả album, hoặc mặc định')}
      ${row('Hiện ở', sel('np.videoWhere', n.videoWhere === 'always' ? 'both' : n.videoWhere, { bg: 'Nền Đang phát', lyrics: 'Lời bài hát', both: 'Cả hai' }), 'Tắt hẳn bằng công tắc ở trên')}
      ${row('Đồng bộ màu theo video', sw('np.videoColors', n.videoColors), 'Sóng, nút, chữ, thanh tua lấy màu chủ đạo của video (giữ đủ tương phản)')}
      ${row('Độ tối', range('np.videoDim', n.videoDim, 0, 0.85, 0.05), 'Tối hơn thì lời dễ đọc hơn')}
      ${row('Làm mờ', range('np.videoBlur', n.videoBlur, 0, 30, 1))}
      ${row('Dừng theo nhạc', sw('np.videoFollow', n.videoFollow), 'Video tạm dừng khi nhạc tạm dừng')}`;
  },
  async playback() {
    const b = prefs().playback, E = player.engine;
    const rates = { 0: 'Theo hệ thống', 44100: '44.1 kHz', 48000: '48 kHz', 88200: '88.2 kHz', 96000: '96 kHz', 176400: '176.4 kHz', 192000: '192 kHz' };
    return `<h3>Chuyển bài</h3>
      ${row('Gapless', sw('playback.gapless', b.gapless), 'Bài sau nối liền bài trước (album live, nhạc cổ điển)')}
      ${row('Crossfade', range('playback.crossfade', b.crossfade, 0, 12, 0.5))}
      ${row('Crossfade thông minh', sw('playback.smartCrossfade', b.smartCrossfade), 'Không trộn hai bài liền nhau của cùng album, rút ngắn với bài ngắn, bỏ qua podcast')}
      ${row('Bỏ đoạn im lặng cuối bài', sw('playback.skipSilence', b.skipSilence), 'Sang bài sau khi đoạn cuối im hơn −55 dBFS trong 1,5 giây')}
      <h3>Hàng chờ</h3>
      ${row('Auto DJ', sw('qol.autoDj', prefs().qol?.autoDj), 'Hết hàng chờ (khi không lặp) thì tự thêm bài tương tự: cùng nghệ sĩ, thể loại, thời kỳ')}
      <h3>Scrobble (ListenBrainz)</h3>
      ${row('Tài khoản ListenBrainz', `<button class="btn small" data-act="lb">${prefs().qol?.lbToken ? 'Đổi token…' : 'Kết nối…'}</button>${prefs().qol?.lbToken ? ` <button class="btn small" data-act="lb-off">Ngắt</button>` : ''}`, prefs().qol?.lbToken ? 'Đang ghi lại lịch sử nghe lên ListenBrainz (mất mạng thì gửi sau)' : 'Dán User token ở listenbrainz.org/settings để ghi lại lịch sử nghe')}
      <h3>ReplayGain</h3>
      ${row('Chế độ', sel('playback.rgMode', b.rgMode, { auto: 'Tự động (album khi nghe cả album)', track: 'Theo bài', album: 'Theo album', off: 'Tắt' }))}
      ${row('Preamp', range('playback.rgPreamp', b.rgPreamp, -12, 12, 0.5))}
      ${row('Bài không có thẻ', range('playback.rgUntagged', b.rgUntagged, -15, 0, 0.5), 'Mức áp dụng cho bài thiếu thông tin ReplayGain')}
      ${row('Chống vỡ tiếng', sw('playback.rgClip', b.rgClip), 'Dùng giá trị đỉnh (peak) để không vượt 0 dBFS')}
      <h3>Đầu ra</h3>
      ${row('Engine', sel('playback.engine', b.engine, { auto: `Tự động${isIOS ? ' (iOS: trực tiếp)' : ' (Web Audio)'}`, webaudio: 'Web Audio (EQ, crossfade mượt)', direct: 'Trực tiếp (nhẹ, phát nền tốt trên iOS)' }), `Đang dùng: ${E.mode === 'direct' ? 'trực tiếp' : E.mode === 'webaudio' ? 'Web Audio' : 'chưa khởi động'}`)}
      ${row('Tần số đầu ra', sel('playback.outputRate', b.outputRate, rates, true), E.outputRate ? `Hiện tại ${E.outputRate / 1000} kHz. Trùng tần số với file để tránh chuyển mẫu.` : '')}
      ${canSetSink() ? row('Thiết bị phát', `<button class="btn small" data-act="sinks">${icon('output')}Chọn…</button>`, b.sinkId ? 'Đã chọn thiết bị riêng' : 'Theo hệ thống') : ''}
      <p class="hint">Trình duyệt không cho phát bit-perfect hay độc quyền thiết bị (exclusive/USB DAC trực tiếp) như app Android gốc. File Hi-Res vẫn được giải mã đủ độ phân giải; âm thanh đi qua bộ trộn float 32-bit của trình duyệt.</p>
      <button class="btn small" data-act="clear-cache">${icon('trash')}Xoá bộ đệm giải mã (DSD/ALAC)</button>`;
  },
  async links() {
    const l = prefs().links;
    return `${row('Tự phát nhạc liên kết', sw('links.autoplay', l.autoplay), 'Mở sách, fanfic, podcast trong Thư viện sẽ phát danh sách/album đã gắn')}
      ${row('Dừng khi đóng nội dung', sw('links.stopOnClose', l.stopOnClose), 'Nhỏ dần rồi dừng khi bạn đóng mục đã kích hoạt nhạc')}
      <p class="hint">Gắn nhạc: trong trang album hoặc danh sách phát chọn “Gắn vào…”, hoặc mở một cuốn sách trong Thư viện và chọn “Gắn nhạc nền”.</p>`;
  },
  async data() {
    const L = await store.library();
    return `<p>${L.tracks.size} bài · ${L.albums.size} album · ${L.artists.size} nghệ sĩ · ${L.playlists.length} danh sách phát</p>
      <p class="hint">Sao lưu toàn app (Cài đặt → Sao lưu) đã gồm cả nhạc: bài hát, album, danh sách phát, lịch sử nghe, preset EQ, lời bài hát. Tệp âm thanh không nằm trong JSON.</p>
      <div class="row-actions"><button class="btn" data-act="export">${icon('download')}Xuất riêng dữ liệu nhạc (JSON)</button>
      <button class="btn" data-act="m3u">${icon('list')}Xuất danh sách phát (M3U8)</button></div>
      <h3>Khôi phục</h3><button class="btn small danger-ghost" data-act="reset">Khôi phục tuỳ chỉnh mặc định</button>`;
  },
};

// Runs an action as a task in the tray (progress + errors), reports failures as a toast too.
async function busy(opts, fn) {
  try { await tasks.run(opts, fn); } catch (e) { console.error(e); toast(e.message, 'error'); }
}

async function exportMusic(task) {
  const tables = ['tracks', 'albums', 'artists', 'plays', 'eqPresets', 'lyrics'];
  const data = {};
  task.update({ total: tables.length + 1 });
  for (const t of tables) { task.update({ detail: t }); data[t] = await db.table(t).toArray(); task.step(); }
  task.update({ detail: 'collections, links, items' });
  data.collections = await db.collections.where('moduleId').equals('music').toArray();
  const ids = new Set(data.collections.map(c => c.id));
  data.links = (await db.links.toArray()).filter(l => ids.has(l.fromId) || l.relation === 'soundtrack-of');
  data.items = await db.items.where('type').anyOf('music', 'podcast').toArray();
  task.step(1, 'Đang tạo tệp JSON…');
  // Same envelope as the app backup, so Cài đặt → Nhập JSON can merge it.
  saveJson(`my-hub-music-${new Date().toISOString().slice(0, 10)}.json`, { format: 'my-hub-backup', schema: db.verno, scope: 'music', exportedAt: new Date().toISOString(), data });
}

async function exportM3u(task) {
  const L = await store.library();
  const out = [];
  task.update({ total: L.playlists.length });
  for (const pl of L.playlists) {
    task.step(0, pl.name);
    const tracks = await store.playlistTracks(pl);
    task.step();
    out.push(`#PLAYLIST:${pl.name}`, ...tracks.flatMap(t => [`#EXTINF:${Math.round(t.duration || 0)},${t.artist} - ${t.title}`, (t.folder ? t.folder + '/' : '') + (t.fileName || t.title)]), '');
  }
  const blob = new Blob(['#EXTM3U\n' + out.join('\n')], { type: 'audio/x-mpegurl' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'my-hub-playlists.m3u8' });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function pickSink(root) {
  try {
    if (navigator.mediaDevices?.selectAudioOutput) {
      const d = await navigator.mediaDevices.selectAudioOutput();
      await setPref('playback.sinkId', d.deviceId); await player.engine.setOutput(d.deviceId); toast('Phát qua: ' + d.label); return;
    }
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
    const s = sheet({ title: 'Thiết bị phát', body: `<div class="mpick">${devs.map(d => `<button class="mpick-row" data-id="${esc(d.deviceId)}">${icon('output')}<span>${esc(d.label || (d.deviceId === 'default' ? 'Mặc định' : 'Thiết bị âm thanh'))}</span></button>`).join('')}</div>
      <p class="hint">Tên thiết bị chỉ hiện khi trình duyệt đã được cấp quyền.</p>` });
    s.el.querySelectorAll('[data-id]').forEach(b => b.onclick = async () => { await setPref('playback.sinkId', b.dataset.id); await player.engine.setOutput(b.dataset.id).catch(e => toast(e.message, 'error')); s.close(); toast('Đã đổi thiết bị phát'); });
  } catch (e) { toast(e.message, 'error'); }
}
