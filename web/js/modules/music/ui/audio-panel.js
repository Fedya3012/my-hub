// "Âm thanh": bit-perfect switch + an honest signal-path view (what happens to the samples from
// the file to the speaker, stage by stage), and output routing (one device with L/R split and
// balance trims, or two devices at once with their own level and delay).
import { icon } from '../../../core/icons.js';
import { esc, toast } from '../../../core/ui.js';
import { player } from '../lib/player.js';
import { prefs, setPref } from '../lib/prefs.js';
import { CH_MODES, canDual, canPickSink, deviceRate, listOutputs, requestOutput } from '../lib/outputs.js';
import { loadProfiles } from '../lib/eq.js';
import { ambient } from '../lib/ambient.js';
import { isIOS } from '../lib/engine.js';
import { sheet } from './sheets.js';
import './audio-icons.js';

const MOBILE = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || isIOS;
const kHz = (r) => r ? (r % 1000 ? (r / 1000).toFixed(1) : r / 1000) + ' kHz' : '?';
const ms = (s) => Math.round(s * 1000) + ' ms';

export function audioSheet(tab = 'path') {
  const s = sheet({ title: 'Âm thanh', wide: true, cls: 'as-audio', body: `<div class="mau">
    <div class="seg small mau-tabs" role="tablist"><button data-tab="path">Hi-Res & đường tín hiệu</button><button data-tab="out">Đầu ra</button></div>
    <div class="mau-body"></div></div>` });
  const body = s.el.querySelector('.mau-body');
  let cur = tab, timer = null;
  const show = (k) => {
    cur = k;
    s.el.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === k));
    (k === 'path' ? renderPath : renderOut)(body);
  };
  s.el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab));
  const refresh = () => { if (cur === 'path' && body.isConnected) renderPath(body); };
  const evs = ['track', 'audio', 'eq', 'volume', 'state'];
  evs.forEach(e => player.addEventListener(e, refresh));
  timer = setInterval(refresh, 2000);   // latency figures settle after playback starts
  const stop = () => { clearInterval(timer); evs.forEach(e => player.removeEventListener(e, refresh)); };
  new MutationObserver((_, mo) => { if (!s.el.isConnected) { stop(); mo.disconnect(); } }).observe(document.body, { childList: true });
  show(cur);
  return s;
}

