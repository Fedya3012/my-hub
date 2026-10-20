// Equalizer model: parametric bands (any number, any filter type), a 10-band graphic mode and a
// 31-band ISO 1/3-octave graphic mode ('g31'), all just lists of biquad bands. Presets (built-in + user, synced via db.eqPresets),
// AutoEQ "ParametricEQ.txt" import/export, frequency response for drawing.
import { db, uid, getSetting, setSetting } from '../../../core/db.js';

export const TYPES = {
  peaking: 'Đỉnh (PK)', lowshelf: 'Kệ thấp (LS)', highshelf: 'Kệ cao (HS)',
  lowpass: 'Thông thấp (LP)', highpass: 'Thông cao (HP)', notch: 'Chặn (Notch)',
};
export const GRAPHIC_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const band = (type, freq, gain = 0, q = 1) => ({ type, freq, gain, q, on: 1 });
const graphic = (gains) => GRAPHIC_FREQS.map((f, i) => band('peaking', f, gains[i] || 0, 1.41));

// ISO 266 1/3-octave centres, 20 Hz – 20 kHz. Q of a 1/3-octave band = 4.32.
export const GRAPHIC31_FREQS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
export const G31_Q = 4.32;
export const G31_MAX = 12;
const g31 = (fn) => GRAPHIC31_FREQS.map(f => band('peaking', f, Math.round(Math.max(-G31_MAX, Math.min(G31_MAX, fn(Math.log2(f / 1000)))) * 2) / 2, G31_Q));
const bell = (o, c, w, g) => g * Math.exp(-((o - c) ** 2) / (2 * w * w));   // o = octaves from 1 kHz
export const BUILTIN31 = [
  { id: 'g31-flat', name: '31 dải · Phẳng', mode: 'g31', preamp: 0, bands: g31(() => 0) },
  { id: 'g31-bass', name: '31 dải · Bass sâu', mode: 'g31', preamp: 0, bands: g31(o => bell(o, -4.6, 1.3, 6)) },
  { id: 'g31-v', name: '31 dải · Chữ V', mode: 'g31', preamp: 0, bands: g31(o => bell(o, -4.3, 1.4, 5) + bell(o, 3.3, 1.2, 4.5) - bell(o, 0, 1, 1.5)) },
  { id: 'g31-vocal', name: '31 dải · Giọng hát', mode: 'g31', preamp: 0, bands: g31(o => bell(o, 1.3, 0.9, 3.5) - bell(o, -2, 0.8, 1.5) - (o < -5 ? 4 : 0)) },
  { id: 'g31-harman', name: '31 dải · Kiểu Harman', mode: 'g31', preamp: 0, bands: g31(o => bell(o, -4.4, 1.1, 4.5) + bell(o, 1.6, 0.8, 2.5) - bell(o, 3.5, 0.6, 1.5)) },
  { id: 'g31-air', name: '31 dải · Trong trẻo', mode: 'g31', preamp: 0, bands: g31(o => bell(o, 3.6, 0.9, 4)) },
  { id: 'g31-night', name: '31 dải · Nghe đêm', mode: 'g31', preamp: 0, bands: g31(o => bell(o, -4.2, 1.2, 4) + bell(o, 3.2, 1, 2.5)) },
];

