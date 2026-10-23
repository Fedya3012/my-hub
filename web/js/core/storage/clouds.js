// Connection settings of the cloud drives (Dropbox, OneDrive): kept in localStorage on this
// device only, never in the JSON backup (they hold passwords and tokens). Shape per provider:
//   dropbox           : { appKey, access, refresh, expires }
//   onedrive          : { clientId, access, refresh, expires }
//   googledrive       : { clientId, secret, access, refresh, expires }
const KEY = 'myhub.clouds';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
export const clouds = {
  get: (id) => read()[id] || null,
  set(id, v) {
    const all = read(); if (v) all[id] = v; else delete all[id];
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: lost on reload */ }
    mem[id] = v || null;
  },
};
const mem = {};
// Memory copy first so a private-mode failure still works for this session.
export const getCloud = (id) => (id in mem ? mem[id] : (mem[id] = clouds.get(id)));
