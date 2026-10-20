// Timers & ambient sheet: sleep timer (time or N tracks, smart fade, tempo slowdown), workout
// intervals, Pomodoro focus, and the ambient mixer (generated rain / noise / ocean / fire / wind /
// birds under the music). Settings live in prefs.audio; running timers in lib/timers.js.
import { icon } from '../../../core/icons.js';
import { esc } from '../../../core/ui.js';
import { prefs, setPref } from '../lib/prefs.js';
import { timers, fmtLeft } from '../lib/timers.js';
import { ambient, SOUNDS } from '../lib/ambient.js';
import { sheet } from './sheets.js';
import './audio-icons.js';

const TABS = { sleep: 'Hẹn giờ ngủ', workout: 'Tập luyện', focus: 'Tập trung', ambient: 'Âm nền' };

export function timersSheet(tab = 'sleep') {
  const s = sheet({ title: 'Hẹn giờ & âm nền', wide: true, cls: 'as-timers', body: `<div class="mau">
    <div class="seg small mau-tabs" role="tablist">${Object.entries(TABS).map(([k, v]) => `<button data-tab="${k}">${v}</button>`).join('')}</div>
    <div class="mau-status" data-status hidden></div>
    <div class="mau-body"></div></div>` });
  const body = s.el.querySelector('.mau-body'), status = s.el.querySelector('[data-status]');
  let cur = tab;
  const show = (k) => { cur = k; s.el.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === k)); R[k](body, () => show(cur)); };
  s.el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab));

  const paint = () => {
    const parts = [];
    if (timers.sleep) {
      const l = timers.sleepLeft(), t = timers.sleep;
      parts.push(`<span>${icon('timer')}<b>Ngủ</b> ${t.kind === 'tracks' ? (t.tracksLeft > 1 ? `còn ${t.tracksLeft} bài` : `hết bài này${l !== Infinity ? ' · ' + fmtLeft(l) : ''}`) : fmtLeft(l)}</span>
        ${t.kind === 'minutes' ? '<button class="chip sm" data-x="plus">+10 phút</button>' : ''}<button class="chip sm" data-x="sleep">Huỷ</button>`);
    }
    if (timers.interval) {
      const iv = timers.interval, p = iv.phases[iv.i];
      parts.push(`<span>${icon(iv.kind === 'workout' ? 'workout' : 'focus')}<b>${esc(p.label)}</b> ${fmtLeft(timers.intervalLeft())}</span>
        <button class="chip sm" data-x="skip">Bỏ qua</button><button class="chip sm" data-x="iv">Dừng</button>`);
    }
    status.hidden = !parts.length;
    status.innerHTML = parts.map(p => `<div>${p}</div>`).join('');
    status.querySelectorAll('[data-x]').forEach(b => b.onclick = () => {
      ({ plus: () => timers.extendSleep(10), sleep: () => timers.stopSleep(), skip: () => timers.skipPhase(), iv: () => timers.stopInterval() })[b.dataset.x]();
      paint();
    });
  };
  const onTick = () => { if (!s.el.isConnected) return cleanup(); paint(); };
  const onChange = () => { if (!s.el.isConnected) return cleanup(); paint(); };
  const cleanup = () => { timers.removeEventListener('tick', onTick); timers.removeEventListener('change', onChange); };
  timers.addEventListener('tick', onTick); timers.addEventListener('change', onChange);
  paint(); show(cur);
  return s;
}

const num = (path, val, min, max, step, unit) => `<label class="mau-num"><input type="number" data-p="${path}" min="${min}" max="${max}" step="${step}" value="${val}" inputmode="decimal"><span>${unit}</span></label>`;
const row = (label, ctl, hint = '') => `<div class="mau-row"><div><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div>${ctl}</div>`;
const sw = (path, on) => `<button class="switch" role="switch" aria-checked="${!!on}" data-sw="${path}"><i></i></button>`;
function bindPrefs(body) {
  body.querySelectorAll('input[data-p]').forEach(i => i.onchange = () => setPref(i.dataset.p, Math.max(+i.min, Math.min(+i.max, +i.value || 0))));
  body.querySelectorAll('select[data-p]').forEach(i => i.onchange = () => setPref(i.dataset.p, +i.value));
  body.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', v); setPref(b.dataset.sw, v ? 1 : 0); });
}

