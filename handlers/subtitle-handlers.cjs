const path = require('path');
const fs = require('fs');
const keytar = require('keytar');

// Services will be injected by the initializer
let ffmpegService;
let fileManager;

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
  console.info('[subtitle-handlers] Initialized.');
}

// --- Handler Implementations ---

async function handleGenerateSubtitles(event, options) {
  const operationId = `generate-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 9)}`;

  // Simple cancellation setup - just create a controller
  const controller = new AbortController();

  // Track operations for cancellation
  if (!global.activeOperations) global.activeOperations = new Map();
  global.activeOperations.set(operationId, controller);

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
    if (global.activeOperations) {
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
  // Log the incoming options to see if operationId is already provided
  console.log(`[handleMergeSubtitles] Received options:`, {
    hasVideoPath: !!options.videoPath,
    hasVideoFileData: !!options.videoFileData,
    hasOperationId: !!options.operationId,
    originalOperationId: options.operationId,
  });

  // Generate a new operationId if not provided
  const operationId =
    options.operationId ||
    `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  console.log(`[handleMergeSubtitles] Using operationId: ${operationId}`);

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

    // --- Prepare Merge Options --- START ---
    const mergeOptions = {
      videoPath: finalOptions.videoPath,
      subtitlesPath: tempSrtPath, // <-- USE THE TEMP SRT PATH HERE
      outputPath: finalOptions.outputPath, // Make sure renderer provides this
      fontSize: finalOptions.fontSize, // Pass original options if needed by service
      stylePreset: finalOptions.stylePreset, // Pass original options if needed by service
      operationId,
      onProgress: progress => {
        try {
          event.sender.send('merge-subtitles-progress', {
            operationId,
            ...progress,
          });
        } catch (e) {
          console.warn(
            `[${operationId}] Error sending progress update:`,
            e.message
          );
        }
      },
      // Use a wrapper for registerProcess to ensure it's only called once
      // and store the process locally if needed, though ffmpegService handles cancellation now
      registerProcess: process => {
        console.log(
          `[${operationId}] Merge process registered by service (PID: ${process?.pid || 'N/A'}).`
        );
        // No need to store here if ffmpegService handles cancellation via operationId
      },
    };
    // --- Prepare Merge Options --- END ---

    // --- Logging ---
    console.log(
      `[${operationId}] >>> Preparing to call mergeSubtitlesWithVideo <<<`
    );
    console.log(`[${operationId}] Video Path: ${mergeOptions.videoPath}`);
    console.log(
      `[${operationId}] Subtitles Path: ${mergeOptions.subtitlesPath}`
    ); // Should now be a path
    console.log(`[${operationId}] Output Path: ${mergeOptions.outputPath}`);
    console.log(`[${operationId}] Font Size: ${mergeOptions.fontSize}`);
    console.log(`[${operationId}] Style Preset: ${mergeOptions.stylePreset}`);
    console.log(`[${operationId}] Operation ID: ${mergeOptions.operationId}`);
    console.log(
      `[${operationId}] Has onProgress function: ${typeof mergeOptions.onProgress === 'function'}`
    );
    console.log(
      `[${operationId}] Has registerProcess function: ${typeof mergeOptions.registerProcess === 'function'}`
    );
    // --- End logging ---

    // --- CHECK DEPENDENCIES BEFORE CALL --- START ---
    console.log(`[${operationId}] Checking dependencies before call:`);
    console.log(
      `[${operationId}]   typeof ffmpegService: ${typeof ffmpegService}`
    );
    console.log(`[${operationId}]   typeof fileManager: ${typeof fileManager}`);
    console.log(`[${operationId}]   ffmpegService defined: ${!!ffmpegService}`);
    console.log(`[${operationId}]   fileManager defined: ${!!fileManager}`);
    // --- CHECK DEPENDENCIES BEFORE CALL --- END ---

    // --- Execute Merge --- START ---
    // Pass dependencies if needed by the service
    const mergeResult = await mergeSubtitlesWithVideo(
      mergeOptions, // 1st arg: options object
      operationId, // 2nd arg: operationId string
      mergeOptions.onProgress, // 3rd arg: progress callback from options
      { ffmpegService } // 4th arg: services object (only ffmpegService needed)
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
    // Cleanup temporary video input file if created
    if (tempVideoPath) {
      try {
        await fs.promises.unlink(tempVideoPath);
        console.log(
          `[${operationId}] Cleaned up temporary video input: ${tempVideoPath}`
        );
      } catch (cleanupError) {
        console.warn(
          `[${operationId}] Failed to cleanup temp merge input video ${tempVideoPath}:`,
          cleanupError.message
        );
      }
    }
    // Cleanup temporary SRT file if created
    if (tempSrtPath) {
      try {
        await fs.promises.unlink(tempSrtPath);
        console.log(
          `[${operationId}] Cleaned up temporary SRT file: ${tempSrtPath}`
        );
      } catch (cleanupError) {
        console.warn(
          `[${operationId}] Failed to cleanup temp SRT file ${tempSrtPath}:`,
          cleanupError.message
        );
      }
    }
    // NOTE: The final output file is NOT cleaned up here; it's returned to the renderer.
  }
}

async function handleTranslateSubtitles(event, options) {
  const operationId = `translate-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 9)}`;

  // Simple cancellation setup - just create a controller
  const controller = new AbortController();

  // Track operations for cancellation
  if (!global.activeOperations) global.activeOperations = new Map();
  global.activeOperations.set(operationId, controller);

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
    if (global.activeOperations) {
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

    // First check if it's a merge operation (FFmpeg)
    if (operationId.startsWith('merge-')) {
      if (!ffmpegService) {
        throw new Error('FFmpegService is not initialized.');
      }
      console.log(
        `[Handlers] Forwarding cancellation to FFmpegService for ${operationId}`
      );
      cancelled = ffmpegService.cancelOperation(operationId);
    }
    // Handle generate or translate operations with our global map
    else if (
      operationId.startsWith('generate-') ||
      operationId.startsWith('translate-')
    ) {
      if (!global.activeOperations) {
        console.warn(`[Handlers] No active operations map found`);
        return {
          success: false,
          error: 'No active operations manager available',
        };
      }

      const controller = global.activeOperations.get(operationId);
      if (controller) {
        console.log(`[Handlers] Aborting operation ${operationId}`);
        controller.abort();
        global.activeOperations.delete(operationId);
        cancelled = true;
      } else {
        console.warn(
          `[Handlers] No active operation found with ID: ${operationId}`
        );
        cancelled = false;
      }
    }
    // Unknown operation type
    else {
      console.warn(
        `[Handlers] Unknown operation ID prefix for cancellation: ${operationId}`
      );
      return {
        success: false,
        error: 'Unknown operation type for cancellation',
      };
    }

    if (cancelled) {
      console.log(
        `[Handlers] Cancellation request processed successfully for ${operationId}.`
      );
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
