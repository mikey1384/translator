const path = require('path');
const fs = require('fs');
const keytar = require('keytar');

// Services will be injected by the initializer
let ffmpegService;
let fileManager;
let cancellationService;

// Define the service name used for storing credentials (for translation)
const API_KEY_SERVICE_NAME = 'TranslatorApp';

// --- Initialization ---
function initializeSubtitleHandlers(services) {
  if (!services || !services.ffmpegService || !services.fileManager) {
    throw new Error(
      '[subtitle-handlers] Required services (ffmpegService, fileManager) not provided.'
    );
  }
  ffmpegService = services.ffmpegService;
  fileManager = services.fileManager;

  // Get cancellationService from the FFmpeg module - this ensures we use the same instance
  try {
    cancellationService =
      require('../dist/services/cancellation-service').cancellationService;
    console.info('[subtitle-handlers] Initialized with cancellationService.');
  } catch (error) {
    console.warn(
      '[subtitle-handlers] Failed to load cancellationService:',
      error
    );
  }

  console.info('[subtitle-handlers] Initialized.');
}

// --- Handler Implementations ---

async function handleGenerateSubtitles(event, options) {
  const operationId = `generate-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 9)}`;

  // Simple cancellation setup - just create a controller
  const controller = new AbortController();

  // Register with cancellation service
  if (cancellationService) {
    cancellationService.registerOperation(operationId, controller);
  } else {
    // Fallback to global map if service not available
    if (!global.activeOperations) global.activeOperations = new Map();
    global.activeOperations.set(operationId, controller);
  }

  let tempVideoPath = null;
  let finalOptions = { ...options }; // Clone options to avoid mutation

  try {
    // Dynamically import the required service function
    const {
      generateSubtitlesFromVideo,
    } = require('../dist/services/subtitle-processing');

    // Handle Temporary Video if data is provided instead of path
    if (options.videoFileData && options.videoFileName) {
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
      delete finalOptions.videoFileData; // Clean up IPC data
    }

    // Validation
    if (!finalOptions.videoPath) {
      throw new Error('Video path is required for subtitle generation.');
    }
    finalOptions.videoPath = path.normalize(finalOptions.videoPath);
    await fs.promises.access(finalOptions.videoPath, fs.constants.R_OK);

    // Execute Generation
    const result = await generateSubtitlesFromVideo(
      finalOptions,
      progress => {
        event.sender.send('generate-subtitles-progress', {
          ...progress,
          operationId,
        });
      },
      { ffmpegService, fileManager }, // Pass dependencies
      controller.signal // Pass the abort signal
    );

    // Check for cancellation result (empty subtitles indicates cancellation)
    if (result.subtitles === '') {
      console.log(`[${operationId}] Generation was cancelled.`);
      return { success: true, cancelled: true, operationId };
    }

    return {
      success: true,
      subtitles: result.subtitles,
      operationId,
    };
  } catch (error) {
    console.error(`[${operationId}] Error generating subtitles:`, error);

    // Determine if this was a cancellation error
    const isCancellationError =
      error instanceof Error &&
      (error.name === 'AbortError' || error.message === 'Operation cancelled');

    event.sender.send('generate-subtitles-progress', {
      percent: 100,
      stage: isCancellationError
        ? 'Generation cancelled'
        : `Error: ${error.message || 'Unknown error'}`,
      error: isCancellationError ? null : error.message || String(error),
      cancelled: isCancellationError,
      operationId,
    });

    return {
      success: !isCancellationError, // Success is false only if it's a real error
      cancelled: isCancellationError,
      error: isCancellationError ? null : error.message || String(error),
      operationId,
    };
  } finally {
    // Clean up operation tracking
    if (cancellationService) {
      cancellationService.unregisterOperation(operationId);
    } else if (global.activeOperations) {
      global.activeOperations.delete(operationId);
    }

    // Clean up temporary file if created
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      try {
        await fs.promises.unlink(tempVideoPath);
      } catch (err) {
        console.warn(`Failed to delete temp video file: ${tempVideoPath}`);
      }
    }
  }
}

