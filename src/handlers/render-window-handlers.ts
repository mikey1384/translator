import { ipcMain, BrowserWindow, app, dialog } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs/promises';
import { RenderSubtitlesOptions, SrtSegment } from '../types/interface.js';
import { parseSrt } from '../shared/helpers/index.js';
import { execFile, ChildProcess } from 'child_process';
import puppeteer, { Browser, Page } from 'puppeteer';
import url from 'url';
import os from 'os';

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

        // --- Generate Timestamped Events ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Generating subtitle change events...`
        );
        const events: Array<{ time: number; text: string }> = [];
        events.push({ time: 0, text: '' }); // Start with blank

        segments.forEach(seg => {
          // Event for text appearing
          // Ensure start time is not negative
          const startTime = Math.max(0, seg.start);
          events.push({ time: startTime, text: seg.text });

          // Event for text disappearing
          // Ensure end time is not negative and slightly after start if equal
          const endTime = Math.max(startTime + 0.001, seg.end);
          events.push({ time: endTime, text: '' });
        });

        // Add final blank event at the very end
        events.push({ time: options.videoDuration, text: '' });

        // Sort events by time, and remove duplicates (same time, same text)
        events.sort((a, b) => a.time - b.time);

        const uniqueEvents: Array<{ time: number; text: string }> = [];
        if (events.length > 0) {
          uniqueEvents.push(events[0]);
          for (let i = 1; i < events.length; i++) {
            // Keep if time is different OR if time is same but text is different
            if (
              events[i].time > events[i - 1].time ||
              events[i].text !== events[i - 1].text
            ) {
              // Also skip if time is negligibly different and text is same (handles tiny overlaps)
              if (
                !(
                  events[i].time - events[i - 1].time < 0.01 &&
                  events[i].text === events[i - 1].text
                )
              ) {
                uniqueEvents.push(events[i]);
              }
            }
          }
        }
        // Ensure the last event goes exactly to video duration
        if (uniqueEvents.length > 0) {
          const lastEvent = uniqueEvents[uniqueEvents.length - 1];
          if (lastEvent.time < options.videoDuration && lastEvent.text === '') {
            // If the last event is blank and before the end, extend it
            lastEvent.time = options.videoDuration;
          } else if (
            lastEvent.time < options.videoDuration &&
            lastEvent.text !== ''
          ) {
            // If the last event has text and ends before duration, add a blank event
            uniqueEvents.push({ time: options.videoDuration, text: '' });
          } else if (lastEvent.time > options.videoDuration) {
            // If the last event somehow goes past duration, cap it
            lastEvent.time = options.videoDuration;
          }
        }

        log.info(
          `[RenderWindowHandlers ${operationId}] Created ${uniqueEvents.length} unique subtitle state events.`
        );
        // --- End Generate Events ---

        // --- Generate State PNGs (Puppeteer) ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Starting state PNG generation loop...`
        );
        const statePngs: Array<{ path: string; duration: number }> = [];
        const TOTAL_EVENTS = uniqueEvents.length;
        const PUPPETEER_STAGE_PERCENT = 10; // Allocate ~10% of progress to this stage

        for (let i = 0; i < TOTAL_EVENTS; i++) {
          const currentEvent = uniqueEvents[i];
          const nextEventTime =
            i + 1 < TOTAL_EVENTS
              ? uniqueEvents[i + 1].time
              : options.videoDuration;
          const stateDuration = Math.max(
            0.001,
            nextEventTime - currentEvent.time
          ); // Ensure positive duration
          const subtitleText = currentEvent.text;

          // Ensure duration doesn't make time exceed videoDuration
          if (
            currentEvent.time + stateDuration >
            options.videoDuration + 0.01
          ) {
            // Add tolerance
            log.warn(
              `[RenderWindowHandlers ${operationId}] State ${i} duration adjusted to fit video duration.`
            );
            // Recalculate duration based on video end time
            // stateDuration = Math.max(0.001, options.videoDuration - currentEvent.time);
            // Let's simply skip rendering if start time is already past duration
            if (currentEvent.time >= options.videoDuration) {
              log.warn(
                `[RenderWindowHandlers ${operationId}] State ${i} starts at or after video duration, skipping.`
              );
              continue;
            }
          }

          if (stateDuration <= 0) {
            log.warn(
              `[RenderWindowHandlers ${operationId}] Skipping event ${i} due to zero or negative duration (${stateDuration}). Time: ${currentEvent.time}, Text: "${subtitleText}"`
            );
            continue;
          }

          const statePngFileName = `state_${String(i).padStart(5, '0')}.png`;
          const statePngPath = path.join(tempDirPath, statePngFileName);

          try {
            // 1. Update text
            await page.evaluate(text => {
              // @ts-ignore
              window.updateSubtitle(text);
            }, subtitleText);

            // Optional small delay
            await new Promise(resolve => setTimeout(resolve, 5));

            // 2. Capture ONE screenshot for this state
            await page.screenshot({
              path: statePngPath,
              omitBackground: true,
              clip: {
                x: 0,
                y: 0,
                width: options.videoWidth,
                height: options.videoHeight,
              },
              type: 'png',
            });

            // 3. Store path and duration
            statePngs.push({ path: statePngPath, duration: stateDuration });

            // --- ADD PROGRESS REPORTING ---
            const stateProgress =
              ((i + 1) / TOTAL_EVENTS) * PUPPETEER_STAGE_PERCENT;
            // Report progress less frequently now, maybe every 10 states or 5%
            if ((i + 1) % 10 === 0 || i === TOTAL_EVENTS - 1) {
              event.sender.send('merge-subtitles-progress', {
                operationId: operationId,
                percent: Math.round(stateProgress),
                stage: `Rendering subtitle state ${i + 1}/${TOTAL_EVENTS}`,
              });
            }
            // --- END PROGRESS REPORTING ---
          } catch (stateError: any) {
            log.error(
              `[RenderWindowHandlers ${operationId}] Error processing state ${i} (Time: ${currentEvent.time}, Text: "${subtitleText}"):`,
              stateError
            );
            throw new Error(
              `Failed during state ${i} processing: ${stateError.message}`
            );
          }
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Finished capturing ${statePngs.length} state PNGs.`
        );

        // Report completion of this stage
        event.sender.send('merge-subtitles-progress', {
          operationId: operationId,
          percent: PUPPETEER_STAGE_PERCENT,
          stage: 'Assembling subtitle overlay video...', // Updated stage message
        });
        // --- End Generate State PNGs ---

        // --- Close Puppeteer Page ---
        await page.close();
        log.info(
          `[RenderWindowHandlers ${operationId}] Puppeteer page closed.`
        );
        // --- End Close Page ---

        // --- FFmpeg Assembly (This part needs modification next) ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Preparing for FFmpeg assembly (Optimized)...`
        );
        const tempOverlayVideoPath = path.join(
          tempDirPath,
          `overlay_${operationId}.mov`
        ); // Keep MOV for potential alpha

        // TODO: Modify assembleClipsFromStates call to pass statePngs and use new logic
        const assemblyResult = await assembleClipsFromStates(
          statePngs,
          tempOverlayVideoPath,
          options.frameRate, // Still need frame rate for intermediate clips
          operationId
        );

        if (!assemblyResult.success || !assemblyResult.outputPath) {
          throw new Error(
            assemblyResult.error || 'Optimized FFmpeg assembly failed.'
          );
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Optimized FFmpeg assembly successful. Temporary overlay video: ${tempOverlayVideoPath}`
        );
        // --- End FFmpeg Assembly ---

        // --- The rest of the logic (Final Merge, Save Dialog, Move) remains the same ---
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

async function assembleClipsFromStates(
  statePngs: Array<{ path: string; duration: number }>,
  outputPath: string,
  frameRate: number,
  operationId: string
): Promise<{ success: boolean; outputPath: string; error?: string }> {
  log.info(
    `[assembleClipsFromStates ${operationId}] Starting assembly from ${statePngs.length} state PNGs...`
  );
  const tempDirPath = path.dirname(statePngs[0].path); // Get temp dir from one of the pngs
  const concatListPath = path.join(
    tempDirPath,
    `concat_list_${operationId}.txt`
  );
  let concatContent = '';
  const ffmpegPath = 'ffmpeg'; // Assume in PATH or use helper if needed
  let clipPathsToCleanup: string[] = []; // <-- DECLARE HERE (initially empty)

  try {
    // --- Step 1: Create individual clips from each state PNG (Parallelized) ---
    log.info(
      `[assembleClipsFromStates ${operationId}] Generating ${statePngs.length} intermediate video clips in parallel...`
    );
    const clipPromises: Promise<void>[] = []; // Store promises that signal task completion
    const MAX_CONCURRENT_FFMPEG = Math.max(
      1,
      Math.min(8, os.cpus().length - 1)
    ); // Limit concurrency (e.g., 8 or num CPU cores - 1)
    log.info(
      `[assembleClipsFromStates ${operationId}] Max concurrent FFmpeg processes: ${MAX_CONCURRENT_FFMPEG}`
    );
    let currentlyRunning = 0;
    let launchedCount = 0;
    const results: { index: number; path: string | null; error?: Error }[] = []; // Store results with index

    const runClipTask = (index: number): Promise<void> => {
      const state = statePngs[index];
      const clipOutputPath = path.join(
        tempDirPath,
        `clip_${String(index).padStart(5, '0')}.mov`
      );
      const clipArgs = [
        '-loop',
        '1',
        '-i',
        state.path,
        '-c:v',
        'prores_ks',
        '-profile:v',
        '4444',
        '-pix_fmt',
        'yuva444p10le',
        '-r',
        frameRate.toString(),
        '-t',
        state.duration.toFixed(4),
        '-y',
        clipOutputPath,
      ];

      currentlyRunning++;
      log.debug(
        `[assembleClipsFromStates ${operationId}] [${currentlyRunning}/${MAX_CONCURRENT_FFMPEG}] Starting clip ${index} generation.`
      );

      return new Promise<void>(resolveTask => {
        // Outer promise resolves when this task slot is free
        const clipPromise = new Promise<void>((resolveClip, rejectClip) => {
          // Inner promise resolves/rejects with clip outcome
          const clipProcess = execFile(ffmpegPath, clipArgs);
          let clipStderr = '';
          clipProcess.stderr?.on(
            'data',
            data => (clipStderr += data.toString())
          );
          clipProcess.on('error', err =>
            rejectClip(
              new Error(
                `FFmpeg clip ${index} error: ${err.message}\nStderr: ${clipStderr}`
              )
            )
          );
          clipProcess.on('close', code => {
            if (code === 0) {
              resolveClip(); // Resolve inner promise with path
            } else {
              rejectClip(
                new Error(
                  `FFmpeg clip ${index} exited with code ${code}\nStderr: ${clipStderr}`
                )
              );
            }
          });
        });

        clipPromise
          .then(() => {
            results.push({ index: index, path: clipOutputPath });
          })
          .catch(error => {
            results.push({ index: index, path: null, error: error });
            log.error(
              `[assembleClipsFromStates ${operationId}] Failed to generate clip ${index}:`,
              error
            );
            // Decide if you want to throw/stop everything on single clip failure, or just log and continue
          })
          .finally(() => {
            currentlyRunning--;
            log.debug(
              `[assembleClipsFromStates ${operationId}] [${currentlyRunning}/${MAX_CONCURRENT_FFMPEG}] Finished clip ${index} generation.`
            );
            resolveTask(); // Resolve outer promise to free up the slot
          });
      });
    };

    // Launch tasks with concurrency limit
    while (launchedCount < statePngs.length) {
      while (
        currentlyRunning < MAX_CONCURRENT_FFMPEG &&
        launchedCount < statePngs.length
      ) {
        clipPromises.push(runClipTask(launchedCount));
        launchedCount++;
      }
      // Wait for at least one task to complete before launching more
      await Promise.race(clipPromises.slice(-MAX_CONCURRENT_FFMPEG)); // Wait for any of the currently running ones
    }

    // Wait for all remaining tasks to complete
    await Promise.all(clipPromises);

    // --- Process results ---
    results.sort((a, b) => a.index - b.index); // Ensure results are in original order
    const successfulClips = results.filter(r => r.path !== null) as {
      index: number;
      path: string;
    }[];
    const failedCount = statePngs.length - successfulClips.length;

    if (failedCount > 0) {
      log.warn(
        `[assembleClipsFromStates ${operationId}] ${failedCount} clip(s) failed to generate. Proceeding with successful ones.`
      );
      // Decide if this should be a fatal error. Let's proceed for now.
      if (successfulClips.length === 0) {
        throw new Error('All intermediate clips failed to generate.');
      }
    }

    // Store successful paths for cleanup
    clipPathsToCleanup = successfulClips.map(clip => clip.path);

    log.info(
      `[assembleClipsFromStates ${operationId}] Successfully generated ${successfulClips.length} intermediate clips (out of ${statePngs.length}).`
    );

    // --- Step 2: Create concat list file (uses successful clips) ---
    log.info(
      `[assembleClipsFromStates ${operationId}] Writing concat list file: ${concatListPath}`
    );
    concatContent = successfulClips
      .map(clip => `file '${path.relative(tempDirPath, clip.path)}'`)
      .join('\n');
    await fs.writeFile(concatListPath, concatContent, 'utf8');

    // --- Step 3: Concatenate clips into final overlay video ---
    log.info(
      `[assembleClipsFromStates ${operationId}] Concatenating clips into final overlay: ${outputPath}`
    );
    const concatArgs = [
      '-f',
      'concat', // Use the concat demuxer
      '-safe',
      '0', // Allow relative paths in concat list
      '-i',
      concatListPath, // Input concat list file
      '-c',
      'copy', // Copy codecs (should be ProRes 4444 already)
      '-y', // Overwrite output
      outputPath, // Final output path (.mov)
    ];

    await new Promise<void>((resolveConcat, rejectConcat) => {
      log.debug(
        `[assembleClipsFromStates ${operationId}] Running concat command: ${ffmpegPath} ${concatArgs.join(' ')}`
      );
      const concatProcess = execFile(ffmpegPath, concatArgs);
      let concatStderr = '';
      concatProcess.stderr?.on(
        'data',
        data => (concatStderr += data.toString())
      );
      concatProcess.on('error', err =>
        rejectConcat(
          new Error(
            `FFmpeg concat error: ${err.message}\nStderr: ${concatStderr}`
          )
        )
      );
      concatProcess.on('close', code => {
        if (code === 0) {
          resolveConcat();
        } else {
          rejectConcat(
            new Error(
              `FFmpeg concat exited with code ${code}\nStderr: ${concatStderr}`
            )
          );
        }
      });
    });

    log.info(
      `[assembleClipsFromStates ${operationId}] Concatenation successful. Final overlay: ${outputPath}`
    );
    return { success: true, outputPath };
  } catch (error: any) {
    log.error(
      `[assembleClipsFromStates ${operationId}] Assembly failed:`,
      error
    );
    return {
      success: false,
      outputPath: '',
      error: error.message || 'Unknown assembly error',
    };
  } finally {
    // --- Step 4: Cleanup intermediate clips and concat list ---
    log.info(
      `[assembleClipsFromStates ${operationId}] Cleaning up intermediate files...`
    );
    const cleanupPromises = [];
    for (const clipPath of clipPathsToCleanup) {
      cleanupPromises.push(
        fs
          .unlink(clipPath)
          .catch(err => log.warn(`Failed to delete clip ${clipPath}: ${err}`))
      );
    }
    cleanupPromises.push(
      fs
        .unlink(concatListPath)
        .catch(err =>
          log.warn(`Failed to delete concat list ${concatListPath}: ${err}`)
        )
    );
    await Promise.allSettled(cleanupPromises);
    log.info(
      `[assembleClipsFromStates ${operationId}] Intermediate file cleanup finished.`
    );
  }
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
