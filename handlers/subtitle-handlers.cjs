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
      { ffmpegService, fileManager } // Pass dependencies
    );

    return {
      success: true,
      subtitles: result.subtitles,
      operationId,
    };
  } catch (error) {
    console.error(`[${operationId}] Error generating subtitles:`, error);
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
    // Cleanup temporary video file if created
    if (tempVideoPath) {
      try {
        await fs.promises.unlink(tempVideoPath);
      } catch (cleanupError) {
        console.warn(
          `[${operationId}] Failed to cleanup temp video ${tempVideoPath}:`,
          cleanupError
        );
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

    // Import Translation Service (Dynamically)
    const { translateSrt } = require('../dist/services/translation-service');

    // Perform Translation
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
      }
    );

    return {
      success: true,
      translatedSubtitles: result.translatedSrt,
      operationId,
    };
  } catch (error) {
    console.error(`[${operationId}] Error translating subtitles:`, error);
    event.sender.send('translate-subtitles-progress', {
      percent: 100,
      stage: `Error: ${error.message || 'Unknown translation error'}`,
      error: error.message || 'Unknown translation error',
      operationId,
    });
    return {
      success: false,
      error: error.message || String(error),
      operationId,
    };
  }
}

async function handleCancelMerge(_event, operationId) {
  if (!operationId) {
    return { success: false, error: 'Operation ID is required to cancel.' };
  }
  try {
    // --- Add check for ffmpegService --- START ---
    if (!ffmpegService) {
      throw new Error('FFmpegService is not initialized in subtitle handlers.');
    }
    // --- Add check for ffmpegService --- END ---
    // Assuming ffmpegService is the one managing cancellable operations
    const cancelled = ffmpegService.cancelOperation(operationId);
    if (cancelled) {
      console.log(`[${operationId}] Cancellation request sent.`);
    } else {
      console.warn(`[${operationId}] No active operation found to cancel.`);
    }
    // Return success even if the operation wasn't found, as the goal is achieved (it's not running)
    const result = { success: true };
    console.log(`[${operationId}] Returning from handleCancelMerge:`, result);
    return result;
  } catch (error) {
    console.error(`[${operationId}] Error cancelling operation:`, error);
    const result = {
      success: false,
      error: error.message || 'Failed to cancel operation',
    };
    console.log(
      `[${operationId}] Returning from handleCancelMerge (error):`,
      result
    );
    return result;
  }
}

// --- Exports ---
module.exports = {
  initializeSubtitleHandlers,
  handleGenerateSubtitles,
  handleMergeSubtitles,
  handleTranslateSubtitles,
  handleCancelMerge,
};
