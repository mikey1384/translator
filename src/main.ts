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
import { fileURLToPath, pathToFileURL } from 'url';
import log from 'electron-log';
import electronContextMenu from 'electron-context-menu';
import nodeProcess from 'process';
import Store from 'electron-store';
import * as renderWindowHandlers from './handlers/render-window-handlers.js';
import * as subtitleHandlers from './handlers/subtitle-handlers.js';

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
import * as utilityHandlers from './handlers/utility-handlers.js';

log.info('--- [main.ts] Execution Started ---');

// Map to store AbortControllers for active subtitle generation operations
const subtitleGenerationControllers = new Map<string, AbortController>();

// --- Initialize electron-store ---
const store = new Store();

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

  const tempPath = path.join(app.getPath('temp'), 'translator-electron');
  log.info(`[main.ts] Determined temp path for services: ${tempPath}`);

  // Instantiate services, injecting the correct temp path
  const saveFileService = SaveFileService.getInstance();
  const fileManager = new FileManager(tempPath);
  const ffmpegService = new FFmpegService(tempPath);

  services = { saveFileService, fileManager, ffmpegService };
  log.info('[main.ts] Services Initialized.');

  // Initialize Handlers, passing required services
  log.info('[main.ts] Initializing Handlers...');
  fileHandlers.initializeFileHandlers({ fileManager, saveFileService });
  subtitleHandlers.initializeSubtitleHandlers({ ffmpegService, fileManager });
  initializeUrlHandler({ fileManager, ffmpegService }); // Pass both services
  renderWindowHandlers.initializeRenderWindowHandlers();
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
  ipcMain.handle('generate-subtitles', async (event, options) => {
    const controller = new AbortController();
    const { signal } = controller;
    const operationId = `generate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    log.info(`[main.ts/generate-subtitles] Starting operation: ${operationId}`);
    subtitleGenerationControllers.set(operationId, controller);

    try {
      // Call the handler, passing the signal and operationId
      const result = await subtitleHandlers.handleGenerateSubtitles(
        event,
        options,
        signal, // Pass the AbortSignal
        operationId // Pass the operationId
      );
      log.info(
        `[main.ts/generate-subtitles] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/generate-subtitles] Error in operation ${operationId}:`,
        error
      );
      // Re-throw the error to be caught by the renderer
      throw error;
    } finally {
      // Ensure the controller is removed from the map when done
      const deleted = subtitleGenerationControllers.delete(operationId);
      if (deleted) {
        log.info(
          `[main.ts/generate-subtitles] Removed controller for ${operationId}.`
        );
      } else {
        log.warn(
          `[main.ts/generate-subtitles] Controller for ${operationId} not found for removal.`
        );
      }
    }
  });
  // URL Processing
  ipcMain.handle('process-url', handleProcessUrl);
  // Operation Cancellation - Updated to handle both AbortController and FFmpeg
  ipcMain.handle('cancel-operation', async (_event, operationId: string) => {
    log.info(`[main.ts/cancel-operation] Received request for: ${operationId}`);
    let cancelledViaController = false;
    let cancelledViaFfmpeg = false;
    let errorMessage = '';

    // 1. Try cancelling via AbortController (for generate-subtitles)
    const controller = subtitleGenerationControllers.get(operationId);
    if (controller) {
      try {
        log.info(
          `[main.ts/cancel-operation] Aborting controller for ${operationId}.`
        );
        controller.abort();
        subtitleGenerationControllers.delete(operationId); // Remove immediately after aborting
        cancelledViaController = true;
        log.info(
          `[main.ts/cancel-operation] Controller for ${operationId} aborted and removed.`
        );
      } catch (error) {
        log.error(
          `[main.ts/cancel-operation] Error aborting controller for ${operationId}:`,
          error
        );
        errorMessage += `Controller abort failed: ${error instanceof Error ? error.message : String(error)}; `;
      }
    } else {
      log.info(
        `[main.ts/cancel-operation] No active AbortController found for ${operationId}.`
      );
    }

    // 2. Try cancelling via FFmpegService (for merge-subtitles or direct FFmpeg ops)
    if (services?.ffmpegService) {
      try {
        log.info(
          `[main.ts/cancel-operation] Calling FFmpegService.cancelOperation for ${operationId}.`
        );
        services.ffmpegService.cancelOperation(operationId);
        // Note: ffmpegService.cancelOperation is fire-and-forget, success isn't guaranteed here
        cancelledViaFfmpeg = true; // Assume initiated
      } catch (error) {
        log.error(
          `[main.ts/cancel-operation] Error calling FFmpegService.cancelOperation for ${operationId}:`,
          error
        );
        errorMessage += `FFmpeg cancel failed: ${error instanceof Error ? error.message : String(error)}; `;
      }
    } else {
      log.warn(
        '[main.ts/cancel-operation] FFmpegService not available for cancellation attempt.'
      );
      if (!cancelledViaController) {
        errorMessage += 'FFmpegService not available; ';
      }
    }

    // 3. Return overall status
    const success = cancelledViaController || cancelledViaFfmpeg;
    if (success) {
      log.info(
        `[main.ts/cancel-operation] Cancellation initiated for ${operationId} (Controller: ${cancelledViaController}, FFmpeg: ${cancelledViaFfmpeg})`
      );
      return {
        success: true,
        message: `Cancellation initiated for ${operationId}`,
      };
    } else {
      log.error(
        `[main.ts/cancel-operation] Failed to initiate cancellation for ${operationId}. Error(s): ${errorMessage}`
      );
      throw new Error(
        `Failed to initiate cancellation for ${operationId}. ${errorMessage}`
      );
    }
  });

  // Get App Path
  ipcMain.handle('get-app-path', () => {
    return app.getAppPath();
  });

  // Get Locale File URL
  ipcMain.handle('get-locale-url', async (_event, lang: string) => {
    try {
      let localeDirPath: string;

      if (isDev) {
        // In dev, app.getAppPath() is usually <project_root>/dist
        // Go up one level from app path, then to src/renderer/locales
        localeDirPath = path.join(
          app.getAppPath(),
          '..',
          'src',
          'renderer',
          'locales'
        );
        log.info(
          `[main.ts/get-locale-url] Using dev path (relative to app path parent): ${localeDirPath}`
        );
      } else {
        // In production, locales are packaged relative to the app root
        // Assuming they are copied to dist/renderer/locales within the app resources
        localeDirPath = path.join(
          app.getAppPath(),
          'dist',
          'renderer',
          'locales'
        );
        log.info(`[main.ts/get-locale-url] Using prod path: ${localeDirPath}`);
      }

      const localePath = path.join(localeDirPath, `${lang}.json`);
      const localeUrl = pathToFileURL(localePath).toString();

      // Add a check to see if the file actually exists before returning
      try {
        await fsPromises.access(localePath, fsPromises.constants.R_OK);
        log.info(
          `[main.ts/get-locale-url] Found ${localePath}. Constructed URL for ${lang}: ${localeUrl}`
        );
        return localeUrl;
      } catch (accessError: any) {
        log.error(
          `[main.ts/get-locale-url] Cannot access locale file at ${localePath}. Error: ${accessError.message}`
        );
        return null; // Indicate failure: file not found or not readable
      }
    } catch (error) {
      log.error(
        `[main.ts/get-locale-url] Error constructing URL for ${lang}:`,
        error
      );
      return null; // Indicate failure
    }
  });

  // --- Language Preference Handlers ---
  ipcMain.handle('get-language-preference', async () => {
    try {
      const lang = store.get('app_language_preference', 'en'); // Default to 'en'
      log.info(`[main.ts/get-language-preference] Retrieved language: ${lang}`);
      return lang;
    } catch (error) {
      log.error(
        '[main.ts/get-language-preference] Error retrieving language:',
        error
      );
      return 'en'; // Fallback on error
    }
  });

  ipcMain.handle('set-language-preference', async (_event, lang: string) => {
    try {
      store.set('app_language_preference', lang);
      log.info(`[main.ts/set-language-preference] Set language to: ${lang}`);
      return { success: true };
    } catch (error) {
      log.error(
        '[main.ts/set-language-preference] Error setting language:',
        error
      );
      return { success: false, error: (error as Error).message };
    }
  });

  log.info('[main.ts] IPC Handlers Registered.');

  // Add this line inside the try block in src/main.ts after other initializations
  renderWindowHandlers.initializeRenderWindowHandlers();

  // Add this line inside the try block in src/main.ts after other initializations
  ipcMain.handle(
    subtitleHandlers.VIDEO_METADATA_CHANNEL,
    subtitleHandlers.handleGetVideoMetadata
  );
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
