// EQ panel: response curve with draggable band handles (drag = frequency/gain, wheel or
// pinch-slider = Q), graphic 10-band sliders, a 31-band 1/3-octave graphic EQ (touch sliders in a
// horizontally scrolling strip), band list for exact values, presets (built-in, user, AutoEQ
// import/export) and per-output profiles (headphones vs speakers keep their own curve).
import { icon } from '../../../core/icons.js';
import { toast, saveJson, confirmBox } from '../../../core/ui.js';
import { player } from '../lib/player.js';
import { TYPES, GRAPHIC_FREQS, allPresets, savePreset, deletePreset, parseAutoEq, toAutoEq, response, logFreqs, effectivePreamp, toG31, G31_MAX, loadProfiles, saveProfile, deleteProfile, activeBands } from '../lib/eq.js';
import { prefs } from '../lib/prefs.js';
import './audio-icons.js';
import { sheet, menu, ask } from './sheets.js';

const FMIN = 20, FMAX = 20000, GMAX = 15;
const fx = (f, w) => Math.log(f / FMIN) / Math.log(FMAX / FMIN) * w;
const xf = (x, w) => FMIN * Math.pow(FMAX / FMIN, x / w);
const gy = (g, h) => h / 2 - g / GMAX * (h / 2 - 10);
const yg = (y, h) => (h / 2 - y) / (h / 2 - 10) * GMAX;
const fLabel = (f) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1).replace('.0', '') + 'k' : Math.round(f) + '';