const R = {
  sleep(body) {
    const o = prefs().audio.sleep;
    body.innerHTML = `<div class="mchoices">${[5, 10, 15, 20, 30, 45, 60, 90].map(m => `<button class="chip" data-m="${m}">${m} phút</button>`).join('')}</div>
      <div class="mchoices">${[1, 2, 3, 5].map(n => `<button class="chip" data-n="${n}">${n === 1 ? 'Hết bài này' : `Sau ${n} bài`}</button>`).join('')}</div>
      <div class="mau-row"><b>Tuỳ chọn</b><span class="mau-inline">${num('audio.sleep.minutes', o.minutes, 1, 600, 1, 'phút')}<button class="btn small" data-custom>Bắt đầu</button></span></div>
      <h4>Tắt dần thông minh</h4>
      ${row('Thời gian giảm âm', `<select data-p="audio.sleep.fadeSec">${[0, 10, 30, 60, 120, 300, 600].map(v => `<option value="${v}" ${v === +o.fadeSec ? 'selected' : ''}>${v ? (v < 60 ? v + ' giây' : v / 60 + ' phút') : 'Không'}</option>`).join('')}</select>`, 'Âm lượng hạ mượt theo đường cong trước khi dừng')}
      ${row('Chậm nhịp dần', sw('audio.sleep.slow', o.slow), 'Tốc độ giảm dần tới 85% (giữ cao độ) trong lúc giảm âm')}
      ${row('Tắt cả âm nền', sw('audio.sleep.ambient', o.ambient), 'Âm nền cũng nhỏ dần và tắt cùng nhạc')}`;
    bindPrefs(body);
    body.querySelectorAll('[data-m]').forEach(b => b.onclick = () => timers.startSleep({ minutes: +b.dataset.m }));
    body.querySelectorAll('[data-n]').forEach(b => b.onclick = () => timers.startSleep({ tracks: +b.dataset.n }));
    body.querySelector('[data-custom]').onclick = () => timers.startSleep({ minutes: Math.max(1, +body.querySelector('[data-p="audio.sleep.minutes"]').value || 30) });
  },
  workout(body) {
    const o = prefs().audio.workout;
    body.innerHTML = `${row('Tập', num('audio.workout.work', o.work, 5, 3600, 5, 'giây'))}
      ${row('Nghỉ', num('audio.workout.rest', o.rest, 0, 3600, 5, 'giây'))}
      ${row('Số hiệp', num('audio.workout.rounds', o.rounds, 1, 99, 1, 'hiệp'))}
      ${row('Tăng nhịp khi tập', `<select data-p="audio.workout.boost">${[1, 1.03, 1.06, 1.1, 1.15].map(v => `<option value="${v}" ${v === +o.boost ? 'selected' : ''}>${v === 1 ? 'Không' : '+' + Math.round((v - 1) * 100) + '%'}</option>`).join('')}</select>`, 'Nhạc nhanh hơn một chút trong hiệp tập (giữ cao độ)')}
      ${row('Âm lượng khi nghỉ', `<select data-p="audio.workout.restDuck">${[1, 0.7, 0.5, 0.3, 0].map(v => `<option value="${v}" ${v === +o.restDuck ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}</select>`)}
      ${row('Chuông báo', sw('audio.workout.chime', o.chime))}
      <div class="row-actions"><button class="btn primary" data-go>${icon('workout')}Bắt đầu tập</button></div>`;
    bindPrefs(body);
    body.querySelector('[data-go]').onclick = () => setTimeout(() => timers.startWorkout(), 50);
  },
  focus(body) {
    const o = prefs().audio.focus;
    body.innerHTML = `${row('Tập trung', num('audio.focus.work', o.work, 1, 180, 1, 'phút'))}
      ${row('Nghỉ ngắn', num('audio.focus.short', o.short, 1, 60, 1, 'phút'))}
      ${row('Nghỉ dài', num('audio.focus.long', o.long, 1, 120, 1, 'phút'))}
      ${row('Số phiên', num('audio.focus.cycles', o.cycles, 1, 12, 1, 'phiên'))}
      ${row('Tạm dừng nhạc khi nghỉ', sw('audio.focus.pauseOnBreak', o.pauseOnBreak))}
      ${row('Chuông báo', sw('audio.focus.chime', o.chime))}
      <div class="row-actions"><button class="btn primary" data-go>${icon('focus')}Bắt đầu Pomodoro</button></div>`;
    bindPrefs(body);
    body.querySelector('[data-go]').onclick = () => setTimeout(() => timers.startFocus(), 50);
  },
  ambient(body) {
    const a = prefs().audio.ambient;
    ambient.setMaster(a.master ?? 0.6);
    const lv = (id) => ambient.level(id);
    body.innerHTML = `<p class="hint">Âm được tạo ngay trong máy (không tải tệp), phát dưới nhạc, không đi qua EQ. Kéo để bật và chỉnh từng âm.</p>
      <div class="mau-mix">${Object.entries(SOUNDS).map(([id, x]) => `<div class="mau-snd${lv(id) ? ' on' : ''}" data-snd="${id}">
        <button class="mau-snd-b" data-tog aria-pressed="${!!lv(id)}">${icon('wave')}<span>${esc(x.label)}</span></button>
        <input type="range" min="0" max="100" value="${Math.round((lv(id) || +a.levels?.[id] || 0) * 100)}" aria-label="${esc(x.label)}"></div>`).join('')}</div>
      ${row('Âm lượng âm nền', `<input type="range" min="0" max="100" value="${Math.round(a.master * 100)}" data-master aria-label="Âm lượng âm nền" class="mau-wide">`)}
      <div class="row-actions"><button class="btn small" data-stop>Tắt hết</button></div>`;
    const store = () => { clearTimeout(R._st); R._st = setTimeout(() => setPref('audio.ambient.levels', Object.fromEntries(ambient.active.map(id => [id, ambient.level(id)]))), 400); };
    body.querySelectorAll('[data-snd]').forEach(el => {
      const id = el.dataset.snd, r = el.querySelector('input'), b = el.querySelector('[data-tog]');
      const paint = () => { const on = !!ambient.level(id); el.classList.toggle('on', on); b.setAttribute('aria-pressed', on); };
      r.oninput = () => { ambient.set(id, r.value / 100); paint(); store(); };
      b.onclick = () => {
        if (ambient.level(id)) ambient.set(id, 0);
        else { const v = +r.value || 50; r.value = v; ambient.set(id, v / 100); }
        paint(); store();
      };
    });
    body.querySelector('[data-master]').oninput = (e) => { ambient.setMaster(e.target.value / 100); clearTimeout(R._mt); R._mt = setTimeout(() => setPref('audio.ambient.master', +e.target.value / 100), 400); };
    body.querySelector('[data-stop]').onclick = () => { ambient.stopAll(); setPref('audio.ambient.levels', {}); R.ambient(body); };
  },
};

