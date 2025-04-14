import { ipcMain, BrowserWindow, app, dialog } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs/promises';
import { RenderSubtitlesOptions, SrtSegment } from '../types/interface.js';
import { parseSrt } from '../shared/helpers/index.js';
import { execFile, ChildProcess } from 'child_process';

// Re-define channels used in this handler file
const RENDER_CHANNELS = {
  REQUEST: 'render-subtitles-request',
  RESULT: 'render-subtitles-result',
};
const WINDOW_CHANNELS = {
  CREATE_REQUEST: 'create-render-window-request',
  CREATE_SUCCESS: 'create-render-window-success',
  DESTROY_REQUEST: 'destroy-render-window-request',
  UPDATE_SUBTITLE: 'render-window-update-subtitle',
};

// Map to store references to active hidden subtitle render windows
const renderWindows = new Map<number, BrowserWindow>();

/**
 * Initializes IPC handlers for the subtitle overlay rendering process.
 */
export function initializeRenderWindowHandlers(): void {
  log.info('[RenderWindowHandlers] Initializing...');

  // --- Main Orchestration Handler ---
  ipcMain.on(
    RENDER_CHANNELS.REQUEST,
    async (event, options: RenderSubtitlesOptions) => {
      const { operationId } = options;
      log.info(
        `[RenderWindowHandlers ${operationId}] Received ${RENDER_CHANNELS.REQUEST}. Orchestration starting.`
      );

      let windowId: number | null = null;
      let tempDirPath: string | null = null;

      try {
        // --- Create Temp Directory ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Creating temporary directory...`
        );
        tempDirPath = await createOperationTempDir(operationId);
        log.info(
          `[RenderWindowHandlers ${operationId}] Temporary directory created: ${tempDirPath}`
        );
        // --- End Temp Directory ---

        // --- Create Hidden Window ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Attempting to create hidden window...`
        );
        windowId = await createHiddenRenderWindow(options);
        log.info(
          `[RenderWindowHandlers ${operationId}] Hidden window created successfully with ID: ${windowId}.`
        );
        // --- End Hidden Window ---

        // --- Parse SRT ---
        let segments: SrtSegment[] = [];
        try {
          // We need a parseSrt function available here.
          // Let's assume it's imported or defined elsewhere in the main process.
          // If not, we'll need to add it (e.g., copy from shared/helpers).
          segments = parseSrt(options.srtContent); // Assuming parseSrtUtil is available
          log.info(
            `[RenderWindowHandlers ${operationId}] Parsed ${segments.length} SRT segments.`
          );
        } catch (parseError: any) {
          throw new Error(`Failed to parse SRT content: ${parseError.message}`);
        }
        // --- End Parse SRT ---

        // --- Frame-by-Frame Render Loop ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Starting frame render/capture loop for window ${windowId}.`
        );
        const totalFrames = Math.ceil(
          options.videoDuration * options.frameRate
        );
        const targetWindow = renderWindows.get(windowId); // Get the created window

        if (!targetWindow || targetWindow.isDestroyed()) {
          // Should not happen if window creation succeeded, but check anyway
          throw new Error(
            `Render window ${windowId} not found or destroyed before loop.`
          );
        }

        for (let i = 0; i < totalFrames; i++) {
          const frameCount = i + 1; // 1-based frame count
          const currentTime = i / options.frameRate; // Time at the start of the frame

          // Determine subtitle text for this frame
          const activeSegment = segments.find(
            seg => currentTime >= seg.start && currentTime < seg.end
          );
          const subtitleText = activeSegment ? activeSegment.text : '';

          // Define frame path (ensure 7 digits for FFmpeg later)
          const frameFileName = `frame_${String(frameCount).padStart(7, '0')}.png`;
          const framePath = path.join(tempDirPath, frameFileName);

          try {
            // 1. Send text update to hidden window
            // log.debug(`[RenderWindowHandlers ${operationId}] Sending text to window ${windowId}: "${subtitleText.substring(0,20)}..."`); // Optional
            targetWindow.webContents.send(WINDOW_CHANNELS.UPDATE_SUBTITLE, {
              text: subtitleText,
            });

            // 2. Wait briefly for rendering (adjust delay if needed)
            await new Promise(resolve => setTimeout(resolve, 10)); // ~1 frame at 60fps, maybe needs adjustment

            // 3. Invoke the capture handler for this window
            const captureResult = await captureFrameAndSave({
              windowId: windowId,
              framePath: framePath,
              operationId: operationId,
            });

            if (!captureResult.success) {
              // Capture handler already logged the error, just throw to stop the process
              throw new Error(
                captureResult.error || `Frame ${frameCount} capture failed.`
              );
            }

            // Log progress periodically
            if (
              frameCount % (options.frameRate * 10) === 0 ||
              frameCount === totalFrames
            ) {
              // Log every 10s or on last frame
              log.info(
                `[RenderWindowHandlers ${operationId}] Captured frame ${frameCount}/${totalFrames} (${Math.round((frameCount / totalFrames) * 100)}%)`
              );
            }
          } catch (frameError: any) {
            log.error(
              `[RenderWindowHandlers ${operationId}] Error processing frame ${frameCount}:`,
              frameError
            );
            throw new Error(
              `Failed during frame ${frameCount} processing: ${frameError.message}`
            ); // Propagate error
          }
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Finished capturing ${totalFrames} PNG frames.`
        );
        // --- End Frame-by-Frame Render Loop ---

        // --- FFmpeg Assembly ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Preparing for FFmpeg assembly...`
        );
        const tempOverlayVideoPath = path.join(
          tempDirPath,
          `overlay_${operationId}.webm` // The path returned by assemblePngSequence
        );

        const assemblyResult = await assemblePngSequence(
          tempDirPath,
          tempOverlayVideoPath,
          options.frameRate,
          operationId
        );

        if (!assemblyResult.success || !assemblyResult.outputPath) {
          // Error is logged within assemblePngSequence
          throw new Error(
            assemblyResult.error ||
              'FFmpeg assembly failed or produced no output path.'
          );
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] FFmpeg assembly successful. Temporary overlay video: ${tempOverlayVideoPath}`
        );
        // --- End FFmpeg Assembly ---

        // --- Prompt User to Save --- START ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Prompting user to save the overlay video...`
        );

        let finalOutputPath: string | undefined;
        try {
          // --- RESTORE WINDOW ARGUMENT ---
          const window =
            BrowserWindow.getFocusedWindow() ||
            BrowserWindow.getAllWindows()[0];
          if (!window) {
            log.error(
              `[RenderWindowHandlers ${operationId}] No window found for save dialog!`
            );
            throw new Error(
              'No application window available to show save dialog.'
            );
          }
          log.info(
            `[RenderWindowHandlers ${operationId}] Window ID for save dialog: ${window?.id}`
          );

          const inputExt = '.webm'; // Output is WebM
          const baseName = 'video-with-subtitles';
          // Try to get a better base name (you might need to pass original filename in options)
          // Example placeholder:
          // const originalFileName = options.originalVideoFileName || 'video';
          // baseName = originalFileName.substring(0, originalFileName.lastIndexOf('.')) || originalFileName;
          const suggestedOutputName = `${baseName}-overlay${inputExt}`;

          const saveDialogResult = await dialog.showSaveDialog(window, {
            // ADDED 'window' argument back
            defaultPath: suggestedOutputName,
            title: 'Save Subtitle Overlay Video As',
            filters: [
              { name: 'WebM Video', extensions: ['webm'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          });
          // --- END RESTORE WINDOW ARGUMENT ---

          log.info(
            `[RenderWindowHandlers ${operationId}] Save dialog returned. Cancelled: ${saveDialogResult.canceled}, Path: ${saveDialogResult.filePath}`
          );

          if (saveDialogResult.canceled || !saveDialogResult.filePath) {
            log.warn(
              `[RenderWindowHandlers ${operationId}] User canceled save dialog.`
            );
            // Decide how to handle cancellation - maybe clean up and reply success=false?
            // For now, we'll throw an error to indicate it wasn't saved.
            throw new Error('Save operation canceled by user.');
          }

          finalOutputPath = saveDialogResult.filePath;
          log.info(
            `[RenderWindowHandlers ${operationId}] User selected output path: ${finalOutputPath}`
          );

          // Move the temporary file to the final location
          log.info(
            `[RenderWindowHandlers ${operationId}] Moving ${tempOverlayVideoPath} to ${finalOutputPath}...`
          );
          await fs.rename(tempOverlayVideoPath, finalOutputPath); // Use fs.rename from fs/promises
          log.info(
            `[RenderWindowHandlers ${operationId}] File moved successfully.`
          );

          // --- Call the Final Merge Step --- START ---
          log.info(
            `[RenderWindowHandlers ${operationId}] Initiating final merge step...`
          );
          // !!! IMPORTANT: We need the ORIGINAL video path here !!!
          // It must be passed in the initial 'options' from the renderer.
          // For now, we'll add a placeholder check.
          // TODO: Update RenderSubtitlesOptions interface and renderer calls to include originalVideoPath.
          const originalVideoPath = options.originalVideoPath; // ASSUMING THIS EXISTS!
          if (!originalVideoPath) {
            throw new Error(
              'Original video path was not provided in the initial render options.'
            );
          }

          // Determine the final merged output path. Let's derive it from the overlay path.
          const finalMergedOutputPath = finalOutputPath.replace(
            /-overlay\.webm$/,
            '-merged.mp4'
          ); // Example: replace suffix

          const mergeResult = await mergeVideoAndOverlay({
            originalVideoPath: originalVideoPath,
            overlayVideoPath: finalOutputPath, // The path where the user saved the overlay
            finalOutputPath: finalMergedOutputPath,
            operationId: operationId,
          });

          if (!mergeResult.success) {
            throw new Error(mergeResult.error || 'Final FFmpeg merge failed.');
          }

          log.info(
            `[RenderWindowHandlers ${operationId}] Final merged video created at: ${mergeResult.finalOutputPath}`
          );
          // --- Call the Final Merge Step --- END ---

          // --- Send FINAL Success Result ---
          // Now we send the path to the *fully merged* video
          event.reply(RENDER_CHANNELS.RESULT, {
            operationId: operationId,
            success: true,
            outputPath: mergeResult.finalOutputPath, // Send the final merged path!
          });
          log.info(
            `[RenderWindowHandlers ${operationId}] Sent final success result (with final merged path) to renderer.`
          );
          // --- End Final Result ---
        } catch (saveMoveError: any) {
          log.error(
            `[RenderWindowHandlers ${operationId}] Error during save/move:`,
            saveMoveError
          );
          // Attempt to clean up the temp file if save/move fails
          try {
            log.warn(
              `[RenderWindowHandlers ${operationId}] Attempting cleanup of temp file ${tempOverlayVideoPath} after save/move error.`
            );
            await fs.rm(tempOverlayVideoPath, { force: true }); // Use fs.rm
          } catch (cleanupErr) {
            log.error(
              `[RenderWindowHandlers ${operationId}] Failed cleanup of ${tempOverlayVideoPath}:`,
              cleanupErr
            );
          }
          // Rethrow the error to be caught by the main try/catch, which sends a failure reply
          throw saveMoveError;
        }
        // --- Prompt User to Save --- END ---

        // *** Important: Cleanup (temp dir) happens in the main finally block ***

        // --- The original event.reply outside the try/catch is now inside the try block above ---
      } catch (error: any) {
        log.error(
          `[RenderWindowHandlers ${operationId}] Error during orchestration:`,
          error
        );
        // Ensure we reply with failure if an error occurred anywhere above
        if (!event.sender.isDestroyed()) {
          event.reply(RENDER_CHANNELS.RESULT, {
            operationId,
            success: false,
            error: error.message || 'Unknown orchestration error',
          });
        } else {
          log.warn(
            `[RenderWindowHandlers ${operationId}] Event sender destroyed before sending error reply.`
          );
        }
        // Cleanup is handled in finally
      } finally {
        // --- Guaranteed Cleanup ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Entering finally block for cleanup.`
        );
        // Clean up window if it exists
        if (windowId !== null) {
          const windowToDestroy = renderWindows.get(windowId);
          if (windowToDestroy && !windowToDestroy.isDestroyed()) {
            log.info(
              `[RenderWindowHandlers ${operationId}] Cleaning up window ID ${windowId} in finally block.`
            );
            windowToDestroy.destroy();
            renderWindows.delete(windowId);
          }
        }
        await cleanupTempDir(tempDirPath, operationId);
        log.info(`[RenderWindowHandlers ${operationId}] Cleanup finished.`);
        // --- End Cleanup ---
      }
    }
  );

  // --- Add other handlers later (CREATE_WINDOW, DESTROY_WINDOW, CAPTURE_FRAME, etc.) ---

  ipcMain.on(WINDOW_CHANNELS.DESTROY_REQUEST, (_event, args) => {
    const { windowId, operationId } = args; // Expect operationId for logging
    log.info(
      `[RenderWindowHandlers ${operationId || 'Cleanup'}] Received request to destroy window ID: ${windowId}`
    );
    const windowToDestroy = renderWindows.get(windowId);
    if (windowToDestroy && !windowToDestroy.isDestroyed()) {
      log.info(
        `[RenderWindowHandlers ${operationId || 'Cleanup'}] Destroying window ID: ${windowId}`
      );
      windowToDestroy.destroy(); // Actually destroy the window
      renderWindows.delete(windowId); // Remove from map
    } else {
      log.warn(
        `[RenderWindowHandlers ${operationId || 'Cleanup'}] Window ID ${windowId} not found or already destroyed.`
      );
    }
  });

  // Handler to relay subtitle text updates TO a specific hidden window
  ipcMain.on(WINDOW_CHANNELS.UPDATE_SUBTITLE, (_event, args) => {
    const { windowId, text, operationId } = args; // Expect operationId for logging
    const targetWindow = renderWindows.get(windowId);

    if (targetWindow && !targetWindow.isDestroyed()) {
      // log.debug(`[RenderWindowHandlers ${operationId}] Relaying text update to window ${windowId}: "${text.substring(0, 30)}..."`); // Optional
      // Send the text to the hidden window's renderer process using the channel its preload script listens on
      targetWindow.webContents.send(WINDOW_CHANNELS.UPDATE_SUBTITLE, { text });
    } else {
      log.warn(
        `[RenderWindowHandlers ${operationId}] Window ID ${windowId} not found or destroyed. Cannot relay text update.`
      );
    }
  });

  log.info('[RenderWindowHandlers] Initialization complete.');
}

