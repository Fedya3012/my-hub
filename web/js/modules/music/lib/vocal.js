// Lightweight vocal isolation for speech recognition: singing is almost always mixed to the centre of a
// stereo song, while guitars, synths and room reverb are spread wide. A short-time spectrum of each channel
// is compared bin by bin (Avendano's centre-channel extraction): bins where left and right agree in phase and
// level keep their energy, bins where they differ are turned down. A band-pass (≈ 100 Hz – 7 kHz) removes
// bass and hiss. Mono songs have nothing to compare, so only the band-pass is applied. It runs on the 16 kHz
// samples Whisper reads, in the page, yielding between blocks so the UI stays responsive.
const N = 1024, HOP = 256, BINS = N / 2 + 1;
const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));   // Hann: 75 % overlap sums to 1.5
const tw = (() => { const c = new Float32Array(N / 2), s = new Float32Array(N / 2); for (let i = 0; i < N / 2; i++) { c[i] = Math.cos(2 * Math.PI * i / N); s[i] = -Math.sin(2 * Math.PI * i / N); } return { c, s }; })();
const rev = (() => { const r = new Uint16Array(N), b = Math.log2(N); for (let i = 0; i < N; i++) { let x = 0; for (let k = 0; k < b; k++) if (i & (1 << k)) x |= 1 << (b - 1 - k); r[i] = x; } return r; })();

// In-place radix-2 FFT; inverse = conjugate trick done by the caller.
function fft(re, im) {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const a = i + j, b = a + half, wr = tw.c[k], wi = tw.s[k];
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}

// RBJ biquad band-pass pair (high-pass then low-pass), in place.
function biquad(x, type, fc, rate) {
  const w = 2 * Math.PI * fc / rate, cs = Math.cos(w), al = Math.sin(w) / (2 * 0.7071);
  let b0, b1, b2;
  if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; } else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
  const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; x[i] = v;
  }
}

// L, R: Float32Array at `rate`; R may be null/equal for mono. → Float32Array (mono, peak-normalised to ≤ 0.95).
export async function isolateVocals(L, R, rate = 16000, { onProgress } = {}) {
  const len = L.length;
  const out = new Float32Array(len);
  const stereo = R && R !== L && R.length === len;
  if (!stereo) out.set(L);
  else {
    const norm = new Float32Array(len + N);
    const lr = new Float32Array(N), li = new Float32Array(N), rr = new Float32Array(N), ri = new Float32Array(N);
    const frames = Math.floor((len - N) / HOP) + 1;
    let tick = 0;
    for (let f = 0; f < Math.max(0, frames); f++) {
      const o = f * HOP;
      for (let i = 0; i < N; i++) { lr[i] = L[o + i] * win[i]; rr[i] = R[o + i] * win[i]; li[i] = 0; ri[i] = 0; }
      fft(lr, li); fft(rr, ri);
      for (let k = 0; k < BINS; k++) {
        const pl = lr[k] * lr[k] + li[k] * li[k], pr = rr[k] * rr[k] + ri[k] * ri[k];
        const cross = lr[k] * rr[k] + li[k] * ri[k];                      // Re(L · conj R)
        const sim = pl + pr > 1e-12 ? 2 * cross / (pl + pr) : 0;          // 1 = same level and phase, ≤ 0 = unrelated or opposite
        const m = sim > 0 ? sim * sim : 0;                                // sharpen: weakly centred bins are dropped
        lr[k] = (lr[k] + rr[k]) / 2 * m; li[k] = (li[k] + ri[k]) / 2 * m;
        if (k > 0 && k < N / 2) { lr[N - k] = lr[k]; li[N - k] = -li[k]; }   // mirror: the output is real
      }
      for (let i = 0; i < N; i++) li[i] = -li[i];                         // inverse FFT via conjugation
      fft(lr, li);
      for (let i = 0; i < N; i++) { out[o + i] += lr[i] / N * win[i]; norm[o + i] += win[i] * win[i]; }
      if (++tick % 400 === 0) { onProgress?.(f / frames); await new Promise(r => setTimeout(r, 0)); }
    }
    for (let i = 0; i < len; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
  }
  biquad(out, 'hp', 100, rate); biquad(out, 'lp', 7000, rate);
  let peak = 0; for (let i = 0; i < len; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  if (peak > 0) { const g = 0.95 / peak; for (let i = 0; i < len; i++) out[i] *= g; }
  return out;
}
