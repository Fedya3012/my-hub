// Bridge for the Windows app: lets the page ask the shell to download and install a new version.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hubDesktop', {
  installUpdate: () => ipcRenderer.invoke('hub:update-install'),
  http: (req) => ipcRenderer.invoke('hub:http', req),
  xs: {
    available: () => ipcRenderer.invoke('hub:xs-available'),
    cmd: (line) => ipcRenderer.invoke('hub:xs', line),
    file: (key, data) => ipcRenderer.invoke('hub:xs-file', { key, data }),
    on: (cb) => { const f = (_e, line) => cb(line); ipcRenderer.on('hub:xs-event', f); return () => ipcRenderer.removeListener('hub:xs-event', f); },
  },
});
