import { app, BrowserWindow, ipcMain, Menu, shell, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url'; // Import for ESM __dirname equivalent
import * as fsPromises from 'fs/promises'; // Use promises version and import statically
import isDev from 'electron-is-dev';
import log from 'electron-log'; // electron-log is already configured by main.cjs
import electronContextMenu from 'electron-context-menu'; // Import the library
import nodeProcess from 'process'; // Alias process
import * as fsSync from 'fs';

// ESM equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // This now replaces the old __dirname

// === Start: Added Imports & Initialization ===
import { SaveFileService } from './services/save-file.js'; // Add .js extension for explicit ESM import
import { FileManager } from './services/file-manager.js'; // Add .js extension
import { FFmpegService } from './services/ffmpeg-service.js'; // Add .js extension
import { updateYtDlp } from './services/url-processor.js'; // Import the updateYtDlp function

// Import the new TypeScript handlers
import * as fileHandlersTS from './handlers/file-handlers.js'; // Add .js extension
import * as apiKeyHandlersTS from './handlers/api-key-handlers.js'; // Add .js extension
import * as subtitleHandlersTS from './handlers/subtitle-handlers.js'; // Add .js extension
import * as urlHandlerTS from './handlers/url-handler.js'; // Add .js extension
import * as utilityHandlersTS from './handlers/utility-handlers.js'; // Add .js extension

// Additional imports for testing
import { exec } from 'child_process';
import { promisify } from 'util';
import { processVideoUrl } from './services/url-processor.js';
import * as fs from 'fs';

// Promisified exec
const execAsync = promisify(exec);

// --- Setup Logging ---
// Configure electron-log basics
Object.assign(console, log.functions); // Make console.log/warn/error go through electron-log
// File path config moved to app.whenReady()

log.info('[src/main.ts] Initializing services and handlers...');

// --- Request Single Instance Lock ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.info('[src/main.ts] Another instance is already running. Quitting...');
  app.quit();
  nodeProcess.exit(0);
}

// Define a type for the services object for better type safety
interface AppServices {
  saveFileService: SaveFileService;
  fileManager: FileManager;
  ffmpegService: FFmpegService;
}

