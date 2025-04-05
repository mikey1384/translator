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
import log from 'electron-log';
import electronContextMenu from 'electron-context-menu';
import nodeProcess from 'process'; // 'process' alias
import * as fsSync from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

// Services & Handlers
import { FFmpegService } from './services/ffmpeg-service.js';
import { SaveFileService } from './services/save-file.js';
import { FileManager } from './services/file-manager.js';
import { handleProcessUrl } from './handlers/url-handler.js';
import * as fileHandlersTS from './handlers/file-handlers.js';
import * as apiKeyHandlersTS from './handlers/api-key-handlers.js';
import * as subtitleHandlersTS from './handlers/subtitle-handlers.js';
import * as utilityHandlersTS from './handlers/utility-handlers.js';

const isDev = !app.isPackaged;

const execAsync = promisify(exec);

log.info('[main.ts] Initializing...');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.info('[main.ts] Another instance is running. Quitting...');
  app.quit();
  nodeProcess.exit(0);
}

interface AppServices {
  saveFileService: SaveFileService;
  fileManager: FileManager;
  ffmpegService: FFmpegService;
}

let mainWindow: BrowserWindow | null = null;
let services: AppServices | null = null;
let lastSearchText = '';

try {
  log.info('[main.ts] Starting service initialization...');
  if (app.isPackaged) {
    log.info(`[main.ts] Packaged mode, __dirname: ${__dirname}`);
    log.info(`[main.ts] resourcesPath: ${nodeProcess.resourcesPath}`);
  }

  const saveFileService = SaveFileService.getInstance();
  const fileManager = new FileManager();
  const ffmpegService = new FFmpegService();

  services = { saveFileService, fileManager, ffmpegService };
  log.info('[main.ts] Services initialized.');

  log.info('[main.ts] Initializing handlers...');
  fileHandlersTS.initializeFileHandlers({ fileManager, saveFileService });
  subtitleHandlersTS.initializeSubtitleHandlers({ ffmpegService, fileManager });
  log.info('[main.ts] Handlers initialized.');

  ipcMain.handle('ping', utilityHandlersTS.handlePing);
  ipcMain.handle('show-message', utilityHandlersTS.handleShowMessage);
  ipcMain.handle('save-file', fileHandlersTS.handleSaveFile);
  ipcMain.handle('open-file', fileHandlersTS.handleOpenFile);
  ipcMain.handle('move-file', fileHandlersTS.handleMoveFile);
  ipcMain.handle('copy-file', fileHandlersTS.handleCopyFile);
  ipcMain.handle('delete-file', fileHandlersTS.handleDeleteFile);
  ipcMain.handle('readFileContent', fileHandlersTS.handleReadFileContent);
  ipcMain.handle('get-api-key-status', apiKeyHandlersTS.handleGetApiKeyStatus);
  ipcMain.handle('save-api-key', apiKeyHandlersTS.handleSaveApiKey);
  ipcMain.handle('merge-subtitles', (event, options) => {
    log.info(`[main.ts] 'merge-subtitles': ${JSON.stringify(options)}`);
    return subtitleHandlersTS.handleMergeSubtitles(event, options);
  });
  ipcMain.handle('cancel-operation', subtitleHandlersTS.handleCancelOperation);
  ipcMain.handle(
    'generate-subtitles',
    subtitleHandlersTS.handleGenerateSubtitles
  );
  ipcMain.handle('process-url', handleProcessUrl);
} catch (error) {
  log.error('[main.ts] FATAL: Error initializing services/handlers:', error);
  if (!isDev) {
    app.whenReady().then(() => {
      dialog.showErrorBox('Initialization Error', 'Error during startup.');
      setTimeout(() => {
        app.quit();
        nodeProcess.exit(1);
      }, 5000);
    });
  } else {
    console.error('FATAL INIT ERROR:', error);
  }
}

app.on('will-quit', async () => {
  log.info('[main.ts] will-quit event triggered.');
  if (services?.fileManager?.cleanup) {
    log.info('[main.ts] Attempting cleanup via FileManager...');
    try {
      await services.fileManager.cleanup();
      log.info('[main.ts] FileManager cleanup attempt finished.');
    } catch (err) {
      log.error('[main.ts] Error during FileManager cleanup:', err);
    }
  } else {
    log.warn(
      '[main.ts] FileManager instance not found, using fallback cleanup.'
    );
    const fallbackDir = path.join(app.getPath('userData'), 'temp');
    log.warn(`[main.ts] Attempting fallback cleanup for: ${fallbackDir}`);
    try {
      await fsPromises.rm(fallbackDir, { recursive: true, force: true });
      log.warn('[main.ts] Fallback cleanup attempt finished successfully.');
    } catch (e) {
      if ((e as any)?.code !== 'ENOENT') {
        log.error('[main.ts] Error during fallback cleanup:', e);
      }
    }
  }
  log.info('[main.ts] will-quit handler finished.');
});

