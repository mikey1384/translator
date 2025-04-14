import { ipcMain, BrowserWindow, app } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url'; // For __dirname in ES modules
import { RenderSubtitlesOptions, SrtSegment } from '../types/interface.js';
import { parseSrt } from '../shared/helpers/index.js';
import { execFile, ChildProcess } from 'child_process';

// --- ES Module __dirname Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        // Define the output path for the temporary overlay video (inside the temp dir)
        const tempOverlayVideoPath = path.join(
          tempDirPath,
          `overlay_${operationId}.webm`
        );

        const assemblyResult = await assemblePngSequence(
          tempDirPath,
          tempOverlayVideoPath,
          options.frameRate,
          operationId
        );

        if (!assemblyResult.success) {
          // Error is logged within assemblePngSequence
          throw new Error(assemblyResult.error || 'FFmpeg assembly failed.');
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] FFmpeg assembly successful. Overlay video: ${assemblyResult.outputPath}`
        );
        // --- End FFmpeg Assembly ---

        // --- Send FINAL Success Result ---
        // Now we send the path to the generated temporary overlay video
        event.reply(RENDER_CHANNELS.RESULT, {
          operationId: operationId,
          success: true,
          outputPath: assemblyResult.outputPath, // The actual path to the overlay video
        });
        log.info(
          `[RenderWindowHandlers ${operationId}] Sent final success result to renderer.`
        );
        // --- End Final Result ---

        // *** Important: Cleanup moved to finally block ***
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
        // Clean up temp directory if it exists (unless configured otherwise for debugging)
        // const keepTempDir = false; // Set to true for debugging PNGs
        // if (!keepTempDir) {
        await cleanupTempDir(tempDirPath, operationId);
        // } else {
        //    log.warn(`[RenderWindowHandlers ${operationId}] Skipping temp directory cleanup for debugging: ${tempDirPath}`);
        // }
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
        show: false, // Keep it hidden
        frame: false,
        transparent: true, // Allows capturing only the subtitles if background is transparent in CSS
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          // SECURITY: Ensure this preload script is correctly configured and secured
          preload: path.join(__dirname, 'preload-render-window.js'), // Preload for this specific window
          backgroundThrottling: false, // Keep rendering smoothly even when hidden
          devTools: !app.isPackaged, // Enable DevTools only in development
        },
        skipTaskbar: true, // Don't show in the taskbar
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
      const hostHtmlPath = path.join(
        app.getAppPath(),
        'dist',
        'render-host.html'
      );
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