// --- Service Initialization ---
let services: AppServices | null = null; // Initialize as null or with a default structure
try {
  log.info('[src/main.ts] Starting service initialization...');

  // Improve native module loading diagnostics
  if (app.isPackaged) {
    log.info(
      '[src/main.ts] Running in packaged mode, resolving module paths...'
    );
    log.info(`[src/main.ts] __dirname: ${__dirname}`);
    log.info(
      `[src/main.ts] process.resourcesPath: ${nodeProcess.resourcesPath}`
    );
    log.info(
      `[src/main.ts] Node integration: ${nodeProcess.env.ELECTRON_NODE_INTEGRATION}`
    );
  }

  const saveFileService = SaveFileService.getInstance();
  log.info('[src/main.ts] SaveFileService initialized');

  const fileManager = new FileManager();
  log.info('[src/main.ts] FileManager initialized');

  const ffmpegService = new FFmpegService();
  log.info('[src/main.ts] FFmpegService initialized');

  services = {
    saveFileService,
    fileManager,
    ffmpegService,
  };

  log.info('[src/main.ts] Services initialized.');

  // --- Initialize Handlers using imported TS modules ---
  try {
    log.info('[src/main.ts] Starting handler initialization...');
    // Note: Pass only the required services for each handler module
    fileHandlersTS.initializeFileHandlers({ fileManager, saveFileService });
    log.info('[src/main.ts] File handlers initialized');

    subtitleHandlersTS.initializeSubtitleHandlers({
      ffmpegService,
      fileManager,
    });
    log.info('[src/main.ts] Subtitle handlers initialized');

    log.info('[src/main.ts] Handlers initialized.');

    // --- Register IPC Handlers using imported TS modules ---
    log.info('[src/main.ts] Registering IPC handlers...');

    ipcMain.handle('ping', utilityHandlersTS.handlePing);
    ipcMain.handle('show-message', utilityHandlersTS.handleShowMessage);
    ipcMain.handle('save-file', fileHandlersTS.handleSaveFile);
    ipcMain.handle('open-file', fileHandlersTS.handleOpenFile);
    ipcMain.handle('move-file', fileHandlersTS.handleMoveFile);
    ipcMain.handle('copy-file', fileHandlersTS.handleCopyFile);
    ipcMain.handle('delete-file', fileHandlersTS.handleDeleteFile);
    ipcMain.handle('readFileContent', fileHandlersTS.handleReadFileContent);
    ipcMain.handle(
      'get-api-key-status',
      apiKeyHandlersTS.handleGetApiKeyStatus
    );
    ipcMain.handle('save-api-key', apiKeyHandlersTS.handleSaveApiKey);
    ipcMain.handle('merge-subtitles', (event, options) => {
      log.info(
        `[IPC] Received 'merge-subtitles' request with options: ${JSON.stringify(options)}`
      );
      return subtitleHandlersTS.handleMergeSubtitles(event, options);
    });
    ipcMain.handle(
      'cancel-operation',
      subtitleHandlersTS.handleCancelOperation
    );
    ipcMain.handle(
      'generate-subtitles',
      subtitleHandlersTS.handleGenerateSubtitles
    );
    ipcMain.handle('process-url', urlHandlerTS.handleProcessUrl);

    // Register the test download function
    ipcMain.handle('test-download', async (_, url) => {
      // --- BABY STEP 2: Test processVideoUrl --- START ---
      const handlerTimeStamp = new Date().toISOString();
      log.error(
        `[${handlerTimeStamp}] ====== BABY STEP 2: Handler Entered =====`
      );
      log.info(`[${handlerTimeStamp}] Baby Step 2: Received URL: ${url}`);

      let installTestPassed = false;
      let downloadResult = null;

      try {
        // 1. Run installation test (we know this works now, but good practice)
        log.info(
          `[${handlerTimeStamp}] Baby Step 2: TRYING testYtDlpInstallation...`
        );
        try {
          installTestPassed = await testYtDlpInstallation();
          log.info(
            `[${handlerTimeStamp}] Baby Step 2: testYtDlpInstallation Result: ${installTestPassed}`
          );
        } catch (installError) {
          log.error(
            `[${handlerTimeStamp}] Baby Step 2: testYtDlpInstallation FAILED:`,
            installError
          );
          // Decide if this should be fatal or just logged
          installTestPassed = false;
        }

        // 2. Attempt the download using processVideoUrl
        log.info(
          `[${handlerTimeStamp}] Baby Step 2: TRYING processVideoUrl...`
        );
        try {
          downloadResult = await processVideoUrl(url, 'high', progress => {
            log.info(
              `[${handlerTimeStamp}] Baby Step 2 Progress: ${progress.stage} - ${progress.percent}%`
            );
            if (progress.error) {
              log.error(
                `[${handlerTimeStamp}] Baby Step 2 Progress Error: ${progress.error}`
              );
            }
          });
          log.info(
            `[${handlerTimeStamp}] Baby Step 2: processVideoUrl SUCCEEDED. Path: ${downloadResult?.videoPath}`
          );
        } catch (processError) {
          log.error(
            `[${handlerTimeStamp}] Baby Step 2: processVideoUrl FAILED:`,
            processError
          );
          // Log specific details if available
          if (processError instanceof Error) {
            log.error(
              `[${handlerTimeStamp}] Process Error Name: ${processError.name}`
            );
            log.error(
              `[${handlerTimeStamp}] Process Error Message: ${processError.message}`
            );
            log.error(
              `[${handlerTimeStamp}] Process Error Stack: ${processError.stack}`
            );
          } else {
            log.error(
              `[${handlerTimeStamp}] Process Non-Error object thrown: ${JSON.stringify(processError)}`
            );
          }
          throw processError; // Rethrow to send error back to renderer
        }

        log.info(
          `[${handlerTimeStamp}] Baby Step 2: Completed successfully. Returning result.`
        );
        return downloadResult; // Return the result from processVideoUrl
      } catch (outerError) {
        // This catches errors re-thrown from the inner blocks
        log.error(
          `[${handlerTimeStamp}] Baby Step 2: FAILED in OUTER CATCH block:`,
          outerError
        );
        if (outerError instanceof Error) {
          log.error(
            `[${handlerTimeStamp}] Outer Error Name: ${outerError.name}`
          );
          log.error(
            `[${handlerTimeStamp}] Outer Error Message: ${outerError.message}`
          );
        }
        throw outerError; // Rethrow to send error back to renderer
      }
      // --- BABY STEP 2: Test processVideoUrl --- END ---
    });

    log.info('[src/main.ts] IPC handlers registered.');
  } catch (handlerError: any) {
    log.error('[src/main.ts] Error initializing handlers:', handlerError);
    log.error('[src/main.ts] Handler error stack:', handlerError.stack);
    throw handlerError; // Rethrow to the outer try-catch
  }
} catch (error) {
  log.error(
    '[src/main.ts] FATAL: Error initializing services or handlers:',
    error
  );
  log.error('[src/main.ts] Error stack:', (error as Error).stack);
  // Don't quit immediately - let the app show at least a basic error message
  if (nodeProcess.env.NODE_ENV !== 'development') {
    // In production, show an error dialog before quitting
    app.whenReady().then(() => {
      dialog.showErrorBox(
        'Initialization Error',
        'The application encountered an error during startup. Please contact support.'
      );
      setTimeout(() => {
        app.quit();
        nodeProcess.exit(1);
      }, 5000); // Give time for the dialog to be seen
    });
  } else {
    // In development, log but don't quit to allow debugging
    console.error('FATAL ERROR DURING INITIALIZATION:', error);
  }
}

