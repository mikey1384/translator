import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  dialog,
  MenuItemConstructorOptions,
} from 'electron';
import path from 'path';
import * as fsPromises from 'fs/promises';
import { fileURLToPath } from 'url';
import log from 'electron-log';
import electronContextMenu from 'electron-context-menu';
import nodeProcess from 'process';

// --- ES Module __dirname / __filename Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Constants ---
const isDev = !app.isPackaged;

// --- Services & Handlers Imports ---
import { FFmpegService } from './services/ffmpeg-service.js';
import { SaveFileService } from './services/save-file.js';
import { FileManager } from './services/file-manager.js';
import {
  handleProcessUrl,
  initializeUrlHandler,
} from './handlers/url-handler.js';
import * as fileHandlers from './handlers/file-handlers.js';
import * as apiKeyHandlers from './handlers/api-key-handlers.js';
import * as subtitleHandlers from './handlers/subtitle-handlers.js';
import * as utilityHandlers from './handlers/utility-handlers.js';

log.info('--- [main.ts] Execution Started ---');

// --- Single Instance Lock ---
// Ensure only one instance of the app runs
if (!app.requestSingleInstanceLock()) {
  log.info('[main.ts] Another instance detected. Quitting this instance.');
  app.quit();
  nodeProcess.exit(0);
}
app.on('second-instance', () => {
  // Someone tried to run a second instance, we should focus our window.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// --- Global Variables ---
let mainWindow: BrowserWindow | null = null;
let services: {
  saveFileService: SaveFileService;
  fileManager: FileManager;
  ffmpegService: FFmpegService;
} | null = null;
let isQuitting = false; // Flag for will-quit handler

// --- Service and Handler Initialization ---
try {
  log.info('[main.ts] Initializing Services...');

  // Determine the correct application-specific temp path
  const appDataPath = app.getPath('appData');
  const appNameDir = 'translator-electron'; // Use the consistent directory name
  const correctTempPath = path.join(appDataPath, appNameDir, 'temp');
  log.info(`[main.ts] Determined temp path for services: ${correctTempPath}`);

  // Instantiate services, injecting the correct temp path
  const saveFileService = SaveFileService.getInstance();
  const fileManager = new FileManager(correctTempPath);
  const ffmpegService = new FFmpegService(correctTempPath);

  services = { saveFileService, fileManager, ffmpegService };
  log.info('[main.ts] Services Initialized.');

  // Initialize Handlers, passing required services
  log.info('[main.ts] Initializing Handlers...');
  fileHandlers.initializeFileHandlers({ fileManager, saveFileService });
  subtitleHandlers.initializeSubtitleHandlers({ ffmpegService, fileManager });
  initializeUrlHandler({ fileManager, ffmpegService }); // Pass both services
  log.info('[main.ts] Handlers Initialized.');

  // --- IPC Handlers Registration ---
  log.info('[main.ts] Registering IPC Handlers...');
  // Utility
  ipcMain.handle('ping', utilityHandlers.handlePing);
  ipcMain.handle('show-message', utilityHandlers.handleShowMessage);
  // File Operations
  ipcMain.handle('save-file', fileHandlers.handleSaveFile);
  ipcMain.handle('open-file', fileHandlers.handleOpenFile); // Registered handler
  ipcMain.handle('move-file', fileHandlers.handleMoveFile);
  ipcMain.handle('copy-file', fileHandlers.handleCopyFile);
  ipcMain.handle('delete-file', fileHandlers.handleDeleteFile);
  ipcMain.handle('readFileContent', fileHandlers.handleReadFileContent);
  // API Keys
  ipcMain.handle('get-api-key-status', apiKeyHandlers.handleGetApiKeyStatus);
  ipcMain.handle('save-api-key', apiKeyHandlers.handleSaveApiKey);
  // Subtitles
  ipcMain.handle('merge-subtitles', subtitleHandlers.handleMergeSubtitles);
  ipcMain.handle(
    'generate-subtitles',
    subtitleHandlers.handleGenerateSubtitles
  );
  ipcMain.handle('cancel-operation', subtitleHandlers.handleCancelOperation);
  // URL Processing
  ipcMain.handle('process-url', handleProcessUrl);
  log.info('[main.ts] IPC Handlers Registered.');
} catch (error) {
  log.error('[main.ts] FATAL: Error during initial setup:', error);
  // Attempt to show error dialog only after app is ready
  app
    .whenReady()
    .then(() => {
      dialog.showErrorBox(
        'Initialization Error',
        `Failed to initialize application components. Please check logs. Error: ${error instanceof Error ? error.message : String(error)}`
      );
      // Give user time to see message before quitting
      setTimeout(() => {
        app.quit();
        nodeProcess.exit(1);
      }, 5000);
    })
    .catch(readyErr => {
      // If whenReady itself fails, log to console and exit
      console.error(
        'FATAL: Error during app.whenReady after setup failure:',
        readyErr
      );
      nodeProcess.exit(1);
    });
}

// --- App Event Handler: will-quit (Handles Cleanup) ---
app.on('will-quit', async event => {
  log.info(`[main.ts] 'will-quit' event triggered. isQuitting: ${isQuitting}`);

  // Prevent loop if triggered by our own app.quit() call
  if (isQuitting) {
    return;
  }

  // Set flag and prevent immediate exit to allow cleanup
  isQuitting = true;
  event.preventDefault();

  log.info('[main.ts] Starting cleanup before quitting...');
  try {
    if (services?.fileManager?.cleanup) {
      log.info('[main.ts] Attempting cleanup via FileManager...');
      await services.fileManager.cleanup();
      log.info('[main.ts] FileManager cleanup finished.');
    } else {
      log.warn('[main.ts] FileManager service not available for cleanup.');
    }
  } catch (err) {
    log.error('[main.ts] Error during cleanup:', err);
  } finally {
    // Allow the app to quit now that cleanup is done (or failed)
    log.info('[main.ts] Cleanup finished. Quitting app manually.');
    app.quit();
  }
});

// --- App Event Handler: window-all-closed ---
app.on('window-all-closed', () => {
  log.info('[main.ts] All windows closed.');
  // Quit the app on Windows & Linux. Keep running on macOS (standard behavior).
  if (nodeProcess.platform !== 'darwin') {
    log.info('[main.ts] Quitting app (non-macOS).');
    app.quit(); // This will trigger 'will-quit'
  }
});

// --- App Event Handler: activate (macOS) ---
app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    log.info("[main.ts] 'activate' event: No windows open, creating new one.");
    createWindow().catch(err =>
      log.error('[main.ts] Error recreating window on activate:', err)
    );
  }
});

