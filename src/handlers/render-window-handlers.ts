import { ipcMain, BrowserWindow, app, dialog } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs/promises';
import { RenderSubtitlesOptions, SrtSegment } from '../types/interface.js';
import { parseSrt } from '../shared/helpers/index.js';
import { execFile, ChildProcess } from 'child_process';
import puppeteer, { Browser, Page } from 'puppeteer';
import url from 'url';

// Re-define channels used in this handler file
const RENDER_CHANNELS = {
  REQUEST: 'render-subtitles-request',
  RESULT: 'render-subtitles-result',
};

/**
 * Initializes IPC handlers for the subtitle overlay rendering process using Puppeteer.
 */
export function initializeRenderWindowHandlers(): void {
  log.info('[RenderWindowHandlers] Initializing (Puppeteer method)...');

  // --- Main Orchestration Handler ---
  ipcMain.on(
    RENDER_CHANNELS.REQUEST,
    async (event, options: RenderSubtitlesOptions) => {
      const { operationId } = options;
      log.info(
        `[RenderWindowHandlers ${operationId}] Received ${RENDER_CHANNELS.REQUEST}. Orchestration starting (Puppeteer).`
      );

      let tempDirPath: string | null = null;
      let browser: Browser | null = null; // Puppeteer browser instance

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

        // --- Puppeteer Setup ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Setting up Puppeteer...`
        );
        const hostHtmlPath = getRenderHostPath(); // Use helper
        if (!(await fs.stat(hostHtmlPath).catch(() => false))) {
          throw new Error(
            `Render host HTML not found at: ${hostHtmlPath}. Check build process.`
          );
        }
        const hostHtmlUrl = url.pathToFileURL(hostHtmlPath).toString();

        log.info(
          `[RenderWindowHandlers ${operationId}] Render host URL: ${hostHtmlUrl}`
        );

        // Attempting auto-detection by omitting executablePath
        try {
          log.info(
            `[RenderWindowHandlers ${operationId}] Launching Puppeteer...`
          );
          browser = await puppeteer.launch({
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
            ], // Added common CI/server args
          });
          log.info(
            `[RenderWindowHandlers ${operationId}] Puppeteer browser launched.`
          );
        } catch (launchError: any) {
          log.error(
            `[RenderWindowHandlers ${operationId}] Puppeteer launch failed. Ensure a compatible Chrome/Chromium is installed OR configure executablePath. Error:`,
            launchError
          );
          throw new Error(
            `Puppeteer launch failed: ${launchError.message}. Check installation/path.`
          );
        }

        const page: Page = await browser.newPage();

        // Forward console messages from the page to the main process log
        page.on('console', msg => {
          const type = msg.type();
          const text = `[Puppeteer Page Console][${type}] ${msg.text()}`;
          if (type === 'error') {
            log.error(text);
          } else if (type === 'warn') {
            log.warn(text);
          } else {
            log.info(text); // Log info, log, debug etc. as info
          }
        });

        await page.setViewport({
          width: options.videoWidth,
          height: options.videoHeight,
        });
        log.info(
          `[RenderWindowHandlers ${operationId}] Puppeteer page created and viewport set.`
        );

        // Add error logging for page load issues
        page.on('pageerror', err => {
          log.error(
            `[RenderWindowHandlers ${operationId}] Puppeteer Page Error: ${err.toString()}`
          );
        });
        page.on('requestfailed', req => {
          log.error(
            `[RenderWindowHandlers ${operationId}] Puppeteer Page Request Failed: ${req.url()} - ${req.failure()?.errorText}`
          );
        });

        log.info(
          `[RenderWindowHandlers ${operationId}] Navigating Puppeteer page to ${hostHtmlUrl}...`
        );
        await page.goto(hostHtmlUrl, { waitUntil: 'networkidle0' }); // Wait for page to load fully
        log.info(
          `[RenderWindowHandlers ${operationId}] Puppeteer page navigated to host HTML.`
        );

        // Check if the updateSubtitle function exists on the page using waitForFunction
        log.info(
          `[RenderWindowHandlers ${operationId}] Waiting for window.updateSubtitle function...`
        );
        try {
          await page.waitForFunction(
            'typeof window.updateSubtitle === "function"',
            { timeout: 5000 }
          ); // Wait up to 5 seconds
          log.info(
            `[RenderWindowHandlers ${operationId}] Found window.updateSubtitle function on page.`
          );
        } catch (waitError) {
          log.error(
            `[RenderWindowHandlers ${operationId}] Error: window.updateSubtitle function did not appear within timeout. Ensure it's exposed correctly in render-host-script.tsx. Error:`,
            waitError
          );
          throw new Error('window.updateSubtitle function timed out.');
        }
        // --- End Puppeteer Setup ---

        // --- Parse SRT ---
        let segments: SrtSegment[] = [];
        try {
          segments = parseSrt(options.srtContent);
          log.info(
            `[RenderWindowHandlers ${operationId}] Parsed ${segments.length} SRT segments.`
          );
        } catch (parseError: any) {
          throw new Error(`Failed to parse SRT content: ${parseError.message}`);
        }
        // --- End Parse SRT ---

        // --- Frame-by-Frame Render Loop (Puppeteer) ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Starting frame render/capture loop (Puppeteer).`
        );
        const totalFrames = Math.ceil(
          options.videoDuration * options.frameRate
        );
        const PUPPETEER_STAGE_PERCENT = 90;

        for (let i = 0; i < totalFrames; i++) {
          const frameCount = i + 1;
          const currentTime = i / options.frameRate;

          const activeSegment = segments.find(
            seg => currentTime >= seg.start && currentTime < seg.end
          );
          const subtitleText = activeSegment ? activeSegment.text : '';

          const frameFileName = `frame_${String(frameCount).padStart(7, '0')}.png`;
          const framePath = path.join(tempDirPath, frameFileName);

          try {
            // 1. Update text using page.evaluate
            await page.evaluate(text => {
              // @ts-ignore - We checked window.updateSubtitle exists
              window.updateSubtitle(text);
            }, subtitleText);

            // Add a small delay AFTER updating text, just in case React needs a tick to re-render
            await new Promise(resolve => setTimeout(resolve, 10)); // Small delay for DOM update

            // 2. Capture using page.screenshot (omitBackground is key!)
            await page.screenshot({
              path: framePath,
              omitBackground: true,
              // Ensure clip matches viewport size exactly
              clip: {
                x: 0,
                y: 0,
                width: options.videoWidth,
                height: options.videoHeight,
              },
              type: 'png', // Explicitly set type
            });

            // --- ADD PROGRESS REPORTING ---
            const frameProgress =
              (frameCount / totalFrames) * PUPPETEER_STAGE_PERCENT;
            if (
              frameCount % options.frameRate === 0 ||
              frameCount === totalFrames
            ) {
              // Send every second or on last frame
              event.sender.send('merge-subtitles-progress', {
                // Use existing channel
                operationId: operationId,
                percent: Math.round(frameProgress),
                stage: `Rendering frame ${frameCount}/${totalFrames}`,
              });
            }
            // --- END PROGRESS REPORTING ---
          } catch (frameError: any) {
            log.error(
              `[RenderWindowHandlers ${operationId}] Error processing frame ${frameCount} (Puppeteer):`,
              frameError
            );
            throw new Error(
              `Failed during frame ${frameCount} processing (Puppeteer): ${frameError.message}`
            );
          }
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Finished capturing ${totalFrames} PNG frames (Puppeteer).`
        );
        // Report completion of this stage
        event.sender.send('merge-subtitles-progress', {
          operationId: operationId,
          percent: PUPPETEER_STAGE_PERCENT,
          stage: 'Assembling PNG sequence...', // Set stage for next step
        });
        // --- End Frame-by-Frame Render Loop ---

        // --- Close Puppeteer Page ---
        await page.close();
        log.info(
          `[RenderWindowHandlers ${operationId}] Puppeteer page closed.`
        );
        // Keep browser open until finally block for safety

        // --- FFmpeg Assembly (No change needed here) ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Preparing for FFmpeg assembly...`
        );
        const tempOverlayVideoPath = path.join(
          tempDirPath,
          `overlay_${operationId}.mov`
        );

        const assemblyResult = await assemblePngSequence(
          tempDirPath,
          tempOverlayVideoPath,
          options.frameRate,
          operationId
        );

        if (!assemblyResult.success || !assemblyResult.outputPath) {
          throw new Error(
            assemblyResult.error ||
              'FFmpeg assembly failed or produced no output path.'
          );
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] FFmpeg assembly successful. Temporary overlay video: ${tempOverlayVideoPath}`
        );
        // --- End FFmpeg Assembly ---

        // --- Prepare for Final Merge (New Flow) ---
        const tempOverlayPath = assemblyResult.outputPath;
        const originalVideoPath = options.originalVideoPath;
        if (!originalVideoPath) {
          throw new Error('Original video path was not provided.');
        }

        // Define path for the TEMPORARY merged output
        const finalTempMergedPath = path.join(
          tempDirPath,
          `final_temp_${operationId}.mp4`
        );
        log.info(
          `[RenderWindowHandlers ${operationId}] Preparing final merge into temporary path: ${finalTempMergedPath}`
        );

        // Report progress before final merge
        event.sender.send('merge-subtitles-progress', {
          operationId: operationId,
          percent: 95, // Or adjust based on how long assembly takes
          stage: 'Merging video and overlay...',
        });
        // --- End Preparation ---

        // --- Call Final Merge into TEMPORARY File ---
        const mergeResult = await mergeVideoAndOverlay({
          originalVideoPath: originalVideoPath,
          overlayVideoPath: tempOverlayPath,
          targetSavePath: finalTempMergedPath, // Merge to temp path first
          operationId: operationId,
          // TODO: Pass event.sender or a callback for progress reporting here later
        });

        if (!mergeResult.success || !mergeResult.finalOutputPath) {
          // Use finalOutputPath which now points to the temp merged file
          throw new Error(
            mergeResult.error ||
              'Final FFmpeg merge into temporary file failed.'
          );
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Final merge into temporary file successful: ${mergeResult.finalOutputPath}`
        );
        // --- End Final Merge ---

        // --- Prompt User to Save the COMPLETED Temporary File ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Prompting user to save the FINAL merged video...`
        );
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (!mainWindow) {
          log.error(
            `[RenderWindowHandlers ${operationId}] No main window found for save dialog!`
          );
          throw new Error('No application window available for save dialog.');
        }

        const originalFileName = path.basename(
          originalVideoPath,
          path.extname(originalVideoPath)
        );
        const suggestedFinalName = `${originalFileName}-merged.mp4`;

        const finalSaveDialogResult = await dialog.showSaveDialog(mainWindow, {
          title: 'Save Merged Video As',
          defaultPath: suggestedFinalName,
          filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
        });

        if (finalSaveDialogResult.canceled || !finalSaveDialogResult.filePath) {
          log.warn(
            `[RenderWindowHandlers ${operationId}] User cancelled saving the final merged video. Cleaning up temporary merged file.`
          );
          // Don't treat cancellation as a hard error, but clean up the temp merged file.
          await fs
            .unlink(mergeResult.finalOutputPath)
            .catch(err =>
              log.error(`Failed to clean up temp merged file on cancel: ${err}`)
            );
          // Send a specific "cancelled" result or just success=false without error?
          // Let's send success=false and a specific message.
          event.reply(RENDER_CHANNELS.RESULT, {
            operationId: operationId,
            success: false, // Indicate not fully successful completion
            error: 'Save cancelled by user.',
          });
          return; // Stop execution here if user cancelled save
        }

        const finalUserSelectedPath = finalSaveDialogResult.filePath;
        log.info(
          `[RenderWindowHandlers ${operationId}] User selected final save path: ${finalUserSelectedPath}`
        );
        // --- End Prompt User ---

        // --- Move Temporary Merged File to Final Location ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Moving temporary merged file ${mergeResult.finalOutputPath} to ${finalUserSelectedPath}`
        );
        try {
          await fs.rename(mergeResult.finalOutputPath, finalUserSelectedPath);
          log.info(
            `[RenderWindowHandlers ${operationId}] Successfully moved merged file.`
          );
        } catch (moveError: any) {
          log.error(
            `[RenderWindowHandlers ${operationId}] Error moving temp file to final destination:`,
            moveError
          );
          // Attempt to copy as fallback? Or just report error? Let's report error.
          throw new Error(
            `Failed to move merged video to final destination: ${moveError.message}`
          );
        }
        // --- End Move File ---

        // --- Send FINAL Success Result ---
        event.sender.send('merge-subtitles-progress', {
          // Final progress update
          operationId: operationId,
          percent: 100,
          stage: 'Merge complete!',
        });
        event.reply(RENDER_CHANNELS.RESULT, {
          operationId: operationId,
          success: true,
          outputPath: finalUserSelectedPath, // Report the final user path
        });
        log.info(
          `[RenderWindowHandlers ${operationId}] Sent final success result to renderer.`
        );
        // --- End Final Result ---
      } catch (error: any) {
        log.error(
          `[RenderWindowHandlers ${operationId}] Error during orchestration:`,
          error
        );
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
      } finally {
        // --- Guaranteed Cleanup ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Entering finally block for cleanup.`
        );
        // Clean up Puppeteer browser
        if (browser) {
          try {
            log.info(
              `[RenderWindowHandlers ${operationId}] Closing Puppeteer browser...`
            );
            await browser.close();
            log.info(
              `[RenderWindowHandlers ${operationId}] Puppeteer browser closed.`
            );
          } catch (closeError) {
            log.warn(
              `[RenderWindowHandlers ${operationId}] Error closing Puppeteer browser:`,
              closeError
            );
          }
        }
        // Clean up temp dir
        await cleanupTempDir(tempDirPath, operationId); // <-- Add // at the beginning
        log.info(`[RenderWindowHandlers ${operationId}] Cleanup finished.`);
        // --- End Cleanup ---
      }
    }
  );

  log.info(
    '[RenderWindowHandlers] Initialization complete (Puppeteer method).'
  );
}