nodeProcess.on('uncaughtException', error => {
  log.error('[main.ts] Uncaught Exception:', error);
  if (!isDev) {
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
      preload: path.join(__dirname, 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
      allowRunningInsecureContent: false,
    },
  });

  electronContextMenu({ window: mainWindow, showInspectElement: true });

  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  log.info(`[main.ts] Loading renderer: ${rendererPath}`);

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) =>
    cb(true)
  );

  mainWindow.webContents.session.protocol.registerFileProtocol(
    'file',
    (request, callback) => {
      const filePath = decodeURI(request.url.replace('file://', ''));
      try {
        callback(filePath);
      } catch (error) {
        log.error('File protocol error:', error);
      }
    }
  );

  await mainWindow.loadFile(rendererPath);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    log.info('[main.ts] Main window closed.');
    mainWindow = null;
  });

  ipcMain.on(
    'find-in-page',
    (_event, { text, findNext, forward, matchCase }) => {
      if (!mainWindow) return;
      if (text) {
        if (text !== lastSearchText) lastSearchText = text;
        mainWindow.webContents.findInPage(text, {
          findNext: !!findNext,
          forward: forward === undefined ? true : forward,
          matchCase: !!matchCase,
        });
      } else {
        mainWindow.webContents.stopFindInPage('clearSelection');
        lastSearchText = '';
      }
    }
  );

  ipcMain.on('stop-find', () => {
    if (mainWindow) {
      mainWindow.webContents.stopFindInPage('clearSelection');
      lastSearchText = '';
    }
  });

  mainWindow.webContents.on('found-in-page', (_event, result) => {
    mainWindow?.webContents.send('find-results', {
      matches: result.matches,
      activeMatchOrdinal: result.activeMatchOrdinal,
      finalUpdate: result.finalUpdate,
    });
  });

  const menuTemplate: MenuItemConstructorOptions[] = [
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
            await shell.openExternal('https://github.com/your-repo');
          },
        },
      ],
    },
  ];

  if (nodeProcess.platform === 'darwin') {
    const name = app.getName();
    menuTemplate.unshift({
      label: name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
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

async function testYtDlpInstallation() {
  log.error('[main.ts] Testing yt-dlp installation');
  try {
    try {
      const { stdout } = await execAsync('which yt-dlp');
      if (stdout.trim()) {
        const systemPath = stdout.trim();
        log.info(`[main.ts] Found system yt-dlp at: ${systemPath}`);
        try {
          const { stdout: verOut } = await execAsync(
            `"${systemPath}" --version`
          );
          log.info(`[main.ts] System yt-dlp version: ${verOut.trim()}`);
        } catch (e) {
          log.error('[main.ts] System yt-dlp version check error:', e);
        }
      }
    } catch {
      log.info('[main.ts] No system-installed yt-dlp found');
    }

    const resourcesPath = nodeProcess.resourcesPath;
    const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');
    const ytdlpPath = path.join(
      unpackedPath,
      'node_modules',
      'youtube-dl-exec',
      'bin',
      'yt-dlp'
    );

    if (fs.existsSync(ytdlpPath)) {
      const stats = fs.statSync(ytdlpPath);
      const isExecutable = (stats.mode & fs.constants.S_IXUSR) !== 0;
      log.info(`[main.ts] yt-dlp is executable: ${isExecutable}`);
      if (!isExecutable) {
        await execAsync(`chmod +x "${ytdlpPath}"`);
      }
      const { stdout, stderr } = await execAsync(`"${ytdlpPath}" --version`);
      log.info(`[main.ts] local yt-dlp version: ${stdout.trim()}`);
      if (stderr) log.warn(`[main.ts] yt-dlp stderr: ${stderr}`);
    }

    try {
      const dirContents = await fsPromises.readdir(unpackedPath);
      log.info(`[main.ts] Unpacked directory: ${dirContents.join(', ')}`);
    } catch (dirError) {
      log.error('[main.ts] Error listing unpacked:', dirError);
    }

    log.info('[main.ts] yt-dlp installation test complete');
    return true;
  } catch (error) {
    log.error('[main.ts] Error testing yt-dlp installation:', error);
    return false;
  }
}

app.whenReady().then(async () => {
  try {
    // Conditionally set log directory and file name
    const logFileName = isDev ? 'dev-main.log' : 'main.log';
    const logDirPath = isDev ? '.' : app.getPath('userData'); // Use project root for dev
    const logFilePath = path.join(logDirPath, logFileName);

    try {
      // Ensure the directory exists (especially needed for userData path)
      await fsPromises.mkdir(logDirPath, { recursive: true });
    } catch (mkdirError: any) {
      // Ignore EEXIST error if dir already exists, log other errors
      if (mkdirError.code !== 'EEXIST') {
        console.error(
          `[main.ts] Failed to ensure log directory ${logDirPath}:`,
          mkdirError
        );
      }
    }

    log.transports.file.resolvePathFn = () => logFilePath;
    log.transports.file.level = isDev ? 'debug' : 'info';
    const startupLogPath = log.transports.file.getFile().path; // Resolve path after setting fn

    // Log the configuration
    log.info(
      `[main.ts] Logging configured. Mode: ${isDev ? 'Development (Project Root)' : 'Production (User Data)'}`
    );
    log.info(`[main.ts] Attempting to log to: ${logFilePath}`);
    log.info(`[main.ts] Resolved log file path: ${startupLogPath}`);

    // --- Debug log file --- START ---
    // Keep this separate for direct debugging if needed
    const debugLogPath = path.join(logDirPath, 'direct_debug_log.txt');
    try {
      fsSync.unlinkSync(debugLogPath);
    } catch {}
    fsSync.appendFileSync(debugLogPath, `STARTUP: ${logFilePath}\n`);
    fsSync.appendFileSync(debugLogPath, `RESOLVED: ${startupLogPath}\n`);
  } catch (error) {
    console.error('[main.ts] Error configuring log path:', error);
  }

  log.info('[main.ts] App ready, creating window...');
  if (app.isPackaged) {
    log.info('[main.ts] Checking yt-dlp...');
    await testYtDlpInstallation();
  }
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  log.info('[main.ts] All windows closed.');
  if (nodeProcess.platform !== 'darwin') {
    log.info('[main.ts] Quitting app (not macOS).');
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
