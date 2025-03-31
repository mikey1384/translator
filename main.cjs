const path = require('path');
const fs = require('fs');
const { ipcMain, app } = require('electron');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.info('Another instance is already running. Quitting...');
  app.quit();
  process.exit(0);
}

const logFile = path.join(__dirname, 'app.log');
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

const startupMessage =
  '\n=== Application Started ' + new Date().toISOString() + ' ===\n\n';
logStream.write(startupMessage);

const originalConsole = { ...console };
function timestamp() {
  return new Date().toISOString();
}

console.log = (...args) => {
  const message = `[${timestamp()}] [LOG] ${args
    .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
    .join(' ')}\n`;
  logStream.write(message);
  originalConsole.log(...args);
};

console.info = (...args) => {
  const message = `[${timestamp()}] [INFO] ${args
    .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
    .join(' ')}\n`;
  logStream.write(message);
  originalConsole.info(...args);
};

console.warn = (...args) => {
  const message = `[${timestamp()}] [WARN] ${args
    .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
    .join(' ')}\n`;
  logStream.write(message);
  originalConsole.warn(...args);
};

console.error = (...args) => {
  const message = `[${timestamp()}] [ERROR] ${args
    .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
    .join(' ')}\n`;
  logStream.write(message);
  originalConsole.error(...args);
};

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

  // Register IPC handlers using the service methods
  ipcMain.handle('ping', () => {
    console.info('Received ping request');
    return 'pong';
  });
  console.info('Registered ping handler.');

  ipcMain.handle('save-file', async (_event, options) => {
    console.info('Received save-file request with options:', options);
    try {
      const filePath = await saveFileService.saveFile(options);
      return { success: true, filePath };
    } catch (error) {
      console.error('Error handling save-file:', error);
      return { success: false, error: error.message || String(error) };
    }
  });
  console.info('Registered save-file handler.');

  ipcMain.handle('open-file', async (_event, options) => {
    console.info('Received open-file request with options:', options);
    try {
      const result = await fileManager.openFile(options);
      return result;
    } catch (error) {
      console.error('Error handling open-file:', error);
      return {
        canceled: false,
        filePaths: [],
        error: error.message || String(error),
      };
    }
  });
  console.info('Registered open-file handler.');

  // Register merge-subtitles handler (updated)
  ipcMain.handle('merge-subtitles', async (event, options) => {
    // Use operationId from options if provided, otherwise generate one (fallback)
    const operationId =
      options.operationId ||
      `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    console.log(
      `[${operationId}] Received merge request via IPC. Options keys:`,
      Object.keys(options)
    );

    // Prepare temporary files if needed
    let tempSrtPath = null;
    let tempVideoPath = null;
    let finalVideoPath = null;

    try {
      // --- Handle Temporary SRT --- //
      if (options.srtContent) {
        console.log(`[${operationId}] Processing SRT content for merge.`);
        tempSrtPath = path.join(
          ffmpegService.getTempDir(),
          `temp_merge_${Date.now()}.srt`
        );
        await fs.promises.writeFile(tempSrtPath, options.srtContent, 'utf8');
        options.subtitlesPath = tempSrtPath; // Use the temp path
        delete options.srtContent; // Clean up data
        console.log(`[${operationId}] Wrote temporary SRT to ${tempSrtPath}`);
      }

      // --- Handle Temporary Video --- //
      if (options.videoFileData && options.videoFileName) {
        console.log(`[${operationId}] Processing video file data for merge.`);
        const safeFileName = options.videoFileName.replace(
          /[^a-zA-Z0-9_.-]/g,
          '_'
        );
        tempVideoPath = path.join(
          ffmpegService.getTempDir(),
          `temp_merge_${Date.now()}_${safeFileName}`
        );
        const buffer = Buffer.from(options.videoFileData);
        await fs.promises.writeFile(tempVideoPath, buffer);
        options.videoPath = tempVideoPath; // Use the temp path for the merge
        // delete options.videoFileData; // Keep data until after merge call if needed?
        // delete options.videoFileName; // <-- Keep videoFileName
        console.log(
          `[${operationId}] Wrote temporary video to ${tempVideoPath}`
        );
      }

      // --- Validation --- //
      finalVideoPath = options.videoPath; // The path to use for merging
      if (!finalVideoPath || !options.subtitlesPath) {
        throw new Error('Video path and subtitles path/content are required.');
      }

      // Normalize paths
      finalVideoPath = path.normalize(finalVideoPath);
      options.subtitlesPath = path.normalize(options.subtitlesPath);

      // Verify file access
      await fs.promises.access(finalVideoPath, fs.constants.R_OK);
      await fs.promises.access(options.subtitlesPath, fs.constants.R_OK);
      console.log(
        `[${operationId}] Verified file access for video: ${finalVideoPath} and subtitles: ${options.subtitlesPath}`
      );

      // --- Execute Merge --- //
      const result = await mergeSubtitlesWithVideo(
        options, // Pass the modified options object
        operationId,
        progress => {
          event.sender.send('merge-subtitles-progress', {
            ...progress,
            operationId,
          });
        },
        { ffmpegService } // Pass dependencies
      );

      // Return the successful result containing the temporary path
      console.log(
        `[${operationId}] Merge successful. Temp path: ${result.tempOutputPath}`
      );
      return {
        success: true,
        tempOutputPath: result.tempOutputPath,
        operationId,
      };
    } catch (error) {
      console.error(`[${operationId}] Error handling merge-subtitles:`, error);
      event.sender.send('merge-subtitles-progress', {
        percent: 100,
        stage: `Error: ${error.message || 'Unknown merge error'}`,
        error: error.message || 'Unknown merge error',
        operationId,
      });
      return {
        success: false,
        error: error.message || String(error),
        operationId,
      };
    } finally {
      // --- Cleanup --- //
      console.log(`[${operationId}] Starting cleanup in finally block.`);
      // Clean up temporary SRT file if created
      if (tempSrtPath) {
        try {
          await fs.promises.unlink(tempSrtPath);
          console.log(`[${operationId}] Cleaned up temp SRT: ${tempSrtPath}`);
        } catch (cleanupError) {
          console.warn(
            `[${operationId}] Failed to cleanup temp SRT ${tempSrtPath}:`,
            cleanupError
          );
        }
      }
      // Clean up temporary Video file if created
      if (tempVideoPath) {
        try {
          await fs.promises.unlink(tempVideoPath);
          console.log(
            `[${operationId}] Cleaned up temp video: ${tempVideoPath}`
          );
        } catch (cleanupError) {
          console.warn(
            `[${operationId}] Failed to cleanup temp video ${tempVideoPath}:`,
            cleanupError
          );
        }
      }
      console.log(`[${operationId}] Cleanup finished.`);
    }
  });
  console.info('Registered merge-subtitles handler.');

  // Register move-file handler
  ipcMain.handle('move-file', async (_event, { sourcePath, targetPath }) => {
    console.info(
      `Received move-file request from ${sourcePath} to ${targetPath}`
    );
    try {
      if (!sourcePath || !targetPath) {
        throw new Error('Source and target paths are required for move.');
      }
      // Ensure target directory exists (optional, rename handles it often, but good practice)
      const targetDir = path.dirname(targetPath);
      await fs.promises.mkdir(targetDir, { recursive: true });
      // Perform the move
      await fs.promises.rename(sourcePath, targetPath);
      console.info(`Successfully moved file to ${targetPath}`);
      return { success: true };
    } catch (error) {
      console.error(
        `Error handling move-file from ${sourcePath} to ${targetPath}:`,
        error
      );
      return { success: false, error: error.message || String(error) };
    }
  });
  console.info('Registered move-file handler.');

  // Register delete-file handler
  ipcMain.handle('delete-file', async (_event, { filePathToDelete }) => {
    console.info(`Received delete-file request for ${filePathToDelete}`);
    try {
      if (!filePathToDelete) {
        throw new Error('File path is required for deletion.');
      }
      await fs.promises.unlink(filePathToDelete);
      console.info(`Successfully deleted file: ${filePathToDelete}`);
      return { success: true };
    } catch (error) {
      // If file doesn't exist, treat as success (idempotent)
      if (error.code === 'ENOENT') {
        console.warn(
          `Attempted to delete non-existent file (considered success): ${filePathToDelete}`
        );
        return { success: true };
      }
      console.error(
        `Error handling delete-file for ${filePathToDelete}:`,
        error
      );
      return { success: false, error: error.message || String(error) };
    }
  });
  console.info('Registered delete-file handler.');

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