export const BUILTIN = [
  { id: 'flat', name: 'Phẳng', mode: 'graphic', preamp: 0, bands: graphic([]) },
  { id: 'bass', name: 'Tăng bass', mode: 'parametric', preamp: -5, bands: [band('lowshelf', 105, 5.5, .7), band('peaking', 60, 1.5, 1)] },
  { id: 'treble', name: 'Tăng treble', mode: 'parametric', preamp: -4, bands: [band('highshelf', 6000, 4, .7)] },
  { id: 'vocal', name: 'Giọng hát', mode: 'parametric', preamp: -3, bands: [band('highpass', 70, 0, .7), band('peaking', 250, -1.5, 1), band('peaking', 2500, 3, 1.2), band('peaking', 5000, 1.5, 2)] },
  { id: 'warm', name: 'Ấm áp', mode: 'parametric', preamp: -3, bands: [band('lowshelf', 200, 2.5, .7), band('highshelf', 9000, -2, .7)] },
  { id: 'loudness', name: 'Nghe nhỏ (loudness)', mode: 'parametric', preamp: -6, bands: [band('lowshelf', 90, 6, .7), band('highshelf', 10000, 3.5, .7)] },
  { id: 'rock', name: 'Rock', mode: 'graphic', preamp: -4, bands: graphic([4, 3, 2, 0, -1, -1, 1, 2.5, 3.5, 4]) },
  { id: 'pop', name: 'Pop', mode: 'graphic', preamp: -3, bands: graphic([-1, 0, 1.5, 3, 3, 1.5, 0, -0.5, -1, -1]) },
  { id: 'jazz', name: 'Jazz', mode: 'graphic', preamp: -3, bands: graphic([3, 2, 1, 1.5, -1, -1, 0, 1, 2, 3]) },
  { id: 'classical', name: 'Cổ điển', mode: 'graphic', preamp: -3, bands: graphic([3, 2.5, 2, 1, 0, 0, 0, 1.5, 2.5, 3]) },
  { id: 'electronic', name: 'Điện tử', mode: 'graphic', preamp: -5, bands: graphic([5, 4, 1.5, 0, -1.5, 1, 0.5, 1.5, 4, 5]) },
  { id: 'podcast', name: 'Podcast / lời nói', mode: 'parametric', preamp: -2, bands: [band('highpass', 90, 0, .7), band('peaking', 200, -2, 1), band('peaking', 3000, 2.5, 1)] },
];

export const DEFAULT_STATE = { enabled: 0, presetId: 'flat', name: 'Phẳng', mode: 'graphic', preamp: 0, autoPreamp: 1, bands: graphic([]) };

export async function loadEq() {
  const s = await getSetting('music.eq', null);
  return s ? { ...DEFAULT_STATE, ...s } : structuredClone(DEFAULT_STATE);
}
export const saveEq = (state) => setSetting('music.eq', state);

export async function allPresets() {
  return [...BUILTIN.map(p => ({ ...p, builtin: true })), ...BUILTIN31.map(p => ({ ...p, builtin: true })), ...(await db.eqPresets.toArray()).filter(p => !p.deleted)];
}
export async function savePreset(name, state) {
  const p = { id: uid(), name, mode: state.mode, preamp: state.preamp, bands: structuredClone(state.bands) };
  await db.eqPresets.put(p);
  return p;
}
export const deletePreset = (id) => db.eqPresets.delete(id);

// Per-output EQ profiles (this device only): { [outputKey]: eqState }. The key is the
// output sinkId ('' = system default) so headphones and speakers keep their own curve.
export const loadProfiles = () => getSetting('music.eqProfiles', {});
export async function saveProfile(key, state) { const p = await loadProfiles(); p[key || 'default'] = structuredClone(state); await setSetting('music.eqProfiles', p); }
export async function deleteProfile(key) { const p = await loadProfiles(); delete p[key || 'default']; await setSetting('music.eqProfiles', p); }

// A 10-band / parametric curve resampled onto the 31 fixed bands (and back is done by the panel).
export const toG31 = (bands) => { const r = response(bands, new Float32Array(GRAPHIC31_FREQS)); return GRAPHIC31_FREQS.map((f, i) => band('peaking', f, Math.round(Math.max(-G31_MAX, Math.min(G31_MAX, r[i])) * 2) / 2, G31_Q)); };

// Bands the engine actually needs: a peaking/shelf band at 0 dB (or switched off) is a no-op,
// so it costs nothing to skip it (31-band flat = zero filters).
export const activeBands = (bands) => bands.filter(b => b.on && !((b.type === 'peaking' || b.type === 'lowshelf' || b.type === 'highshelf') && Math.abs(b.gain) < 0.05));

