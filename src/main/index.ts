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
import * as renderWindowHandlers from '../handlers/render-window-handlers.js';
import * as subtitleHandlers from '../handlers/subtitle-handlers.js';
import {
  getDownloadProcess,
  removeDownloadProcess,
} from './active-processes.js';

import { getActiveRenderJob } from '../handlers/render-window-handlers.js';

// --- ES Module __dirname / __filename Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Constants ---
const isDev = !app.isPackaged;

// --- Services & Handlers Imports ---
import { FFmpegService } from '../services/ffmpeg-service.js';
import { SaveFileService } from '../services/save-file.js';
import { FileManager } from '../services/file-manager.js';
import {
  handleProcessUrl,
  initializeUrlHandler,
} from '../handlers/url-handler.js';
import * as fileHandlers from '../handlers/file-handlers.js';
import * as apiKeyHandlers from '../handlers/api-key-handlers.js';
import * as utilityHandlers from '../handlers/utility-handlers.js';

log.info('--- [main.ts] Execution Started ---');

// Map to store AbortControllers for active subtitle generation operations
const subtitleGenerationControllers = new Map<string, AbortController>();

// --- Initialize electron-store ---
const settingsStore = new Store({
  name: 'app-settings',
  defaults: {
    app_language_preference: 'en',
    subtitleTargetLanguage: 'original',
    apiKey: null,
    videoPlaybackPositions: {},
  },
});
log.info(`[Main Process] Settings store path: ${settingsStore.path}`);