// ── Signal path ────────────────────────────────────────────────
export function signalPath() {
  const t = player.track, tech = t?.tech || {}, r = player.resolveInfo || {}, E = player.engine;
  const pi = E.pathInfo(), pb = prefs().playback, bp = !!prefs().audio?.bitPerfect;
  const srcRate = r.rate || tech.sampleRate || 0, dev = deviceRate();
  const codec = tech.codecLabel || tech.codec || '?';
  const dsd = !!tech.dsdRate || /DSD|DSF|DFF/i.test(tech.container || '');
  const stages = [];
  const add = (name, value, ok, note = '') => stages.push({ name, value, ok, note });

  // 1. Source
  const depth = tech.bitDepth ? `${tech.floatPCM ? '32-bit float' : tech.bitDepth + '-bit'}` : '';
  add('Tệp nguồn', t ? (dsd ? `${codec} · 1-bit ${tech.dsdRate ? (tech.dsdRate / 1e6).toFixed(1) + ' MHz' : ''}` : `${codec} · ${[depth, kHz(tech.sampleRate)].filter(Boolean).join(' / ')}`) + (tech.channels ? ` · ${tech.channels} kênh` : '') : 'Chưa phát bài nào',
    !t ? null : tech.lossless === false ? 'warn' : true,
    tech.lossless === false ? 'Định dạng nén mất dữ liệu: bit-perfect chỉ giữ nguyên những gì còn lại sau khi nén.' : '');

  // 2. Decode
  if (t) {
    if (dsd) add('Giải mã', `DSD → PCM ${kHz(srcRate)} / 24-bit (lọc thông thấp trong app)`, false, 'Trình duyệt không xuất được DSD gốc hay DoP; DSD luôn được chuyển sang PCM.');
    else if (r.decoded) add('Giải mã', `${r.decoded.toUpperCase()} → WAV PCM (không mất dữ liệu) → float32`, true);
    else if ((tech.bitDepth || 0) > 24 && !tech.floatPCM) add('Giải mã', 'Trình duyệt → float32', false, 'PCM nguyên 32-bit đổi sang float32 mất 8 bit thấp nhất (thấp hơn −144 dB, không nghe thấy).');
    else add('Giải mã', 'Trình duyệt → float32', true, 'float32 chứa trọn mẫu 16/24-bit, không làm tròn.');
  }

  // 3. DSP
  const dsp = [];
  if (pi.mode === 'webaudio') {
    if (pi.filters) dsp.push(`EQ ${pi.filters} bộ lọc`);
    if (Math.abs(pi.preampDb) > 0.05) dsp.push(`preamp ${pi.preampDb.toFixed(1)} dB`);
    if (Math.abs(pi.rgDb) > 0.05) dsp.push(`ReplayGain ${pi.rgDb > 0 ? '+' : ''}${pi.rgDb.toFixed(1)} dB`);
    if (pi.balance) dsp.push('cân bằng L/R');
    if (!pi.routerWire) dsp.push('định tuyến / tách kênh');
  } else if (Math.abs(pi.rgDb) > 0.05) dsp.push('ReplayGain (âm lượng phần tử)');
  if (!bp && +pb.crossfade) dsp.push(`crossfade ${pb.crossfade}s`);
  if (pi.volume < 0.999) dsp.push(`âm lượng ${Math.round(pi.volume * 100)}%`);
  if (pi.duck < 0.999) dsp.push('hẹn giờ đang giảm âm');
  if (Math.abs(pi.rate - 1) > 0.001) dsp.push(`tốc độ ${pi.rate}×`);
  if (ambient.active.length && pi.mode === 'webaudio') dsp.push('âm nền trộn chung ở hệ điều hành');
  add('Xử lý (DSP)', dsp.length ? dsp.join(' · ') : 'Không có: tín hiệu đi thẳng', !dsp.length,
    bp && dsp.length ? 'Bit-perfect đã bỏ EQ, ReplayGain, crossfade và cân bằng; những mục còn lại là do bạn bật.' : '');

  // 4. Context
  if (pi.mode === 'webaudio') {
    const same = srcRate && pi.ctxRate === srcRate;
    add('Web Audio', `float32 @ ${kHz(pi.ctxRate)}${pi.state && pi.state !== 'running' ? ` (${pi.state === 'suspended' ? 'đang chờ' : pi.state})` : ''}`, !t ? null : same,
      !t ? '' : same ? 'Trùng tần số của bài: không chuyển mẫu.' : `Bài ${kHz(srcRate)} được chuyển mẫu sang ${kHz(pi.ctxRate)}.${bp ? ' Trình duyệt không mở được context ở tần số này.' : ' Bật Bit-perfect để mở context đúng tần số của bài.'}`);
  } else add('Phát trực tiếp', 'Phần tử <audio>, trình duyệt tự trộn', 'warn', 'Không dùng Web Audio (iOS/chế độ trực tiếp): không có EQ; tần số do trình duyệt quyết định.');

  // 5. Output device
  const lat = pi.baseLatency + pi.outputLatency;
  const devSame = pi.mode === 'webaudio' ? pi.ctxRate === dev : null;
  add('Thiết bị ra', `${pi.sinkId ? 'Thiết bị đã chọn' : 'Mặc định hệ thống'} · khoảng ${kHz(dev)}${lat ? ` · trễ ${ms(lat)}` : ''}`,
    devSame === null ? 'warn' : devSame ? 'warn' : false,
    devSame === false ? `Trình duyệt chuyển ${kHz(pi.ctxRate)} → ${kHz(dev)} cho thiết bị. Đặt tần số của thiết bị (Cài đặt âm thanh của hệ điều hành) bằng ${kHz(pi.ctxRate)} để tránh bước này.` : 'Tần số thiết bị theo trình duyệt báo (thiết bị mặc định).');
  // 6. OS
  add('Hệ điều hành', 'Bộ trộn dùng chung (shared mode)', 'warn', 'Trình duyệt không có chế độ độc quyền (WASAPI exclusive, ASIO, CoreAudio hog mode, USB DAC trực tiếp): hệ điều hành vẫn trộn và có thể đổi độ sâu bit / tần số. Muốn bit-perfect tuyệt đối tới DAC, hãy đặt DAC trùng tần số và để âm lượng hệ thống 100%.');

  const verdict = stages.every(x => x.ok === true || x.ok === null || x.name === 'Hệ điều hành' || (x.name === 'Thiết bị ra' && x.ok === 'warn'));
  return { stages, verdict, bp, srcRate };
}

