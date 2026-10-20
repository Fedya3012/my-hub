// Background tasks with visible progress (sync, uploads, downloads, imports, decoding, exports…).
// Any module or core service reports long work here; a small tray shows every running task with
// a progress bar, percent, speed / time left and a cancel button when the task allows it.
//
//   const t = tasks.start({ label: 'Đang tải lên Drive', total: bytes, unit: 'bytes', onCancel });
//   t.update({ done, total, detail: 'bai-hat.flac' });   // or t.step(n) to add n
//   t.finish('Đã tải lên 3 tệp');                       // or t.fail(error)
//   await tasks.run({ label }, async (t) => { ... });    // start + finish/fail around a function
//
// unit: 'items' (default, shows "3 / 10"), 'bytes' (shows MB and speed), 'percent' (done is 0–100).
// Without a total the bar is indeterminate. Events: bus 'tasks:changed' with the list.
//
// Extra options (all optional):
//   delay: ms      stay hidden this long; a task that ends sooner never shows (no flashing).
//   quiet: true    never shown unless it fails (background work); update({ quiet: false }) reveals it.
//   cancellable    show the cancel button even without onCancel. handle.signal (an AbortSignal)
//                  is aborted on cancel either way, so fetch / XHR / loops can stop;
//                  handle.check() throws an AbortError once cancelled.
import { bus } from './bus.js';
import { icon } from './icons.js';

const list = new Map();
let seq = 0, trayEl = null, open = false, raf = 0, shape = '';
// Minimized tray: a small floating ring (remembered on this device), draggable to any screen edge.
const LS_MIN = 'hub.tasks.min', LS_POS = 'hub.tasks.pos';
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
let minimized = !!lsGet(LS_MIN, false), lastFailed = 0;

function notify() {
  bus.emit('tasks:changed', [...list.values()].map(snapshot));
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; renderTray(); });
}

function snapshot(t) {
  const { id, label, detail, done, total, unit, state, error, startedAt, quiet } = t;
  return { id, label, detail, done, total, unit, state, error, startedAt, quiet, percent: pct(t) };
}
const pct = (t) => t.unit === 'percent' ? Math.max(0, Math.min(100, t.done)) : t.total ? Math.max(0, Math.min(100, t.done / t.total * 100)) : null;
const visible = (t) => t.state === 'failed' || (!t.quiet && (t.shown || performance.now() >= t.showAt));
const canCancel = (t) => !!(t.onCancel || t.cancellable);

export function abortError() {
  try { return new DOMException('Đã huỷ', 'AbortError'); }
  catch { return Object.assign(new Error('Đã huỷ'), { name: 'AbortError' }); }
}

export const tasks = {
  start({ label, detail = '', total = 0, unit = 'items', onCancel = null, quiet = false, delay = 0, cancellable = false } = {}) {
    const ctl = new AbortController();
    const at = performance.now();
    const t = { id: ++seq, label, detail, done: 0, total, unit, onCancel, cancellable, quiet, ctl, state: 'running', startedAt: at, showAt: at + delay, shown: false, samples: [] };
    list.set(t.id, t);
    if (delay > 0) setTimeout(notify, delay + 20);
    notify();
    const handle = {
      id: t.id,
      signal: ctl.signal,
      get cancelled() { return t.state === 'cancelled'; },
      get running() { return t.state === 'running'; },
      update(p = {}) {
        if (t.state !== 'running') return handle;
        if (p.total != null && p.total !== t.total) { t.total = p.total; t.samples = []; }
        if (p.label != null && p.label !== t.label) { t.label = p.label; t.samples = []; }
        if (p.unit != null && p.unit !== t.unit) { t.unit = p.unit; t.samples = []; }
        if (p.done != null) t.done = p.done;
        if (p.detail != null) t.detail = p.detail;
        if (p.quiet != null) t.quiet = !!p.quiet;
        t.samples.push([performance.now(), t.done]);
        if (t.samples.length > 20) t.samples.shift();
        notify();
        return handle;
      },
      step(n = 1, detail) { return handle.update({ done: t.done + n, detail }); },
      check() { if (t.state === 'cancelled') throw abortError(); },
      finish(msg) {
        if (t.state !== 'running') return;
        t.state = 'done'; t.detail = msg || t.detail; if (t.total) t.done = t.total; if (t.unit === 'percent') t.done = 100;
        // Never on screen (ended inside its delay, or quiet): drop it now instead of flashing "done".
        if (!t.shown) { list.delete(t.id); notify(); return; }
        notify();
        setTimeout(() => { list.delete(t.id); notify(); }, 2600);
      },
      fail(err) {
        if (t.state !== 'running') return;
        t.state = 'failed'; t.error = err?.message || String(err || 'Lỗi');
        open = true; notify();
      },
    };
    return handle;
  },

  async run(opts, fn) {
    const t = tasks.start(opts);
    try { const r = await fn(t); t.finish(); return r; }
    catch (e) { if (!t.cancelled) t.fail(e); throw e; }
  },

  cancel(id) {
    const t = list.get(id);
    if (!t || t.state !== 'running') return;
    t.state = 'cancelled'; t.detail = 'Đã huỷ';
    try { t.ctl.abort(abortError()); } catch { /* ignore */ }
    try { t.onCancel?.(); } catch (e) { console.error(e); }
    notify();
    setTimeout(() => { list.delete(id); notify(); }, 1500);
  },

  dismiss(id) { list.delete(id); notify(); },
  all: () => [...list.values()].map(snapshot),
  get busy() { return [...list.values()].some(t => t.state === 'running'); },
};