// --- Placeholder functions for later implementation ---

async function createOperationTempDir(operationId: string): Promise<string> {
  // TODO: Implement temp directory creation logic using fsPromises and app.getPath('temp')
  log.info(
    `[RenderWindowHandlers ${operationId}] Placeholder: Create Temp Dir`
  );
  const tempDir = path.join(
    app.getPath('temp'),
    `subtitle-render-${operationId}`
  );
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

async function createHiddenRenderWindow(
  options: RenderSubtitlesOptions
): Promise<number> {
  const { operationId, videoWidth, videoHeight } = options;
  log.info(
    `[RenderWindowHandlers ${operationId}] Creating hidden window (${videoWidth}x${videoHeight}).`
  );

  return new Promise<number>((resolve, reject) => {
    try {
      const renderWindow = new BrowserWindow({
        width: videoWidth,
        height: videoHeight,
        // --- Revert to hidden state ---
        show: false, // Back to false
        frame: false, // Back to false
        transparent: true, // Back to true (important for overlay)
        // --- End revert ---
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(app.getAppPath(), 'preload-render-window.js'), // Keep corrected path
          backgroundThrottling: false,
          devTools: !app.isPackaged, // Revert to conditional DevTools
        },
        skipTaskbar: true, // Keep true
      });

      const windowId = renderWindow.id;
      renderWindows.set(windowId, renderWindow);
      log.info(
        `[RenderWindowHandlers ${operationId}] Stored hidden render window ID: ${windowId}`
      );

      // Handle window closure events gracefully
      renderWindow.on('closed', () => {
        log.info(
          `[RenderWindowHandlers ${operationId}] Hidden window ID ${windowId} was closed.`
        );
        renderWindows.delete(windowId); // Remove from map if closed unexpectedly
      });

      // Prevent accidental closure - should only be closed via IPC
      renderWindow.on('close', e => {
        if (!renderWindow.isDestroyed()) {
          log.warn(
            `[RenderWindowHandlers ${operationId}] Attempt to close hidden window ID ${windowId} directly was prevented. Use DESTROY_REQUEST.`
          );
          e.preventDefault(); // Prevent closing
        }
      });

      // Load the host HTML file for the React component
      // TODO: Ensure 'render-host.html' exists and is correctly built/copied.
      // Adjust the path based on your build output structure (dev vs. prod).
      const hostHtmlPath = path.join(app.getAppPath(), 'render-host.html');
      log.info(
        `[RenderWindowHandlers ${operationId}] Loading render host HTML: ${hostHtmlPath}`
      );

      renderWindow
        .loadFile(hostHtmlPath)
        .then(() => {
          log.info(
            `[RenderWindowHandlers ${operationId}] Render host HTML loaded for window ID ${windowId}.`
          );
          // Now that the window and its HTML are ready, resolve the promise with the ID
          resolve(windowId);
        })
        .catch(err => {
          log.error(
            `[RenderWindowHandlers ${operationId}] Failed to load host HTML for window ID ${windowId}:`,
            err
          );
          // Clean up the failed window attempt
          if (!renderWindow.isDestroyed()) {
            renderWindow.destroy();
          }
          renderWindows.delete(windowId);
          reject(new Error(`Failed to load render-host.html: ${err.message}`));
        });
    } catch (error) {
      log.error(
        `[RenderWindowHandlers ${operationId}] Error creating hidden window:`,
        error
      );
      reject(error); // Reject the promise on error
    }
  });
}

