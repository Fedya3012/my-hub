// DLNA / UPnP picker and remote controller (Android app). See lib/native.js.
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { bus } from '../../../core/bus.js';
import { player } from '../lib/player.js';
import { dlna } from '../lib/native.js';
import { fmtTime } from '../lib/format.js';
import { sheet } from './sheets.js';

export async function dlnaPicker() {
  if (dlna.device) return dlnaRemote();
  const s = sheet({ title: 'Phát lên thiết bị DLNA / UPnP', body: `<p class="hint">${icon('output')} Đang tìm loa, ampli, TV trong mạng Wi-Fi…</p>` });
  let list = [];
  try { list = await dlna.discover(); } catch (e) { s.el.querySelector('.hint').textContent = e.message || 'Không dò được'; return; }
  if (!s.el.isConnected) return;
  s.body.innerHTML = list.length
    ? `<div class="stack">${list.map((d, i) => `<button class="btn" data-i="${i}">${icon('output')}<span>${esc(d.name)}${d.model ? ` <small class="muted">${esc(d.model)}</small>` : ''}</span></button>`).join('')}</div>`
    : `<p class="hint">Không thấy thiết bị nào. Thiết bị và điện thoại cần cùng mạng Wi-Fi, và thiết bị phải bật DLNA / UPnP (Media Renderer).</p><button class="btn small" data-retry>${icon('refresh')}Tìm lại</button>`;
  s.body.querySelector('[data-retry]')?.addEventListener('click', () => { s.close(); dlnaPicker(); });
  s.body.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', async () => {
    s.close();
    try { await dlna.start(player, list[+b.dataset.i]); dlnaRemote(); } catch (e) { toast(e.message || 'Không phát được', 'error'); }
  }));
}

export function dlnaRemote() {
  if (!dlna.device) return;
  let paused = false;
  const offs = [];
  const s = sheet({ title: dlna.device.name, onClose: () => offs.forEach(f => f()), body: `<div class="stack">
    <div><b data-t></b><br><small class="muted" data-a></small></div>
    <div class="muted" data-pos>—</div>
    <div class="row-actions">
      <button class="icon-btn" data-k="prev" aria-label="Bài trước">${icon('prev')}</button>
      <button class="icon-btn" data-k="pp" aria-label="Phát / tạm dừng">${icon('pause')}</button>
      <button class="icon-btn" data-k="next" aria-label="Bài sau">${icon('next')}</button>
    </div>
    <label>Âm lượng thiết bị <input type="range" min="0" max="100" value="30" data-vol></label>
    <button class="btn small" data-k="stop">${icon('x')}Dừng và phát lại trên máy</button></div>` });
  const $ = (q) => s.body.querySelector(q);
  const paint = () => { const t = player.track; $('[data-t]').textContent = t?.title || ''; $('[data-a]').textContent = t?.artist || ''; };
  paint();
  offs.push(bus.on('music:dlna-status', (st) => { $('[data-pos]').textContent = `${fmtTime(st.position || 0)} / ${fmtTime(st.duration || 0)} · ${st.state === 'PLAYING' ? 'Đang phát' : st.state === 'PAUSED_PLAYBACK' ? 'Tạm dừng' : st.state || ''}`; paint(); }));
  const run = (f) => f().catch(e => toast(e.message || 'Thiết bị không phản hồi', 'warn'));
  s.body.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'prev') run(() => dlna.skip(player, -1));
    if (k === 'next') run(() => dlna.skip(player, 1));
    if (k === 'pp') { paused = !paused; e.target.closest('button').innerHTML = icon(paused ? 'play' : 'pause'); run(() => dlna.control(paused ? 'pause' : 'resume')); }
    if (k === 'stop') { s.close(); run(() => dlna.stop(player)); }
  });
  $('[data-vol]').addEventListener('change', (e) => run(() => dlna.volume(+e.target.value)));
}
