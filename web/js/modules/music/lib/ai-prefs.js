// AI lyrics settings with an optional per-song layer: lyrics.aiSong = { trackId: { aiGenModel, aiModel, aiVocal,
// aiLang, trModel, trLang } }. A song's own value wins; anything it does not set comes from the shared setting.
import { prefs, setPref } from './prefs.js';

export const SONG_KEYS = ['aiGenModel', 'aiModel', 'aiVocal', 'aiLang', 'trModel', 'trLang'];
const Y = () => prefs().lyrics || {};

export const songPrefs = (t) => (t?.id && Y().aiSong?.[t.id]) || null;
export const hasSongPrefs = (t) => !!songPrefs(t) && Object.keys(songPrefs(t)).length > 0;

export function aiPref(key, t) {
  const o = songPrefs(t);
  return o && o[key] !== undefined ? o[key] : Y()[key];
}

// t = null (or scope 'all') writes the shared setting; a song writes only that song's layer.
export async function setAiPref(key, val, t = null) {
  if (!t?.id) return setPref('lyrics.' + key, val);
  const all = { ...(Y().aiSong || {}) };
  all[t.id] = { ...(all[t.id] || {}), [key]: val };
  return setPref('lyrics.aiSong', all);
}

export async function clearSongPrefs(t) {
  if (!t?.id || !Y().aiSong?.[t.id]) return;
  const all = { ...Y().aiSong };
  delete all[t.id];
  return setPref('lyrics.aiSong', all);
}