async function cleanupTempDir(
  tempDirPath: string | null,
  operationId: string
): Promise<void> {
  if (!tempDirPath) {
    log.warn(
      `[RenderWindowHandlers ${operationId}] No temp directory path provided for cleanup.`
    );
    return;
  }
  try {
    log.info(
      `[RenderWindowHandlers ${operationId}] Cleaning up temporary directory: ${tempDirPath}`
    );
    await fs.rm(tempDirPath, { recursive: true, force: true });
    log.info(
      `[RenderWindowHandlers ${operationId}] Successfully removed temp directory: ${tempDirPath}`
    );
  } catch (error) {
    log.error(
      `[RenderWindowHandlers ${operationId}] Error removing temporary directory ${tempDirPath}:`,
      error
    );
    // Decide if this should throw or just be logged
  }
}

async function captureFrameAndSave(args: {
  windowId: number;
  framePath: string;
  operationId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { windowId, framePath, operationId } = args;
  const targetWindow = renderWindows.get(windowId);

  // log.debug(`[captureFrameAndSave ${operationId}] Capturing window ${windowId} -> ${framePath}`);

  if (!targetWindow || targetWindow.isDestroyed()) {
    log.error(
      `[captureFrameAndSave ${operationId}] Capture failed: Target window ${windowId} not found or destroyed.`
    );
    return { success: false, error: `Render window ${windowId} not found.` };
  }

  if (!framePath) {
    log.error(
      `[captureFrameAndSave ${operationId}] Capture failed: No framePath provided.`
    );
    return { success: false, error: 'No framePath provided for capture.' };
  }

  try {
    const nativeImage = await targetWindow.webContents.capturePage();
    if (nativeImage.isEmpty()) {
      log.warn(
        `[captureFrameAndSave ${operationId}] Captured image empty for ${framePath}. Skipping save.`
      );
      return { success: true }; // Nothing to save is not an error here
    }
    const pngBuffer = nativeImage.toPNG();
    await fs.writeFile(framePath, pngBuffer);
    // log.debug(`[captureFrameAndSave ${operationId}] Saved frame ${framePath}`);
    return { success: true };
  } catch (error: any) {
    log.error(
      `[captureFrameAndSave ${operationId}] Failed to capture or save frame ${framePath}:`,
      error
    );
    return {
      success: false,
      error: error.message || 'Frame capture/save failed',
    };
  }
}

/**
 * Assembles a sequence of PNG frames into a video using FFmpeg.
 * Creates a transparent WebM video using VP9 codec.
 * @param tempDirPath Directory containing frame_*.png images.
 * @param outputPath The full path for the output video file (e.g., overlay.webm).
 * @param frameRate The frame rate of the input sequence.
 * @param operationId For logging.
 * @returns Promise resolving to { success: true, outputPath: string } or rejecting on error.
 */
async function assemblePngSequence(
  tempDirPath: string,
  outputPath: string,
  frameRate: number,
  operationId: string
): Promise<{ success: boolean; outputPath: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = 'ffmpeg'; // Assume ffmpeg is in PATH
    // Pattern must match the saved frame filenames (e.g., frame_0000001.png)
    const inputPattern = path.join(tempDirPath, 'frame_%07d.png');

    // FFmpeg arguments for creating a transparent VP9 WebM video
    const args = [
      '-framerate',
      frameRate.toString(), // Input frame rate
      '-i',
      inputPattern, // Input pattern
      '-c:v',
      'libvpx-vp9', // Codec: VP9 for WebM with alpha
      '-pix_fmt',
      'yuva420p', // Pixel format supporting alpha
      '-lossless',
      '1', // Use lossless compression for best quality
      // '-crf', '18',                  // Constant Rate Factor (lower is better quality, ignored with lossless)
      // '-b:v', '0',                   // Target bitrate 0 (let CRF/lossless control quality)
      '-y', // Overwrite output file without asking
      outputPath, // Output file path
    ];

    log.info(
      `[RenderWindowHandlers ${operationId}] Assembling PNGs with FFmpeg...`
    );
    log.info(
      `[RenderWindowHandlers ${operationId}] Command: ${ffmpegPath} ${args.join(' ')}`
    );

    let ffmpegOutput = ''; // To store stdout/stderr

    try {
      const child: ChildProcess = execFile(ffmpegPath, args);

      child.stdout?.on('data', data => {
        ffmpegOutput += data.toString();
      });
      child.stderr?.on('data', data => {
        ffmpegOutput += data.toString();
        // Optional: log stderr in real-time for debugging progress
        log.debug(`[FFmpeg stderr ${operationId}]: ${data.toString().trim()}`);
      });

      child.on('error', error => {
        log.error(
          `[RenderWindowHandlers ${operationId}] FFmpeg execution error:`,
          error
        );
        log.error(
          `[RenderWindowHandlers ${operationId}] FFmpeg output on error:\n${ffmpegOutput}`
        );
        reject(new Error(`FFmpeg execution failed: ${error.message}`));
      });

      child.on('close', code => {
        log.info(
          `[RenderWindowHandlers ${operationId}] FFmpeg process exited with code ${code}.`
        );
        // Optional: Log full output only on error or specific conditions
        // log.debug(`[RenderWindowHandlers ${operationId}] Full FFmpeg output:\n${ffmpegOutput}`);

        if (code === 0) {
          log.info(
            `[RenderWindowHandlers ${operationId}] FFmpeg assembly successful: ${outputPath}`
          );
          resolve({ success: true, outputPath });
        } else {
          log.error(
            `[RenderWindowHandlers ${operationId}] FFmpeg assembly failed (exit code ${code}).`
          );
          log.error(
            `[RenderWindowHandlers ${operationId}] FFmpeg output on failure:\n${ffmpegOutput}`
          );
          reject(
            new Error(
              `FFmpeg assembly failed with exit code ${code}. Output:\n${ffmpegOutput}`
            )
          );
        }
      });
    } catch (execError) {
      log.error(
        `[RenderWindowHandlers ${operationId}] Error trying to execute FFmpeg:`,
        execError
      );
      reject(execError); // Reject if execFile itself throws
    }
  });
}

