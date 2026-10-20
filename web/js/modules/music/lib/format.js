// How audio formats are described on screen (badges, spec lines, Hi-Res rule).
import { esc } from '../../../core/ui.js';

// Hi-Res rule. 'standard' = better than CD (JAS/CTA style): lossless and >16-bit or >48 kHz.
// 'strict' = at least 24-bit AND at least 88.2 kHz. DSD always counts.
export const HIRES_RULES = {
  standard: 'Trên chuẩn CD: lossless và trên 16-bit hoặc trên 48 kHz',
  strict: 'Nghiêm ngặt: lossless, từ 24-bit và từ 88.2 kHz',
};

export function isHiRes(tech, rule = 'standard') {
  if (!tech || !tech.lossless) return false;
  if (tech.codec === 'DSD') return true;
  const bits = tech.floatPCM ? 32 : tech.bitDepth || 0, sr = tech.sampleRate || 0;
  return rule === 'strict' ? bits >= 24 && sr >= 88200 : bits > 16 || sr > 48000;
}

export const CODECS = {
  FLAC: { name: 'FLAC', full: 'Free Lossless Audio Codec', lossless: true },
  ALAC: { name: 'ALAC', full: 'Apple Lossless', lossless: true },
  WavPack: { name: 'WavPack', full: 'WavPack', lossless: true },
  APE: { name: 'APE', full: "Monkey's Audio", lossless: true },
  PCM: { name: 'PCM', full: 'PCM không nén (WAV/AIFF)', lossless: true },
  DSD: { name: 'DSD', full: 'Direct Stream Digital (1-bit)', lossless: true },
  MP3: { name: 'MP3', full: 'MPEG-1 Layer III', lossless: false },
  AAC: { name: 'AAC', full: 'Advanced Audio Coding', lossless: false },
  Opus: { name: 'Opus', full: 'Opus', lossless: false },
  Vorbis: { name: 'Vorbis', full: 'Ogg Vorbis', lossless: false },
};

export function khz(sr) {
  if (!sr) return '';
  if (sr >= 1e6) return (sr / 1e6).toFixed(1).replace('.0', '') + ' MHz';
  const k = sr / 1000;
  return (Number.isInteger(k) ? k : k.toFixed(1)) + ' kHz';
}
const kNum = (sr) => { const k = sr / 1000; return Number.isInteger(k) ? String(k) : k.toFixed(1); };

export const kbps = (bps) => bps ? Math.round(bps / 1000).toLocaleString((globalThis.__LOCALE || 'vi-VN')) + ' kbps' : '';

export function channelsLabel(n) {
  return { 1: 'Mono', 2: 'Stereo', 3: '2.1', 4: 'Quad', 5: '4.1', 6: '5.1', 8: '7.1' }[n] || (n ? n + ' kênh' : '');
}

const bitsOf = (t) => t.floatPCM ? '32-bit float' : t.bitDepth ? t.bitDepth + '-bit' : '';

// Compact spec next to a format name: '24/96', 'DSD64', '320k'.
export function shortSpec(t) {
  if (!t) return '';
  if (t.codec === 'DSD') return t.dsdRate || 'DSD';
  if (t.lossless && t.bitDepth && t.sampleRate) return `${t.floatPCM ? '32f' : t.bitDepth}/${kNum(t.sampleRate)}`;
  if (t.bitrate) return Math.round(t.bitrate / 1000) + 'k';
  return t.sampleRate ? kNum(t.sampleRate) + 'k' : '';
}

// One line: 'FLAC · 24-bit · 96 kHz · Stereo · 2 304 kbps'
export function techLine(t, { bitrate = true } = {}) {
  if (!t) return 'Chưa có tệp âm thanh';
  const parts = [t.codecLabel || t.codec];
  if (t.codec === 'DSD') parts.push(khz(t.sampleRate));
  else { if (t.lossless) parts.push(bitsOf(t)); parts.push(khz(t.sampleRate)); }
  parts.push(channelsLabel(t.channels));
  if (bitrate && t.bitrate) parts.push(kbps(t.bitrate) + (t.vbr ? ' VBR' : ''));
  return parts.filter(Boolean).join(' · ');
}

// Badge row used in lists, mini player and Now Playing.
export function badges(t, { hiRes, size = '' } = {}) {
  if (!t) return '';
  const fam = t.lossless ? 'lossless' : 'lossy';
  const spec = shortSpec(t);
  return `<span class="mfmt ${size}"><b class="mfmt-${fam}">${esc(t.codecLabel || t.codec)}</b>${spec ? `<i>${esc(spec)}</i>` : ''}</span>${hiRes ? `<span class="hires ${size}" title="Hi-Res Audio">Hi-Res</span>` : ''}`;
}

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtTotal(sec) {
  const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
  if (!h && sec < 60) return `${Math.round(sec)} giây`;
  return h ? `${h} giờ ${m} phút` : `${m} phút`;
}

export const dB = (v, digits = 1) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits) + ' dB';