function renderPath(body) {
  const bp = !!prefs().audio?.bitPerfect, p = signalPath(), E = player.engine;
  const mark = (ok) => ok === true ? `<i class="mau-ok" title="Giữ nguyên bit">${icon('check')}</i>` : ok === false ? `<i class="mau-no" title="Có thay đổi">${icon('x')}</i>` : ok === 'warn' ? '<i class="mau-warn" title="Không kiểm soát được">!</i>' : '<i class="mau-na">–</i>';
  body.innerHTML = `
    <div class="mau-row mau-bp"><div><b>Bit-perfect / Hi-Res</b><small>Bỏ qua EQ, preamp, ReplayGain, crossfade, cân bằng và định tuyến; âm lượng về 100% (vẫn chỉnh được); mở Web Audio đúng tần số của bài khi trình duyệt cho phép. Gapless vẫn giữ (trừ khi bài sau khác tần số).</small></div>
      <button class="switch" role="switch" aria-checked="${bp}" data-bp aria-label="Bit-perfect"><i></i></button></div>
    ${E.mode === 'direct' ? `<p class="notice">${icon('info')}<span>Đang dùng chế độ phát trực tiếp nên không đổi được tần số. Chọn Engine “Web Audio” trong Tuỳ chỉnh → Phát nếu thiết bị cho phép.</span></p>` : ''}
    <div class="mau-verdict ${p.verdict ? 'ok' : ''}">${p.verdict ? 'Trong trình duyệt: giữ nguyên bit từ tệp tới bộ trộn của hệ điều hành' : 'Tín hiệu đang bị thay đổi ở ít nhất một bước'}</div>
    <ol class="mau-path">${p.stages.map(x => `<li>${mark(x.ok)}<div><b>${esc(x.name)}</b><span class="num">${esc(x.value)}</span>${x.note ? `<small>${esc(x.note)}</small>` : ''}</div></li>`).join('')}</ol>
    <p class="hint">Định dạng: FLAC, WAV (PCM 16/24/32-bit, float), ALAC, AIFF và DSD (DSF/DFF, chuyển sang PCM 88,2/176,4 kHz) đều phát được. Trình duyệt không cho chọn chế độ độc quyền hay xuất thẳng ra USB DAC.</p>`;
  body.querySelector('[data-bp]').onclick = async (e) => {
    const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
    e.currentTarget.setAttribute('aria-checked', on);
    await player.setBitPerfect(on);
    toast(on ? 'Đã bật Bit-perfect' : 'Đã tắt Bit-perfect');
    renderPath(body);
  };
}

