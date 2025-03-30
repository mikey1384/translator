// SUBTITLE-HANDLERS.JS
// Import required modules
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Load service dependencies
let ffmpegService;
let fileManagerService;
let subtitleProcessing;

try {
  // Import the required services and functions
  subtitleProcessing = require('../dist/services/subtitle-processing');
  const { FFmpegService } = require('../dist/services/ffmpeg-service');
  const { FileManager } = require('../dist/services/file-manager');

  // Initialize services
  ffmpegService = new FFmpegService();
  fileManagerService = new FileManager();

  console.log('Subtitle processing services initialized successfully');
} catch (err) {
  console.warn('Subtitle processing service not loaded:', err.message);
}

// Register generate-subtitles handler
let generateHandlerExists = false;
try {
  ipcMain.handle('generate-subtitles', () => {});
  ipcMain.removeHandler('generate-subtitles');
} catch (err) {
  generateHandlerExists = true;
}

if (!generateHandlerExists) {
  ipcMain.handle('generate-subtitles', async (event, options) => {
    try {
      // If required services aren't available, return an error
      if (!ffmpegService || !fileManagerService || !subtitleProcessing) {
        console.error('Required services are not available');
        return {
          subtitles: '',
          error: 'Required services are not available',
        };
      }

      console.log(
        'Generate subtitles received options:',
        JSON.stringify(options, null, 2)
      );

      // Handle videoFile from browser context (packaged app)
      if (options.videoFileName && options.videoFileData) {
        console.log('Processing video file data from browser context');

        try {
          // Create a temporary file path
          const tempDir = fileManagerService.tempDir;
          const safeFileName = options.videoFileName.replace(
            /[^a-zA-Z0-9_.-]/g,
            '_'
          );
          const tempFilePath = path.join(
            tempDir,
            `temp_${Date.now()}_${safeFileName}`
          );

          console.log(`Created temporary path: ${tempFilePath}`);

          // Write the file data to the temporary path
          const buffer = Buffer.from(options.videoFileData);
          await fs.promises.writeFile(tempFilePath, buffer);

          console.log(`Wrote ${buffer.length} bytes to ${tempFilePath}`);

          // Set the videoPath to the temporary path
          options.videoPath = tempFilePath;

          // Remove the data from options to save memory
          delete options.videoFileData;

          // We'll continue processing with this path
          console.log(
            `Using temporary path for video processing: ${options.videoPath}`
          );
        } catch (error) {
          console.error('Error saving temporary file:', error);
          return {
            subtitles: '',
            error: 'Failed to save temporary video file: ' + error.message,
          };
        }
      }

      // Simple validation: ensure videoPath exists and is accessible
      if (!options.videoPath) {
        console.error(
          'No videoPath provided in options:',
          JSON.stringify(options)
        );

        // Check if there are other properties that might contain the path
        if (options.filePath) {
          console.log('Using filePath instead of videoPath');
          options.videoPath = options.filePath;
        } else if (options.filePaths && options.filePaths.length > 0) {
          console.log('Using filePaths[0] instead of videoPath');
          options.videoPath = options.filePaths[0];
        } else {
          return {
            subtitles: '',
            error: 'Video path is required and was not provided in any field',
          };
        }
      }

      // Log path details to help with debugging
      console.log(`Video path: ${options.videoPath}`);
      console.log(
        `Path as Buffer: ${Buffer.from(options.videoPath).toString('hex')}`
      );

      // Normalize the path - important for paths with international characters
      options.videoPath = path.normalize(options.videoPath);
      console.log(`Normalized path: ${options.videoPath}`);

      // Verify file exists and is readable using fs.promises for better error handling
      try {
        await fs.promises.access(options.videoPath, fs.constants.R_OK);
        console.log(
          `Verified file exists and is readable: ${options.videoPath}`
        );
      } catch (err) {
        console.error(`Cannot access video file at ${options.videoPath}:`, err);

        // Try an alternative approach with Buffer for paths with international characters
        try {
          // Create a temporary copy with a simpler path if needed
          const tempDir = fileManagerService.tempDir;
          const tempFileName = `temp_video_${Date.now()}${path.extname(
            options.videoPath
          )}`;
          const tempFilePath = path.join(tempDir, tempFileName);

          console.log(`Creating temporary copy at: ${tempFilePath}`);

          // Copy the file to a temp location without international characters
          await fs.promises.copyFile(options.videoPath, tempFilePath);
          console.log(`Successfully copied to: ${tempFilePath}`);

          // Use the temporary path instead
          options.videoPath = tempFilePath;
        } catch (copyErr) {
          console.error(`Failed to create temporary copy:`, copyErr);
          return {
            subtitles: '',
            error: `Cannot access video file. The path may contain unsupported characters: ${err.message}`,
          };
        }
      }

      console.log(`Processing video file at: ${options.videoPath}`);

      // Process the job using the function directly
      const result = await subtitleProcessing.generateSubtitlesFromVideo(
        options,
        progress => {
          // Create a safe copy of the progress object with default values
          const safeProgress = {
            percent: progress.percent || 0,
            stage: progress.stage || 'Processing',
            current: progress.current || 0,
            total: progress.total || 0,
            partialResult: progress.partialResult || '',
          };

          // Send the progress update to the renderer process with guaranteed properties
          console.log('Progress Update:', safeProgress.partialResult);
          event.sender.send('generate-subtitles-progress', safeProgress);
        },
        { ffmpegService, fileManager: fileManagerService }
      );

      return result;
    } catch (error) {
      console.error('Error in generate-subtitles handler:', error);
      return {
        subtitles: '',
        error: `Generate subtitles error: ${error.message || String(error)}`,
      };
    }
  });

  console.log('Generate subtitles handler registered');
}

