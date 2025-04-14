import { ipcMain, BrowserWindow, app, dialog } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs/promises';
import { RenderSubtitlesOptions, SrtSegment } from '../types/interface.js';
import { parseSrt } from '../shared/helpers/index.js';
import { execFile, ChildProcess } from 'child_process';
import puppeteer, { Browser, Page } from 'puppeteer-core';
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

        // Check if the updateSubtitle function exists on the page
        const functionExists = await page.evaluate(() => {
          // @ts-ignore
          return typeof window.updateSubtitle === 'function';
        });
        if (!functionExists) {
          log.error(
            `[RenderWindowHandlers ${operationId}] Error: window.updateSubtitle function not found in render-host.html. Ensure it's exposed correctly in render-host-script.tsx.`
          );
          throw new Error('window.updateSubtitle function not found on page.');
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Found window.updateSubtitle function on page.`
        );
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

            // Log progress periodically
            if (
              frameCount % (options.frameRate * 10) === 0 ||
              frameCount === totalFrames
            ) {
              log.info(
                `[RenderWindowHandlers ${operationId}] Captured frame ${frameCount}/${totalFrames} (${Math.round((frameCount / totalFrames) * 100)}%) (Puppeteer)`
              );
            }
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
          `overlay_${operationId}.webm`
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

        // --- Final Merge Prep (No change needed here) ---
        const tempOverlayPath = assemblyResult.outputPath;
        const originalVideoPath = options.originalVideoPath;
        if (!originalVideoPath) {
          throw new Error('Original video path was not provided.');
        }
        // --- End Final Merge Prep ---

        // --- Prompt User to Save FINAL MP4 (No change needed here) ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Prompting user to save the FINAL merged video...`
        );
        // Try getting window differently just in case focus is lost
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
          // Use mainWindow
          title: 'Save Merged Video As',
          defaultPath: suggestedFinalName,
          filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
        });
        if (finalSaveDialogResult.canceled || !finalSaveDialogResult.filePath) {
          throw new Error('User cancelled saving the final merged video.');
        }
        const finalUserSelectedPath = finalSaveDialogResult.filePath;
        // --- End Prompt User ---

        // --- Call Final Merge (No change needed here) ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Calling mergeVideoAndOverlay. Overlay: ${tempOverlayPath}, Final Target: ${finalUserSelectedPath}`
        );
        const mergeResult = await mergeVideoAndOverlay({
          originalVideoPath: originalVideoPath,
          overlayVideoPath: tempOverlayPath,
          targetSavePath: finalUserSelectedPath,
          operationId: operationId,
        });

        if (!mergeResult.success) {
          throw new Error(mergeResult.error || 'Final FFmpeg merge failed.');
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Final merged video created at: ${mergeResult.finalOutputPath}`
        );
        // --- End Final Merge ---

        // --- Send FINAL Success Result ---
        event.reply(RENDER_CHANNELS.RESULT, {
          operationId: operationId,
          success: true,
          outputPath: mergeResult.finalOutputPath,
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
        await cleanupTempDir(tempDirPath, operationId); // Ensure this is re-enabled if you commented it out
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
  // Adjust if your build structure is different
  // Assuming render-host.html is copied to the root of the dist folder by a build step
  return path.join(app.getAppPath(), 'dist', 'render-host.html');
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

// --- FFmpeg Functions (Keep as they are, ensure assemblePngSequence uses -crf 18 -b:v 0) ---

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
      'libvpx-vp9',
      '-pix_fmt',
      'yuva420p', // Crucial for alpha
      '-crf', // Use CRF for quality
      '18',
      '-b:v', // Required with CRF
      '0',
      '-deadline',
      'realtime', // Can sometimes help with hanging processes
      '-cpu-used',
      '8', // Adjust based on system cores, might speed up vp9
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