// --- Define the options interface ---
interface MergeVideoAndOverlayOptions {
  originalVideoPath: string;
  overlayVideoPath: string;
  finalOutputPath: string;
  operationId: string;
}

/**
 * Merges the original video file with the generated subtitle overlay video.
 * @param options Options object containing paths and operationId.
 * @returns Promise resolving to { success: true, finalOutputPath: string } or rejecting on error.
 */
async function mergeVideoAndOverlay(
  options: MergeVideoAndOverlayOptions // Use the options object
): Promise<{ success: boolean; finalOutputPath: string; error?: string }> {
  // Destructure options
  const { originalVideoPath, overlayVideoPath, finalOutputPath, operationId } =
    options;

  log.info(
    `[mergeVideoAndOverlay ${operationId}] Starting final merge. Original: ${originalVideoPath}, Overlay: ${overlayVideoPath}, Output: ${finalOutputPath}`
  );

  return new Promise((resolve, reject) => {
    const ffmpegPath = 'ffmpeg'; // Assume ffmpeg is in PATH

    // Construct FFmpeg arguments for overlaying
    const args = [
      '-i',
      originalVideoPath, // Input 0: Original video
      '-i',
      overlayVideoPath, // Input 1: Overlay video
      '-filter_complex',
      // Center overlay horizontally, place near bottom (adjust y offset as needed)
      '[0:v][1:v]overlay=x=(W-w)/2:y=H-h-(H*0.05):format=auto[out]',
      '-map',
      '[out]', // Map filtered video to output
      '-map',
      '0:a?', // Map audio from original video (if it exists)
      '-c:a',
      'copy', // Copy audio stream without re-encoding
      '-c:v',
      'libx264', // Video codec (H.264 is widely compatible)
      '-preset',
      'veryfast', // Encoding speed/compression trade-off
      '-crf',
      '22', // Constant Rate Factor (quality, lower is better, 18-28 is common)
      '-y', // Overwrite output file without asking
      finalOutputPath, // Final output file path
    ];

    log.info(
      `[mergeVideoAndOverlay ${operationId}] Executing FFmpeg command: ${ffmpegPath} ${args.map(arg => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}` // Log command safely
    );

    let ffmpegOutput = ''; // To store stdout/stderr
    let ffmpegError = ''; // Specifically for stderr

    try {
      const child: ChildProcess = execFile(ffmpegPath, args);

      child.stdout?.on('data', data => {
        ffmpegOutput += data.toString();
        // Optional: log stdout in real-time
        log.debug(`[FFmpeg stdout ${operationId}]: ${data.toString().trim()}`);
      });

      child.stderr?.on('data', data => {
        const stderrLine = data.toString();
        ffmpegOutput += stderrLine;
        ffmpegError += stderrLine; // Capture stderr separately for error reporting
        // Optional: log stderr in real-time for debugging progress
        log.debug(`[FFmpeg stderr ${operationId}]: ${stderrLine.trim()}`);
      });

      child.on('error', error => {
        log.error(
          `[mergeVideoAndOverlay ${operationId}] FFmpeg execution error:`,
          error
        );
        log.error(
          `[mergeVideoAndOverlay ${operationId}] FFmpeg full output on error:\n${ffmpegOutput}`
        );
        reject(
          new Error(
            `FFmpeg execution failed: ${error.message}. Output: ${ffmpegError}`
          )
        );
      });

      child.on('close', code => {
        log.info(
          `[mergeVideoAndOverlay ${operationId}] FFmpeg process exited with code ${code}.`
        );

        if (code === 0) {
          log.info(
            `[mergeVideoAndOverlay ${operationId}] Final merge successful: ${finalOutputPath}`
          );
          resolve({ success: true, finalOutputPath });
        } else {
          log.error(
            `[mergeVideoAndOverlay ${operationId}] Final merge failed (exit code ${code}).`
          );
          log.error(
            `[mergeVideoAndOverlay ${operationId}] FFmpeg full output on failure:\n${ffmpegOutput}`
          );
          reject(
            new Error(
              `Final merge failed with exit code ${code}. Error output: ${ffmpegError}`
            )
          );
        }
      });
    } catch (execError) {
      log.error(
        `[mergeVideoAndOverlay ${operationId}] Error trying to execute FFmpeg:`,
        execError
      );
      reject(execError); // Reject if execFile itself throws
    }
  });
}