export function eqSheet() {
  let st = structuredClone(player.eq);
  const s = sheet({ title: 'Bộ chỉnh âm', wide: true, cls: 'as-eq', actions: `<button class="icon-btn" data-hires aria-label="Đường tín hiệu & Hi-Res" title="Đường tín hiệu & Hi-Res">${icon('hires')}</button><button class="switch" role="switch" aria-checked="${!!st.enabled}" data-on aria-label="Bật EQ"><i></i></button>`, body: `
    <div class="meq">
      <div class="meq-bar">
        <button class="btn small" data-presets>${icon('sliders')}<span data-pname></span>${icon('chev-down')}</button>
        <div class="seg small" role="group" aria-label="Chế độ"><button data-mode="graphic">10 dải</button><button data-mode="g31">31 dải</button><button data-mode="parametric">Tham số</button></div>
      </div>
      <div class="meq-graph"><canvas></canvas><div class="meq-handles"></div></div>
      <div class="meq-graphic" data-gfx></div>
      <div class="g31" data-g31></div>
      <div class="meq-bands" data-bands></div>
      <div class="meq-pre">
        <label>Preamp <span class="num" data-prev></span><input type="range" min="-24" max="6" step="0.1" data-pre></label>
        <label class="check"><input type="checkbox" data-auto> Tự hạ preamp để không vỡ tiếng</label>
      </div>
      <p class="hint" data-hint></p>
    </div>` });
  const root = s.el.querySelector('.meq');
  const cv = root.querySelector('canvas'), handles = root.querySelector('.meq-handles');
  let sel = 0;

  const commit = () => { player.setEq(st); draw(); };
  const changed = () => { st.presetId = null; st.name = 'Tuỳ chỉnh'; commit(); paintMeta(); };

  function paintMeta() {
    s.el.querySelector('[data-on]').setAttribute('aria-checked', !!st.enabled);
    root.dataset.on = st.enabled ? '1' : '0';
    root.dataset.mode = st.mode;
    root.querySelector('[data-pname]').textContent = st.name || 'Tuỳ chỉnh';
    root.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === st.mode));
    root.querySelector('[data-pre]').value = st.preamp;
    root.querySelector('[data-auto]').checked = !!st.autoPreamp;
    const eff = effectivePreamp(st);
    root.querySelector('[data-prev]').textContent = `${st.preamp.toFixed(1)} dB${st.autoPreamp && eff < st.preamp ? ` (đang dùng ${eff.toFixed(1)})` : ''}`;
    root.querySelector('[data-hint]').textContent = player.engine.mode === 'direct'
      ? 'Đang phát trực tiếp (không Web Audio) nên EQ không có tác dụng. Đổi Engine trong Tuỳ chỉnh → Phát.'
      : prefs().audio?.bitPerfect ? 'Bit-perfect đang bật: EQ, preamp và ReplayGain đều được bỏ qua. Tắt Bit-perfect để nghe EQ.'
      : st.mode === 'g31' ? `31 dải 1/3 quãng tám (ISO), ±${G31_MAX} dB. Kéo dọc để chỉnh, vuốt ngang để cuộn, chạm đúp để về 0. Dải ở 0 dB không tốn CPU (đang dùng ${activeBands(st.bands).length} bộ lọc).`
      : st.mode === 'graphic' ? 'Kéo thanh trượt để chỉnh từng dải. Chuyển sang Tham số để thêm dải, đổi loại bộ lọc và Q.' : 'Kéo chấm trên đồ thị: ngang = tần số, dọc = mức. Lăn chuột trên chấm để đổi Q. Có thể dán preset AutoEQ cho tai nghe của bạn.';
  }

  function draw() {
    const w = cv.offsetWidth, hh = cv.offsetHeight, dpr = devicePixelRatio || 1;
    if (!w) return;
    cv.width = w * dpr; cv.height = hh * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(root);
    const line = css.getPropertyValue('--line').trim(), muted = css.getPropertyValue('--muted').trim(), acc = css.getPropertyValue('--accent').trim();
    g.clearRect(0, 0, w, hh);
    g.font = '10px ' + css.getPropertyValue('--font-mono');
    g.fillStyle = muted; g.strokeStyle = line; g.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = Math.round(fx(f, w)) + .5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke(); g.fillText(fLabel(f), x + 3, hh - 4); }
    for (const db of [-12, -6, 0, 6, 12]) { const y = Math.round(gy(db, hh)) + .5; g.globalAlpha = db === 0 ? 1 : .6; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.globalAlpha = 1; g.fillText((db > 0 ? '+' : '') + db, 3, y - 3); }
    const freqs = logFreqs(Math.max(64, Math.floor(w / 2)));
    const r = response(st.bands, freqs);
    const pre = effectivePreamp(st);
    g.beginPath();
    for (let i = 0; i < freqs.length; i++) { const x = fx(freqs[i], w), y = gy(r[i] + pre, hh); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = acc; g.lineWidth = 2.2; g.globalAlpha = st.enabled ? 1 : .4; g.stroke();
    g.lineTo(w, gy(0, hh)); g.lineTo(0, gy(0, hh)); g.closePath();
    g.fillStyle = acc; g.globalAlpha = st.enabled ? .12 : .05; g.fill(); g.globalAlpha = 1;
    // Handles
    handles.innerHTML = st.mode === 'g31' ? '' : st.bands.map((b, i) => `<button class="meq-h${i === sel ? ' sel' : ''}${b.on ? '' : ' off'}" data-h="${i}" style="left:${fx(b.freq, w)}px;top:${gy(['lowpass', 'highpass', 'notch'].includes(b.type) ? 0 : b.gain, hh)}px" aria-label="Dải ${i + 1}">${i + 1}</button>`).join('');
    handles.querySelectorAll('[data-h]').forEach(hd => dragHandle(hd, +hd.dataset.h, w, hh));
  }

  function dragHandle(hd, i, w, hh) {
    hd.onpointerdown = (e) => {
      e.preventDefault(); sel = i; renderBands();
      if (st.mode === 'graphic') { hd.setPointerCapture(e.pointerId); }
      hd.setPointerCapture(e.pointerId);
      const box = cv.getBoundingClientRect();
      hd.onpointermove = (ev) => {
        const b = st.bands[i];
        if (st.mode !== 'graphic') b.freq = Math.round(Math.min(FMAX, Math.max(FMIN, xf(ev.clientX - box.left, w))));
        if (!['lowpass', 'highpass', 'notch'].includes(b.type)) b.gain = Math.round(Math.max(-GMAX, Math.min(GMAX, yg(ev.clientY - box.top, hh))) * 10) / 10;
        changed(); renderBands(); renderGraphic();
      };
      hd.onpointerup = () => { hd.onpointermove = hd.onpointerup = null; };
    };
    hd.onwheel = (e) => {
      if (st.mode === 'graphic') return;
      e.preventDefault();
      const b = st.bands[i];
      b.q = Math.round(Math.max(0.1, Math.min(12, b.q * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) * 100) / 100;
      changed(); renderBands();
    };
  }

  // 31-band strip: pointer-driven vertical sliders (touch-action: pan-x keeps the strip
  // scrollable sideways); the engine is updated at most once per frame while dragging.
  let raf = 0;
  const commitSoon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; changed(); }); };
  function renderG31() {
    const box = root.querySelector('[data-g31]');
    if (st.mode !== 'g31') { box.innerHTML = ''; return; }
    if (box.children.length !== st.bands.length) {
      box.innerHTML = st.bands.map((b, i) => `<div class="g31-b"><output class="num" data-v="${i}"></output>
        <div class="g31-t" role="slider" tabindex="0" data-s="${i}" aria-label="${fLabel(b.freq)} Hz" aria-valuemin="${-G31_MAX}" aria-valuemax="${G31_MAX}"><i></i><b></b></div>
        <span class="num">${fLabel(b.freq)}</span></div>`).join('');
      box.querySelectorAll('[data-s]').forEach(tr => {
        const i = +tr.dataset.s;
        const setY = (y) => {
          const r = tr.getBoundingClientRect();
          const p = 1 - Math.max(0, Math.min(1, (y - r.top) / r.height));
          const v = Math.round((p * 2 - 1) * G31_MAX * 2) / 2;
          if (v !== st.bands[i].gain) { st.bands[i].gain = v; if (!st.enabled) { st.enabled = 1; paintMeta(); } paintG31(i); commitSoon(); }
        };
        tr.onpointerdown = (e) => {
          if (e.button) return;
          tr.setPointerCapture(e.pointerId); tr.classList.add('drag');
          setY(e.clientY);
          tr.onpointermove = (ev) => setY(ev.clientY);
          tr.onpointerup = tr.onpointercancel = () => { tr.classList.remove('drag'); tr.onpointermove = tr.onpointerup = tr.onpointercancel = null; paintMeta(); };
        };
        tr.ondblclick = () => { st.bands[i].gain = 0; paintG31(i); changed(); };
        tr.onkeydown = (e) => {
          const d = { ArrowUp: 0.5, ArrowRight: 0.5, ArrowDown: -0.5, ArrowLeft: -0.5, PageUp: 3, PageDown: -3 }[e.key];
          if (e.key === 'Home' || e.key === '0') st.bands[i].gain = 0; else if (d) st.bands[i].gain = Math.max(-G31_MAX, Math.min(G31_MAX, st.bands[i].gain + d)); else return;
          e.preventDefault(); paintG31(i); commitSoon();
        };
      });
    }
    st.bands.forEach((b, i) => paintG31(i));
  }
  function paintG31(i) {
    const box = root.querySelector('[data-g31]'), b = st.bands[i];
    const tr = box.querySelector(`[data-s="${i}"]`);
    if (!tr) return;
    tr.style.setProperty('--p', ((b.gain / G31_MAX + 1) / 2).toFixed(4));
    tr.setAttribute('aria-valuenow', b.gain);
    tr.classList.toggle('nz', !!b.gain);
    box.querySelector(`[data-v="${i}"]`).textContent = b.gain ? (b.gain > 0 ? '+' : '') + b.gain : '0';
  }

  function renderGraphic() {
    renderG31();
    const box = root.querySelector('[data-gfx]');
    if (st.mode !== 'graphic') { box.innerHTML = ''; return; }
    if (!box.children.length) {
      box.innerHTML = st.bands.map((b, i) => `<label class="meq-gs"><span class="num" data-gv="${i}"></span><input type="range" min="-12" max="12" step="0.5" data-g="${i}" aria-label="${fLabel(b.freq)} Hz" orient="vertical"><span class="num">${fLabel(b.freq)}</span></label>`).join('');
      box.querySelectorAll('[data-g]').forEach(r => r.oninput = () => { st.bands[+r.dataset.g].gain = +r.value; changed(); renderGraphic(); });
    }
    st.bands.forEach((b, i) => {
      const r = box.querySelector(`[data-g="${i}"]`); if (r && +r.value !== b.gain) r.value = b.gain;
      box.querySelector(`[data-gv="${i}"]`).textContent = (b.gain > 0 ? '+' : '') + b.gain;
    });
  }

  function renderBands() {
    const box = root.querySelector('[data-bands]');
    if (st.mode !== 'parametric') { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="meq-list">${st.bands.map((b, i) => `<div class="meq-band${i === sel ? ' sel' : ''}" data-b="${i}">
        <button class="switch sm" role="switch" aria-checked="${!!b.on}" data-bon aria-label="Bật dải ${i + 1}"><i></i></button>
        <b class="num">${i + 1}</b>
        <select data-k="type" aria-label="Loại">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === b.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label><span>Hz</span><input type="number" data-k="freq" min="20" max="20000" step="1" value="${Math.round(b.freq)}"></label>
        <label><span>dB</span><input type="number" data-k="gain" min="-24" max="24" step="0.1" value="${b.gain}" ${['lowpass', 'highpass', 'notch'].includes(b.type) ? 'disabled' : ''}></label>
        <label><span>Q</span><input type="number" data-k="q" min="0.1" max="20" step="0.01" value="${b.q}" ${['lowshelf', 'highshelf'].includes(b.type) ? 'disabled title="Bộ lọc kệ của trình duyệt dùng độ dốc cố định"' : ''}></label>
        <button class="icon-btn sm" data-del aria-label="Xoá dải">${icon('trash')}</button></div>`).join('')}</div>
      <button class="btn small" data-add ${st.bands.length >= 16 ? 'disabled' : ''}>${icon('plus')}Thêm dải</button>`;
    box.querySelectorAll('[data-b]').forEach(row => {
      const i = +row.dataset.b, b = st.bands[i];
      row.onfocusin = () => { if (sel !== i) { sel = i; draw(); row.parentElement.querySelectorAll('.meq-band').forEach(r => r.classList.toggle('sel', r === row)); } };
      row.querySelector('[data-bon]').onclick = (e) => { b.on = b.on ? 0 : 1; e.currentTarget.setAttribute('aria-checked', !!b.on); changed(); };
      row.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => { b[inp.dataset.k] = inp.dataset.k === 'type' ? inp.value : +inp.value; changed(); renderBands(); });
      row.querySelector('[data-del]').onclick = () => { st.bands.splice(i, 1); sel = Math.max(0, sel - 1); changed(); renderBands(); };
    });
    box.querySelector('[data-add]').onclick = () => { st.bands.push({ type: 'peaking', freq: 1000, gain: 0, q: 1, on: 1 }); sel = st.bands.length - 1; changed(); renderBands(); };
  }

  s.el.querySelector('[data-hires]').onclick = () => import('./audio-panel.js').then(m => m.audioSheet());
  s.el.querySelector('[data-on]').onclick = () => { st.enabled = st.enabled ? 0 : 1; commit(); paintMeta(); };
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    if (b.dataset.mode === st.mode) return;
    if (b.dataset.mode === 'graphic') {
      // Sample the current curve at the 10 graphic frequencies.
      const r = response(st.bands, new Float32Array(GRAPHIC_FREQS));
      st.bands = GRAPHIC_FREQS.map((f, i) => ({ type: 'peaking', freq: f, gain: Math.round(Math.max(-12, Math.min(12, r[i])) * 2) / 2, q: 1.41, on: 1 }));
    } else if (b.dataset.mode === 'g31') st.bands = toG31(st.bands);
    root.querySelector('[data-g31]').innerHTML = '';
    st.mode = b.dataset.mode; sel = 0;
    root.querySelector('[data-gfx]').innerHTML = '';
    changed(); renderGraphic(); renderBands();
  });
  root.querySelector('[data-pre]').oninput = (e) => { st.preamp = +e.target.value; commit(); paintMeta(); };
  root.querySelector('[data-auto]').onchange = (e) => { st.autoPreamp = e.target.checked ? 1 : 0; commit(); paintMeta(); };
  root.querySelector('[data-presets]').onclick = async (e) => {
    const list = await allPresets();
    const load = (p) => { st = { ...st, enabled: 1, presetId: p.id, name: p.name, mode: p.mode, preamp: p.preamp, bands: structuredClone(p.bands) }; root.querySelector('[data-gfx]').innerHTML = ''; root.querySelector('[data-g31]').innerHTML = ''; sel = 0; commit(); paintMeta(); renderGraphic(); renderBands(); };
    const outKey = prefs().playback.sinkId || 'default', profiles = await loadProfiles();
    menu(e.currentTarget, [
      ...list.filter(p => !p.builtin || p.mode !== 'g31' || st.mode === 'g31').map(p => ({ icon: p.builtin ? 'sliders' : 'star', label: p.name + (p.id === st.presetId ? ' ✓' : ''), act: () => load(p) })),
      '-',
      { icon: 'plus', label: 'Lưu thành preset…', act: async () => { const n = await ask('Tên preset', st.name === 'Tuỳ chỉnh' ? 'Preset của tôi' : st.name); if (n) { const p = await savePreset(n, st); st.presetId = p.id; st.name = n; commit(); paintMeta(); toast('Đã lưu preset (đồng bộ mọi thiết bị)'); } } },
      { icon: 'device', label: profiles[outKey] ? 'Cập nhật hồ sơ cho thiết bị ra này' : 'Lưu làm hồ sơ cho thiết bị ra này', hint: 'Tự dùng lại khi chọn thiết bị ra này', act: async () => { await saveProfile(outKey, st); toast('Đã lưu hồ sơ EQ cho thiết bị ra hiện tại'); } },
      profiles[outKey] ? { icon: 'x', label: 'Bỏ hồ sơ của thiết bị ra này', act: async () => { await deleteProfile(outKey); toast('Đã bỏ hồ sơ EQ'); } } : null,
      { icon: 'upload', label: 'Nhập AutoEQ / Equalizer APO…', act: () => importAutoEq(load) },
      { icon: 'download', label: 'Xuất preset (AutoEQ + JSON)', act: () => saveJson(`eq-${(st.name || 'preset').replace(/\W+/g, '-')}.json`, { format: 'my-hub-eq', version: 1, name: st.name, mode: st.mode, preamp: st.preamp, bands: st.bands, autoeq: toAutoEq(st) }) },
      st.presetId && !list.find(p => p.id === st.presetId)?.builtin ? { icon: 'trash', label: 'Xoá preset này', danger: true, act: async () => { if (await confirmBox('Xoá preset?', st.name, 'Xoá')) { await deletePreset(st.presetId); st.presetId = null; paintMeta(); } } } : null,
    ], { title: 'Preset EQ' });
  };

  paintMeta(); renderGraphic(); renderBands();
  requestAnimationFrame(draw);
  const ro = new ResizeObserver(() => draw());
  ro.observe(cv);
}

async function importAutoEq(load) {
  const s = sheet({ title: 'Nhập preset', body: `<form class="stack"><p class="muted">Dán nội dung <code>ParametricEQ.txt</code> từ AutoEQ, cấu hình Equalizer APO, hoặc JSON xuất từ app này.</p>
    <textarea class="code" rows="9" placeholder="Preamp: -6.4 dB&#10;Filter 1: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.71&#10;Filter 2: ON PK Fc 2600 Hz Gain -3.1 dB Q 1.80"></textarea>
    <label class="btn small">${icon('upload')}Chọn tệp<input type="file" accept=".txt,.json" hidden></label>
    <div class="row-actions"><button class="btn primary">Nhập</button></div></form>` });
  const ta = s.el.querySelector('textarea');
  s.el.querySelector('input[type=file]').onchange = async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); };
  s.el.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    try {
      const txt = ta.value.trim();
      let p;
      if (txt.startsWith('{')) { const j = JSON.parse(txt); if (j.format !== 'my-hub-eq') throw new Error('JSON không phải preset EQ.'); p = j; }
      else p = parseAutoEq(txt);
      load({ id: null, name: p.name || 'AutoEQ', mode: 'parametric', preamp: p.preamp, bands: p.bands.slice(0, 16) });
      s.close(); toast(`Đã nhập ${p.bands.length} dải`);
    } catch (err) { toast(err.message, 'error'); }
  };
}
