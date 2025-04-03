// SUBTITLE-HANDLERS.JS
// Import required modules
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const fsp = require('fs').promises; // Use fs.promises

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

// Helper function to send progress updates safely
function sendProgress(event, operationId, progressData) {
  try {
    const safeProgress = {
      operationId: operationId || progressData.operationId,
      percent: progressData.percent || 0,
      stage: progressData.stage || 'Processing...',
      current: progressData.current || 0,
      total: progressData.total || 0,
      partialResult: progressData.partialResult || '',
      error: progressData.error || null,
    };
    event.sender.send('generate-subtitles-progress', safeProgress);
  } catch (e) {
    console.error(`[${operationId}] Error sending progress update:`, e);
  }
}

if (!generateHandlerExists) {
  ipcMain.handle('generate-subtitles', async (event, options) => {
    const operationId = `generate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    let fullAudioPath = null;
    let tempVideoPath = null; // For handling file data from renderer

    try {
      if (!ffmpegService || !fileManagerService || !subtitleProcessing) {
        throw new Error('Required services are not available');
      }

      sendProgress(event, operationId, {
        percent: 0,
        stage: 'Initializing...',
      });
      console.log(
        `[${operationId}] Generate subtitles received options:`,
        JSON.stringify(options, null, 2)
      );

      // --- Handle video file data if sent from renderer --- START ---
      if (options.videoFileName && options.videoFileData) {
        console.log(
          `[${operationId}] Processing video file data from browser context`
        );
        try {
          const tempDir = fileManagerService.tempDir;
          const safeFileName = options.videoFileName.replace(
            /[^a-zA-Z0-9_.-]/g,
            '_'
          );
          tempVideoPath = path.join(
            tempDir,
            `temp_${Date.now()}_${safeFileName}`
          );
          console.log(
            `[${operationId}] Created temporary path: ${tempVideoPath}`
          );
          const buffer = Buffer.from(options.videoFileData);
          await fsp.writeFile(tempVideoPath, buffer);
          console.log(
            `[${operationId}] Wrote ${buffer.length} bytes to ${tempVideoPath}`
          );
          options.videoPath = tempVideoPath; // Use this temp path
          delete options.videoFileData;
        } catch (error) {
          console.error(`[${operationId}] Error saving temporary file:`, error);
          throw new Error(
            `Failed to save temporary video file: ${error.message}`
          );
        }
      }
      // --- Handle video file data if sent from renderer --- END ---

      // --- Validate and Normalize Video Path --- START ---
      if (!options.videoPath) {
        console.error(`[${operationId}] No videoPath provided.`);
        // Attempt to find path in other fields (optional, adapt as needed)
        if (options.filePath) options.videoPath = options.filePath;
        else if (options.filePaths && options.filePaths.length > 0)
          options.videoPath = options.filePaths[0];
        else throw new Error('Video path is required.');
      }
      options.videoPath = path.normalize(options.videoPath);
      console.log(
        `[${operationId}] Normalized video path: ${options.videoPath}`
      );

      try {
        await fsp.access(options.videoPath, fs.constants.R_OK);
        console.log(
          `[${operationId}] Verified file exists and is readable: ${options.videoPath}`
        );
      } catch (err) {
        // Consider if temp copy logic is still needed or if FFmpeg handles paths better now
        console.error(
          `[${operationId}] Cannot access video file at ${options.videoPath}:`,
          err
        );
        throw new Error(
          `Cannot access video file: ${err.message}. Check path and permissions.`
        );
        // If needed, re-add logic to copy to a temp file with simpler name here
      }
      // --- Validate and Normalize Video Path --- END ---

      console.log(
        `[${operationId}] Processing video file at: ${options.videoPath}`
      );

      // === Simplified Workflow Using Internal Chunking ===

      // 1. Extract Full Audio
      sendProgress(event, operationId, {
        percent: 5,
        stage: 'Extracting audio...',
      });
      console.log(
        `[${operationId}] Extracting audio from ${options.videoPath}`
      );
      fullAudioPath = await ffmpegService.extractAudio(options.videoPath);
      console.log(`[${operationId}] Extracted full audio to: ${fullAudioPath}`);
      // Don't send 10% progress here, let generateSubtitlesFromAudio handle it

      // 2. Call the service function that handles internal chunking and transcription
      sendProgress(event, operationId, {
        percent: 10,
        stage: 'Starting transcription...',
      });
      console.log(
        `[${operationId}] Calling generateSubtitlesFromAudio for: ${fullAudioPath}`
      );

      // Define the progress callback to forward updates
      const internalProgressCallback = progress => {
        // Log the raw progress object received from the service
        console.log(
          `[${operationId}] RAW Internal Progress Received:`,
          JSON.stringify(progress, null, 2)
        );

        // Assuming generateSubtitlesFromAudio reports progress from 0-100
        // We scale it here to fit within the 10%-95% range of the overall process
        const overallPercent = 10 + (progress.percent / 100) * 85;
        sendProgress(event, operationId, {
          percent: overallPercent,
          stage: progress.stage || 'Transcribing...',
          current: progress.current,
          total: progress.total,
          partialResult: progress.partialResult,
          error: progress.error,
        });
      };

      // Call the function from subtitle-processing which handles chunking internally
      // We need to ensure this function exists and accepts these parameters.
      // Assuming it returns the final SRT string.
      if (typeof subtitleProcessing.generateSubtitlesFromAudio !== 'function') {
        throw new Error(
          'subtitleProcessing.generateSubtitlesFromAudio is not available or not a function.'
        );
      }

      const finalSrt = await subtitleProcessing.generateSubtitlesFromAudio({
        inputAudioPath: fullAudioPath,
        targetLanguage: options.targetLanguage, // Pass target language if provided
        progressCallback: internalProgressCallback,
        // We don't need to pass progressRange here, the callback handles scaling
      });

      console.log(
        `[${operationId}] Received final SRT from subtitleProcessing service.`
      );
      sendProgress(event, operationId, {
        percent: 98,
        stage: 'Transcription complete!',
      });

      // 3. Return final result
      return {
        subtitles: finalSrt,
        error: null,
      };
    } catch (error) {
      console.error(
        `[${operationId}] Error in generate-subtitles handler:`,
        error
      );
      // Ensure error is sent via progress update
      sendProgress(event, operationId, {
        percent: 100,
        stage: 'Error',
        error: error.message || String(error),
      });
      return {
        subtitles: '',
        error: `Generate subtitles error: ${error.message || String(error)}`,
      };
    } finally {
      // 4. Cleanup (Only full audio and temp video if created)
      console.log(`[${operationId}] Starting cleanup...`);
      const cleanupPromises = [];

      if (fullAudioPath && fs.existsSync(fullAudioPath)) {
        console.log(
          `[${operationId}] Deleting full audio file: ${fullAudioPath}`
        );
        cleanupPromises.push(
          fsp
            .unlink(fullAudioPath)
            .catch(err =>
              console.error(
                `[${operationId}] Failed to delete full audio:`,
                err
              )
            )
        );
      } else {
        console.log(
          `[${operationId}] Full audio path not found or already deleted: ${fullAudioPath}`
        );
      }

      // Remove chunk dir cleanup - no longer created here

      if (tempVideoPath && fs.existsSync(tempVideoPath)) {
        console.log(
          `[${operationId}] Deleting temporary video file: ${tempVideoPath}`
        );
        cleanupPromises.push(
          fsp
            .unlink(tempVideoPath)
            .catch(err =>
              console.error(
                `[${operationId}] Failed to delete temp video:`,
                err
              )
            )
        );
      } else {
        console.log(
          `[${operationId}] Temp video path not found or already deleted: ${tempVideoPath}`
        );
      }

      await Promise.allSettled(cleanupPromises);
      console.log(`[${operationId}] Cleanup finished.`);
    }
  });

  console.log(
    'Generate subtitles handler registered (using internal chunking)'
  );
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
            await fsp.writeFile(tempVideoPath, buffer);
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
            await fsp.writeFile(tempSrtPath, options.srtContent, 'utf8');
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
          await fsp.access(options.videoPath, fs.constants.R_OK);
          await fsp.access(options.subtitlesPath, fs.constants.R_OK);
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

        // Send final success status with the outputPath
        console.log(
          `[${operationId}] Async merge completed successfully. Output path: ${result.outputPath}`
        );
        event.sender.send('merge-subtitles-progress', {
          percent: 100,
          stage: 'Merge complete!',
          outputPath: result.outputPath,
          operationId,
        });

        // Move the file to the final destination if outputPath is different from the target path
        if (
          result.outputPath &&
          options.outputPath &&
          result.outputPath !== options.outputPath
        ) {
          try {
            console.log(
              `[${operationId}] Moving file from ${result.outputPath} to ${options.outputPath}`
            );
            await fsp.rename(result.outputPath, options.outputPath);
            console.log(
              `[${operationId}] Successfully moved file to final destination`
            );
            // Update the result's outputPath to reflect the final location
            result.outputPath = options.outputPath;
          } catch (moveError) {
            console.error(
              `[${operationId}] Error moving file to final destination:`,
              moveError
            );
            throw new Error(
              `Failed to move file to final destination: ${moveError.message}`
            );
          }
        }
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
            await fsp.unlink(tempVideoPath);
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
            await fsp.unlink(tempSrtPath);
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