if (!app.requestSingleInstanceLock()) {
  log.info('[main.ts] Another instance detected. Quitting this instance.');
  app.quit();
  nodeProcess.exit(0);
}
app.on('second-instance', () => {
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

  // Initialize Handlers
  log.info('[main.ts] Initializing Handlers...');
  fileHandlers.initializeFileHandlers({ fileManager, saveFileService });
  subtitleHandlers.initializeSubtitleHandlers({ ffmpegService, fileManager });
  initializeUrlHandler({ fileManager, ffmpegService });
  renderWindowHandlers.initializeRenderWindowHandlers();
  log.info('[main.ts] Handlers Initialized.');

  // --- IPC Handlers Registration ---
  log.info('[main.ts] Registering IPC Handlers...');
  // Utility
  ipcMain.handle('ping', utilityHandlers.handlePing);
  ipcMain.handle('show-message', utilityHandlers.handleShowMessage);
  // File Operations
  ipcMain.handle('save-file', fileHandlers.handleSaveFile);
  ipcMain.handle('open-file', fileHandlers.handleOpenFile);
  ipcMain.handle('move-file', fileHandlers.handleMoveFile);
  ipcMain.handle('copy-file', fileHandlers.handleCopyFile);
  ipcMain.handle('delete-file', fileHandlers.handleDeleteFile);
  ipcMain.handle('readFileContent', fileHandlers.handleReadFileContent);
  // API Keys
  ipcMain.handle('get-api-key-status', apiKeyHandlers.handleGetApiKeyStatus);
  ipcMain.handle('save-api-key', apiKeyHandlers.handleSaveApiKey);

  ipcMain.handle('generate-subtitles', async (event, options) => {
    const controller = new AbortController();
    const { signal } = controller;
    const operationId = `generate-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`;

    log.info(`[main.ts/generate-subtitles] Starting operation: ${operationId}`);
    subtitleGenerationControllers.set(operationId, controller);

    try {
      const result = await subtitleHandlers.handleGenerateSubtitles(
        event,
        options,
        signal,
        operationId
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
      throw error;
    } finally {
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

  // Operation Cancellation - Updated
  ipcMain.handle('cancel-operation', async (_event, operationId: string) => {
    log.info(`[main.ts/cancel-operation] Received request for: ${operationId}`);
    let cancelledViaController = false;
    let cancelledViaDownload = false;
    let errorMessage = '';

    const controller = subtitleGenerationControllers.get(operationId);
    if (controller) {
      try {
        log.info(
          `[main.ts/cancel-operation] Aborting controller for ${operationId}.`
        );
        controller.abort();
        subtitleGenerationControllers.delete(operationId);
        cancelledViaController = true;
        log.info(
          `[main.ts/cancel-operation] Controller for ${operationId} aborted and removed.`
        );
      } catch (error) {
        log.error(
          `[main.ts/cancel-operation] Error aborting controller for ${operationId}:`,
          error
        );
        errorMessage += `Controller abort failed: ${
          error instanceof Error ? error.message : String(error)
        }; `;
      }
    } else {
      log.info(
        `[main.ts/cancel-operation] No active AbortController found for ${operationId}.`
      );
    }

    // 2. Try cancelling via Download Process Map
    const downloadProcess = getDownloadProcess(operationId);
    if (downloadProcess && !downloadProcess.killed) {
      try {
        log.info(
          `[main.ts/cancel-operation] Killing download process for ${operationId}.`
        );
        downloadProcess.kill();
        removeDownloadProcess(operationId);
        cancelledViaDownload = true;
        log.info(
          `[main.ts/cancel-operation] Download process for ${operationId} killed and removed.`
        );
      } catch (error) {
        log.error(
          `[main.ts/cancel-operation] Error killing download process ${operationId}:`,
          error
        );
        errorMessage += `Download process kill failed: ${
          error instanceof Error ? error.message : String(error)
        }; `;
        removeDownloadProcess(operationId);
      }
    } else if (downloadProcess && downloadProcess.killed) {
      log.info(
        `[main.ts/cancel-operation] Download process ${operationId} already killed. Removing from map.`
      );
      removeDownloadProcess(operationId);
    } else {
      log.info(
        `[main.ts/cancel-operation] No active Download Process found for ${operationId}.`
      );
    }

    // --- new block for merge jobs -----------------
    if (operationId.startsWith('render-')) {
      const job = getActiveRenderJob(operationId);
      if (job) {
        // Kill any FFmpeg processes
        job.processes.forEach(proc => {
          try {
            proc.kill('SIGINT');
          } catch {
            /* ignore */
          }
        });
        // Close Puppeteer browser if present
        try {
          await job.browser?.close();
        } catch {
          /* ignore */
        }

        log.info(
          `[main.ts/cancel-operation] Render job ${operationId} cancelled.`
        );
        return {
          success: true,
          message: `Render job ${operationId} cancelled`,
        };
      }
      // If no job found, it will fall through to the final throw below
    }
    // ----------------------------------------------

    // 4. Return overall status if we already canceled something
    const success = cancelledViaController || cancelledViaDownload;
    if (success) {
      log.info(
        `[main.ts/cancel-operation] Cancellation initiated for ${operationId} (Controller: ${cancelledViaController}, Download: ${cancelledViaDownload})`
      );
      return {
        success: true,
        message: `Cancellation initiated for ${operationId}`,
      };
    } else {
      log.error(
        `[main.ts/cancel-operation] Failed to find operation to cancel for ${operationId}. Errors: ${errorMessage}`
      );
      // If we get here, it means we didn't find any matching operation (controller, download, or render)
      throw new Error(
        `No active operation ${operationId} to cancel. ${errorMessage}`
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

      try {
        await fsPromises.access(localePath, fsPromises.constants.R_OK);
        log.info(
          `[main.ts/get-locale-url] Found ${localePath}. URL for ${lang}: ${localeUrl}`
        );
        return localeUrl;
      } catch (accessError: any) {
        log.error(
          `[main.ts/get-locale-url] Cannot access locale file at ${localePath}. Error: ${accessError.message}`
        );
        return null;
      }
    } catch (error) {
      log.error(`[main.ts/get-locale-url] Error constructing URL:`, error);
      return null;
    }
  });

  // --- Language Preference Handlers ---
  ipcMain.handle('get-language-preference', async () => {
    try {
      const lang = settingsStore.get('app_language_preference', 'en');
      log.info(
        `[main.ts/get-language-preference] Retrieved UI language: ${lang}`
      );
      return lang;
    } catch (error) {
      log.error(
        '[main.ts/get-language-preference] Error retrieving UI language:',
        error
      );
      return 'en';
    }
  });

  ipcMain.handle('set-language-preference', async (_event, lang: string) => {
    try {
      settingsStore.set('app_language_preference', lang);
      log.info(`[main.ts/set-language-preference] Set UI language to: ${lang}`);
      return { success: true };
    } catch (error) {
      log.error(
        '[main.ts/set-language-preference] Error setting UI language:',
        error
      );
      return { success: false, error: (error as Error).message };
    }
  });

  // --- Subtitle Target Language Preference Handlers ---
  ipcMain.handle('get-subtitle-target-language', async () => {
    try {
      const lang = settingsStore.get('subtitleTargetLanguage', 'original');
      log.info(`[main.ts/get-subtitle-target-language] Retrieved: ${lang}`);
      return lang;
    } catch (error) {
      log.error(
        '[main.ts/get-subtitle-target-language] Error retrieving:',
        error
      );
      return 'original';
    }
  });

  ipcMain.handle(
    'set-subtitle-target-language',
    async (_event, lang: string) => {
      try {
        if (typeof lang === 'string') {
          settingsStore.set('subtitleTargetLanguage', lang);
          log.info(`[main.ts/set-subtitle-target-language] Set to: ${lang}`);
          return { success: true };
        } else {
          log.warn(
            '[main.ts] Invalid type received for set-subtitle-target-language:',
            lang
          );
          return { success: false, error: 'Invalid language type received' };
        }
      } catch (error) {
        log.error(
          '[main.ts/set-subtitle-target-language] Error setting language:',
          error
        );
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle('get-video-metadata', subtitleHandlers.handleGetVideoMetadata);

  // Save/Load video playback position
  ipcMain.handle(
    'save-video-playback-position',
    (_event, filePath: string, position: number) => {
      if (!filePath || typeof position !== 'number' || position < 0) {
        log.warn(
          `[main.ts] Invalid attempt to save playback position: Path=${filePath}, Position=${position}`
        );
        return;
      }
      try {
        const currentPositions = settingsStore.get(
          'videoPlaybackPositions',
          {}
        ) as { [key: string]: number };
        const updatedPositions = {
          ...currentPositions,
          [filePath]: position,
        };
        settingsStore.set('videoPlaybackPositions', updatedPositions);
      } catch (error) {
        log.error(
          `[main.ts] Error saving playback position for ${filePath}:`,
          error
        );
      }
    }
  );

  ipcMain.handle(
    'get-video-playback-position',
    async (_event, filePath: string): Promise<number | null> => {
      if (!filePath) {
        log.warn(
          '[main.ts] Invalid attempt to get playback position: empty path'
        );
        return null;
      }
      try {
        const positions = settingsStore.get('videoPlaybackPositions', {}) as {
          [key: string]: number;
        };
        const position = positions[filePath];
        if (typeof position === 'number' && position >= 0) {
          log.info(
            `[main.ts] Retrieved playback position for ${filePath}: ${position}s`
          );
          return position;
        }
        log.info(`[main.ts] No valid playback position found for ${filePath}`);
        return null;
      } catch (error) {
        log.error(
          `[main.ts] Error getting playback position for ${filePath}:`,
          error
        );
        return null;
      }
    }
  );
} catch (error) {
  log.error('[main.ts] FATAL: Error during initial setup:', error);
  app
    .whenReady()
    .then(() => {
      dialog.showErrorBox(
        'Initialization Error',
        `Failed to initialize. Check logs. Error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      setTimeout(() => {
        app.quit();
        nodeProcess.exit(1);
      }, 5000);
    })
    .catch(readyErr => {
      console.error('FATAL: Error during app.whenReady after setup:', readyErr);
      nodeProcess.exit(1);
    });
}

// --- App Event Handler: will-quit ---
app.on('will-quit', async event => {
  log.info(`[main.ts] 'will-quit' event triggered. isQuitting: ${isQuitting}`);
  if (isQuitting) {
    return;
  }
  isQuitting = true;
  event.preventDefault();

  log.info('[main.ts] Starting cleanup before quitting...');
  try {
    if (services?.fileManager?.cleanup) {
      log.info('[main.ts] Attempting FileManager cleanup...');
      await services.fileManager.cleanup();
      log.info('[main.ts] FileManager cleanup finished.');
    } else {
      log.warn('[main.ts] FileManager service not available for cleanup.');
    }
  } catch (err) {
    log.error('[main.ts] Error during cleanup:', err);
  } finally {
    log.info('[main.ts] Cleanup finished. Quitting app now.');
    app.quit();
  }
});

app.on('window-all-closed', () => {
  log.info('[main.ts] All windows closed.');
  if (nodeProcess.platform !== 'darwin') {
    log.info('[main.ts] Quitting app (non-macOS).');
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    log.info("[main.ts] 'activate': No windows open, creating new one.");
    createWindow().catch(err =>
      log.error('[main.ts] Error recreating window on activate:', err)
    );
  }
});

nodeProcess.on('uncaughtException', error => {
  log.error('[main.ts] UNCAUGHT EXCEPTION:', error);
  if (!isDev) {
    dialog.showErrorBox(
      'Unhandled Error',
      `Unexpected error: ${error.message}\nApp will now quit.`
    );
    app.quit();
    nodeProcess.exit(1);
  }
});

// --- Window Creation ---
async function createWindow() {
  log.info('[main.ts] Creating main window...');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  electronContextMenu({
    window: mainWindow,
    showInspectElement: isDev,
  });

  const rendererPath = path.join(__dirname, '../renderer/index.html');
  log.info(`[main.ts] Loading renderer from: ${rendererPath}`);
  try {
    await mainWindow.loadFile(rendererPath);
    log.info('[main.ts] Renderer loaded successfully.');
  } catch (loadError: any) {
    log.error('[main.ts] Error loading renderer:', loadError);
    dialog.showErrorBox(
      'Load Error',
      `Failed to load UI: ${loadError.message}`
    );
    app.quit();
    return;
  }

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    log.info('[main.ts] Main window closed.');
    mainWindow = null;
  });

  // Find-in-Page IPC
  let currentFindText = '';
  ipcMain.on(
    'find-in-page',
    (_event, { text, findNext, forward, matchCase }) => {
      if (!mainWindow) return;
      if (text && text.length > 0) {
        if (text !== currentFindText) currentFindText = text;
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
    mainWindow?.webContents.send('find-results', {
      matches: result.matches,
      activeMatchOrdinal: result.activeMatchOrdinal,
      finalUpdate: result.finalUpdate,
    });
  });

  createApplicationMenu();
}

function createApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
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
    {
      label: 'File',
      submenu: [
        nodeProcess.platform === 'darwin'
          ? { role: 'close' }
          : { role: 'quit' },
      ],
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
            await shell.openExternal('https://github.com/your-repo');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  log.info('[main.ts] Application menu created.');
}

async function testYtDlpInstallation() {
  log.warn(
    '[main.ts] testYtDlpInstallation function is a placeholder (implement if needed).'
  );
  return true;
}

app
  .whenReady()
  .then(async () => {
    log.info('[main.ts] App is ready.');
    try {
      const logDirPath = isDev ? '.' : app.getPath('logs');
      const logFileName = isDev ? 'dev-main.log' : 'main.log';
      const logFilePath = path.join(logDirPath, logFileName);

      try {
        await fsPromises.mkdir(logDirPath, { recursive: true });
      } catch (mkdirError: any) {
        if (mkdirError.code !== 'EEXIST') {
          console.error(
            `[main.ts] Failed to ensure log directory ${logDirPath}:`,
            mkdirError
          );
        }
      }

      log.transports.file.resolvePathFn = () => logFilePath;
      log.transports.file.level = isDev ? 'debug' : 'info';
      log.transports.console.level = isDev ? 'debug' : 'info';

      const resolvedLogPath = log.transports.file.getFile().path;
      log.info(
        `[main.ts] Logging Mode: ${isDev ? 'Development' : 'Production'}`
      );
      log.info(`[main.ts] Log Level: ${log.transports.file.level}`);
      log.info(`[main.ts] Attempting to log to: ${logFilePath}`);
      log.info(`[main.ts] Resolved log file path: ${resolvedLogPath}`);
    } catch (error) {
      console.error('[main.ts] Error configuring logging:', error);
    }

    log.info('[main.ts] Performing startup cleanup...');
    if (services?.fileManager?.cleanup) {
      try {
        await services.fileManager.cleanup();
        log.info('[main.ts] Startup cleanup finished.');
      } catch (cleanupError) {
        log.error('[main.ts] Error during startup cleanup:', cleanupError);
      }
    } else {
      log.warn('[main.ts] FileManager service not available for cleanup.');
    }

    if (app.isPackaged) {
      log.info('[main.ts] Checking yt-dlp installation...');
      await testYtDlpInstallation();
    }

    await createWindow().then(() => {
      log.info('[main.ts] Main window created.');
      if (isDev) {
        mainWindow?.webContents.on('devtools-opened', () => {
          // Additional dev logic if desired
        });
      }
    });
  })
  .catch(error => {
    log.error('[main.ts] Error during app.whenReady:', error);
    dialog.showErrorBox(
      'Application Error',
      `Failed to start: ${error.message}`
    );
    app.quit();
    nodeProcess.exit(1);
  });