// ── Outputs ────────────────────────────────────────────────────
async function renderOut(body) {
  const cfg = structuredClone(prefs().audio?.out || {});
  cfg.a ||= {}; cfg.b ||= {};
  const bp = !!prefs().audio?.bitPerfect, E = player.engine, dual = cfg.mode === 'dual';
  const devs = canPickSink() ? await listOutputs() : [];
  const sinkA = prefs().playback.sinkId || '';
  const devSel = (val, attr) => `<select ${attr}>${[{ id: '', label: 'Mặc định của hệ thống' }, ...devs.filter(d => d.id)].map(d => `<option value="${esc(d.id)}" ${d.id === val ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select>`;
  const chSel = (val, attr) => `<select ${attr}>${Object.entries(CH_MODES).map(([k, v]) => `<option value="${k}" ${k === (val || 'stereo') ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`;
  const rng = (k, val, min, max, step, unit) => `<span class="mau-rng"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${+val || 0}"><output class="num" data-o="${k}">${fmt(+val || 0, unit)}</output></span>`;
  const why = MOBILE
    ? 'Trình duyệt trên Android/iOS chỉ phát ra một thiết bị âm thanh tại một thời điểm và không cho chọn hai tai nghe Bluetooth. Hãy dùng tách kênh L/R và cân bằng trên một thiết bị.'
    : !canDual() ? 'Trình duyệt này không cho chọn thiết bị ra (cần setSinkId, có trên Chrome/Edge máy tính). Tách kênh L/R và cân bằng trên một thiết bị vẫn dùng được.' : '';
  body.innerHTML = `
    ${bp ? `<p class="notice">${icon('info')}<span>Bit-perfect đang bật nên định tuyến bên dưới được bỏ qua (đi thẳng ra thiết bị). Tắt Bit-perfect để dùng.</span></p>` : ''}
    ${E.mode === 'direct' ? `<p class="notice">${icon('info')}<span>Chế độ phát trực tiếp: tách kênh và hai đầu ra cần Web Audio.</span></p>` : ''}
    <div class="seg small" role="group" aria-label="Chế độ đầu ra"><button data-mode="single" aria-pressed="${!dual}">Một thiết bị</button><button data-mode="dual" aria-pressed="${dual}" ${canDual() ? '' : 'disabled'}>Hai thiết bị cùng lúc</button></div>
    ${why ? `<p class="hint mau-why">${esc(why)}</p>` : ''}
    <section class="mau-card"><h4>${dual ? 'Đầu ra A' : 'Thiết bị ra'}</h4>
      ${canPickSink() ? `<div class="mau-row"><span>Thiết bị</span>${devSel(sinkA, 'data-sink-a')}</div>` : ''}
      <div class="mau-row"><span>Kênh</span>${chSel(cfg.a.ch, 'data-ch-a')}</div>
      <div class="mau-row"><span>Trái (L)</span>${rng('a.trimL', cfg.a.trimL, -24, 0, 0.5, 'dB')}</div>
      <div class="mau-row"><span>Phải (R)</span>${rng('a.trimR', cfg.a.trimR, -24, 0, 0.5, 'dB')}</div>
      ${dual ? `<div class="mau-row"><span>Mức</span>${rng('a.gainDb', cfg.a.gainDb, -24, 6, 0.5, 'dB')}</div><div class="mau-row"><span>Trễ</span>${rng('a.delayMs', cfg.a.delayMs, 0, 500, 5, 'ms')}</div>` : ''}
    </section>
    ${dual ? `<section class="mau-card"><h4>Đầu ra B</h4>
      <div class="mau-row"><span>Thiết bị</span>${devSel(cfg.b.sinkId, 'data-sink-b')}</div>
      <div class="mau-row"><span>Kênh</span>${chSel(cfg.b.ch, 'data-ch-b')}</div>
      <div class="mau-row"><span>Mức</span>${rng('b.gainDb', cfg.b.gainDb, -24, 6, 0.5, 'dB')}</div>
      <div class="mau-row"><span>Trễ</span>${rng('b.delayMs', cfg.b.delayMs, 0, 500, 5, 'ms')}</div></section>
      <div class="mchoices"><button class="chip" data-pre="split">L → A · R → B</button><button class="chip" data-pre="mono">Mono cho cả hai</button><button class="chip" data-pre="stereo">Stereo cho cả hai</button></div>
      <p class="hint">Hai đầu ra dùng chung một đồng hồ âm thanh. Tai nghe Bluetooth thường trễ 150–300 ms: tăng “Trễ” ở thiết bị nhanh hơn cho tới khi hai bên khớp nhau.</p>` : ''}
    <div class="row-actions">${navigator.mediaDevices?.selectAudioOutput ? `<button class="btn small" data-ask>${icon('outputs')}Chọn thiết bị khác…</button>` : ''}<button class="btn small" data-reset>Về mặc định</button></div>`;

  const save = () => player.setOutputs(structuredClone(cfg));
  body.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { cfg.mode = b.dataset.mode; save(); setTimeout(() => renderOut(body), 0); });
  body.querySelectorAll('input[data-k]').forEach(i => i.oninput = () => {
    const [side, k] = i.dataset.k.split('.');
    cfg[side][k] = +i.value;
    body.querySelector(`[data-o="${i.dataset.k}"]`).textContent = fmt(+i.value, k === 'delayMs' ? 'ms' : 'dB');
    save();
  });
  body.querySelector('[data-ch-a]').onchange = (e) => { cfg.a.ch = e.target.value; save(); };
  const chb = body.querySelector('[data-ch-b]'); if (chb) chb.onchange = (e) => { cfg.b.ch = e.target.value; save(); };
  const sb = body.querySelector('[data-sink-b]'); if (sb) sb.onchange = (e) => { cfg.b.sinkId = e.target.value; save(); };
  const sa = body.querySelector('[data-sink-a]'); if (sa) sa.onchange = (e) => setSinkA(e.target.value);
  body.querySelectorAll('[data-pre]').forEach(b => b.onclick = () => {
    const [a, bb] = { split: ['left', 'right'], mono: ['mono', 'mono'], stereo: ['stereo', 'stereo'] }[b.dataset.pre];
    cfg.a.ch = a; cfg.b.ch = bb; save(); renderOut(body);
  });
  body.querySelector('[data-reset]').onclick = () => { cfg.mode = 'single'; cfg.a = { ch: 'stereo', trimL: 0, trimR: 0, gainDb: 0, delayMs: 0 }; cfg.b = { ...cfg.b, ch: 'stereo', gainDb: 0, delayMs: 0 }; save(); renderOut(body); };
  body.querySelector('[data-ask]')?.addEventListener('click', async () => {
    try { const d = await requestOutput(); if (d) { await setSinkA(d.id); renderOut(body); } } catch (e) { if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') toast(e.message, 'warn'); }
  });
}

const fmt = (v, unit) => unit === 'ms' ? `${Math.round(v)} ms` : `${v > 0 ? '+' : ''}${(+v).toFixed(1)} dB`;

// Main output device; switches to that device's EQ profile when one is saved.
export async function setSinkA(id) {
  try { await player.engine.setOutput(id); } catch (e) { toast('Không chọn được thiết bị: ' + e.message, 'warn'); return; }
  await setPref('playback.sinkId', id);
  ambient.setSink(id);
  if (prefs().audio?.eqAutoProfile) {
    const prof = (await loadProfiles())[id || 'default'];
    if (prof) { await player.setEq({ ...prof }); toast(`Đã dùng hồ sơ EQ “${prof.name || 'Tuỳ chỉnh'}” cho thiết bị này`); }
  }
  player.dispatchEvent(new CustomEvent('audio'));
}

