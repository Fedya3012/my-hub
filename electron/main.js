// Windows shell for My Hub. It serves web/ from a fixed localhost port so the app keeps a
// stable origin: IndexedDB data survives updates, 
// http://localhost:<port> as an authorized JavaScript origin.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, net } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 47821;
const WEB = path.join(__dirname, '..', 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.lrc': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

function serve() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (range) {   // audio/video seeking
        const start = range[1] ? +range[1] : 0, end = range[2] ? +range[2] : st.size - 1;
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, 'localhost', () => resolve(server));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 360, minHeight: 560,
    backgroundColor: '#eef1f4', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.once('ready-to-show', () => win.show());
  // App feel: no pinch/ctrl-zoom, no browser-style context menu on the page background.
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('context-menu', (e, params) => { if (!params.isEditable && !params.selectionText) e.preventDefault(); });
  // Every external link opens in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://localhost:${PORT}/#library`);
}

// Cloud drives (WebDAV, FileJump): WebDAV servers rarely send CORS headers, so the page asks the main
// process to make the request (no CORS there). Only http(s) and only the methods the app uses.
function setupHttp() {
  ipcMain.handle('hub:http', async (_e, { url, method = 'GET', headers = {}, body = null }) => {
    if (!/^https?:\/\//i.test(url) || !['GET', 'PUT', 'DELETE', 'POST', 'HEAD'].includes(method)) throw new Error('Yêu cầu không hợp lệ');
    const res = await net.fetch(url, { method, headers, body: body == null ? undefined : (typeof body === 'string' ? body : Buffer.from(body)), bypassCustomProtocolHandlers: true });
    const buf = method === 'HEAD' ? new ArrayBuffer(0) : await res.arrayBuffer();
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: buf };
  });
}

const REPO = 'Fedya3012/my-hub';
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

// Installed (Setup.exe) builds download the new version from GitHub Releases in the background
// and offer to restart into it. The portable build cannot replace itself, so it only tells the
// user a newer release exists and opens the download page.
function setupUpdates() {
  const win = () => BrowserWindow.getAllWindows()[0];
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    ipcMain.handle('hub:update-install', async () => { shell.openExternal(`https://github.com/${REPO}/releases/latest`); return { portable: true }; });
    const check = () => https.get({ host: 'api.github.com', path: `/repos/${REPO}/releases/latest`, headers: { 'User-Agent': 'my-hub' } }, (res) => {
      let body = ''; res.on('data', (d) => body += d); res.on('end', async () => {
        try {
          const rel = JSON.parse(body), v = String(rel.tag_name || '').replace(/^v/, '');
          if (!v || !newer(v, require('../package.json').displayVersion || app.getVersion())) return;
          const r = await dialog.showMessageBox(win(), { type: 'info', buttons: ['Mở trang tải', 'Để sau'], defaultId: 0, cancelId: 1, title: 'My Hub', message: `Có phiên bản mới ${v}`, detail: 'Bản portable không tự cập nhật. Hãy tải bản mới (hoặc dùng bản Setup để tự cập nhật).' });
          if (r.response === 0) shell.openExternal(rel.html_url);
        } catch { /* offline or rate-limited: try again later */ }
      });
    }).on('error', () => {});
    setTimeout(check, 8000); setInterval(check, 6 * 3600e3);
    return;
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let shownErr = false;
  autoUpdater.on('error', (e) => {
    console.warn('[updater]', e?.message || e);
    if (shownErr) return; shownErr = true;   // one dialog per run, with the real reason
    dialog.showMessageBox(win(), { type: 'warning', buttons: ['Mở trang tải', 'Đóng'], defaultId: 0, cancelId: 1, title: 'My Hub', message: 'Không tự cập nhật được', detail: String(e?.message || e).slice(0, 600) + '\n\nBạn có thể tải bản Setup mới ở trang Releases và chạy đè lên, dữ liệu vẫn giữ.' })
      .then((r) => { if (r.response === 0) shell.openExternal('https://github.com/Fedya3012/my-hub/releases/latest'); }).catch(() => {});
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const r = await dialog.showMessageBox(win(), { type: 'info', buttons: ['Khởi động lại ngay', 'Để sau'], defaultId: 0, cancelId: 1, title: 'My Hub', message: `Đã tải xong phiên bản ${info.version}`, detail: 'Khởi động lại để cập nhật. Dữ liệu của bạn được giữ nguyên. Chọn "Để sau" thì bản mới tự cài khi bạn đóng app.' });
    if (r.response === 0) autoUpdater.quitAndInstall(true, true);
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  // "Cập nhật lõi" in the app: the web files are inside this installer, so a new core means a new installer.
  ipcMain.handle('hub:update-install', async () => {
    const r = await autoUpdater.checkForUpdates();   // autoDownload: the restart dialog follows 'update-downloaded'
    return { version: r?.updateInfo?.version, available: !!r?.isUpdateAvailable };
  });
  setTimeout(check, 8000); setInterval(check, 6 * 3600e3);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try { await serve(); } catch (e) { console.error('[my-hub] port in use', e.message); }
    createWindow();
    setupHttp();
    if (app.isPackaged) setupUpdates();
  });
  app.on('window-all-closed', () => app.quit());
}
