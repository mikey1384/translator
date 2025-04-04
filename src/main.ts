import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';
import log from 'electron-log'; // electron-log is already configured by main.cjs
import electronContextMenu from 'electron-context-menu'; // Import the library

let mainWindow: BrowserWindow | null = null;

// Variable to store the last search text for findNext
let lastSearchText = '';

async function createWindow() {
  log.info('[src/main.ts] Creating main window...');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // __dirname in dist/main.js will be /path/to/project/dist
      preload: path.join(__dirname, 'preload', 'index.js'),
      // Defaults are recommended:
      // sandbox: true, // default in Electron 20+
      contextIsolation: true, // Keep true for security
      nodeIntegration: false, // Keep false for security
      webSecurity: false, // Required for loading local files sometimes, but use with caution
      allowRunningInsecureContent: false, // Keep false for security
    },
  });

  // Initialize the context menu, hiding Inspect Element
  electronContextMenu({
    window: mainWindow,
    showInspectElement: false,
  });

  // Load the renderer entry point using loadFile for local HTML
  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  log.info(`[src/main.ts] Loading renderer file: ${rendererPath}`);

  // Configure the session to properly handle file:// URLs
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      // Allow all permissions including media access
      callback(true);
    }
  );

  // Configure file protocol handling
  mainWindow.webContents.session.protocol.registerFileProtocol(
    'file',
    (request, callback) => {
      const filePath = decodeURI(request.url.replace('file://', ''));
      try {
        callback(filePath);
      } catch (error) {
        log.error(`Error with file protocol: ${error}`);
      }
    }
  );

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

  // Find-in-page IPC listeners
  ipcMain.on(
    'find-in-page',
    (_event, { text, findNext, forward, matchCase }) => {
      if (mainWindow && text) {
        if (text !== lastSearchText) {
          // Reset if text changes
          lastSearchText = text;
        }
        const options = {
          findNext: findNext || false,
          forward: forward === undefined ? true : forward, // Default to searching forward
          matchCase: matchCase || false,
        };
        log.info(`[main.ts] Finding in page: "${text}", options:`, options);
        mainWindow.webContents.findInPage(text, options);
      } else if (mainWindow && !text) {
        // If text is empty, stop the current find operation
        log.info('[main.ts] Stopping find due to empty text');
        mainWindow.webContents.stopFindInPage('clearSelection');
        lastSearchText = ''; // Reset last search text
      }
    }
  );

  ipcMain.on('stop-find', () => {
    if (mainWindow) {
      log.info('[main.ts] Stopping find via IPC');
      mainWindow.webContents.stopFindInPage('clearSelection');
      lastSearchText = ''; // Reset last search text
    }
  });

  // Listen for find results and forward to renderer
  if (mainWindow) {
    // Ensure mainWindow exists before accessing webContents
    mainWindow.webContents.on('found-in-page', (_event, result) => {
      log.info('[main.ts] Found in page event:', result);
      if (mainWindow) {
        // Check again inside async callback
        mainWindow.webContents.send('find-results', {
          matches: result.matches,
          activeMatchOrdinal: result.activeMatchOrdinal,
          finalUpdate: result.finalUpdate,
        });
      }
    });
  }

  // Basic Menu Setup (you might already have this or more)
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' }, // Add separator
        {
          // Add Find menu item
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            if (mainWindow) {
              log.info(
                '[main.ts] Find menu item clicked, sending show-find-bar'
              );
              mainWindow.webContents.send('show-find-bar');
            }
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/your-repo'); // Replace with your repo link
          },
        },
      ],
    },
  ];

  // macOS specific menu setup
  if (process.platform === 'darwin') {
    const name = app.getName();
    menuTemplate.unshift({
      label: name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
    // Window menu
    menuTemplate[4].submenu = [
      { role: 'close' },
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' },
    ];
  }

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
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

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Note: single-instance lock is handled in main.cjs
// Note: initial logging setup is handled in main.cjs

log.info(
  '[src/main.ts] Main process TypeScript module loaded successfully by main.cjs.'
);
