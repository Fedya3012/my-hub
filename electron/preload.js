// Bridge for the Windows app: lets the page ask the shell to download and install a new version.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hubDesktop', {
  installUpdate: () => ipcRenderer.invoke('hub:update-install'),
  http: (req) => ipcRenderer.invoke('hub:http', req),
});
