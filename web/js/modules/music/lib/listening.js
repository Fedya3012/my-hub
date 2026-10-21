// Which sound output is in use ("tai nghe Bluetooth", "loa ngoài", a named device) for the "Đang nghe trên…" line.
// Browsers only reveal output labels once the page has an audio permission; without labels we say what we can
// (the chosen output device, else "loa mặc định"). The result travels with the cross-device session.
import { prefs } from './prefs.js';

const KINDS = [
  ['bluetooth', /bluetooth|airpods|buds|\bwh-|\bwf-|\bqc\d|headset|hands-?free|tws/i, 'Tai nghe Bluetooth'],
  ['headphones', /headphone|earphone|earbud|tai nghe|headset|\bhp\b/i, 'Tai nghe'],
  ['hdmi', /hdmi|displayport|tv\b|monitor/i, 'Màn hình / TV'],
  ['usb', /usb|dac|amp\b/i, 'DAC / USB'],
  ['speaker', /speaker|loa|built-?in|internal/i, 'Loa'],
];
const clean = (l) => (l || '').replace(/^(default|communications)\s*-\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/i, '').trim();

export async function detectOutput() {
  const out = { kind: 'unknown', label: 'Loa mặc định' };
  try {
    const list = (await navigator.mediaDevices?.enumerateDevices?.() || []).filter(d => d.kind === 'audiooutput');
    const wanted = prefs().playback?.sinkId;
    const dev = (wanted && list.find(d => d.deviceId === wanted)) || list.find(d => d.deviceId === 'default') || list[0];
    const label = clean(dev?.label);
    if (label) { out.label = label; const k = KINDS.find(([, re]) => re.test(label)); if (k) out.kind = k[0]; else out.kind = 'speaker'; }
  } catch { /* keep the default */ }
  return out;
}

export const OUT_NAMES = { bluetooth: 'Tai nghe Bluetooth', headphones: 'Tai nghe', hdmi: 'Màn hình / TV', usb: 'DAC / USB', speaker: 'Loa', unknown: 'Loa' };
export function watchOutput(cb) {
  const md = navigator.mediaDevices;
  if (!md?.addEventListener) return () => {};
  const f = async () => cb(await detectOutput());
  md.addEventListener('devicechange', f);
  return () => md.removeEventListener('devicechange', f);
}
