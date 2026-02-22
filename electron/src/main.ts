import { app, BrowserWindow, ipcMain, shell, session } from 'electron';
import path from 'path';
import { initDb } from './db';

let win: BrowserWindow | null = null;

function createWindow() {
  console.log('[Electron][Main] createWindow ✅');

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const isDev = !app.isPackaged;

  // ✅ Reader app dev URL
  const devUrl = 'http://localhost:4300';

  if (isDev) {
    console.log('[Electron][Main] DEV load:', devUrl);
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // ✅ IMPORTANT: build output path (Step-6 में finalize करेंगे)
    const indexHtml = path.join(__dirname, '../dist/reader/browser/index.html');
    console.log('[Electron][Main] PROD load:', indexHtml);
    win.loadFile(indexHtml);
  }

  // ✅ External links app के अंदर open नहीं होंगे
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Electron][Security] blocked window.open:', url);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    const allow = url.startsWith(devUrl) || url.startsWith('file://');
    if (!allow) {
      console.log('[Electron][Security] blocked navigation:', url);
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // ✅ “Offline Tutor Mode” network block (app के अंदर)
  // NOTE: DEV में Angular localhost allowed रहेगा
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allow = url.startsWith(devUrl) || url.startsWith('file://');
    if (!allow) {
      console.log('[Electron][NetBlock] blocked:', url);
      return callback({ cancel: true });
    }
    callback({ cancel: false });
  });

  win.on('closed', () => (win = null));
}

// ✅ IPC test
ipcMain.handle('mm:ping', async () => {
  console.log('[Electron][IPC] mm:ping ✅');
  return { ok: true, ts: Date.now() };
});

app.whenReady().then(() => {
  console.log('[Electron][Main] app ready ✅');
  initDb();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});