// --- Cleanup Temporary Files on Quit ---
app.on('will-quit', async () => {
  // Ensure fileManager is initialized before trying to access tempDir
  if (
    services?.fileManager &&
    typeof services.fileManager.cleanup === 'function'
  ) {
    log.info('[src/main.ts] App quitting, cleaning up temp directory...');
    try {
      await services.fileManager.cleanup(); // Use FileManager's cleanup
      log.info('[src/main.ts] Temp directory cleanup finished.');
    } catch (err) {
      log.error('[src/main.ts] Error during temp directory cleanup:', err);
    }
  } else {
    log.warn('[src/main.ts] FileManager not available for cleanup on quit.');
    // Fallback cleanup logic from main.cjs if needed, but preferably use the service
    const tempDirFallback = path.join(app.getPath('userData'), 'temp');
    log.warn(
      `[src/main.ts] Attempting fallback cleanup for: ${tempDirFallback}`
    );
    try {
      // Remove require, use imported fs.promises
      await fsPromises.rm(tempDirFallback, { recursive: true, force: true });
      log.warn(
        `[src/main.ts] Fallback cleanup attempt finished for ${tempDirFallback}.`
      );
    } catch (fallbackError: any) {
      // Type the error
      if (fallbackError?.code !== 'ENOENT') {
        // Check if code exists
        log.error(`[src/main.ts] Fallback cleanup error:`, fallbackError);
      }
    }
  }
});

// --- Global Error Handler ---
nodeProcess.on('uncaughtException', error => {
  log.error('[src/main.ts] Uncaught Exception:', error);
  // Potentially show a dialog to the user before quitting
  if (!isDev) {
    // Only quit automatically in production
    app.quit();
    nodeProcess.exit(1);
  }
});
// === End: Added Imports & Initialization ===

let mainWindow: BrowserWindow | null = null;

// Variable to store the last search text for findNext
let lastSearchText = '';