// --- Uncaught Exception Handler ---
nodeProcess.on('uncaughtException', error => {
  log.error('[main.ts] UNCAUGHT EXCEPTION:', error);
  // Consider showing a dialog before quitting in production
  if (!isDev) {
    dialog.showErrorBox(
      'Unhandled Error',
      `An unexpected error occurred: ${error.message}\nThe application will now quit.`
    );
    app.quit();
    nodeProcess.exit(1);
  }
});

// --- Main Window Creation Function ---
async function createWindow() {
  log.info('[main.ts] Creating main window...');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Security recommendations:
      contextIsolation: true, // Keep true (default)
      nodeIntegration: false, // Keep false (default)
      webSecurity: !isDev, // Disable only in dev if necessary, but prefer keeping it true
      allowRunningInsecureContent: false,
      // Preload script:
      preload: path.join(__dirname, 'preload', 'index.js'), // Correct path using __dirname
    },
  });

  // Context Menu Setup
  electronContextMenu({
    window: mainWindow,
    showInspectElement: isDev, // Only show "Inspect Element" in development
  });

  // Load Renderer HTML
  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  log.info(`[main.ts] Loading renderer from: ${rendererPath}`);
  try {
    await mainWindow.loadFile(rendererPath);
    log.info('[main.ts] Renderer loaded successfully.');
  } catch (loadError: any) {
    log.error('[main.ts] Error loading renderer HTML:', loadError);
    // Handle error (e.g., show dialog, quit)
    dialog.showErrorBox(
      'Load Error',
      `Failed to load application UI: ${loadError.message}`
    );
    app.quit();
    return;
  }

  // Protocol Registration (Example - adjust if needed)
  // Ensure this doesn't interfere with loading the main file
  // mainWindow.webContents.session.protocol.registerFileProtocol(
  //   'file',
  //   (request, callback) => {
  //     try {
  //        const filePath = decodeURI(request.url.replace('file:///', '/')); // Adjust for platform if needed
  //        callback(filePath);
  //     } catch (error) {
  //        log.error('File protocol error:', error);
  //        callback({ error: -6 /* FILE_NOT_FOUND */ } as any);
  //     }
  //   }
  // );

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Window Event: Closed
  mainWindow.on('closed', () => {
    log.info('[main.ts] Main window closed.');
    mainWindow = null; // Dereference the window object
  });

  // --- Find-in-Page IPC ---
  let currentFindText = '';
  ipcMain.on(
    'find-in-page',
    (_event, { text, findNext, forward, matchCase }) => {
      if (!mainWindow) return;
      if (text && text.length > 0) {
        if (text !== currentFindText) currentFindText = text; // Update search text
        mainWindow.webContents.findInPage(text, {
          findNext: !!findNext,
          forward: forward === undefined ? true : forward,
          matchCase: !!matchCase,
        });
      } else {
        mainWindow.webContents.stopFindInPage('clearSelection');
        currentFindText = '';
      }
    }
  );

  ipcMain.on('stop-find', () => {
    if (mainWindow) {
      mainWindow.webContents.stopFindInPage('clearSelection');
      currentFindText = '';
    }
  });

  mainWindow.webContents.on('found-in-page', (_event, result) => {
    // Send results back to renderer for display
    mainWindow?.webContents.send('find-results', {
      matches: result.matches,
      activeMatchOrdinal: result.activeMatchOrdinal,
      finalUpdate: result.finalUpdate,
    });
  });

  // --- Application Menu ---
  createApplicationMenu(); // Call function to set up menu
} // End createWindow()

