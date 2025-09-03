import dotenv from 'dotenv';
import path from 'path';
import { esmDirname } from '@shared/esm-paths';

const __dirname = esmDirname(import.meta.url);

// Configure dotenv to look for .env file in project root
const envPath = path.resolve(__dirname, '../../../../.env');
dotenv.config({ path: envPath });

import log from 'electron-log';

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  dialog,
  MenuItemConstructorOptions,
} from 'electron';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import electronContextMenu from 'electron-context-menu';
import nodeProcess from 'process';
import os from 'os';
import Store from 'electron-store';
import * as renderWindowHandlers from './handlers/render-window-handlers/index.js';
import * as subtitleHandlers from './handlers/subtitle-handlers.js';
import * as registry from './active-processes.js';
import { buildSettingsHandlers } from './handlers/settings-handlers.js';
import { buildUpdateHandlers } from './handlers/update-handlers.js';
import { defaultBrowserHint } from './services/url-processor/utils.js';

import { SaveFileService } from './services/save-file.js';
import { FileManager } from './services/file-manager.js';
import {
  handleProcessUrl,
  initializeUrlHandler,
} from './handlers/url-handlers.js';
import * as fileHandlers from './handlers/file-handlers.js';
import * as utilityHandlers from './handlers/utility-handlers.js';
import { createFFmpegContext } from './services/ffmpeg-runner.js';
import type { FFmpegContext } from './services/ffmpeg-runner.js';
import {
  handleGetCreditBalance,
  handleCreateCheckoutSession,
  handleResetCredits,
  handleResetCreditsToZero,
  handleStripeSuccess,
  getDeviceId,
} from './handlers/credit-handlers.js';

log.info('--- [main.ts] Execution Started ---');

let filePathToOpenOnLoad: string | null = null;