// Register merge-subtitles handler
let mergeHandlerExists = false;
try {
  ipcMain.handle('merge-subtitles', () => {});
  ipcMain.removeHandler('merge-subtitles');
} catch (err) {
  mergeHandlerExists = true;
}

if (!mergeHandlerExists) {
  ipcMain.handle('merge-subtitles', async (event, options) => {
    // Generate ID immediately
    const operationId = `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    console.log(`[${operationId}] Received merge request.`);

    // --- Run the actual merge asynchronously ---
    // Use an IIFE (Immediately Invoked Function Expression) to run async code without blocking the handler return
    (async () => {
      let tempVideoPath = null;
      let tempSrtPath = null;
      try {
        // If required services aren't available, send error progress
        if (!ffmpegService || !fileManagerService || !subtitleProcessing) {
          throw new Error('Required services are not available for merge');
        }

        console.log(
          `[${operationId}] Starting async merge processing with options:`,
          JSON.stringify(options, null, 2)
        );

        // --- Copy logic for handling temp files from original try block ---
        // Handle video file data if sent from renderer
        if (options.videoFileName && options.videoFileData) {
          console.log(
            `[${operationId}] Processing video file data for merge from browser context`
          );
          try {
            const tempDir = fileManagerService.tempDir;
            const safeFileName = options.videoFileName.replace(
              /[^a-zA-Z0-9_.-]/g,
              '_'
            );
            tempVideoPath = path.join(
              tempDir,
              `temp_merge_${Date.now()}_${safeFileName}`
            );
            console.log(
              `[${operationId}] Creating temporary video file for merge at: ${tempVideoPath}`
            );
            const buffer = Buffer.from(options.videoFileData);
            await fs.promises.writeFile(tempVideoPath, buffer);
            console.log(
              `[${operationId}] Wrote ${buffer.length} bytes to temporary merge video file ${tempVideoPath}`
            );
            options.videoPath = tempVideoPath; // Use the temp path
            delete options.videoFileData; // Clean up data
          } catch (error) {
            console.error(
              `[${operationId}] Error saving temporary video file for merge:`,
              error
            );
            throw new Error(
              'Failed to save temporary video file for merge: ' + error.message
            );
          }
        }

        // Handle SRT content if sent from renderer
        if (options.srtContent) {
          console.log(
            `[${operationId}] Processing SRT content for merge from browser context`
          );
          try {
            const tempDir = fileManagerService.tempDir;
            tempSrtPath = path.join(tempDir, `temp_merge_${Date.now()}.srt`);
            console.log(
              `[${operationId}] Creating temporary SRT file for merge at: ${tempSrtPath}`
            );
            await fs.promises.writeFile(
              tempSrtPath,
              options.srtContent,
              'utf8'
            );
            console.log(
              `[${operationId}] Wrote SRT content to temporary file ${tempSrtPath}`
            );
            options.subtitlesPath = tempSrtPath; // Use the temp path
            delete options.srtContent; // Clean up data
          } catch (error) {
            console.error(
              `[${operationId}] Error saving temporary SRT file for merge:`,
              error
            );
            throw new Error(
              'Failed to save temporary SRT file for merge: ' + error.message
            );
          }
        } else if (!options.subtitlesPath) {
          throw new Error('Subtitles path or content is required for merging');
        }

        if (!options.videoPath) {
          throw new Error('Video path is required for merging');
        }

        options.videoPath = path.normalize(options.videoPath);
        options.subtitlesPath = path.normalize(options.subtitlesPath);

        try {
          await fs.promises.access(options.videoPath, fs.constants.R_OK);
          await fs.promises.access(options.subtitlesPath, fs.constants.R_OK);
          console.log(`[${operationId}] Verified final file access for merge.`);
        } catch (err) {
          console.error(
            `[${operationId}] Cannot access final files for merge:`,
            err
          );
          throw new Error(
            `Cannot access video or subtitle file for merging: ${err.message}`
          );
        }
        // --- End copy ---

        // Call the actual merge process
        const result = await subtitleProcessing.mergeSubtitlesWithVideo(
          options,
          operationId,
          progress => {
            // Send progress updates during the async operation
            event.sender.send('merge-subtitles-progress', {
              ...progress,
              operationId,
            });
          },
          { ffmpegService }
        );

        // Send final success status
        console.log(`[${operationId}] Async merge completed successfully.`);
        event.sender.send('merge-subtitles-progress', {
          percent: 100,
          stage: 'Merge complete!',
          outputPath: result.outputPath, // Include final path
          operationId,
        });
      } catch (error) {
        // Send final error status
        console.error(`[${operationId}] Error during async merge:`, error);
        event.sender.send('merge-subtitles-progress', {
          percent: 100, // Indicate completion, but with error
          stage: `Error: ${error.message || 'Unknown merge error'}`,
          error: error.message || 'Unknown merge error',
          operationId,
        });
      } finally {
        // Cleanup temporary files in the async flow
        console.log(`[${operationId}] Starting async cleanup.`);
        if (tempVideoPath) {
          try {
            await fs.promises.unlink(tempVideoPath);
            console.log(
              `[${operationId}] Successfully deleted temporary video file: ${tempVideoPath}`
            );
          } catch (cleanupError) {
            console.error(
              `[${operationId}] Failed to delete temporary merge video file ${tempVideoPath}:`,
              cleanupError
            );
          }
        }
        if (tempSrtPath) {
          try {
            await fs.promises.unlink(tempSrtPath);
            console.log(
              `[${operationId}] Successfully deleted temporary SRT file: ${tempSrtPath}`
            );
          } catch (cleanupError) {
            console.error(
              `[${operationId}] Failed to delete temporary merge SRT file ${tempSrtPath}:`,
              cleanupError
            );
          }
        }
      }
    })(); // Execute the async IIFE
    // --- End async execution ---

    // Return the operation ID immediately
    return { operationId };
  });

  // Handler to cancel a merge operation
  ipcMain.handle('cancel-merge', async (event, operationId) => {
    console.log(`[${operationId}] Received cancel request.`);
    if (!ffmpegService) {
      console.error(
        `[${operationId}] Cannot cancel: FFmpegService not available.`
      );
      return { success: false, error: 'FFmpegService not available' };
    }
    try {
      const success = ffmpegService.cancelOperation(operationId);
      return { success };
    } catch (error) {
      console.error(`[${operationId}] Error during cancellation:`, error);
      return {
        success: false,
        error: error.message || 'Unknown cancellation error',
      };
    }
  });

  console.log('Merge subtitles handler registered');
  console.log('Cancel merge handler registered');
}