async function handleMergeSubtitles(event, options) {
  // Generate a new operationId if not provided
  const operationId =
    options.operationId ||
    `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  console.log(`[handleMergeSubtitles] Using operationId: ${operationId}`);

  // Simple cancellation setup - create a controller for all operations
  const controller = new AbortController();

  // Register with cancellation service
  if (cancellationService) {
    cancellationService.registerOperation(operationId, controller);
  } else {
    // Fallback to global map if service not available
    if (!global.activeOperations) global.activeOperations = new Map();
    global.activeOperations.set(operationId, controller);
  }

  let tempVideoPath = null;
  let tempSrtPath = null; // Variable for the temporary SRT path
  let finalOptions = { ...options, operationId }; // Ensure operationId is included

  try {
    // Dynamically import the required service function
    const {
      mergeSubtitlesWithVideo,
    } = require('../dist/services/subtitle-processing');

    // Handle Temporary Video if data is provided
    if (finalOptions.videoFileData && finalOptions.videoFileName) {
      const safeFileName = finalOptions.videoFileName.replace(
        /[^a-zA-Z0-9_.-]/g,
        '_'
      );
      tempVideoPath = path.join(
        ffmpegService.getTempDir(), // Use injected ffmpegService
        `temp_merge_video_${operationId}_${safeFileName}` // More specific temp name
      );
      const buffer = Buffer.from(finalOptions.videoFileData);
      await fs.promises.writeFile(tempVideoPath, buffer);
      finalOptions.videoPath = tempVideoPath;
      delete finalOptions.videoFileData;
      delete finalOptions.videoFileName; // Clean up IPC data
      console.log(
        `[${operationId}] Temporary video file written to: ${tempVideoPath}`
      );
    }

    // Validation (Video Path)
    if (!finalOptions.videoPath) {
      throw new Error('Video path is required for merge.');
    }
    finalOptions.videoPath = path.normalize(finalOptions.videoPath);
    await fs.promises.access(finalOptions.videoPath, fs.constants.R_OK);

    // Validation (SRT Content) & Write Temporary SRT File
    if (
      !finalOptions.srtContent ||
      typeof finalOptions.srtContent !== 'string'
    ) {
      throw new Error('SRT content (string) is required for merge.');
    }
    // Construct temp SRT path
    const tempSrtFilename = `temp_merge_subtitles_${operationId}.srt`;
    tempSrtPath = path.join(ffmpegService.getTempDir(), tempSrtFilename); // Use injected ffmpegService for temp dir
    // Write content to temp file
    await fs.promises.writeFile(tempSrtPath, finalOptions.srtContent, 'utf8');
    console.log(
      `[${operationId}] Temporary SRT file written to: ${tempSrtPath}`
    );

    // Check if operation was cancelled before proceeding to merge
    if (
      global.activeOperations &&
      global.activeOperations.get(operationId)?.signal?.aborted
    ) {
      console.log(`[${operationId}] Operation cancelled before merge started`);

      // Make sure to update UI with cancellation message
      event.sender.send('merge-subtitles-progress', {
        percent: 100,
        stage: 'Merge cancelled',
        cancelled: true,
        operationId,
      });

      return {
        success: true,
        cancelled: true,
        operationId,
      };
    }

    // --- Execute Merge --- START ---
    const mergeResult = await mergeSubtitlesWithVideo(
      {
        videoPath: finalOptions.videoPath,
        subtitlesPath: tempSrtPath,
        fontSize: finalOptions.fontSize,
        stylePreset: finalOptions.stylePreset,
      },
      operationId,
      progress => {
        event.sender.send('merge-subtitles-progress', {
          ...progress,
          operationId,
        });
      },
      { ffmpegService } // Pass injected dependencies
    );
    // --- Execute Merge --- END ---

    // Check if the merge was cancelled (empty outputPath indicates cancellation)
    if (!mergeResult.outputPath) {
      console.log(
        `[${operationId}] Merge was cancelled, sending success with cancelled status`
      );
      event.sender.send('merge-subtitles-progress', {
        percent: 100,
        stage: 'Merge cancelled',
        cancelled: true,
        operationId,
      });
      return {
        success: true,
        cancelled: true,
        operationId,
      };
    }

    // Check again for cancellation after merge but before returning result
    if (
      global.activeOperations &&
      global.activeOperations.get(operationId)?.signal?.aborted
    ) {
      console.log(`[${operationId}] Operation cancelled after merge completed`);
      // Clean up the merged file since we won't be using it
      if (mergeResult.outputPath && fs.existsSync(mergeResult.outputPath)) {
        try {
          await fs.promises.unlink(mergeResult.outputPath);
          console.log(
            `[${operationId}] Deleted merged file after cancellation: ${mergeResult.outputPath}`
          );
        } catch (err) {
          console.warn(
            `[${operationId}] Failed to delete merged file after cancellation: ${err}`
          );
        }
      }
      return {
        success: true,
        cancelled: true,
        operationId,
      };
    }

    console.log(
      `[${operationId}] Merge successful. Output path: ${mergeResult.outputPath}`
    );
    return {
      success: true,
      // Return the actual final output path from the result
      outputPath: mergeResult.outputPath,
      operationId,
    };
  } catch (error) {
    console.error(`[${operationId}] Error merging subtitles:`, error);

    // Determine if this was a cancellation
    const isCancellationError =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.message === 'Operation cancelled' ||
        error.message.includes('cancelled'));

    event.sender.send('merge-subtitles-progress', {
      percent: 100,
      stage: isCancellationError
        ? 'Merge cancelled'
        : `Error: ${error.message || 'Unknown merge error'}`,
      error: isCancellationError
        ? null
        : error.message || 'Unknown merge error',
      cancelled: isCancellationError,
      operationId,
    });

    return {
      success: !isCancellationError, // Success is true for cancellations
      cancelled: isCancellationError,
      error: isCancellationError ? null : error.message || String(error),
      operationId,
    };
  } finally {
    // Clean up operation tracking
    if (cancellationService) {
      cancellationService.unregisterOperation(operationId);
    } else if (global.activeOperations) {
      global.activeOperations.delete(operationId);
    }

    // Clean up temporary files
    for (const tempFile of [tempVideoPath, tempSrtPath]) {
      if (tempFile && fs.existsSync(tempFile)) {
        try {
          await fs.promises.unlink(tempFile);
          console.log(`[${operationId}] Cleaned up temp file: ${tempFile}`);
        } catch (cleanupError) {
          console.warn(
            `[${operationId}] Failed to cleanup temp file ${tempFile}:`,
            cleanupError
          );
        }
      }
    }
  }
}

async function handleTranslateSubtitles(event, options) {
  const operationId = `translate-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 9)}`;

  // Simple cancellation setup - just create a controller
  const controller = new AbortController();

  // Register with cancellation service
  if (cancellationService) {
    cancellationService.registerOperation(operationId, controller);
  } else {
    // Fallback to global map if service not available
    if (!global.activeOperations) global.activeOperations = new Map();
    global.activeOperations.set(operationId, controller);
  }

  try {
    // Validation
    if (!options.subtitles || typeof options.subtitles !== 'string') {
      throw new Error('Subtitle content (string) is required.');
    }
    if (!options.sourceLanguage || typeof options.sourceLanguage !== 'string') {
      throw new Error('Source language is required.');
    }
    if (!options.targetLanguage || typeof options.targetLanguage !== 'string') {
      throw new Error('Target language is required.');
    }

    // Load API Keys
    const openaiKey = await keytar.getPassword(API_KEY_SERVICE_NAME, 'openai');
    const anthropicKey = await keytar.getPassword(
      API_KEY_SERVICE_NAME,
      'anthropic'
    );

    if (!openaiKey || !anthropicKey) {
      throw new Error(
        'API keys for both OpenAI and Anthropic are required for translation.'
      );
    }

    // Perform Translation, passing ID and signal
    const result = await translateSrt(
      options.subtitles,
      options.sourceLanguage,
      options.targetLanguage,
      {
        openaiApiKey: openaiKey,
        anthropicApiKey: anthropicKey,
      },
      progress => {
        event.sender.send('translate-subtitles-progress', {
          ...progress,
          operationId,
        });
      },
      operationId, // Pass the operationId
      controller.signal // Pass the signal
    );

    // Check for cancellation result
    if (result.translatedSrt === '') {
      console.log(`[${operationId}] Translation was cancelled.`);
      return { success: true, cancelled: true, operationId };
    }

    return {
      success: true,
      translatedSubtitles: result.translatedSrt,
      operationId,
    };
  } catch (error) {
    console.error(`[${operationId}] Error translating subtitles:`, error);
    const isCancellationError =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.message === 'Translation cancelled');

    event.sender.send('translate-subtitles-progress', {
      percent: 100,
      stage: isCancellationError
        ? 'Translation cancelled'
        : `Error: ${error.message || 'Unknown translation error'}`,
      error: isCancellationError
        ? null
        : error.message || 'Unknown translation error',
      cancelled: isCancellationError,
      operationId,
    });

    return {
      success: !isCancellationError, // Success is false only if it's a real error
      cancelled: isCancellationError,
      error: isCancellationError ? null : error.message || String(error),
      operationId,
    };
  } finally {
    // Clean up operation tracking
    if (cancellationService) {
      cancellationService.unregisterOperation(operationId);
    } else if (global.activeOperations) {
      global.activeOperations.delete(operationId);
    }
  }
}

async function handleCancelOperation(_event, operationId) {
  if (!operationId) {
    return { success: false, error: 'Operation ID is required to cancel.' };
  }
  console.log(`[Handlers] Received cancellation request for ${operationId}`);

  try {
    let cancelled = false;

    // First try the cancellation service
    if (cancellationService) {
      console.log(`[Handlers] Using cancellationService for ${operationId}`);
      // Check if the operation exists before trying to cancel
      if (cancellationService.hasActiveOperation(operationId)) {
        cancelled = cancellationService.cancelOperation(operationId);
      } else {
        console.log(
          `[Handlers] No active operation found in cancellationService for ${operationId}`
        );
      }
    }
    // Fallback to global map
    else if (
      global.activeOperations &&
      global.activeOperations.has(operationId)
    ) {
      const controller = global.activeOperations.get(operationId);
      console.log(`[Handlers] Using global map for ${operationId}`);
      controller.abort();
      global.activeOperations.delete(operationId);
      cancelled = true;
    }
    // Also try the FFmpeg service directly as a last resort
    else if (operationId.startsWith('merge-') && ffmpegService) {
      console.log(
        `[Handlers] Falling back to FFmpegService for ${operationId}`
      );
      cancelled = ffmpegService.cancelOperation(operationId);
    }
    // If no operation found
    else {
      console.warn(
        `[Handlers] No active operation found with ID: ${operationId}`
      );
      cancelled = false;
    }

    if (cancelled) {
      console.log(
        `[Handlers] Cancellation request processed successfully for ${operationId}.`
      );

      // Update the UI for all operation types
      if (_event?.sender) {
        if (operationId.startsWith('merge-')) {
          _event.sender.send('merge-subtitles-progress', {
            percent: 100,
            stage: 'Merge cancelled',
            cancelled: true,
            operationId,
          });
        } else if (operationId.startsWith('generate-')) {
          _event.sender.send('generate-subtitles-progress', {
            percent: 100,
            stage: 'Generation cancelled',
            cancelled: true,
            operationId,
          });
        } else if (operationId.startsWith('translate-')) {
          _event.sender.send('translate-subtitles-progress', {
            percent: 100,
            stage: 'Translation cancelled',
            cancelled: true,
            operationId,
          });
        }
      }
    } else {
      console.warn(
        `[Handlers] No active operation found or cancellation failed for ${operationId}.`
      );
    }

    // Return success regardless, as the intent is to stop the operation
    return { success: true };
  } catch (error) {
    console.error(
      `[Handlers] Error during handleCancelOperation for ${operationId}:`,
      error
    );
    return {
      success: false,
      error: error.message || 'Failed to cancel operation',
    };
  }
}

// --- Exports ---
module.exports = {
  initializeSubtitleHandlers,
  handleGenerateSubtitles,
  handleMergeSubtitles,
  handleTranslateSubtitles,
  handleCancelOperation,
};
