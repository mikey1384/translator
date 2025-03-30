import { app, BrowserWindow } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';
import log from 'electron-log'; // electron-log is already configured by main.cjs

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  log.info('[src/main.ts] Creating main window...');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // __dirname in dist/main.js will be /path/to/project/dist
      preload: path.join(__dirname, 'preload', 'index.js'),
      // Defaults are recommended:
      // sandbox: true, // default in Electron 20+
      // contextIsolation: true, // default
      // nodeIntegration: false, // default
    },
  });

  // Load the renderer entry point using loadFile for local HTML
  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  log.info(`[src/main.ts] Loading renderer file: ${rendererPath}`);
  mainWindow.loadFile(rendererPath);

  // Open the DevTools automatically if running in development
  const isRunningInDev = process.env.BUN_ENV === 'development' || isDev;
  if (isRunningInDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    log.info('[src/main.ts] Main window closed.');
    mainWindow = null;
  });
}

// App lifecycle events handled below
// Handler initialization is done in main.cjs

app.whenReady().then(() => {
  log.info('[src/main.ts] App ready event received.');
  createWindow();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      log.info(
        '[src/main.ts] App activated with no windows open, creating new window.'
      );
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  log.info('[src/main.ts] All windows closed event received.');
  // Quit when all windows are closed, except on macOS.
  if (process.platform !== 'darwin') {
    log.info('[src/main.ts] Quitting application (not macOS).');
    app.quit();
  }
});

// Note: single-instance lock is handled in main.cjs
// Note: initial logging setup is handled in main.cjs

log.info(
  '[src/main.ts] Main process TypeScript module loaded successfully by main.cjs.'
);
