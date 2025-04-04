const path = require('path');
const fs = require('fs');
const { ipcMain, app } = require('electron');
const keytar = require('keytar');

// --- Require and setup logging --- START ---
const { setupLogging } = require('./logging.cjs');
setupLogging();
// --- Require and setup logging --- END ---

// --- Require handler modules --- START ---
const fileHandlers = require('./handlers/file-handlers.cjs');
const apiKeyHandlers = require('./handlers/api-key-handlers.cjs');
const subtitleHandlers = require('./handlers/subtitle-handlers.cjs');
const urlHandler = require('./handlers/url-handler.cjs');
const utilityHandlers = require('./handlers/utility-handlers.cjs');
// --- Require handler modules --- END ---

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.info('Another instance is already running. Quitting...');
  app.quit();
  process.exit(0);
}

console.info('Loading application...');

// --- Start: Service Initialization and Handler Registration ---
let services = {};
try {
  // Import TypeScript services using their compiled JS output paths
  const { SaveFileService } = require('./dist/services/save-file');
  const { FileManager } = require('./dist/services/file-manager');
  const { FFmpegService } = require('./dist/services/ffmpeg-service');
  const {
    mergeSubtitlesWithVideo,
    generateSubtitlesFromVideo,
  } = require('./dist/services/subtitle-processing');

  // Initialize services
  const saveFileService = SaveFileService.getInstance();
  const fileManager = new FileManager();
  const ffmpegService = new FFmpegService();

  // Store service instances
  services = {
    saveFileService,
    fileManager,
    ffmpegService,
  };

  console.info('TypeScript services initialized.');

  // --- Initialize handlers --- START ---
  fileHandlers.initializeFileHandlers(services);
  subtitleHandlers.initializeSubtitleHandlers(services);
  // --- Initialize handlers --- END ---

  // Register IPC handlers using the service methods
  // === Utility Handlers (Now Imported) === START ===
  ipcMain.handle('ping', utilityHandlers.handlePing);
  ipcMain.handle('show-message', utilityHandlers.handleShowMessage);
  // === Utility Handlers (Now Imported) === END ===

  // === File Handlers (Now Imported) === START ===
  ipcMain.handle('save-file', fileHandlers.handleSaveFile);
  ipcMain.handle('open-file', fileHandlers.handleOpenFile);
  ipcMain.handle('move-file', fileHandlers.handleMoveFile);
  ipcMain.handle('copy-file', fileHandlers.handleCopyFile);
  ipcMain.handle('delete-file', fileHandlers.handleDeleteFile);
  ipcMain.handle('readFileContent', fileHandlers.handleReadFileContent);
  // === File Handlers (Now Imported) === END ===

  // === API Key Handlers (Now Imported) === START ===
  ipcMain.handle('get-api-key-status', apiKeyHandlers.handleGetApiKeyStatus);
  ipcMain.handle('save-api-key', apiKeyHandlers.handleSaveApiKey);
  // === API Key Handlers (Now Imported) === END ===

  // === Subtitle Handlers (Now Imported) === START ===
  ipcMain.handle(
    'translate-subtitles',
    subtitleHandlers.handleTranslateSubtitles
  );
  ipcMain.handle('merge-subtitles', subtitleHandlers.handleMergeSubtitles);
  ipcMain.handle('cancel-merge', subtitleHandlers.handleCancelMerge);
  ipcMain.handle(
    'generate-subtitles',
    subtitleHandlers.handleGenerateSubtitles
  );
  // === Subtitle Handlers (Now Imported) === END ===

  // === URL Processing Handler (Now Imported) === START ===
  ipcMain.handle('process-url', urlHandler.handleProcessUrl);
  // === URL Processing Handler (Now Imported) === END ===

  console.info('TypeScript service handlers registered.');
} catch (error) {
  console.error(
    'FATAL: Error initializing TypeScript services or handlers:',
    error
  );
  // Optionally quit the app if services are essential
  // app.quit();
  // process.exit(1);
}
// --- End: Service Initialization and Handler Registration ---

let mainPath;

const distMainPath = path.join(__dirname, 'dist', 'main.js');
if (fs.existsSync(distMainPath)) {
  mainPath = distMainPath;
  console.info(`Found main module at ${mainPath}`);
} else {
  const potentialLocations = [
    path.join(__dirname, 'dist', 'main.js'),
    path.join(__dirname, 'main.js'),
    path.join(__dirname, 'dist', 'index.js'),
  ];

  for (const location of potentialLocations) {
    if (fs.existsSync(location)) {
      mainPath = location;
      console.info(`Found main module at ${mainPath}`);
      break;
    }
  }
}

if (!mainPath) {
  console.error('Could not find main module! Application cannot start.');
  process.exit(1);
}

try {
  require(mainPath); // This loads the compiled src/main.ts
} catch (err) {
  console.error('Error loading main module:', err);
  process.exit(1);
}

// Global error handler (optional but good practice)
process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// --- Cleanup Temporary Files on Quit --- START ---
app.on('will-quit', async () => {
  const tempDir = path.join(app.getPath('userData'), 'temp');
  console.log(
    `[Cleanup] App quitting, attempting to clean temp directory: ${tempDir}`
  );

  try {
    // Use fs.promises for async operations
    const files = await fs.promises.readdir(tempDir);
    const tempVideoFiles = files.filter(f => f.startsWith('ytdl_'));

    if (tempVideoFiles.length === 0) {
      console.log('[Cleanup] No temporary ytdl_ files found to delete.');
      return;
    }

    console.log(
      `[Cleanup] Found ${tempVideoFiles.length} temporary ytdl_ files to delete.`
    );

    const deletePromises = tempVideoFiles.map(async file => {
      const filePath = path.join(tempDir, file);
      try {
        // Use fs.promises for async operations
        await fs.promises.unlink(filePath);
        console.log(`[Cleanup] Deleted: ${file}`);
        return { file, status: 'deleted' };
      } catch (err) {
        console.error(`[Cleanup] Failed to delete ${file}:`, err.message);
        return { file, status: 'failed', error: err.message };
      }
    });

    await Promise.allSettled(deletePromises);
    console.log('[Cleanup] Finished cleanup attempt.');
  } catch (err) {
    // Handle cases where the temp directory itself might not exist
    if (err.code === 'ENOENT') {
      console.log('[Cleanup] Temp directory does not exist, nothing to clean.');
    } else {
      console.error(
        '[Cleanup] Error reading temp directory during cleanup:',
        err
      );
    }
  }
});
// --- Cleanup Temporary Files on Quit --- END ---