// --- Application Menu Setup Function ---
function createApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    // { role: 'appMenu' } // Standard macOS app menu
    ...((nodeProcess.platform === 'darwin'
      ? [
          {
            label: app.getName(),
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
          },
        ]
      : []) as MenuItemConstructorOptions[]),
    // { role: 'fileMenu' } // Standard File menu
    {
      label: 'File',
      submenu: [
        nodeProcess.platform === 'darwin'
          ? { role: 'close' }
          : { role: 'quit' },
      ],
    },
    // { role: 'editMenu' } // Standard Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...((nodeProcess.platform === 'darwin'
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: 'Speech',
                submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
              },
            ]
          : [
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' },
            ]) as MenuItemConstructorOptions[]),
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('show-find-bar'),
        },
      ],
    },
    // { role: 'viewMenu' } // Standard View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...((isDev
          ? [{ role: 'toggleDevTools' }]
          : []) as MenuItemConstructorOptions[]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    // { role: 'windowMenu' } // Standard Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...((nodeProcess.platform === 'darwin'
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' },
            ]
          : [{ role: 'close' }]) as MenuItemConstructorOptions[]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More (Example)',
          click: async () => {
            await shell.openExternal('https://github.com/your-repo'); // Replace with actual URL
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  log.info('[main.ts] Application menu created.');
}

// --- yt-dlp Installation Test (Optional - Keep if needed) ---
async function testYtDlpInstallation() {
  // Implement the check logic here if required, similar to the original file
  // Ensure paths are correctly resolved for packaged apps (app.asar.unpacked)
  log.warn(
    '[main.ts] testYtDlpInstallation function needs implementation if required.'
  );
  return true;
}

// --- App Ready Handler ---
app
  .whenReady()
  .then(async () => {
    log.info('[main.ts] App is ready.');

    // --- Configure Logging ---
    try {
      // Use app.getPath('logs') for production logs for standard location
      const logDirPath = isDev ? '.' : app.getPath('logs');
      // Ensure the consistent app name ('translator-electron') is reflected if needed
      // Note: electron-log might handle subdirectories based on app name automatically
      const logFileName = isDev ? 'dev-main.log' : 'main.log';
      const logFilePath = path.join(logDirPath, logFileName);

      // Ensure log directory exists
      try {
        await fsPromises.mkdir(logDirPath, { recursive: true });
      } catch (mkdirError: any) {
        if (mkdirError.code !== 'EEXIST') {
          console.error(
            `[main.ts] Failed to ensure log directory ${logDirPath}:`,
            mkdirError
          );
          // Continue, logging might still work to default location
        }
      }

      // Configure electron-log file transport
      log.transports.file.resolvePathFn = () => logFilePath;
      log.transports.file.level = isDev ? 'debug' : 'info';
      log.transports.console.level = isDev ? 'debug' : 'info'; // Also configure console

      // Log config info AFTER setting it up
      const resolvedLogPath = log.transports.file.getFile().path; // Get path after setting resolvePathFn
      log.info(
        `[main.ts] Logging Mode: ${isDev ? 'Development' : 'Production'}`
      );
      log.info(`[main.ts] Log Level: ${log.transports.file.level}`);
      log.info(`[main.ts] Attempting to log to: ${logFilePath}`);
      log.info(`[main.ts] Resolved log file path: ${resolvedLogPath}`);
    } catch (error) {
      console.error('[main.ts] Error configuring logging:', error);
    }

    // --- Startup Cleanup ---
    log.info('[main.ts] Performing startup cleanup...');
    if (services?.fileManager?.cleanup) {
      try {
        await services.fileManager.cleanup();
        log.info('[main.ts] Startup cleanup finished successfully.');
      } catch (cleanupError) {
        log.error('[main.ts] Error during startup cleanup:', cleanupError);
        // Decide if this is critical - maybe show error?
      }
    } else {
      log.warn(
        '[main.ts] FileManager service not available for startup cleanup.'
      );
    }

    // --- Test yt-dlp (Optional) ---
    if (app.isPackaged) {
      log.info('[main.ts] Checking yt-dlp installation...');
      await testYtDlpInstallation(); // Implement this function if needed
    }

    // --- Create Main Window ---
    await createWindow().then(() => {
      log.info('[main.ts] Main window created successfully.');
      if (isDev) {
        mainWindow?.webContents.on('devtools-opened', () => {
          // ... existing code ...
        });
      }
    });
  })
  .catch(error => {
    log.error('[main.ts] Error during app.whenReady:', error);
    // Handle critical startup error
    dialog.showErrorBox(
      'Application Error',
      `Failed to start the application: ${error.message}`
    );
    app.quit();
    nodeProcess.exit(1);
  });