async function createWindow() {
  log.info('[src/main.ts] Creating main window...');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Correct preload path relative to dist/main.js
      preload: path.join(__dirname, 'preload', 'index.js'),
      // Defaults are recommended:
      // sandbox: true, // default in Electron 20+
      contextIsolation: true, // Keep true for security
      nodeIntegration: false, // Keep false for security
      webSecurity: !isDev, // Slightly relax security in dev for easier debugging if needed
      allowRunningInsecureContent: false, // Keep false for security
    },
  });

  // Initialize the context menu, hiding Inspect Element
  electronContextMenu({
    window: mainWindow,
    showInspectElement: true,
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

  await mainWindow.loadFile(rendererPath);

  // Open the DevTools automatically if running in development
  const isRunningInDev = nodeProcess.env.BUN_ENV === 'development' || isDev;
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
  if (nodeProcess.platform === 'darwin') {
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

app.whenReady().then(async () => {
  // Configure file logging path now that app is ready
  try {
    // Use app.getPath('userData') which is more reliable
    const logDirPath = app.getPath('userData');
    // --- MODIFIED: Use a distinct log file name ---
    const logFilePath = path.join(logDirPath, 'ipc-handler.log');

    // Ensure the directory exists (Electron usually creates userData, but double-check)
    try {
      await fsPromises.access(logDirPath);
    } catch {
      await fsPromises.mkdir(logDirPath, { recursive: true });
    }

    // --- MODIFIED: Force electron-log to use this specific path ---
    log.transports.file.resolvePathFn = () => logFilePath;
    log.transports.file.level = isDev ? 'debug' : 'info'; // Log more in dev
    // Force re-initialization with the new path function
    log.transports.file.resolvePathFn; // Call it once to ensure it resolves immediately if needed internally
    log.info(`[src/main.ts] Log file NOW CONFIGURED AT: ${logFilePath}`); // Changed log message

    // Log the resolved path at startup
    try {
      const startupLogPath = log.transports.file.getFile().path;
      log.info(
        `[src/main.ts] electron-log resolved path at startup: ${startupLogPath}`
      );
      const debugLogPath = path.join(
        app.getPath('userData'),
        'direct_debug_log.txt'
      );
      // Clear the direct debug log at startup for clean testing
      try {
        fsSync.unlinkSync(debugLogPath);
      } catch (e) {
        /* ignore if not exists */
      }
      fsSync.appendFileSync(
        debugLogPath,
        `STARTUP: electron-log configured path = ${logFilePath}\n`
      );
      fsSync.appendFileSync(
        debugLogPath,
        `STARTUP: electron-log resolved path = ${startupLogPath}\n`
      );
    } catch (e) {
      log.error('[src/main.ts] Error getting/logging startup log path:', e);
    }
  } catch (error) {
    console.error('[src/main.ts] Error configuring log file path:', error);
  }

  log.info('[src/main.ts] App ready event received.');

  // Try to update yt-dlp in the background
  updateYtDlp()
    .then(updated => {
      if (updated) {
        log.info('[src/main.ts] yt-dlp was successfully updated');
      } else {
        log.warn(
          '[src/main.ts] yt-dlp update was unsuccessful, will continue with existing version'
        );
      }
    })
    .catch(error => {
      log.error('[src/main.ts] Error updating yt-dlp:', error);
    });

  // Run test on startup in production mode
  if (app.isPackaged) {
    log.info('[src/main.ts] Running yt-dlp installation test on startup');
    await testYtDlpInstallation();
  }

  await createWindow();

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
  if (nodeProcess.platform !== 'darwin') {
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

// Test Functions
async function testYtDlpInstallation() {
  log.error('[main.ts] Testing yt-dlp installation');

  try {
    // ADDED: Check for system yt-dlp first
    try {
      log.info('[main.ts] Checking for system-installed yt-dlp');
      const { stdout } = await execAsync('which yt-dlp');
      if (stdout && stdout.trim()) {
        const systemPath = stdout.trim();
        log.info(`[main.ts] Found system yt-dlp at: ${systemPath}`);

        // Test if it works
        try {
          const { stdout: versionOutput } = await execAsync(
            `"${systemPath}" --version`
          );
          log.info(`[main.ts] System yt-dlp version: ${versionOutput.trim()}`);

          // Create a symbolic link to the system binary in the unpacked directory if possible
          try {
            const resourcesPath = process.resourcesPath;
            const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');
            const nodeModulesPath = path.join(unpackedPath, 'node_modules');
            const ytdlpDir = path.join(
              nodeModulesPath,
              'youtube-dl-exec',
              'bin'
            );

            // Ensure directory exists
            if (!fs.existsSync(ytdlpDir)) {
              await fsPromises.mkdir(ytdlpDir, { recursive: true });
              log.info(`[main.ts] Created directory: ${ytdlpDir}`);
            }

            const targetPath = path.join(ytdlpDir, 'yt-dlp');

            // Remove existing file/link if it exists
            if (fs.existsSync(targetPath)) {
              await fsPromises.unlink(targetPath);
              log.info(`[main.ts] Removed existing file: ${targetPath}`);
            }

            // Create symbolic link
            await fsPromises.symlink(systemPath, targetPath);
            log.info(
              `[main.ts] Created symlink from ${systemPath} to ${targetPath}`
            );

            return true;
          } catch (linkError) {
            log.error(
              '[main.ts] Error creating symlink to system yt-dlp:',
              linkError
            );
            // Continue with original flow, don't return yet
          }
        } catch (versionError) {
          log.error(
            '[main.ts] Error checking system yt-dlp version:',
            versionError
          );
        }
      }
    } catch (whichError) {
      log.info('[main.ts] No system-installed yt-dlp found');
    }

    // Check unpacked folder
    const resourcesPath = process.resourcesPath;
    const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');
    const ytdlpPath = path.join(
      unpackedPath,
      'node_modules',
      'youtube-dl-exec',
      'bin',
      'yt-dlp'
    );

    log.info(`[main.ts] Checking if yt-dlp exists at: ${ytdlpPath}`);
    const exists = fs.existsSync(ytdlpPath);
    log.info(`[main.ts] yt-dlp exists: ${exists}`);

    if (exists) {
      // Check permissions
      const stats = fs.statSync(ytdlpPath);
      const isExecutable = (stats.mode & fs.constants.S_IXUSR) !== 0;
      log.info(`[main.ts] yt-dlp is executable: ${isExecutable}`);

      if (!isExecutable) {
        log.info('[main.ts] Attempting to make yt-dlp executable');
        await execAsync(`chmod +x "${ytdlpPath}"`);
        log.info('[main.ts] chmod command executed');
      }

      // Test running yt-dlp
      log.info('[main.ts] Testing yt-dlp execution');
      const { stdout, stderr } = await execAsync(`"${ytdlpPath}" --version`);
      log.info(`[main.ts] yt-dlp version: ${stdout.trim()}`);
      if (stderr) {
        log.warn(`[main.ts] yt-dlp stderr: ${stderr}`);
      }
    }

    // Check other possible locations
    try {
      log.info('[main.ts] Checking other possible locations');
      const dirContents = await fsPromises.readdir(unpackedPath);
      log.info(
        `[main.ts] Unpacked directory contents: ${dirContents.join(', ')}`
      );

      // Check node_modules directory
      const nodeModulesPath = path.join(unpackedPath, 'node_modules');
      if (fs.existsSync(nodeModulesPath)) {
        const nodeModulesContents = await fsPromises.readdir(nodeModulesPath);
        log.info(
          `[main.ts] node_modules contents: ${nodeModulesContents.join(', ')}`
        );

        // Check youtube-dl-exec directory
        const ytdlpDir = path.join(nodeModulesPath, 'youtube-dl-exec');
        if (fs.existsSync(ytdlpDir)) {
          const ytdlpDirContents = await fsPromises.readdir(ytdlpDir);
          log.info(
            `[main.ts] youtube-dl-exec contents: ${ytdlpDirContents.join(', ')}`
          );

          // Check bin directory
          const binDir = path.join(ytdlpDir, 'bin');
          if (fs.existsSync(binDir)) {
            const binDirContents = await fsPromises.readdir(binDir);
            log.info(`[main.ts] bin contents: ${binDirContents.join(', ')}`);
          }
        }
      }
    } catch (dirError) {
      log.error('[main.ts] Error checking directories:', dirError);
    }

    log.info('[main.ts] yt-dlp installation test complete');
    return true;
  } catch (error) {
    log.error('[main.ts] Error testing yt-dlp installation:', error);
    return false;
  }
}

// EXPOSING TEST FUNCTION
// @ts-ignore - Add to global for debugging
global.testDownload = async (url: string) => {
  try {
    log.info(`[main.ts] Test download called for URL: ${url}`);
    await testYtDlpInstallation();

    const result = await processVideoUrl(url, 'high', progress => {
      log.info(
        `[main.ts] Test download progress: ${progress.stage} - ${progress.percent}%`
      );
    });

    log.info(
      `[main.ts] Test download completed successfully: ${result.videoPath}`
    );
    return result;
  } catch (error) {
    log.error('[main.ts] Test download failed:', error);
    throw error;
  }
};
