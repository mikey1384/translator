import { ipcMain, BrowserWindow, app, dialog } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs/promises';
import { RenderSubtitlesOptions, SrtSegment } from '../types/interface.js';
import { parseSrt } from '../shared/helpers/index.js';
import { execFile, ChildProcess } from 'child_process';
import puppeteer, { Browser, Page } from 'puppeteer';
import url from 'url';
import { spawn } from 'child_process';

// Re-define channels used in this handler file
const RENDER_CHANNELS = {
  REQUEST: 'render-subtitles-request',
  RESULT: 'render-subtitles-result',
};

type ProgressData = {
  percent: number;
  stage: string;
  error?: string | null;
  cancelled?: boolean;
  operationId: string;
};
type ProgressCallback = (data: Partial<ProgressData>) => void;

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

        // Define the callback function here
        const assemblyProgressCallback: ProgressCallback = progressData => {
          event.sender.send('merge-subtitles-progress', {
            operationId: operationId, // Ensure operationId is included
            ...progressData, // Spread the received progress data (percent, stage)
          });
        };

        const assemblyResult = await assembleClipsFromStates(
          statePngs,
          tempOverlayVideoPath,
          options.frameRate,
          operationId,
          assemblyProgressCallback // <-- PASS the callback here
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
  outputPath: string, // Final overlay path (e.g., overlay.mov)
  frameRate: number,
  operationId: string,
  progressCallback?: ProgressCallback // Accept the callback
): Promise<{ success: boolean; outputPath: string; error?: string }> {
  log.info(
    `[assembleClipsFromStates ${operationId}] Starting assembly using concat demuxer from ${statePngs.length} state PNGs...`
  );

  if (statePngs.length === 0) {
    log.warn(
      `[assembleClipsFromStates ${operationId}] No state PNGs provided. Skipping assembly.`
    );
    // Report minimal progress and return success but empty path?
    progressCallback?.({
      percent: 95,
      stage: 'No states to assemble',
      operationId,
    });
    return { success: true, outputPath: '' };
  }

  const tempDirPath = path.dirname(statePngs[0].path);
  const concatListPath = path.join(
    tempDirPath,
    `concat_list_${operationId}.txt`
  );
  const ffmpegPath = 'ffmpeg'; // Assume in PATH

  // Define progress range for this stage (FFmpeg encoding)
  const ASSEMBLY_START_PERCENT = 10; // Starts after puppeteer
  const ASSEMBLY_END_PERCENT = 95; // Ends before final merge
  const ASSEMBLY_PROGRESS_RANGE = ASSEMBLY_END_PERCENT - ASSEMBLY_START_PERCENT;

  try {
    // --- Step 1: Create the concat list file with durations ---
    log.info(
      `[assembleClipsFromStates ${operationId}] Writing concat list file: ${concatListPath}`
    );
    let concatContent = 'ffconcat version 1.0\n\n'; // Required header
    for (const state of statePngs) {
      // IMPORTANT: Paths in concat list need correct escaping/quoting if they contain special chars.
      // Using relative paths and ensuring no problematic chars in temp names is safest.
      // Normalizing separators for cross-platform compatibility.
      const relativePath = path
        .relative(tempDirPath, state.path)
        .replace(/\\/g, '/');
      concatContent += `file '${relativePath}'\n`;
      concatContent += `duration ${state.duration.toFixed(6)}\n\n`; // Specify duration for the preceding file
    }
    // Add the last file again with zero duration to ensure total duration is met?
    // Or rely on the final segment duration. Let's test without first.
    // const lastState = statePngs[statePngs.length - 1];
    // const lastRelativePath = path.relative(tempDirPath, lastState.path).replace(/\\/g, '/');
    // concatContent += `file '${lastRelativePath}'\n`;

    await fs.writeFile(concatListPath, concatContent, 'utf8');
    log.info(`[assembleClipsFromStates ${operationId}] Concat list generated.`);
    // log.debug(`[assembleClipsFromStates ${operationId}] Concat list content:\n${concatContent.substring(0, 500)}...`); // Log part of the list if needed

    // --- Step 2: Run FFmpeg using the concat demuxer ---
    log.info(
      `[assembleClipsFromStates ${operationId}] Assembling overlay video: ${outputPath}`
    );

    // Calculate total duration for progress reporting
    const totalConcatDuration = statePngs.reduce(
      (sum, state) => sum + state.duration,
      0
    );
    log.info(
      `[assembleClipsFromStates ${operationId}] Calculated total duration for concat: ${totalConcatDuration.toFixed(3)}s`
    );

    const concatArgs = [
      '-f',
      'concat', // Input format: concat demuxer
      '-safe',
      '0', // Allow relative paths
      '-i',
      concatListPath, // Input concat list file
      '-c:v',
      'prores_ks', // Use ProRes codec for alpha support
      '-profile:v',
      '4444', // ProRes 4444 profile for alpha
      '-pix_fmt',
      'yuva444p10le', // Pixel format supporting alpha
      '-r',
      frameRate.toString(), // Ensure consistent frame rate
      // '-vf', `fps=${frameRate}`, // Force constant frame rate if needed
      '-progress',
      'pipe:1', // Enable progress reporting to pipe 1 (stdout)
      '-y', // Overwrite output
      outputPath, // Final output path (.mov)
    ];

    // Use spawn instead of execFile to handle streams better, especially progress
    await new Promise<void>((resolveConcat, rejectConcat) => {
      log.debug(
        `[assembleClipsFromStates ${operationId}] Running concat command: ${ffmpegPath} ${concatArgs.join(' ')}`
      );
      const concatProcess = spawn(ffmpegPath, concatArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      }); // Pipe stdout (progress) and stderr

      let stdoutData = '';
      let stderrData = '';
      let lastProgressReportTime = 0;
      const progressUpdateInterval = 500; // Update every 500ms

      concatProcess.stdout.on('data', (data: Buffer) => {
        stdoutData += data.toString();
        // Parse progress from stdout (lines like 'frame=xx', 'fps=xx', 'out_time_ms=xx')
        const lines = stdoutData.split('\n');
        stdoutData = lines.pop() || ''; // Keep the last partial line

        lines.forEach(line => {
          if (line.startsWith('out_time_ms=')) {
            const timeMs = parseInt(line.split('=')[1], 10);
            if (!isNaN(timeMs) && totalConcatDuration > 0) {
              const currentTime = timeMs / 1_000_000; // Convert microseconds to seconds
              const currentProgress = (currentTime / totalConcatDuration) * 100;
              const overallPercent = Math.round(
                ASSEMBLY_START_PERCENT +
                  (currentProgress * ASSEMBLY_PROGRESS_RANGE) / 100
              );

              const now = Date.now();
              if (
                now - lastProgressReportTime > progressUpdateInterval ||
                overallPercent >= ASSEMBLY_END_PERCENT
              ) {
                lastProgressReportTime = now;
                progressCallback?.({
                  operationId,
                  percent: Math.min(ASSEMBLY_END_PERCENT, overallPercent),
                  stage: `Assembling overlay video... (${Math.round(currentProgress)}%)`,
                });
              }
            }
          }
        });
      });

      concatProcess.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString();
        // Log stderr lines for debugging if needed
        // log.debug(`[FFmpeg Concat Stderr ${operationId}] ${data.toString().trim()}`);
      });

      concatProcess.on('error', err => {
        stderrData = stderrData.slice(-1024); // Limit stderr on error
        rejectConcat(
          new Error(
            `FFmpeg concat spawn error: ${err.message}\nStderr (Last 1KB): ${stderrData}`
          )
        );
      });

      concatProcess.on('close', code => {
        if (code === 0) {
          // Send final progress for this stage
          progressCallback?.({
            operationId,
            percent: ASSEMBLY_END_PERCENT,
            stage: 'Overlay assembly complete',
          });
          resolveConcat();
        } else {
          stderrData = stderrData.slice(-1024); // Limit stderr on error
          rejectConcat(
            new Error(
              `FFmpeg concat exited with code ${code}\nStderr (Last 1KB): ${stderrData}`
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
    progressCallback?.({
      // Report error via progress
      operationId,
      percent: ASSEMBLY_END_PERCENT, // Indicate stage failure
      stage: 'Assembly failed',
      error: error.message || 'Unknown assembly error',
    });
    return {
      success: false,
      outputPath: '',
      error: error.message || 'Unknown assembly error',
    };
  } finally {
    // --- Step 3: Cleanup concat list ---
    log.info(
      `[assembleClipsFromStates ${operationId}] Cleaning up concat list file...`
    );
    await fs.unlink(concatListPath).catch(err => {
      if (err.code !== 'ENOENT') {
        log.warn(
          `Failed to delete concat list ${concatListPath}: ${err.message}`
        );
      }
    });
    // NOTE: The state PNGs are cleaned up by the main handler's finally block using cleanupTempDir
    log.info(
      `[assembleClipsFromStates ${operationId}] Concat list cleanup finished.`
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