// ── AutoEQ / Equalizer APO text format ──────────────────────────
// Preamp: -6.2 dB
// Filter 1: ON PK Fc 105 Hz Gain 3.4 dB Q 0.70
const APO = { PK: 'peaking', PEQ: 'peaking', LSC: 'lowshelf', LS: 'lowshelf', HSC: 'highshelf', HS: 'highshelf', LP: 'lowpass', LPQ: 'lowpass', HP: 'highpass', HPQ: 'highpass', NO: 'notch' };
export function parseAutoEq(text) {
  const out = { mode: 'parametric', preamp: 0, bands: [] };
  const pre = text.match(/Preamp:\s*([+-]?[\d.]+)\s*dB/i);
  if (pre) out.preamp = +pre[1];
  for (const m of text.matchAll(/Filter\s*\d*:\s*(ON|OFF)\s+([A-Z]+)\s+Fc\s+([\d.]+)\s*Hz(?:\s+Gain\s+([+-]?[\d.]+)\s*dB)?(?:\s+Q\s+([\d.]+))?/gi)) {
    const type = APO[m[2].toUpperCase()];
    if (!type) continue;
    out.bands.push({ type, freq: +m[3], gain: +(m[4] || 0), q: +(m[5] || 0.71), on: m[1].toUpperCase() === 'ON' ? 1 : 0 });
  }
  if (!out.bands.length) throw new Error('Không thấy dòng "Filter" nào theo định dạng AutoEQ / Equalizer APO.');
  return out;
}
export function toAutoEq(state) {
  const rev = { peaking: 'PK', lowshelf: 'LSC', highshelf: 'HSC', lowpass: 'LPQ', highpass: 'HPQ', notch: 'NO' };
  return [`Preamp: ${(+state.preamp).toFixed(1)} dB`, ...state.bands.map((b, i) =>
    `Filter ${i + 1}: ${b.on ? 'ON' : 'OFF'} ${rev[b.type]} Fc ${Math.round(b.freq)} Hz Gain ${(+b.gain).toFixed(1)} dB Q ${(+b.q).toFixed(2)}`)].join('\n');
}

// ── Frequency response (same filters the engine uses) ───────────
let offline = null;
export function response(bands, freqs, sampleRate = 48000) {
  offline ||= new OfflineAudioContext(1, 128, sampleRate);
  const total = new Float32Array(freqs.length);
  const mag = new Float32Array(freqs.length), ph = new Float32Array(freqs.length);
  for (const b of activeBands(bands)) {
    const f = offline.createBiquadFilter();
    applyBand(f, b, offline.currentTime);
    f.getFrequencyResponse(freqs, mag, ph);
    for (let i = 0; i < freqs.length; i++) total[i] += 20 * Math.log10(mag[i] || 1e-6);
  }
  return total;
}

export function applyBand(node, b, t = 0) {   // eslint-disable-line no-unused-vars
  // .value (not setValueAtTime): takes effect at once, and getFrequencyResponse on a node that
  // has never rendered (the response graph) sees it — Chromium ignores pending automation there.
  node.type = b.type;
  node.frequency.value = Math.min(b.freq, node.context.sampleRate * 0.45);
  node.gain.value = b.on ? b.gain : 0;
  // Web Audio shelves ignore Q (fixed slope); lowpass/highpass take Q as resonance in dB.
  node.Q.value = b.type === 'lowpass' || b.type === 'highpass' ? 20 * Math.log10(Math.max(0.1, b.q) / Math.SQRT1_2) : b.q;
  if (!b.on && b.type !== 'peaking' && b.type !== 'lowshelf' && b.type !== 'highshelf') node.type = 'allpass';
}

// Preamp that keeps the loudest boost from clipping.
export function autoPreamp(bands) {
  const freqs = logFreqs(256);
  const r = response(bands, freqs);
  return -Math.max(0, ...r);
}

export function logFreqs(n, lo = 20, hi = 20000) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = lo * Math.pow(hi / lo, i / (n - 1));
  return out;
}

export const effectivePreamp = (s) => s.autoPreamp ? Math.min(s.preamp, autoPreamp(s.bands)) : s.preamp;
