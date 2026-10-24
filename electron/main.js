// Windows shell for My Hub. It serves web/ from a fixed localhost port so the app keeps a
// stable origin: IndexedDB data survives updates, 
// http://localhost:<port> as an authorized JavaScript origin.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, net } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const { spawn } = require('child_process');
const os = require('os');

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
    // oauth-google.html (opened in the system browser) hands Google's answer to the app window.
    if (req.method === 'POST' && req.url === '/__google') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 8192) req.destroy(); });
      req.on('end', () => {
        for (const w of BrowserWindow.getAllWindows()) { w.webContents.send('hub:google', body); w.show(); w.focus(); }
        res.writeHead(204); res.end();
      });
      return;
    }
    let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB + path.sep)) { res.writeHead(403); return res.end(); }   // a sibling folder named web… must not pass
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

const APP_ORIGIN = `http://localhost:${PORT}`;
const fromApp = (url) => { try { return new URL(url).origin === APP_ORIGIN; } catch { return false; } };
// IPC answers only the app's own page (not a frame or page from elsewhere).
const fromAppFrame = (e) => fromApp(e.senderFrame?.url || '');

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
  // The window only ever shows the app: a link that would navigate it to another site opens in the browser instead,
  // so no outside page gets the hubDesktop bridge (preload.js).
  win.webContents.on('will-navigate', (e, url) => {
    if (fromApp(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.loadURL(`http://localhost:${PORT}/#library`);
}

// Cloud drives (Dropbox, OneDrive token): some providers send no CORS headers, so the page asks the main
// process to make the request (no CORS there). Only http(s) and only the methods the app uses.
function setupHttp() {
  ipcMain.handle('hub:http', async (e, { url, method = 'GET', headers = {}, body = null }) => {
    if (!fromAppFrame(e)) throw new Error('Không được phép');
    if (!/^https?:\/\//i.test(url) || !['GET', 'PUT', 'DELETE', 'POST', 'HEAD'].includes(method)) throw new Error('Yêu cầu không hợp lệ');
    const res = await net.fetch(url, { method, headers, body: body == null ? undefined : (typeof body === 'string' ? body : Buffer.from(body)), bypassCustomProtocolHandlers: true });
    const buf = method === 'HEAD' ? new ArrayBuffer(0) : await res.arrayBuffer();
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: buf };
  });
}

// Bit-perfect output (WASAPI Exclusive): native/xs-audio (C, built in CI) plays FLAC / WAV / MP3 files straight to
// the DAC at their own format. The page copies the song to a temp file once (hub:xs-file), then drives the
// player with one-line commands (hub:xs) and gets its lines back as 'hub:xs-event'. See native/xs-audio/xs-audio.c.
function setupExclusive() {
  const exe = app.isPackaged ? path.join(process.resourcesPath, 'native', 'xs-audio.exe') : path.join(__dirname, '..', 'build', 'native', 'xs-audio.exe');
  const dir = path.join(os.tmpdir(), 'myhub-xs');
  let proc = null, buf = '';
  const send = (line) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('hub:xs-event', line); };
  const start = () => {
    if (proc) return proc;
    if (process.platform !== 'win32' || !fs.existsSync(exe)) throw new Error('Chế độ độc quyền chỉ có trên bản Windows');
    proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { send(buf.slice(0, i).trim()); buf = buf.slice(i + 1); } });
    proc.on('exit', () => { proc = null; send('exit'); });
    return proc;
  };
  ipcMain.handle('hub:xs-available', () => process.platform === 'win32' && fs.existsSync(exe));
  ipcMain.handle('hub:xs', (e, line) => {
    if (!fromAppFrame(e)) throw new Error('Không được phép');
    if (typeof line !== 'string' || /[\r\n]/.test(line)) throw new Error('Lệnh không hợp lệ');
    start().stdin.write(line + '\n');
  });
  // Song → temp file named by key (track id + size). The last few are kept so going back is instant.
  ipcMain.handle('hub:xs-file', async (e, { key, data }) => {
    if (!fromAppFrame(e)) throw new Error('Không được phép');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, String(key).replace(/[^\w.-]/g, '_'));
    if (data) await fs.promises.writeFile(file, Buffer.from(data));
    else if (!fs.existsSync(file)) return null;
    const all = (await fs.promises.readdir(dir)).map(n => path.join(dir, n));
    const st = await Promise.all(all.map(async f => [f, (await fs.promises.stat(f)).mtimeMs]));
    st.sort((a, b) => b[1] - a[1]).slice(6).forEach(([f]) => { if (f !== file) fs.promises.unlink(f).catch(() => {}); });
    return file;
  });
  app.on('before-quit', () => { try { proc?.stdin.write('quit\n'); } catch { /* gone */ } });
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
    setupExclusive();
    if (app.isPackaged) setupUpdates();
  });
  app.on('window-all-closed', () => app.quit());
}
