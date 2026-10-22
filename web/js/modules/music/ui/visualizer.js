// Visualizer themes for Now Playing (background and behind the lyrics), fed by the engine's
// AnalyserNode. Every theme reacts to touch/pointer physics:
//   fluid   – WebGL2 stable-fluids: drag to stir dye, the bass injects colour bursts
//   neon    – particle flow along a moving field, additive glow, fingers push and swirl it
//   sphere  – WebGL point sphere displaced by the spectrum, drag to spin (inertia), gyro tilt
//   bars3d  – WebGL voxel city of spectrum columns in perspective, drag to orbit
//   ribbons – waveform ribbons from the time-domain signal; touch bends them like strings
//   bars    – the classic spectrum bars (also used for the small strip above the title)
// Performance: resolution scales with measured FPS (auto quality), the loop sleeps while the
// page or the canvas is hidden, 30 fps cap on low battery, nothing reads layout per frame.
const TAU = Math.PI * 2;
export const VIS_THEMES = { fluid: 'Chất lỏng (chạm để khuấy)', neon: 'Dòng hạt neon', sphere: 'Cầu 3D', bars3d: 'Cột 3D', ribbons: 'Dải sóng', bars: 'Cột phổ' };

const hex = (c) => {
  if (Array.isArray(c)) return c;
  const m = String(c || '').trim().match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  const r = String(c || '').match(/(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
  return r ? [+r[1], +r[2], +r[3]] : [140, 120, 255];
};
const css = ([r, g, b], a = 1) => `rgb(${r | 0} ${g | 0} ${b | 0} / ${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

let lowBattery = false;
navigator.getBattery?.().then(b => { const f = () => { lowBattery = !b.charging && b.level < 0.25; }; f(); b.addEventListener('levelchange', f); b.addEventListener('chargingchange', f); }).catch(() => {});

export class Visualizer {
  // canvas: target; opts.analyser(): AnalyserNode|null; opts.playing(): bool; opts.input: element receiving pointer events
  constructor(canvas, { theme = 'bars', analyser = () => null, playing = () => true, input = null, mode = 'bg' } = {}) {
    this.cv = canvas; this.getAn = analyser; this.isPlaying = playing; this.mode = mode;
    this.q = matchMedia('(pointer: coarse)').matches ? 0.75 : 1;   // quality (resolution / particle scale)
    this.colors = [hex('#a78bfa'), hex('#f472b6'), hex('#22e1ff')];
    this.ptr = { x: .5, y: .5, dx: 0, dy: 0, down: false, active: 0, moved: false };
    this.f = { bass: 0, mid: 0, high: 0, energy: 0, beat: 0 };
    this.freq = new Uint8Array(1024); this.wave = new Uint8Array(2048);
    this.visible = true; this.running = false; this.t = 0; this.fpsAvg = 60; this.lastEval = 0; this.slow = 0; this.fast = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.size = { w: 0, h: 0 };
    this.ro = new ResizeObserver(([e]) => { this.size = { w: e.contentRect.width, h: e.contentRect.height }; this.resize(); });
    this.ro.observe(canvas);
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.kick(); });
    this.io.observe(canvas);
    this.onVis = () => this.kick();
    document.addEventListener('visibilitychange', this.onVis);
    if (input) this.bindInput(input);
    this.setTheme(theme);
  }

  bindInput(el) {
    const P = this.ptr;
    const pos = (e) => { const r = this.rect || (this.rect = this.cv.getBoundingClientRect()); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    const down = (e) => { this.rect = this.cv.getBoundingClientRect(); [P.x, P.y] = pos(e); P.dx = P.dy = 0; P.down = !e.target.closest?.('button, a, input, select, .mnp-pbody, .ly, [role="tab"]'); P.active = 1; };
    const move = (e) => {
      const [x, y] = pos(e);
      P.dx = x - P.x; P.dy = y - P.y; P.x = x; P.y = y; P.moved = true; P.active = 1;
    };
    const up = () => { P.down = false; };
    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerup', up, { passive: true }); el.addEventListener('pointercancel', up, { passive: true });
    // Optional gyro tilt (no permission prompt: used only where the browser sends it freely).
    this.gyro = (e) => { if (e.beta != null) { this.tilt = [(e.gamma || 0) / 90, ((e.beta || 0) - 45) / 90]; } };
    addEventListener('deviceorientation', this.gyro, { passive: true });
    this.unbind = () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); removeEventListener('deviceorientation', this.gyro); };
  }

  setColors(list) {
    const c = list.map(hex);
    while (c.length < 3) c.push(c[c.length - 1] || [255, 255, 255]);
    this.target = c;
    if (!this.colorsSet) { this.colors = c.map(x => [...x]); this.colorsSet = true; }
  }

  setTheme(name) {
    if (!VIS_THEMES[name]) name = 'bars';
    if (this.theme === name && this.r) return;
    this.r?.destroy?.();
    this.theme = name;
    // A canvas keeps the context type it was first given: swap in a fresh canvas when it changes.
    const want = name === 'fluid' || name === 'sphere' || name === 'bars3d' ? 'gl' : '2d';
    // A canvas keeps its context (and a lost GL context stays lost): new theme → fresh canvas.
    if (this.ctxType && (this.ctxType !== want || want === 'gl')) {
      const n = this.cv.cloneNode(false);
      this.cv.replaceWith(n); this.ro.unobserve(this.cv); this.io.unobserve(this.cv);
      this.cv = n; this.ro.observe(n); this.io.observe(n);
    }
    this.ctxType = want;
    try {
      this.r = name === 'fluid' ? new Fluid(this) : name === 'sphere' || name === 'bars3d' ? new Points3D(this, name) : name === 'neon' ? new Neon(this) : name === 'ribbons' ? new Ribbons(this) : new Bars(this);
    } catch (e) {
      console.warn('[visualizer]', name, e.message);
      if (want === 'gl') { this.ctxType = 'gl'; this.theme = null; return this.setTheme('neon'); }
      this.r = null;
    }
    this.resize();
  }

  resize() {
    const { w, h } = this.size;
    if (!w || !h || !this.r) return;
    const dpr = Math.min(devicePixelRatio || 1, 2) * this.q * (this.r.scale || 1);
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    this.rect = null;
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; this.r.resize?.(W, H, dpr); }
  }

  start() { this.running = true; this.kick(); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); this.raf = 0; }
  kick() { if (this.running && !this.raf && !document.hidden && this.visible) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.frame(t)); } }
  destroy() { this.stop(); this.r?.destroy?.(); this.ro.disconnect(); this.io.disconnect(); this.unbind?.(); document.removeEventListener('visibilitychange', this.onVis); }

  features(dt) {
    const an = this.getAn(), F = this.f, playing = this.isPlaying();
    let bass = 0, mid = 0, high = 0;
    if (an && playing) {
      const n = an.frequencyBinCount;
      if (this.freq.length !== n) { this.freq = new Uint8Array(n); this.wave = new Uint8Array(an.fftSize); }
      an.getByteFrequencyData(this.freq);
      an.getByteTimeDomainData(this.wave);
      const hz = an.context.sampleRate / 2 / n, band = (a, b) => { let s = 0, c = 0; for (let i = Math.max(1, a / hz | 0); i < Math.min(n, b / hz | 0); i++) { s += this.freq[i]; c++; } return c ? s / c / 255 : 0; };
      bass = band(30, 160); mid = band(160, 2000); high = band(2000, 12000);
      this.live = true;
    } else {
      // No analyser (iOS direct mode) or paused: a calm synthetic breath so themes still move.
      const k = playing ? 0.35 : 0.08;
      bass = k * (0.5 + 0.5 * Math.sin(this.t * 2.1)); mid = k * (0.5 + 0.5 * Math.sin(this.t * 1.3 + 1)); high = k * 0.4 * (0.5 + 0.5 * Math.sin(this.t * 3.7));
      for (let i = 0; i < this.wave.length; i++) this.wave[i] = 128 + 40 * k * Math.sin(i / 40 + this.t * 3) * Math.sin(i / 300 + this.t);
      for (let i = 0; i < this.freq.length; i++) this.freq[i] = 255 * k * (0.6 + 0.4 * Math.sin(i / 9 - this.t * 2)) * Math.max(0, 1 - i / 500);
      this.live = false;
    }
    const s = 1 - Math.exp(-dt * 12);
    const prevBass = F.bass;
    F.bass += (bass - F.bass) * s; F.mid += (mid - F.mid) * s; F.high += (high - F.high) * s;
    F.energy = F.bass * .5 + F.mid * .35 + F.high * .15;
    F.beat = Math.max(F.beat * Math.exp(-dt * 6), bass - prevBass > 0.06 && bass > 0.45 ? 1 : 0);
  }

  frame(now) {
    this.raf = 0;
    if (!this.running || document.hidden || !this.visible) return;
    let dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
    // Paused: the calm breath needs only ~12 frames/s.
    const cap = !this.isPlaying() ? 1 / 12 : lowBattery || this.reduced ? 1 / 30 : 0;
    if (cap && dt < cap - 0.002) { this.raf = requestAnimationFrame((t) => this.frame(t)); return; }
    this.last = now; this.t += dt;
    // Colours glide towards their target (video / artwork palette changes are smooth).
    if (this.target) { const k = 1 - Math.exp(-dt * 2.5); this.colors = this.colors.map((c, i) => mix(c, this.target[i], k)); }
    this.features(dt);
    try { this.r?.draw(dt, this.t); } catch (e) { console.warn('[visualizer]', e); this.stop(); return; }
    this.ptr.dx *= 0.5; this.ptr.dy *= 0.5; this.ptr.active *= Math.exp(-dt * 2); this.ptr.moved = false;
    if (this.isPlaying()) this.govern(dt, now);   // the paused frame cap is not slowness
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // Auto quality: lower the resolution when frames are slow, raise it slowly when there is room.
  govern(dt, now) {
    this.fpsAvg += (1 / dt - this.fpsAvg) * 0.05;
    if (now - this.lastEval < 1000) return;
    this.lastEval = now;
    const target = lowBattery || this.reduced ? 28 : 50;
    if (this.fpsAvg < target) { this.slow++; this.fast = 0; } else if (this.fpsAvg > target + 8) { this.fast++; this.slow = 0; }
    if (this.slow >= 2 && this.q > 0.35) { this.q = Math.max(0.35, this.q * 0.78); this.slow = 0; this.resize(); this.r?.quality?.(this.q); }
    else if (this.fast >= 5 && this.q < 1) { this.q = Math.min(1, this.q * 1.12); this.fast = 0; this.resize(); this.r?.quality?.(this.q); }
  }
}

// ── 2D: classic bars ────────────────────────────────────────────
class Bars {
  constructor(v) { this.v = v; this.g = v.cv.getContext('2d'); this.peaks = new Float32Array(96); }
  draw(dt) {
    const { v, g } = this, W = v.cv.width, H = v.cv.height, strip = v.mode === 'strip';
    g.clearRect(0, 0, W, H);
    const an = v.getAn(), sr = an?.context.sampleRate || 48000, nb = v.freq.length;
    const n = strip ? Math.min(64, Math.floor(W / 10)) : Math.min(96, Math.floor(W / 14)), gap = Math.max(1, W / n * 0.25), bw = (W - gap * (n - 1)) / n;
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, css(v.colors[0])); grad.addColorStop(1, css(v.colors[1]));
    g.fillStyle = grad;
    const hmax = strip ? H : H * 0.42;
    for (let i = 0; i < n; i++) {
      const f0 = 40 * Math.pow(400, i / n), f1 = 40 * Math.pow(400, (i + 1) / n);
      const b0 = Math.floor(f0 / (sr / 2) * nb), b1 = Math.max(b0 + 1, Math.floor(f1 / (sr / 2) * nb));
      let m = 0; for (let b = b0; b < b1 && b < nb; b++) m = Math.max(m, v.freq[b]);
      const e = (m / 255) ** 1.6, bh = Math.max(2, e * hmax);
      this.peaks[i] = Math.max(bh, this.peaks[i] - hmax * dt * 0.6);
      g.globalAlpha = strip ? 0.35 + 0.65 * (m / 255) : 0.18 + 0.4 * (m / 255);
      const x = i * (bw + gap);
      g.beginPath(); g.roundRect ? g.roundRect(x, H - bh, bw, bh, Math.min(4, bw / 2)) : g.rect(x, H - bh, bw, bh); g.fill();
      if (!strip) { g.globalAlpha = 0.6; g.fillRect(x, H - this.peaks[i] - 4, bw, 2); }
    }
    g.globalAlpha = 1;
  }
}

// ── 2D: waveform ribbons that bend under the finger ─────────────
class Ribbons {
  constructor(v) { this.v = v; this.scale = 0.75; this.g = v.cv.getContext('2d'); this.bend = new Float32Array(64); this.bv = new Float32Array(64); }
  draw(dt, t) {
    const { v, g } = this, W = v.cv.width, H = v.cv.height, P = v.ptr, F = v.f;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    // Spring-damped string displacement: touching pushes the nearby segment towards the finger.
    const N = this.bend.length;
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      if (P.down || P.moved) { const d = x - P.x, w = Math.exp(-(d * d) / 0.006); this.bv[i] += ((P.y - 0.5) * 1.6 - this.bend[i]) * w * 0.35 + P.dy * w * 8; }
      this.bv[i] += -this.bend[i] * 60 * dt; this.bv[i] *= Math.exp(-dt * 3.2); this.bend[i] += this.bv[i] * dt * 6;
    }
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    const wave = v.wave, L = wave.length, R = 5;
    for (let r = 0; r < R; r++) {
      const c = mix(v.colors[r % 2], v.colors[2], r / R), amp = H * (0.12 + F.energy * 0.5) * (1 - r * 0.12);
      g.strokeStyle = css(c, 0.18 + 0.5 * (1 - r / R));
      g.lineWidth = Math.max(1, (3.2 - r * 0.45) * v.q * (devicePixelRatio || 1) * 0.8);
      g.beginPath();
      const steps = 120, ph = t * (0.6 + r * 0.17) + r * 1.3;
      for (let s = 0; s <= steps; s++) {
        const x = s / steps, wi = Math.min(L - 1, ((x * 0.9 + r * 0.02) * L) | 0);
        const bi = Math.min(N - 1, x * (N - 1) | 0);
        const y = 0.5 + ((wave[wi] - 128) / 128) * (0.35 + r * 0.08) + Math.sin(x * TAU * (1 + r * 0.35) + ph) * (0.05 + F.bass * 0.12) * (r + 1) / R;
        const yy = H * 0.5 + (y - 0.5) * amp * 2.2 + this.bend[bi] * H * 0.35 * (1 - r * 0.1);
        s ? g.lineTo(x * W, yy) : g.moveTo(x * W, yy);
      }
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }
}

// ── 2D: neon particle flow ──────────────────────────────────────
class Neon {
  constructor(v) { this.v = v; this.scale = 0.6; this.g = v.cv.getContext('2d'); this.quality(v.q); }
  quality(q) {
    const n = Math.round((matchMedia('(pointer: coarse)').matches ? 520 : 900) * Math.max(0.4, q));
    const old = this.p;
    this.p = new Float32Array(n * 5);   // x, y, vx, vy, hue(0..1)
    for (let i = 0; i < n; i++) {
      if (old && i * 5 < old.length) { for (let k = 0; k < 5; k++) this.p[i * 5 + k] = old[i * 5 + k]; continue; }
      this.p[i * 5] = Math.random(); this.p[i * 5 + 1] = Math.random(); this.p[i * 5 + 4] = Math.random();
    }
  }
  draw(dt, t) {
    const { v, g, p } = this, W = v.cv.width, H = v.cv.height, F = v.f, P = v.ptr, asp = W / H;
    // Fade the previous frame (trails) instead of clearing.
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgb(0 0 0 / ${Math.min(0.5, 0.12 + dt * 3)})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const speed = (0.03 + F.energy * 0.32 + F.beat * 0.25) * dt, sz = Math.max(1, 1.6 * v.q * (devicePixelRatio || 1) * (1 + F.high));
    const c0 = v.colors[0], c1 = v.colors[1], c2 = v.colors[2];
    const cols = [css(c0, 0.75), css(mix(c0, c1, 0.5), 0.75), css(c1, 0.75), css(c2, 0.8)];
    const touch = P.active > 0.05;
    for (let k = 0; k < 4; k++) {
      g.fillStyle = cols[k];
      for (let i = k * 5; i < p.length; i += 20) {
        let x = p[i], y = p[i + 1];
        // Cheap moving flow field (two layered trig waves ≈ curl noise).
        const a = Math.sin(x * 3.1 + t * 0.21) * 2.1 + Math.cos(y * 2.7 - t * 0.17) * 2.3 + Math.sin((x + y) * 5 + t * 0.4) * F.mid * 2;
        let vx = p[i + 2] * 0.92 + Math.cos(a) * speed, vy = p[i + 3] * 0.92 + Math.sin(a) * speed * asp;
        if (touch) {   // finger: drag along its motion, swirl around it
          const dx = (x - P.x) * asp, dy = y - P.y, d2 = dx * dx + dy * dy, w = Math.exp(-d2 / 0.02) * P.active;
          vx += (P.dx * 0.6 - dy * 0.02) * w; vy += (P.dy * 0.6 + dx * 0.02) * w;
        }
        x += vx; y += vy;
        if (x < 0) x += 1; else if (x > 1) x -= 1;
        if (y < 0) y += 1; else if (y > 1) y -= 1;
        p[i] = x; p[i + 1] = y; p[i + 2] = vx; p[i + 3] = vy;
        g.fillRect(x * W, y * H, sz, sz);
      }
    }
    g.globalCompositeOperation = 'source-over';
  }
}

// ── WebGL helpers ───────────────────────────────────────────────
function gl2(cv, opts = {}) {
  const gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power', ...opts });
  if (!gl) throw new Error('WebGL2 không khả dụng');
  return gl;
}
function program(gl, vs, fs) {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

// ── WebGL2: stable-fluids (advect → curl/vorticity → divergence → pressure → project) ──
const QUAD_VS = `#version 300 es
in vec2 aPos; uniform vec2 tx; out vec2 vUv, vL, vR, vT, vB;
void main(){ vUv = aPos*.5+.5; vL = vUv-vec2(tx.x,0.); vR = vUv+vec2(tx.x,0.); vT = vUv+vec2(0.,tx.y); vB = vUv-vec2(0.,tx.y); gl_Position = vec4(aPos,0.,1.); }`;
const H = `#version 300 es
precision highp float; precision highp sampler2D; in vec2 vUv, vL, vR, vT, vB; out vec4 o;`;
const FS = {
  splat: H + `uniform sampler2D uT; uniform float asp, rad; uniform vec3 col; uniform vec2 pt;
    void main(){ vec2 p = vUv-pt; p.x *= asp; o = vec4(texture(uT,vUv).xyz + exp(-dot(p,p)/rad)*col, 1.); }`,
  advect: H + `uniform sampler2D uV, uS; uniform vec2 stx; uniform float dt, dis;
    void main(){ vec2 c = vUv - dt*texture(uV,vUv).xy*stx; o = texture(uS,c) / (1. + dis*dt); }`,
  div: H + `uniform sampler2D uV; void main(){ float L=texture(uV,vL).x, R=texture(uV,vR).x, T=texture(uV,vT).y, B=texture(uV,vB).y; o = vec4(.5*(R-L+T-B),0.,0.,1.); }`,
  curl: H + `uniform sampler2D uV; void main(){ float L=texture(uV,vL).y, R=texture(uV,vR).y, T=texture(uV,vT).x, B=texture(uV,vB).x; o = vec4(.5*(R-L-T+B),0.,0.,1.); }`,
  vort: H + `uniform sampler2D uV, uC; uniform float curl, dt;
    void main(){ float L=texture(uC,vL).x, R=texture(uC,vR).x, T=texture(uC,vT).x, B=texture(uC,vB).x, C=texture(uC,vUv).x;
      vec2 f = .5*vec2(abs(T)-abs(B), abs(R)-abs(L)); f /= length(f)+1e-4; f *= curl*C; f.y *= -1.;
      o = vec4(texture(uV,vUv).xy + f*dt, 0., 1.); }`,
  press: H + `uniform sampler2D uP, uD; void main(){ float L=texture(uP,vL).x, R=texture(uP,vR).x, T=texture(uP,vT).x, B=texture(uP,vB).x; o = vec4((L+R+B+T-texture(uD,vUv).x)*.25,0.,0.,1.); }`,
  grad: H + `uniform sampler2D uP, uV; void main(){ float L=texture(uP,vL).x, R=texture(uP,vR).x, T=texture(uP,vT).x, B=texture(uP,vB).x; o = vec4(texture(uV,vUv).xy - vec2(R-L,T-B), 0., 1.); }`,
  fade: H + `uniform sampler2D uT; uniform float k; void main(){ o = k*texture(uT,vUv); }`,
  show: H + `uniform sampler2D uT; uniform float glow;
    void main(){ vec3 c = texture(uT,vUv).rgb; c = c/(1.+c*.6)*glow; float a = clamp(max(c.r,max(c.g,c.b)),0.,1.); o = vec4(c,a); }`,
};

class Fluid {
  constructor(v) {
    this.v = v; this.scale = 0.5;   // the dye texture is the canvas; draw it at half the CSS resolution
    const gl = this.gl = gl2(v.cv);
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Không có float FBO');
    gl.getExtension('OES_texture_float_linear');
    this.P = Object.fromEntries(Object.entries(FS).map(([k, fs]) => [k, program(gl, QUAD_VS, fs)]));
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.auto = 0;
  }
  fbo(w, h) {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  dbl(w, h) { const a = this.fbo(w, h), b = this.fbo(w, h); return { r: a, w: b, swap() { [this.r, this.w] = [this.w, this.r]; } }; }
  resize(W, H) {
    this.free();
    const sim = Math.round(96 * Math.max(0.5, this.v.q) + 32), sw = Math.round(sim * Math.max(1, W / H)), sh = Math.round(sim * Math.max(1, H / W));
    this.sim = [sw, sh]; this.dyeSz = [W, H];
    this.vel = this.dbl(sw, sh); this.pres = this.dbl(sw, sh); this.divT = this.fbo(sw, sh); this.curlT = this.fbo(sw, sh);
    this.dye = this.dbl(W, H);
  }
  free() {
    const gl = this.gl;
    for (const f of [this.vel?.r, this.vel?.w, this.pres?.r, this.pres?.w, this.divT, this.curlT, this.dye?.r, this.dye?.w]) if (f) { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fb); }
  }
  destroy() { this.free(); this.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  run(prog, target, uni, tx) {
    const gl = this.gl, { p, u } = this.P[prog];
    gl.useProgram(p);
    gl.uniform2f(u.tx, 1 / tx[0], 1 / tx[1]);
    let unit = 0;
    for (const [k, val] of Object.entries(uni)) {
      if (val && val.tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, val.tex); gl.uniform1i(u[k], unit++); }
      else if (Array.isArray(val)) (val.length === 2 ? gl.uniform2fv : gl.uniform3fv).call(gl, u[k], val);
      else gl.uniform1f(u[k], val);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.v.cv.width, target ? target.h : this.v.cv.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  splat(x, y, dx, dy, col, rad) {
    const asp = this.v.cv.width / this.v.cv.height, S = this.sim;
    this.run('splat', this.vel.w, { uT: this.vel.r, asp, rad, col: [dx, dy, 0], pt: [x, y] }, S); this.vel.swap();
    this.run('splat', this.dye.w, { uT: this.dye.r, asp, rad, col, pt: [x, y] }, this.dyeSz); this.dye.swap();
  }
  draw(dt) {
    if (!this.vel) return;
    const v = this.v, F = v.f, P = v.ptr, S = this.sim, c = v.colors.map(x => x.map(k => k / 255));
    // Touch: stir in the drag direction and drop colour.
    if (P.active > 0.2 && (P.moved || P.down)) {
      const col = c[(v.t * 0.7 | 0) % 3].map(k => k * 0.35);
      this.splat(P.x, 1 - P.y, P.dx * 4000, -P.dy * 4000, col, 0.0025);
    }
    // Music: bass bursts from slowly orbiting emitters, a gentle drift otherwise.
    this.auto -= dt;
    if (F.beat > 0.5 || this.auto <= 0) {
      const a = v.t * 0.37 + Math.random() * TAU, r = 0.25 + Math.random() * 0.15, x = 0.5 + Math.cos(a) * r, y = 0.5 + Math.sin(a) * r;
      const pow = 250 + F.bass * 1400;
      const col = c[Math.random() * 3 | 0].map(k => k * (0.12 + F.energy * 0.6));
      this.splat(x, y, -Math.cos(a) * pow, -Math.sin(a) * pow, col, 0.002 + F.bass * 0.004);
      this.auto = 0.5 - F.energy * 0.35;
    }
    this.run('curl', this.curlT, { uV: this.vel.r }, S);
    this.run('vort', this.vel.w, { uV: this.vel.r, uC: this.curlT, curl: 18 + F.mid * 20, dt }, S); this.vel.swap();
    this.run('div', this.divT, { uV: this.vel.r }, S);
    this.run('fade', this.pres.w, { uT: this.pres.r, k: 0.8 }, S); this.pres.swap();
    const iters = v.q < 0.6 ? 10 : 18;
    for (let i = 0; i < iters; i++) { this.run('press', this.pres.w, { uP: this.pres.r, uD: this.divT }, S); this.pres.swap(); }
    this.run('grad', this.vel.w, { uP: this.pres.r, uV: this.vel.r }, S); this.vel.swap();
    const stx = [1 / S[0], 1 / S[1]];
    this.run('advect', this.vel.w, { uV: this.vel.r, uS: this.vel.r, stx, dt, dis: 0.25 }, S); this.vel.swap();
    this.run('advect', this.dye.w, { uV: this.vel.r, uS: this.dye.r, stx, dt, dis: 0.55 - F.energy * 0.3 }, this.dyeSz); this.dye.swap();
    this.run('show', null, { uT: this.dye.r, glow: 1.1 + F.energy * 0.6 }, this.dyeSz);
  }
}

// ── WebGL2: point sphere / voxel bars in 3D ─────────────────────
const P3_VS = `#version 300 es
in vec3 aPos; in float aBand; in float aLvl;
uniform mat4 uM; uniform float uSpec[64]; uniform float uMode, uSize, uBeat, uT; uniform vec3 uC0, uC1;
out vec3 vC; out float vA;
void main(){
  int b = int(aBand); float s = uSpec[b];
  vec3 p = aPos; float a = 1.;
  if (uMode < .5) { p *= 1. + s*.45 + uBeat*.06 + .015*sin(uT*2.+aBand); }
  else { float h = s*1.3; a = step(aLvl, h+.02); p.y = -.55 + aLvl*1.1; }
  vec4 q = uM * vec4(p,1.);
  float z = q.z + 3.2;
  vec2 sc = uAsp > 1. ? vec2(1./uAsp, 1.) : vec2(1., uAsp); gl_Position = vec4(q.xy/z*2.6*sc, 0., 1.);
  gl_PointSize = uSize * (1.2 + s*2.2) / z;
  vC = mix(uC0, uC1, aBand/63.) * (.55 + s*.9); vA = a * (.25 + s*.75) * clamp(2.8 - z*.45, .2, 1.);
}`;
const P3_FS = `#version 300 es
precision mediump float; in vec3 vC; in float vA; out vec4 o;
void main(){ vec2 d = gl_PointCoord-.5; float r = dot(d,d); if (r > .25) discard; float k = smoothstep(.25,.0,r); o = vec4(vC*k*vA, k*vA); }`;

class Points3D {
  constructor(v, kind) {
    this.v = v; this.kind = kind;
    const gl = this.gl = gl2(v.cv);
    this.prog = program(gl, P3_VS.replace('uniform float uMode', 'uniform float uAsp; uniform float uMode'), P3_FS);
    this.locB = gl.getAttribLocation(this.prog.p, 'aBand'); this.locL = gl.getAttribLocation(this.prog.p, 'aLvl'); this.locP = gl.getAttribLocation(this.prog.p, 'aPos');
    this.spec = new Float32Array(64);
    this.rot = [0.4, 0.3]; this.spin = [0.12, 0];
    this.build();
  }
  build() {
    const gl = this.gl, pts = [];
    if (this.kind === 'sphere') {
      const n = Math.round(2600 * Math.max(0.45, this.v.q)), ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
        const lat = Math.acos(y) / Math.PI;   // poles = bass, equator = highs mirrored
        pts.push(Math.cos(th) * r * .8, y * .8, Math.sin(th) * r * .8, Math.min(63, Math.floor((1 - Math.abs(lat - .5) * 2) * 63)), 0);
      }
    } else {
      const G = 16, L = 14;
      for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
        const dx = i - (G - 1) / 2, dz = j - (G - 1) / 2, d = Math.sqrt(dx * dx + dz * dz) / (G * 0.71);
        const band = Math.min(63, Math.floor(d * 63));
        for (let l = 0; l < L; l++) pts.push(dx / G * 1.6, 0, dz / G * 1.6, band, l / (L - 1));
      }
    }
    this.n = pts.length / 5;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const b = this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.locP); gl.vertexAttribPointer(this.locP, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(this.locB); gl.vertexAttribPointer(this.locB, 1, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(this.locL); gl.vertexAttribPointer(this.locL, 1, gl.FLOAT, false, 20, 16);
  }
  quality() { this.gl.deleteBuffer(this.buf); this.build(); }
  destroy() { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  draw(dt, t) {
    const { gl, v } = this, P = v.ptr, F = v.f, W = v.cv.width, H = v.cv.height;
    // Spectrum → 64 log bands.
    const an = v.getAn(), sr = an?.context.sampleRate || 48000, nb = v.freq.length;
    for (let i = 0; i < 64; i++) {
      const f0 = 40 * Math.pow(350, i / 64), f1 = 40 * Math.pow(350, (i + 1) / 64);
      const b0 = Math.floor(f0 / (sr / 2) * nb), b1 = Math.max(b0 + 1, Math.floor(f1 / (sr / 2) * nb));
      let m = 0; for (let b = b0; b < b1 && b < nb; b++) m = Math.max(m, v.freq[b]);
      const x = (m / 255) ** 1.5; this.spec[i] += (x - this.spec[i]) * Math.min(1, dt * (x > this.spec[i] ? 25 : 6));
    }
    // Drag to rotate with inertia; idle auto-spin; optional gyro tilt.
    if (P.down && (P.dx || P.dy)) { this.spin[0] = P.dx * 6 / dt * 0.05; this.spin[1] = P.dy * 6 / dt * 0.05; }
    else { this.spin[0] += (0.12 + F.energy * 0.3 - this.spin[0]) * dt * 0.8; this.spin[1] *= Math.exp(-dt * 1.5); }
    this.rot[0] += this.spin[0] * dt; this.rot[1] = Math.max(-1.2, Math.min(1.2, this.rot[1] + this.spin[1] * dt));
    const tl = v.tilt || [0, 0];
    const ry = this.rot[0] + tl[0] * 0.5, rx = (this.kind === 'bars3d' ? 0.45 : 0) + this.rot[1] + tl[1] * 0.4;
    const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
    const M = new Float32Array([cy, sx * sy, -cx * sy, 0, 0, cx, sx, 0, sy, -sx * cy, cx * cy, 0, 0, 0, 0, 1]);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.prog.p); gl.bindVertexArray(this.vao);
    const u = this.prog.u;
    gl.uniformMatrix4fv(u.uM, false, M);
    gl.uniform1fv(u.uSpec, this.spec);
    gl.uniform1f(u.uMode, this.kind === 'sphere' ? 0 : 1);
    gl.uniform1f(u.uSize, Math.min(W, H) * (this.kind === 'sphere' ? 0.022 : 0.05));
    gl.uniform1f(u.uBeat, F.beat); gl.uniform1f(u.uT, t);
    gl.uniform1f(u.uAsp, W / H);
    gl.uniform3fv(u.uC0, v.colors[0].map(k => k / 255)); gl.uniform3fv(u.uC1, v.colors[1].map(k => k / 255));
    gl.drawArrays(gl.POINTS, 0, this.n);
  }
}
