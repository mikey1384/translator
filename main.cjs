const path = require('path');
const fs = require('fs');
const { ipcMain, app } = require('electron');
const keytar = require('keytar');

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

  // Register IPC handlers using the service methods
  ipcMain.handle('ping', () => {
    console.info('Received ping request');
    return 'pong';
  });
  console.info('Registered ping handler.');

  ipcMain.handle('show-message', async (_, message) => {
    console.info('Received show-message request:', message);
    try {
      const { dialog } = require('electron');
      await dialog.showMessageBox({
        type: 'info',
        title: 'Translator',
        message: message || 'Operation completed successfully',
        buttons: ['OK'],
      });
      return { success: true };
    } catch (error) {
      console.error('Error showing message:', error);
      return { success: false, error: error.message || String(error) };
    }
  });
  console.info('Registered show-message handler.');

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

  // === API Key Handlers ===
  const SERVICE_NAME = 'TranslatorApp'; // Used for keytar service identifier

  ipcMain.handle('get-api-key-status', async () => {
    console.info('Received get-api-key-status request');
    try {
      const openAIKey = await keytar.getPassword(SERVICE_NAME, 'openai');
      const anthropicKey = await keytar.getPassword(SERVICE_NAME, 'anthropic');
      const status = {
        openai: !!openAIKey,
        anthropic: !!anthropicKey,
      };
      console.info('API Key Status:', status);
      return { success: true, status };
    } catch (error) {
      console.error('Error getting API key status:', error);
      // Avoid exposing error details potentially containing sensitive info
      return {
        success: false,
        error: 'Failed to retrieve key status.',
        status: { openai: false, anthropic: false },
      };
    }
  });
  console.info('Registered get-api-key-status handler.');

  ipcMain.handle('save-api-key', async (_event, { keyType, apiKey }) => {
    console.info(`Received save-api-key request for type: ${keyType}`);

    // Adjust validation: Allow empty string for deletion, but not null/undefined
    if (!keyType || typeof apiKey === 'undefined' || apiKey === null) {
      console.warn('Save API key rejected: Key type or API key missing.');
      return { success: false, error: 'Key type and API key are required.' };
    }
    if (keyType !== 'openai' && keyType !== 'anthropic') {
      console.warn(`Save API key rejected: Invalid key type '${keyType}'.`);
      return { success: false, error: 'Invalid key type specified.' };
    }

    try {
      if (apiKey === '') {
        // --- Deletion Logic ---
        console.info(`Attempting to delete ${keyType} API key...`);
        const deleted = await keytar.deletePassword(SERVICE_NAME, keyType);
        if (deleted) {
          console.info(`Successfully deleted ${keyType} API key.`);
          return { success: true };
        } else {
          // This might happen if the key didn't exist in the first place
          console.warn(
            `Keytar reported no key found to delete for ${keyType}, considering success.`
          );
          return { success: true }; // Treat as success if key wasn't there
        }
      } else {
        // --- Saving Logic ---
        console.info(`Attempting to save ${keyType} API key...`);
        // Basic validation (example: check prefix) - only apply if saving, not deleting
        if (keyType === 'openai' && !apiKey.startsWith('sk-')) {
          console.warn('Save API key rejected: Invalid OpenAI key format.');
          return { success: false, error: 'Invalid OpenAI key format.' };
        }
        // Add similar check for Anthropic if needed
        // if (keyType === 'anthropic' && !apiKey.startsWith('sk-ant-')) { ... }

        await keytar.setPassword(SERVICE_NAME, keyType, apiKey);
        console.info(`Successfully saved ${keyType} API key.`);
        return { success: true };
      }
    } catch (error) {
      // Log the error with more context
      const action = apiKey === '' ? 'deleting' : 'saving';
      console.error(`Error ${action} ${keyType} API key:`, error);
      return { success: false, error: `Failed to ${action} ${keyType} key.` };
    }
  });
  console.info('Registered save-api-key handler.');

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
  ipcMain.handle('move-file', async (_event, sourcePath, destinationPath) => {
    // --- Add Logging --- START ---
    console.log(
      `[move-file handler] Received source: ${sourcePath}, destination: ${destinationPath}`
    );
    // --- Add Logging --- END ---
    if (!sourcePath || !destinationPath) {
      // Log the error condition too
      console.error(
        `[move-file handler] Error: Missing paths. Source: ${sourcePath}, Dest: ${destinationPath}`
      );
      return { error: 'Source and target paths are required for move.' };
    }
    try {
      // Ensure target directory exists (optional, rename handles it often, but good practice)
      const targetDir = path.dirname(destinationPath);
      await fs.promises.mkdir(targetDir, { recursive: true });
      // Perform the move
      await fs.promises.rename(sourcePath, destinationPath);
      console.info(`Successfully moved file to ${destinationPath}`);
      return { success: true };
    } catch (error) {
      console.error(
        `Error handling move-file from ${sourcePath} to ${destinationPath}:`,
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

  // Register cancel-merge handler
  ipcMain.handle('cancel-merge', async (_event, operationId) => {
    // ... existing cancel-merge handler code ...
  });
  console.info('Registered cancel-merge handler.');

  // === Register generate-subtitles handler ===
  ipcMain.handle('generate-subtitles', async (event, options) => {
    const operationId = `generate-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    console.log(
      `[${operationId}] Received generate-subtitles request via IPC. Options keys:`,
      Object.keys(options)
    );

    let tempVideoPath = null;
    let finalOptions = { ...options }; // Clone options to avoid mutation

    try {
      // --- Handle Temporary Video --- //
      if (options.videoFileData && options.videoFileName) {
        console.log(
          `[${operationId}] Processing video file data for generation.`
        );
        const safeFileName = options.videoFileName.replace(
          /[^a-zA-Z0-9_.-]/g,
          '_'
        );
        tempVideoPath = path.join(
          ffmpegService.getTempDir(),
          `temp_generate_${Date.now()}_${safeFileName}`
        );
        const buffer = Buffer.from(options.videoFileData);
        await fs.promises.writeFile(tempVideoPath, buffer);
        finalOptions.videoPath = tempVideoPath; // Use the temp path
        // Clean up data passed over IPC
        delete finalOptions.videoFileData;
        console.log(
          `[${operationId}] Wrote temporary video to ${tempVideoPath}`
        );
      }

      // --- Validation --- //
      if (!finalOptions.videoPath) {
        throw new Error('Video path is required for subtitle generation.');
      }
      finalOptions.videoPath = path.normalize(finalOptions.videoPath);
      await fs.promises.access(finalOptions.videoPath, fs.constants.R_OK);
      console.log(
        `[${operationId}] Verified file access for video: ${finalOptions.videoPath}`
      );

      // --- Execute Generation --- //
      const result = await generateSubtitlesFromVideo(
        finalOptions, // Pass the potentially modified options
        progress => {
          event.sender.send('generate-subtitles-progress', {
            ...progress,
            operationId,
          });
        },
        { ffmpegService, fileManager } // Pass dependencies
      );

      // Return the successful result
      console.log(
        `[${operationId}] Subtitle generation successful. Subtitle length: ${result.subtitles?.length || 0}`
      );
      return {
        success: true,
        subtitles: result.subtitles,
        operationId,
      };
    } catch (error) {
      console.error(
        `[${operationId}] Error handling generate-subtitles:`,
        error
      );
      event.sender.send('generate-subtitles-progress', {
        percent: 100,
        stage: `Error: ${error.message || 'Unknown generation error'}`,
        error: error.message || 'Unknown generation error',
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
  console.info('Registered generate-subtitles handler.');

  // === Register translate-subtitles handler (Placeholder) ===
  ipcMain.handle('translate-subtitles', async (event, options) => {
    const operationId = `translate-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    console.log(
      `[${operationId}] Received translate-subtitles request via IPC. Options keys:`,
      Object.keys(options)
    );

    // Simulate some work and progress
    const sendProgress = (percent, stage) => {
      try {
        event.sender.send('translate-subtitles-progress', {
          percent,
          stage,
          operationId,
        });
      } catch (sendError) {
        console.error(`[${operationId}] Error sending progress:`, sendError);
      }
    };

    try {
      sendProgress(10, 'Starting translation...');
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay

      sendProgress(50, 'Translating segments...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay

      // Simulate creating translated content (replace with actual logic later)
      let dummyTranslatedSrt = '';
      if (typeof options.subtitles === 'string') {
        dummyTranslatedSrt = options.subtitles
          .split('\n\n')
          .map(block => {
            const lines = block.split('\n');
            if (lines.length >= 3) {
              // Add translation prefix to text lines
              for (let i = 2; i < lines.length; i++) {
                if (lines[i].trim() !== '') {
                  // Avoid translating empty lines
                  lines[i] = `[Translated] ${lines[i]}`;
                }
              }
            }
            return lines.join('\n');
          })
          .join('\n\n');
      } else {
        console.warn(
          `[${operationId}] Subtitles option is not a string, skipping dummy translation.`
        );
      }

      sendProgress(100, 'Translation complete.');

      console.log(`[${operationId}] Translation simulation complete.`);
      return {
        success: true,
        translatedSubtitles: dummyTranslatedSrt,
        operationId,
      };
    } catch (error) {
      // Use 'unknown' or 'any' if unsure about error type
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[${operationId}] Error handling translate-subtitles:`,
        error
      );
      sendProgress(100, `Error: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        operationId,
      };
    }
  });
  console.info('Registered translate-subtitles handler (Placeholder).');

  // === Register process-url handler ===
  ipcMain.handle('process-url', async (event, options) => {
    const operationId = `process-url-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    console.log(`[${operationId}] Received process-url request:`, options);

    const sendProgress = progressData => {
      try {
        event.sender.send('process-url-progress', {
          ...progressData,
          operationId,
        });
      } catch (e) {
        console.error(`[${operationId}] Error sending URL progress update:`, e);
      }
    };

    let downloadedVideoPath = null;
    let finalVideoPathFromLog = null; // Variable to store the definitive path

    try {
      // --- Validation ---
      if (!options || !options.url) {
        throw new Error('URL is required.');
      }
      const urlToProcess = options.url;

      // --- Setup yt-dlp ---
      sendProgress({ percent: 0, stage: 'Initializing download...' });
      const { default: youtubedl } = await import('youtube-dl-exec');
      const tempDir = ffmpegService.getTempDir(); // Use existing temp dir
      const outputTemplate = path.join(
        tempDir,
        `ytdl_${Date.now()}_%(title)s.%(ext)s`
      );

      // --- Download Video ---
      console.log(
        `[${operationId}] Starting download for URL: ${urlToProcess}`
      );
      sendProgress({ percent: 5, stage: 'Downloading video...' });

      // Use youtubedl exec, capturing progress
      const ytdlProcess = youtubedl.exec(urlToProcess, {
        output: outputTemplate,
        format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', // Prefer mp4
        // Add any other yt-dlp flags needed, e.g., cookies, proxies
        // cookies: '/path/to/cookies.txt', // Example - don't use without a real file
        progress: true,
        progressTemplate:
          'download-title:%(info.title)s %(progress._percent_str)s of %(progress._total_bytes_str)s at %(progress._speed_str)s ETA %(progress._eta_str)s',
        // --- Add merge output format flag --- START ---
        mergeOutputFormat: 'mp4', // Explicitly ask for mp4 container
      });

      ytdlProcess.stdout.on('data', data => {
        const output = data.toString();
        console.log(`[${operationId}] yt-dlp stdout:`, output.trim());

        // --- Try to capture the MERGED path first --- START ---
        const mergerMatch = output.match(
          /\[Merger\] Merging formats into "(.*)"/
        );
        if (mergerMatch && mergerMatch[1]) {
          finalVideoPathFromLog = mergerMatch[1].trim();
          console.log(
            `[${operationId}] CAPTURED MERGED PATH: ${finalVideoPathFromLog}`
          );
        }
        // --- Try to capture the MERGED path first --- END ---

        // Extract progress and update renderer
        const progressMatch = output.match(
          /\[download\]\s+(\d+\.\d+)% of.*? ETA (\S+)/
        );

        // Only use destination path if merge path wasn't found
        const destinationMatch = output.match(/\[download\] Destination: (.*)/);
        if (destinationMatch && destinationMatch[1]) {
          if (!finalVideoPathFromLog) {
            finalVideoPathFromLog = destinationMatch[1].trim();
            console.log(
              `[${operationId}] CAPTURED DESTINATION PATH (fallback): ${finalVideoPathFromLog}`
            );
          }
        }

        if (progressMatch) {
          const percent = parseFloat(progressMatch[1]);
          let stage = 'Downloading...';
          if (progressMatch[2]) stage += ` (${progressMatch[2]})`;
          if (progressMatch[3]) stage += ` ETA ${progressMatch[3]}`;

          // Show download progress within 0-100% range
          sendProgress({ percent, stage });
        }
      });

      ytdlProcess.stderr.on('data', data => {
        console.error(
          `[${operationId}] yt-dlp stderr: ${data.toString().trim()}`
        );
        // Potentially update progress stage on specific errors
      });

      // Wait for download completion
      await ytdlProcess;
      console.log(`[${operationId}] yt-dlp process finished.`);
      sendProgress({ percent: 100, stage: 'Download complete.' });

      // --- Add Robustness Check --- START ---
      if (!finalVideoPathFromLog) {
        throw new Error(
          'Could not determine the downloaded video file path from yt-dlp output.'
        );
      }

      // Verify the final file exists after the process completes
      try {
        await fs.promises.access(finalVideoPathFromLog, fs.constants.R_OK);
        console.log(
          `[${operationId}] Verified final file exists: ${finalVideoPathFromLog}`
        );
      } catch (accessError) {
        console.error(
          `[${operationId}] ERROR: Final video file not accessible after download: ${finalVideoPathFromLog}`,
          accessError
        );
        throw new Error(
          `Downloaded video file is missing or inaccessible: ${path.basename(finalVideoPathFromLog)}`
        );
      }
      // --- Add Robustness Check --- END ---

      console.log(
        `[${operationId}] Using final captured video file: ${finalVideoPathFromLog}`
      );

      // Get file size
      const stats = await fs.promises.stat(finalVideoPathFromLog);
      const fileSize = stats.size;

      // Create a file:// URL that the renderer can use directly
      const fileUrl = `file://${finalVideoPathFromLog.replace(/ /g, '%20')}`;
      console.log(`[${operationId}] Created file URL: ${fileUrl}`);

      // Return success with downloaded file info
      return {
        success: true,
        videoPath: finalVideoPathFromLog,
        filename: path.basename(finalVideoPathFromLog),
        size: fileSize,
        fileUrl: fileUrl, // Direct file URL for the renderer
        operationId,
      };
    } catch (error) {
      console.error(`[${operationId}] Error handling process-url:`, error);
      sendProgress({
        percent: 100,
        stage: `Error: ${error.message || 'Unknown processing error'}`,
        error: error.message || String(error),
      });
      return {
        success: false,
        error: error.message || String(error),
        operationId,
      };
    }
  });
  console.info('Registered process-url handler.');

  // --- Add Handler for Copying Files --- START ---
  ipcMain.handle('copy-file', async (_event, sourcePath, destinationPath) => {
    if (!sourcePath || !destinationPath) {
      return {
        error: 'Source or destination path missing for copy operation.',
      };
    }
    try {
      await fs.promises.copyFile(sourcePath, destinationPath);
      console.log(`File copied from ${sourcePath} to ${destinationPath}`);
      return { success: true };
    } catch (err) {
      console.error(
        `Error copying file from ${sourcePath} to ${destinationPath}:`,
        err
      );
      return { error: err.message || 'Failed to copy file.' };
    }
  });
  // --- Add Handler for Copying Files --- END ---

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
