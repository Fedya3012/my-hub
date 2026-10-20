// Identity of this device, so synced progress can say "paused on Windows 5 minutes ago".
import { db, uid, now, getSetting, setSetting } from './db.js';

function detectPlatform() {
  const ua = navigator.userAgent;
  const uaPlatform = navigator.userAgentData?.platform || '';
  const apk = document.referrer.startsWith('android-app://');
  if (/Android/i.test(ua)) return { platform: 'android', name: apk ? 'Điện thoại Android (APK)' : 'Điện thoại Android' };
  if (/iPhone|iPad|iPod/i.test(ua)) return { platform: 'ios', name: /iPad/.test(ua) ? 'iPad' : 'iPhone' };
  if (/Windows/i.test(uaPlatform + ua)) return { platform: 'windows', name: 'Máy tính Windows' };
  if (/Mac/i.test(uaPlatform + ua)) return { platform: 'mac', name: 'Máy Mac' };
  if (/Linux|CrOS/i.test(uaPlatform + ua)) return { platform: 'linux', name: 'Máy tính Linux' };
  return { platform: 'other', name: 'Thiết bị khác' };
}

let cached = null;

// Stable id stored locally (never synced as a setting), plus a row in db.devices that is synced.
export async function thisDevice() {
  if (cached) return cached;
  let id = await getSetting('device.id');
  if (!id) { id = uid(); await setSetting('device.id', id); }
  const detected = detectPlatform();
  const row = (await db.devices.get(id)) || { id, createdAt: now() };
  cached = { ...row, ...detected, name: row.customName || detected.name, lastSeenAt: now(), updatedAt: now() };
  await db.devices.put(cached);
  return cached;
}

export async function renameDevice(name) {
  const d = await thisDevice();
  cached = { ...d, customName: name, name, updatedAt: now() };
  await db.devices.put(cached);
}

export async function touchDevice() {
  const d = await thisDevice();
  d.lastSeenAt = d.updatedAt = now();
  await db.devices.put(d);
}

export async function deviceName(id) {
  if (!id) return null;
  const d = await thisDevice();
  if (id === d.id) return 'máy này';
  return (await db.devices.get(id))?.name || 'thiết bị khác';
}