const settingsStore = new Store<{
  app_language_preference: string;
  subtitleTargetLanguage: string;
  apiKey: string | null;
  videoPlaybackPositions: Record<string, number>;
}>({
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

const fileArgFromPrimaryInstance = nodeProcess.argv
  .slice(1)
  .find(
    p =>
      /\.\w+$/.test(p) &&
      !p.startsWith('--') &&
      fs.existsSync(p.replace(/^"|"$/g, ''))
  );
if (fileArgFromPrimaryInstance) {
  log.info(
    `[main.ts] Application launched with file argument (primary instance): ${fileArgFromPrimaryInstance}`
  );
  filePathToOpenOnLoad = fileArgFromPrimaryInstance.replace(/^"|"$/g, '');
}

app.on('second-instance', (_event, commandLine, _workingDirectory) => {
  log.info("[main.ts] 'second-instance' event triggered.");
  log.info(`[main.ts] Command line: ${commandLine.join(' ')}`);

  const fileArg = commandLine
    .slice(1)
    .find(
      arg =>
        /\.\w+$/.test(arg) &&
        !arg.startsWith('--') &&
        fs.existsSync(arg.replace(/^"|"$/g, ''))
    );

  if (fileArg) {
    log.info(
      `[main.ts] File path found in second-instance commandLine: ${fileArg}`
    );
    openVideoFile(fileArg.replace(/^"|"$/g, ''));
  } else {
    log.info(
      '[main.ts] No specific file path found or file does not exist in second-instance commandLine. Focusing window.'
    );
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (fileArg) {
    createWindow().catch(err =>
      log.error(
        '[main.ts] Error creating window on second-instance for file:',
        err
      )
    );
  } else {
    createWindow().catch(err =>
      log.error('[main.ts] Error creating window on second-instance:', err)
    );
  }
});

let mainWindow: BrowserWindow | null = null;
let services: {
  saveFileService: SaveFileService;
  fileManager: FileManager;
  ffmpeg: FFmpegContext;
} | null = null;
let isQuitting = false;

const isDev = !app.isPackaged;

function getRendererHtmlPath() {
  return app.isPackaged
    ? path.join(app.getAppPath(), 'packages', 'renderer', 'dist', 'index.html')
    : path.join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'packages',
        'renderer',
        'dist',
        'index.html'
      );
}

function getPreloadPath() {
  return app.isPackaged
    ? path.join(
        app.getAppPath(),
        'packages',
        'main',
        'dist',
        'preload',
        'preload.cjs'
      )
    : path.join(__dirname, '../preload/preload.cjs');
}

try {
  log.info('[main.ts] Initializing Services...');

  const tempPath = path.join(app.getPath('temp'), 'translator-electron');
  log.info(`[main.ts] Determined temp path for services: ${tempPath}`);

  const saveFileService = SaveFileService.getInstance();
  const fileManager = new FileManager(tempPath);
  const ffmpeg = await createFFmpegContext(tempPath);
  services = { saveFileService, fileManager, ffmpeg };
  log.info('[main.ts] Services Initialized.');

  log.info('[main.ts] Initializing Handlers...');
  fileHandlers.initializeFileHandlers({ fileManager, saveFileService });
  subtitleHandlers.initializeSubtitleHandlers({ ffmpeg, fileManager });
  initializeUrlHandler({ fileManager, ffmpeg });
  renderWindowHandlers.initializeRenderWindowHandlers({ ffmpeg });
  log.info('[main.ts] Handlers Initialized.');

  log.info('[main.ts] Registering IPC Handlers...');

  // ──────────────────────────────────────────────────────────────
  // Settings IPC handlers
  // ──────────────────────────────────────────────────────────────
  const settingsHandlers = buildSettingsHandlers({
    store: settingsStore,
    isDev,
  });

  ipcMain.handle('get-locale-url', settingsHandlers.getLocaleUrl);
  ipcMain.handle(
    'get-language-preference',
    settingsHandlers.getLanguagePreference
  );
  ipcMain.handle(
    'set-language-preference',
    settingsHandlers.setLanguagePreference
  );
  ipcMain.handle(
    'get-subtitle-target-language',
    settingsHandlers.getSubtitleTargetLanguage
  );
  ipcMain.handle(
    'set-subtitle-target-language',
    settingsHandlers.setSubtitleTargetLanguage
  );
  ipcMain.handle(
    'save-video-playback-position',
    settingsHandlers.saveVideoPlaybackPosition
  );
  ipcMain.handle(
    'get-video-playback-position',
    settingsHandlers.getVideoPlaybackPosition
  );

  ipcMain.handle('has-video-track', async (_evt, filePath: string) => {
    try {
      return await services!.ffmpeg.hasVideoTrack(filePath);
    } catch (err: any) {
      log.error('[main] has-video-track error:', err);
      return { success: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('ping', utilityHandlers.handlePing);
  ipcMain.handle('show-message', utilityHandlers.handleShowMessage);
  ipcMain.handle('save-file', fileHandlers.handleSaveFile);
  ipcMain.handle('open-file', fileHandlers.handleOpenFile);
  ipcMain.handle('move-file', fileHandlers.handleMoveFile);
  ipcMain.handle('copy-file', fileHandlers.handleCopyFile);
  ipcMain.handle('delete-file', fileHandlers.handleDeleteFile);
  ipcMain.handle('readFileContent', fileHandlers.handleReadFileContent);

  ipcMain.handle('generate-subtitles', async (event, options) => {
    const operationId =
      options.operationId ||
      `generate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    log.info(`[main.ts/generate-subtitles] Starting operation: ${operationId}`);

    try {
      const result = await subtitleHandlers.handleGenerateSubtitles(
        event,
        options,
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
      registry.finish(operationId);
      log.info(
        `[main.ts/generate-subtitles] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('translate-subtitles', async (event, options) => {
    const operationId =
      options.operationId ||
      `translate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(
      `[main.ts/translate-subtitles] Starting operation: ${operationId}`
    );
    try {
      const result = await subtitleHandlers.handleTranslateSubtitles(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/translate-subtitles] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/translate-subtitles] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/translate-subtitles] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('translate-one-line', async (event, options) => {
    const operationId =
      options.operationId ||
      `translate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(
      `[main.ts/translate-one-line] Starting operation: ${operationId}`
    );
    try {
      const result = await subtitleHandlers.handleTranslateOneLine(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/translate-one-line] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/translate-one-line] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/translate-one-line] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('transcribe-one-line', async (event, options) => {
    const operationId =
      options.operationId ||
      `transcribe-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(
      `[main.ts/transcribe-one-line] Starting operation: ${operationId}`
    );
    try {
      const result = await subtitleHandlers.handleTranscribeOneLine(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/transcribe-one-line] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/transcribe-one-line] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/transcribe-one-line] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('transcribe-remaining', async (event, options) => {
    const operationId =
      options.operationId ||
      `transcribe-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(
      `[main.ts/transcribe-remaining] Starting operation: ${operationId}`
    );
    try {
      const res = await subtitleHandlers.handleTranscribeRemaining(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/transcribe-remaining] Operation ${operationId} completed.`
      );
      return res;
    } catch (error) {
      log.error(
        `[main.ts/transcribe-remaining] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/transcribe-remaining] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('process-url', handleProcessUrl);

  ipcMain.handle('cancel-operation', async (_event, operationId: string) => {
    log.info(`[main.ts/cancel-operation] Received request for: ${operationId}`);
    try {
      const success = await registry.cancel(operationId);
      return {
        success,
        message: success
          ? `Cancellation initiated for ${operationId}`
          : `No active operation found for ${operationId}`,
      };
    } catch (error) {
      log.error(
        `[main.ts/cancel-operation] Error cancelling operation ${operationId}:`,
        error
      );
      throw new Error(
        `Failed to cancel operation ${operationId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  });

  ipcMain.handle('get-app-path', () => {
    return app.getAppPath();
  });

  // Provide default cookie browser hint to renderer
  ipcMain.handle('get-default-cookie-browser', () => defaultBrowserHint());

  ipcMain.handle('get-video-metadata', subtitleHandlers.handleGetVideoMetadata);

  ipcMain.handle('get-credit-balance', handleGetCreditBalance);
  ipcMain.handle('create-checkout-session', handleCreateCheckoutSession);
  ipcMain.handle('reset-credits', handleResetCredits);
  ipcMain.handle('reset-credits-to-zero', handleResetCreditsToZero);
  ipcMain.handle('get-device-id', () => getDeviceId());
  ipcMain.handle(
    'get-admin-device-id',
    () => process.env.ADMIN_DEVICE_ID || null
  );
  ipcMain.handle('get-system-info', () => {
    try {
      const platform = process.platform;
      const arch = process.arch;
      const release = os.release();
      const cpu = os.cpus()?.[0]?.model ?? '';
      const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
      return { platform, arch, release, cpu, isAppleSilicon };
    } catch (e: any) {
      return { platform: process.platform, arch: process.arch } as any;
    }
  });

  // yt-dlp auto update is always on; no IPC settings

  // Persisted cookies browser preference
  ipcMain.handle(
    'settings:getPreferredCookiesBrowser',
    settingsHandlers.getPreferredCookiesBrowser
  );
  ipcMain.handle(
    'settings:setPreferredCookiesBrowser',
    settingsHandlers.setPreferredCookiesBrowser
  );

  // Handle Stripe checkout completion messages from embedded window
  ipcMain.on('stripe-success', async (_event, data) => {
    log.info('[main.ts] Received stripe-success message:', data);
    await handleStripeSuccess(data.sessionId);
  });

  ipcMain.on('stripe-cancelled', (_event, data) => {
    log.info('[main.ts] Received stripe-cancelled message:', data);
    // No action needed for cancellation
  });

  // Expose app.isPackaged to renderer via preload (sync)
  ipcMain.on('is-packaged', event => {
    event.returnValue = app.isPackaged;
  });
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
  } else if (filePathToOpenOnLoad && mainWindow) {
    log.info(
      `[main.ts] 'activate' with pending file: ${filePathToOpenOnLoad}. Ensuring it's processed.`
    );
    openVideoFile(filePathToOpenOnLoad);
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
      sandbox: false,
      preload: getPreloadPath(),
      backgroundThrottling: false,
    },
  });

  electronContextMenu({
    window: mainWindow,
    showInspectElement: isDev,
  });

  const rendererPath = getRendererHtmlPath();
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

  mainWindow.webContents.on('did-finish-load', () => {
    log.info('[main.ts] Main window finished loading content.');
    if (filePathToOpenOnLoad) {
      log.info(
        `[main.ts] Processing queued file path on did-finish-load: ${filePathToOpenOnLoad}`
      );
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.webContents &&
        !mainWindow.webContents.isDestroyed()
      ) {
        mainWindow.webContents.send('open-video-file', filePathToOpenOnLoad);
      } else {
        log.error(
          '[main.ts] Cannot send queued file: mainWindow or webContents became invalid before did-finish-load processing.'
        );
      }
      filePathToOpenOnLoad = null;
    }
  });

  createApplicationMenu();

  // Initialize update handlers after window is created
  try {
    const updateHandlers = buildUpdateHandlers({
      mainWindow,
      isDev,
    });
    if (updateHandlers) {
      log.info('[main.ts] Update handlers initialized.');
    }
  } catch (err: any) {
    log.error('[main.ts] Error initializing update handlers:', err);
  }
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

    // Customize About panel
    app.setAboutPanelOptions({
      applicationName: 'Translator',
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: '© 2025 Stage5 Tools LLC',
    });

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

function openVideoFile(filePath: string) {
  log.info(`[main.ts] Request to open video file: ${filePath}`);
  if (!filePath || !fs.existsSync(filePath)) {
    log.warn(
      `[main.ts] Invalid or non-existent file path for openVideoFile: ${filePath}`
    );
    filePathToOpenOnLoad = null;
    return;
  }

  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents &&
    !mainWindow.webContents.isDestroyed() &&
    !mainWindow.webContents.isLoading()
  ) {
    log.info(
      `[main.ts] Main window is ready. Sending 'open-video-file' IPC for: ${filePath}`
    );
    mainWindow.webContents.send('open-video-file', filePath);
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
    filePathToOpenOnLoad = null;
  } else {
    log.info(
      `[main.ts] Main window not fully ready or available. Queuing filePath: ${filePath}`
    );
    filePathToOpenOnLoad = filePath;
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
      log.info(
        '[main.ts] No windows open, creating one to handle queued file.'
      );
      createWindow().catch(err =>
        log.error('[main.ts] Error creating window for queued file:', err)
      );
    }
  }
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  log.info(`[main.ts] 'open-file' event (macOS) for: ${filePath}`);
  if (!filePath || !fs.existsSync(filePath)) {
    log.warn(
      `[main.ts] Invalid or non-existent file path from 'open-file' event: ${filePath}`
    );
    filePathToOpenOnLoad = null;
    return;
  }
  if (app.isReady()) {
    openVideoFile(filePath);
  } else {
    filePathToOpenOnLoad = filePath;
  }
});