// --- Helper function to get render-host.html path ---
function getRenderHostPath(): string {
  const appPath = app.getAppPath();
  let correctPath: string;

  if (app.isPackaged) {
    correctPath = path.join(appPath, 'dist', 'render-host.html');
    log.info(`[getRenderHostPath] Packaged mode path: ${correctPath}`);
  } else {
    // In development, appPath might be 'dist/main'. Go up one level to 'dist'.
    correctPath = path.join(appPath, '..', 'render-host.html'); // Go up from dist/main to dist
    log.info(
      `[getRenderHostPath] Development mode path (relative to appPath parent): ${correctPath}`
    );
  }

  return correctPath;
}

// --- Utility Functions (Keep as they are) ---

async function createOperationTempDir(operationId: string): Promise<string> {
  const tempDir = path.join(
    app.getPath('temp'),
    `subtitle-render-${operationId}`
  );
  log.info(`[createOperationTempDir ${operationId}] Creating ${tempDir}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
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
  }
}

async function assemblePngSequence(
  tempDirPath: string,
  outputPath: string,
  frameRate: number,
  operationId: string
): Promise<{ success: boolean; outputPath: string; error?: string }> {
  log.info(
    `[assemblePngSequence ${operationId}] Starting assembly. Input dir: ${tempDirPath}, Output: ${outputPath}`
  );
  return new Promise((resolve, reject) => {
    const ffmpegPath = 'ffmpeg';
    const inputPattern = path.join(tempDirPath, 'frame_%07d.png');

    // Check if input files exist (basic check)
    // This is complex to do properly without listing dir, skip for now but consider adding later if needed

    const args = [
      '-framerate',
      frameRate.toString(),
      '-i',
      inputPattern,
      '-c:v',
      'png',
      '-pix_fmt',
      'rgba',
      '-y',
      outputPath,
    ];

    log.info(
      `[assemblePngSequence ${operationId}] Assembling PNGs with FFmpeg command: ${ffmpegPath} ${args.join(' ')}`
    );

    let ffmpegOutput = '';
    let hasSeenData = false;
    const child: ChildProcess = execFile(ffmpegPath, args);

    child.stdout?.on('data', data => {
      hasSeenData = true;
      ffmpegOutput += data.toString();
    });
    child.stderr?.on('data', data => {
      hasSeenData = true;
      const stderrLine = data.toString().trim();
      if (stderrLine) {
        // Avoid logging empty lines
        ffmpegOutput += stderrLine + '\n';
        log.debug(`[FFmpeg stderr ${operationId}]: ${stderrLine}`);
      }
    });

    child.on('error', error => {
      log.error(
        `[assemblePngSequence ${operationId}] FFmpeg execution error:`,
        error
      );
      log.error(
        `[assemblePngSequence ${operationId}] FFmpeg output on error:\n${ffmpegOutput}`
      );
      reject(new Error(`FFmpeg execution failed: ${error.message}`));
    });

    child.on('close', code => {
      log.info(
        `[assemblePngSequence ${operationId}] FFmpeg process exited with code ${code}.`
      );
      if (code === 0 && hasSeenData) {
        // Check hasSeenData as extra validation
        log.info(
          `[assemblePngSequence ${operationId}] Assembly successful: ${outputPath}`
        );
        resolve({ success: true, outputPath });
      } else {
        log.error(
          `[assemblePngSequence ${operationId}] FFmpeg assembly failed (exit code ${code}, saw data: ${hasSeenData}).`
        );
        log.error(
          `[assemblePngSequence ${operationId}] FFmpeg output on failure:\n${ffmpegOutput}`
        );
        reject(
          new Error(
            `FFmpeg assembly failed with exit code ${code}. Output:\n${ffmpegOutput}`
          )
        );
      }
    });
  });
}

interface MergeVideoAndOverlayOptions {
  originalVideoPath: string;
  overlayVideoPath: string;
  targetSavePath: string;
  operationId: string;
}

async function mergeVideoAndOverlay(
  options: MergeVideoAndOverlayOptions
): Promise<{ success: boolean; finalOutputPath: string; error?: string }> {
  const { originalVideoPath, overlayVideoPath, targetSavePath, operationId } =
    options;

  log.info(
    `[mergeVideoAndOverlay ${operationId}] Starting final merge. Original: ${originalVideoPath}, Overlay: ${overlayVideoPath}, Output: ${targetSavePath}`
  );

  // Add check for overlay file existence
  if (!(await fs.stat(overlayVideoPath).catch(() => false))) {
    throw new Error(`Overlay video file not found at: ${overlayVideoPath}`);
  }

  return new Promise((resolve, reject) => {
    const ffmpegPath = 'ffmpeg';
    const args = [
      '-i',
      originalVideoPath,
      '-i',
      overlayVideoPath, // This should now have proper alpha
      '-filter_complex',
      // Keep target position - assuming y=50 works if overlay is transparent
      '[0:v][1:v]overlay=x=(main_w-overlay_w)/2:y=50[out]', // Using y=50 as target position
      '-map',
      '[out]', // Map the filtered video stream
      '-map',
      '0:a?', // Map audio from original video if it exists
      '-c:a',
      'copy', // Copy audio codec
      '-c:v',
      'libx264', // Standard video codec for MP4
      '-preset',
      'veryfast', // Faster encoding
      '-crf',
      '22', // Decent quality/size balance
      '-y', // Overwrite output without asking
      targetSavePath,
    ];

    log.info(
      `[mergeVideoAndOverlay ${operationId}] Executing FFmpeg command: ${ffmpegPath} ${args.map(arg => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}`
    );

    let ffmpegOutput = '';
    let ffmpegError = '';
    let hasSeenData = false;
    const child: ChildProcess = execFile(ffmpegPath, args);

    child.stdout?.on('data', data => {
      hasSeenData = true;
      ffmpegOutput += data.toString();
      log.debug(`[FFmpeg stdout ${operationId}]: ${data.toString().trim()}`);
    });
    child.stderr?.on('data', data => {
      hasSeenData = true;
      const stderrLine = data.toString().trim();
      if (stderrLine) {
        ffmpegOutput += stderrLine + '\n';
        ffmpegError += stderrLine + '\n'; // Capture stderr specifically for error reporting
        log.debug(`[FFmpeg stderr ${operationId}]: ${stderrLine}`);
      }
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
          `FFmpeg execution failed: ${error.message}. Error output: ${ffmpegError}`
        )
      );
    });

    child.on('close', code => {
      log.info(
        `[mergeVideoAndOverlay ${operationId}] FFmpeg process exited with code ${code}.`
      );
      if (code === 0 && hasSeenData) {
        log.info(
          `[mergeVideoAndOverlay ${operationId}] Final merge successful: ${targetSavePath}`
        );
        resolve({ success: true, finalOutputPath: targetSavePath });
      } else {
        log.error(
          `[mergeVideoAndOverlay ${operationId}] Final merge failed (exit code ${code}, saw data: ${hasSeenData}).`
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
  });
}

// --- Declare window type augmentation for render-host-script ---
// This helps TypeScript understand the function we expect on the window object
declare global {
  interface Window {
    updateSubtitle?: (text: string) => void;
  }
}