// ── Formatting ─────────────────────────────────────────────────
const mb = (b) => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(0, Math.round(b / 1e3)) + ' KB';
function rate(t) {
  const s = t.samples;
  if (s.length < 2) return 0;
  const [t0, d0] = s[0], [t1, d1] = s[s.length - 1];
  return t1 > t0 && d1 > d0 ? (d1 - d0) / ((t1 - t0) / 1000) : 0;
}
function eta(t) {
  const r = rate(t), p = pct(t);
  if (!r || p == null || p >= 100) return '';
  const left = t.unit === 'percent' ? (100 - t.done) / r : (t.total - t.done) / r;
  if (!isFinite(left) || left < 1) return '';
  return left < 60 ? `còn ${Math.ceil(left)} giây` : `còn ${Math.ceil(left / 60)} phút`;
}
function amount(t) {
  if (t.unit === 'bytes') return t.total ? `${mb(t.done)} / ${mb(t.total)}` : mb(t.done);
  if (t.unit === 'percent') return '';
  return t.total ? `${t.done} / ${t.total}` : t.done ? String(t.done) : '';
}

// ── Tray ───────────────────────────────────────────────────────
// The markup is rebuilt only when the tray's structure changes (tasks added / removed, state,
// opened / closed). Progress ticks patch text and bar widths in place, so a click on "Huỷ"
// is never lost to a re-render and keyboard focus stays put.
function renderTray() {
  const shown = [...list.values()].filter(visible);
  if (!shown.length) { trayEl?.remove(); trayEl = null; open = false; shape = ''; return; }
  shown.forEach(t => { t.shown = true; });
  if (!trayEl) {
    trayEl = document.createElement('section');
    trayEl.className = 'task-tray';
    trayEl.setAttribute('aria-label', 'Tác vụ đang chạy');
    trayEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.minimize != null) { setMinimized(true); return; }
      if (b.dataset.restore != null) { if (trayEl._dragged) { trayEl._dragged = false; return; } setMinimized(false); trayEl.querySelector('[data-minimize]')?.focus(); return; }
      if (b.dataset.toggle != null) { open = !open; renderTray(); }
      else if (b.dataset.cancel) tasks.cancel(+b.dataset.cancel);
      else if (b.dataset.dismiss) tasks.dismiss(+b.dataset.dismiss);
    });
    bindBubbleDrag(trayEl);
    document.body.appendChild(trayEl);
    shape = '';
  }
  const running = shown.filter(t => t.state === 'running');
  const failed = shown.filter(t => t.state === 'failed');
  const known = running.filter(t => pct(t) != null);
  const overall = known.length ? known.reduce((s, t) => s + pct(t), 0) / known.length : null;
  const head = running.length
    ? (running.length === 1 ? running[0].label : `${running.length} tác vụ đang chạy`)
    : failed.length ? `${failed.length} tác vụ lỗi` : 'Đã xong';
  trayEl.dataset.state = running.length ? 'running' : failed.length ? 'failed' : 'done';
  // Auto-expand only when something fails.
  if (failed.length > lastFailed && minimized) { minimized = false; lsSet(LS_MIN, false); }
  lastFailed = failed.length;
  trayEl.classList.toggle('min', minimized);
  if (minimized) { renderBubble(running, failed, overall); return; }
  clearBubblePos();

  const next = JSON.stringify(['full', open, running.length > 0, failed.length, overall != null,
    open ? shown.map(t => [t.id, t.state, canCancel(t), pct(t) != null]) : 0]);
  if (next !== shape) {
    shape = next;
    trayEl.innerHTML = `
    <div class="task-top"><button class="task-head" data-toggle aria-expanded="${open}">
      <span class="task-ic">${running.length ? '<i class="task-spin"></i>' : icon(failed.length ? 'x' : 'check')}</span>
      <span class="task-head-t" data-f="head"></span>
      ${overall != null && running.length ? '<span class="task-pct num" data-f="pct"></span>' : ''}
      <span class="task-chev">${icon(open ? 'x' : 'list')}</span>
      ${running.length ? `<span class="task-mini"><i data-f="mini" class="${overall == null ? 'indet' : ''}"></i></span>` : ''}
    </button><button class="icon-btn sm task-minbtn" data-minimize aria-label="Thu nhỏ thành vòng tròn" title="Thu nhỏ">${icon('chev-down')}</button></div>
    ${open ? `<ul class="task-list">${shown.map(t => {
      const p = pct(t);
      return `<li class="task-i" data-state="${t.state}" data-id="${t.id}">
        <div class="task-row"><b data-f="label"></b>${p != null && t.state === 'running' ? '<span class="num" data-f="p"></span>' : ''}
          ${t.state === 'running' && canCancel(t) ? `<button class="icon-btn sm" data-cancel="${t.id}" aria-label="Huỷ">${icon('x')}</button>` : ''}
          ${t.state === 'failed' ? `<button class="icon-btn sm" data-dismiss="${t.id}" aria-label="Đóng">${icon('x')}</button>` : ''}</div>
        <div class="task-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i class="${p == null && t.state === 'running' ? 'indet' : ''}"></i></div>
        <small class="task-d"><span data-f="detail"></span> <span class="num" data-f="meta"></span></small></li>`;
    }).join('')}</ul>` : ''}`;
  }

  const set = (root, f, text) => { const el = root.querySelector(`[data-f="${f}"]`); if (el && el.textContent !== text) el.textContent = text; };
  set(trayEl, 'head', head);
  set(trayEl, 'pct', overall != null ? Math.floor(overall) + '%' : '');
  const mini = trayEl.querySelector('[data-f="mini"]');
  if (mini && overall != null) mini.style.width = overall + '%';
  if (!open) return;
  for (const t of shown) {
    const li = trayEl.querySelector(`.task-i[data-id="${t.id}"]`);
    if (!li) continue;
    const p = pct(t);
    set(li, 'label', t.label || '');
    set(li, 'p', p != null ? Math.floor(p) + '%' : '');
    li.querySelector('[data-cancel]')?.setAttribute('aria-label', 'Huỷ ' + (t.label || ''));
    li.querySelector('.task-bar i').style.width = p != null ? p + '%' : t.state !== 'running' ? '100%' : '';
    if (p != null) li.querySelector('.task-bar').setAttribute('aria-valuenow', Math.floor(p));
    set(li, 'detail', t.state === 'failed' ? t.error : t.detail || '');
    set(li, 'meta', t.state !== 'running' ? '' : [amount(t), t.unit === 'bytes' && rate(t) ? mb(rate(t)) + '/s' : '', eta(t)].filter(Boolean).join(' · '));
  }
}

// ── Minimized bubble ───────────────────────────────────────────
function setMinimized(on) { minimized = on; lsSet(LS_MIN, on); shape = ''; renderTray(); }
const R = 19, CIRC = 2 * Math.PI * R;
function renderBubble(running, failed, overall) {
  const state = running.length ? 'running' : failed.length ? 'failed' : 'done';
  const next = JSON.stringify(['min', state, overall == null, running.length]);
  if (next !== shape) {
    shape = next;
    trayEl.innerHTML = `<button class="task-bubble" data-restore>
      <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="tb-trk" cx="22" cy="22" r="${R}"/><circle class="tb-val ${overall == null && running.length ? 'indet' : ''}" cx="22" cy="22" r="${R}" stroke-dasharray="${CIRC.toFixed(2)}"/></svg>
      <span class="tb-ic">${running.length ? '' : icon(failed.length ? 'x' : 'check')}</span>
      ${running.length > 1 ? `<span class="tb-badge num">${running.length}</span>` : ''}</button>`;
  }
  const val = trayEl.querySelector('.tb-val');
  const p = running.length ? (overall ?? 30) : 100;
  val.style.strokeDashoffset = (CIRC * (1 - p / 100)).toFixed(2);
  const b = trayEl.querySelector('.task-bubble');
  const label = running.length
    ? `${running.length} tác vụ đang chạy${overall != null ? ', ' + Math.floor(overall) + '%' : ''}. Bấm để mở rộng`
    : failed.length ? `${failed.length} tác vụ lỗi. Bấm để xem` : 'Tác vụ đã xong. Bấm để mở rộng';
  if (b.getAttribute('aria-label') !== label) { b.setAttribute('aria-label', label); b.title = label; }
  applyBubblePos();
}
// Position: { edge: 'left'|'right'|'top'|'bottom', f: 0..1 along that edge }.
function applyBubblePos() {
  const pos = lsGet(LS_POS, null);
  if (!pos || !trayEl) return;
  const S = 48, M = 12, W = innerWidth, H = innerHeight;
  const along = (len) => Math.round(M + (len - S - 2 * M) * Math.max(0, Math.min(1, pos.f)));
  const x = pos.edge === 'left' ? M : pos.edge === 'right' ? W - S - M : along(W);
  const y = pos.edge === 'top' ? M : pos.edge === 'bottom' ? H - S - M : along(H);
  Object.assign(trayEl.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
}
function clearBubblePos() { if (trayEl?.style.left) Object.assign(trayEl.style, { left: '', top: '', right: '', bottom: '' }); }
addEventListener('resize', () => { if (minimized) applyBubblePos(); });
// Drag the bubble (mouse, touch, pen); on release it snaps to the nearest screen edge.
function bindBubbleDrag(el) {
  let st = null;
  el.addEventListener('pointerdown', (e) => {
    if (!minimized || !e.target.closest('.task-bubble')) return;
    const r = el.getBoundingClientRect();
    st = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
  });
  const move = (e) => {
    if (!st || e.pointerId !== st.id) return;
    if (!st.moved && Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < 6) return;
    if (!st.moved) { st.moved = true; el.classList.add('dragging'); }
    Object.assign(el.style, { left: (e.clientX - st.dx) + 'px', top: (e.clientY - st.dy) + 'px', right: 'auto', bottom: 'auto' });
  };
  const end = (e) => {
    if (!st || e.pointerId !== st.id) return;
    removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
    const moved = st.moved; st = null;
    el.classList.remove('dragging');
    if (!moved) return;
    el._dragged = true; setTimeout(() => { el._dragged = false; }, 50);
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, W = innerWidth, H = innerHeight;
    const d = { left: cx, right: W - cx, top: cy, bottom: H - cy };
    const edge = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
    const f = edge === 'left' || edge === 'right' ? (cy - 24 - 12) / Math.max(1, H - 48 - 24) : (cx - 24 - 12) / Math.max(1, W - 48 - 24);
    lsSet(LS_POS, { edge, f: Math.max(0, Math.min(1, f)) });
    applyBubblePos();
  };
  // Keyboard: arrow keys move the bubble to that edge.
  el.addEventListener('keydown', (e) => {
    if (!minimized) return;
    const edge = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' }[e.key];
    if (!edge) return;
    e.preventDefault();
    const cur = lsGet(LS_POS, { edge: 'right', f: 1 });
    lsSet(LS_POS, { edge, f: cur.f ?? 1 }); applyBubblePos();
  });
}

// Leaving the page while something is still writing loses data: ask first.
window.addEventListener('beforeunload', (e) => { if ([...list.values()].some(t => t.state === 'running' && !t.quiet)) { e.preventDefault(); e.returnValue = ''; } });
