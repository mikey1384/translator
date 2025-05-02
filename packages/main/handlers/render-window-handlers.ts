import path from 'path';
import fs from 'fs/promises';
import {
  RenderSubtitlesOptions,
  SrtSegment,
} from '../../shared/types/interface.js';
import { FFmpegService } from '../../services/ffmpeg-service.js';
import { parseSrt } from '../../shared/helpers/index.js';
import { getAssetsPath } from '../../shared/helpers/paths.js';
import { pathToFileURL } from 'url';
import puppeteer, { Browser, Page } from 'puppeteer';
import url from 'url';
import { cueText } from '../../shared/helpers/index.js';
import { spawn, ChildProcess } from 'child_process';
import os from 'os';

// O3 Suggestion: Track active render jobs
const activeRenderJobs = new Map<
  string,
  { browser?: Browser; processes: ChildProcess[] }
>();

const fontRegular = pathToFileURL(getAssetsPath('NotoSans-Regular.ttf')).href;

export function getActiveRenderJob(id: string) {
  return activeRenderJobs.get(id);
}

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

      // O3 suggestion: Create a new entry for this job right away
      activeRenderJobs.set(operationId, { browser: undefined, processes: [] });

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
              '--allow-file-access-from-files',
              '--disable-web-security',
            ],
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

        // O3 suggestion: Store the browser reference in the active job
        const activeJob = activeRenderJobs.get(operationId);
        if (activeJob) {
          activeJob.browser = browser;
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
        await page.goto(hostHtmlUrl, { waitUntil: 'networkidle0' });
        if (options.fontSizePx) {
          await page.addStyleTag({
            content: `
              @font-face {
                font-family: "Noto Sans";
                src: url("${fontRegular}") format("truetype");
                font-weight: normal;
              }
            `,
          });
          await page.evaluate(() => document.fonts.ready);
        }
        if (options.stylePreset) {
          await page.evaluate(preset => {
            // @ts-ignore
            window.applySubtitlePreset?.(preset);
          }, options.stylePreset);
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Puppeteer page navigated to host HTML.`
        );

        // Check if the updateSubtitle function exists on the page
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

        // --- Generate Timestamped Events (Using Milliseconds) ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Generating subtitle change events (using milliseconds)...`
        );
        const eventsMs: Array<{ timeMs: number; text: string }> = [];
        const videoDurationMs = Math.round(options.videoDuration * 1000);
        const MIN_DURATION_MS = 1; // Minimum duration for a state in ms

        eventsMs.push({ timeMs: 0, text: '' }); // Start with blank at time 0

        segments.forEach(seg => {
          const startMs = Math.max(0, Math.round(seg.start * 1000));
          const endMs = Math.max(
            startMs + MIN_DURATION_MS,
            Math.round(seg.end * 1000)
          );

          // Add event for text appearing
          const subtitleText = cueText(
            seg,
            options.outputMode ?? 'dual' // default keeps previous behaviour
          );

          eventsMs.push({ timeMs: startMs, text: subtitleText });
          // Add event for text disappearing
          eventsMs.push({ timeMs: endMs, text: '' });
        });

        // Ensure an event at the exact end with blank text
        const lastKnownEvent = eventsMs.reduce(
          (latest, current) =>
            current.timeMs > latest.timeMs ? current : latest,
          { timeMs: 0, text: '' }
        );
        if (lastKnownEvent.timeMs < videoDurationMs) {
          eventsMs.push({ timeMs: videoDurationMs, text: '' });
        } else if (lastKnownEvent.timeMs > videoDurationMs) {
          lastKnownEvent.timeMs = videoDurationMs;
        }

        eventsMs.sort((a, b) => a.timeMs - b.timeMs);

        // Filter out duplicates / negligible durations
        const uniqueEventsMs: Array<{ timeMs: number; text: string }> = [];
        if (eventsMs.length > 0) {
          uniqueEventsMs.push(eventsMs[0]);
          for (let i = 1; i < eventsMs.length; i++) {
            const prevEvent = uniqueEventsMs[uniqueEventsMs.length - 1];
            const currentEvent = eventsMs[i];
            const timeDiffMs = currentEvent.timeMs - prevEvent.timeMs;

            if (currentEvent.text === prevEvent.text) {
              // Extend previous state
              continue;
            }
            if (timeDiffMs < MIN_DURATION_MS) {
              // Overwrite the previous event if durations are negligible
              if (
                uniqueEventsMs.length > 1 ||
                prevEvent.timeMs !== 0 ||
                prevEvent.text !== ''
              ) {
                prevEvent.text = currentEvent.text;
                continue;
              }
            }
            uniqueEventsMs.push(currentEvent);
          }
        }

        // Ensure final event exactly at videoDurationMs
        if (uniqueEventsMs.length > 0) {
          const finalEvent = uniqueEventsMs[uniqueEventsMs.length - 1];
          if (finalEvent.timeMs < videoDurationMs) {
            if (finalEvent.text !== '') {
              uniqueEventsMs.push({ timeMs: videoDurationMs, text: '' });
            } else {
              uniqueEventsMs.push({ timeMs: videoDurationMs, text: '' });
            }
          } else if (finalEvent.timeMs > videoDurationMs) {
            finalEvent.timeMs = videoDurationMs;
          }
          // Re-filter duplicates if we just pushed a final blank
          const finalFilteredEvents: Array<{ timeMs: number; text: string }> =
            [];
          if (uniqueEventsMs.length > 0) {
            finalFilteredEvents.push(uniqueEventsMs[0]);
            for (let i = 1; i < uniqueEventsMs.length; i++) {
              if (
                uniqueEventsMs[i].timeMs >
                  finalFilteredEvents[finalFilteredEvents.length - 1].timeMs ||
                uniqueEventsMs[i].text !==
                  finalFilteredEvents[finalFilteredEvents.length - 1].text
              ) {
                if (uniqueEventsMs[i].timeMs <= videoDurationMs) {
                  finalFilteredEvents.push(uniqueEventsMs[i]);
                }
              }
            }
          }
          log.info(
            `[RenderWindowHandlers ${operationId}] Created ${finalFilteredEvents.length} unique subtitle state events (ms).`
          );
          uniqueEventsMs.splice(
            0,
            uniqueEventsMs.length,
            ...finalFilteredEvents
          );
        } else {
          log.warn(
            `[RenderWindowHandlers ${operationId}] No unique events generated.`
          );
        }
        // --- End Generate Events ---

        // --- Generate State PNGs (Puppeteer) ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Starting state PNG generation loop...`
        );
        const statePngs: Array<{ path: string; duration: number }> = [];
        const TOTAL_EVENTS = uniqueEventsMs.length;
        const PUPPETEER_STAGE_PERCENT = 10;
        const frameDurationSec = 1 / options.frameRate;

        const FREQUENT_UPDATE_THRESHOLD = 50;

        for (let i = 0; i < TOTAL_EVENTS; i++) {
          const currentEvent = uniqueEventsMs[i];
          const nextEventTimeMs =
            i + 1 < TOTAL_EVENTS
              ? uniqueEventsMs[i + 1].timeMs
              : videoDurationMs;
          const stateDurationMs = nextEventTimeMs - currentEvent.timeMs;
          const subtitleText = currentEvent.text;

          if (stateDurationMs < 1 || currentEvent.timeMs >= videoDurationMs) {
            log.warn(
              `[RenderWindowHandlers ${operationId}] Skipping event ${i} due to negligible duration.`
            );
            continue;
          }

          const stateDurationSec = stateDurationMs / 1000.0;
          const frameCount = Math.round(stateDurationSec / frameDurationSec);
          const snappedDurationSec = Math.max(
            frameDurationSec,
            frameCount * frameDurationSec
          );
          const durationToUse = snappedDurationSec;

          const statePngFileName = `state_${String(i).padStart(5, '0')}.png`;
          const statePngPath = path.join(tempDirPath, statePngFileName);

          try {
            // 1. Update text
            await page.evaluate(
              ({ txt, fontSize, preset }) => {
                // @ts-ignore
                window.updateSubtitle(txt, {
                  fontSizePx: fontSize,
                  stylePreset: preset,
                });
              },
              {
                txt: subtitleText,
                fontSize: options.fontSizePx,
                preset: options.stylePreset,
              }
            );

            // 2. Capture screenshot
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

            // 3. Store
            statePngs.push({ path: statePngPath, duration: durationToUse });

            // 4. Progress Updates
            const stateProgress =
              ((i + 1) / TOTAL_EVENTS) * PUPPETEER_STAGE_PERCENT;

            // Emit progress more frequently for small jobs or the first 50 states,
            // then revert to every 10 states, and always emit on the very last one.
            if (
              i < FREQUENT_UPDATE_THRESHOLD ||
              (i + 1) % 10 === 0 ||
              i === TOTAL_EVENTS - 1
            ) {
              event.sender.send('merge-subtitles-progress', {
                operationId: operationId,
                percent: Math.round(stateProgress),
                stage: `Rendering subtitle state ${i + 1}/${TOTAL_EVENTS}`,
              });
            }
          } catch (stateError: any) {
            log.error(
              `[RenderWindowHandlers ${operationId}] Error processing state ${i}:`,
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

        event.sender.send('merge-subtitles-progress', {
          operationId: operationId,
          percent: PUPPETEER_STAGE_PERCENT,
          stage: 'Assembling subtitle overlay video...',
        });
        // --- End Generate State PNGs ---

        // --- Close Puppeteer Page ---
        await page.close();
        log.info(
          `[RenderWindowHandlers ${operationId}] Puppeteer page closed.`
        );
        // --- End Close Page ---

        // --- FFmpeg Assembly (With progress callback) ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Preparing for FFmpeg assembly (Optimized)...`
        );
        const tempOverlayVideoPath = path.join(
          tempDirPath,
          `overlay_${operationId}.mov`
        );

        const assemblyProgressCallback: ProgressCallback = progressData => {
          event.sender.send('merge-subtitles-progress', {
            operationId: operationId,
            ...progressData,
          });
        };

        const assemblyResult = await assembleClipsFromStates(
          statePngs,
          tempOverlayVideoPath,
          options.frameRate,
          operationId,
          assemblyProgressCallback
        );

        const originalVideoPath = options.originalVideoPath;
        if (!originalVideoPath) {
          throw new Error('Original video path was not provided.');
        }

        // [ADDED] Decide which "video" to feed into the final merge
        let videoForMerge = originalVideoPath;
        if (options.overlayMode === 'blackVideo') {
          const ffmpegService = new FFmpegService(app.getPath('temp')); // or your DI/injection
          const blackVidPath = path.join(
            tempDirPath,
            `black_${operationId}.mp4`
          );

          log.info(
            `[RenderWindowHandlers ${operationId}] Creating silent black video at: ${blackVidPath}`
          );

          // Create a black video with the desired resolution and duration
          await ffmpegService.makeBlackVideo({
            out: blackVidPath,
            w: options.videoWidth,
            h: options.videoHeight,
            fps: options.frameRate,
            dur: options.videoDuration,
          });

          videoForMerge = blackVidPath;
        }

        if (!assemblyResult.success || !assemblyResult.outputPath) {
          throw new Error(
            assemblyResult.error || 'Optimized FFmpeg assembly failed.'
          );
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Optimized FFmpeg assembly successful: ${tempOverlayVideoPath}`
        );

        const finalTempMergedPath = path.join(
          tempDirPath,
          `final_temp_${operationId}.mp4`
        );
        log.info(
          `[RenderWindowHandlers ${operationId}] Preparing final merge into temporary path: ${finalTempMergedPath}`
        );

        event.sender.send('merge-subtitles-progress', {
          operationId: operationId,
          percent: 40,
          stage: 'Merging video and overlay...',
        });

        const mergeProgressCallback: ProgressCallback = progressData => {
          event.sender.send('merge-subtitles-progress', {
            operationId: operationId,
            ...progressData,
          });
        };

        const mergeResult = await mergeVideoAndOverlay({
          baseVideoPath: videoForMerge,
          originalMediaPath: originalVideoPath,
          overlayVideoPath: tempOverlayVideoPath,
          targetSavePath: finalTempMergedPath,
          operationId: operationId,
          videoDuration: options.videoDuration,
          overlayMode: options.overlayMode ?? 'overlayOnVideo', // <-- [ADDED]
          progressCallback: mergeProgressCallback,
        });

        if (!mergeResult.success || !mergeResult.finalOutputPath) {
          throw new Error(
            mergeResult.error ||
              'Final FFmpeg merge into temporary file failed.'
          );
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Final merge successful: ${mergeResult.finalOutputPath}`
        );

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
            `[RenderWindowHandlers ${operationId}] User cancelled saving the final merged video. Cleaning up temp file.`
          );
          await fs
            .unlink(mergeResult.finalOutputPath)
            .catch(err =>
              log.error(`Failed to clean up temp file on cancel: ${err}`)
            );
          event.reply(RENDER_CHANNELS.RESULT, {
            operationId: operationId,
            success: false,
            error: 'Save cancelled by user.',
          });
          return;
        }

        const finalUserSelectedPath = finalSaveDialogResult.filePath;
        log.info(
          `[RenderWindowHandlers ${operationId}] User selected final save path: ${finalUserSelectedPath}`
        );

        // Move the temp merged file
        log.info(
          `[RenderWindowHandlers ${operationId}] Moving ${mergeResult.finalOutputPath} to ${finalUserSelectedPath}`
        );
        try {
          await fs.rename(mergeResult.finalOutputPath, finalUserSelectedPath);
          log.info(
            `[RenderWindowHandlers ${operationId}] Successfully moved merged file.`
          );
        } catch (moveError: any) {
          log.error(
            `[RenderWindowHandlers ${operationId}] Error moving file:`,
            moveError
          );
          throw new Error(
            `Failed to move merged video to final destination: ${moveError.message}`
          );
        }

        // Final result
        event.sender.send('merge-subtitles-progress', {
          operationId: operationId,
          percent: 100,
          stage: 'Merge complete!',
        });
        event.reply(RENDER_CHANNELS.RESULT, {
          operationId: operationId,
          success: true,
          outputPath: finalUserSelectedPath,
        });
        log.info(
          `[RenderWindowHandlers ${operationId}] Sent final success result.`
        );
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
              `[RenderWindowHandlers ${operationId}] Error closing browser:`,
              closeError
            );
          }
        }

        await cleanupTempDir(tempDirPath, operationId);
        log.info(`[RenderWindowHandlers ${operationId}] Cleanup finished.`);

        // O3 suggestion: remove the job from activeRenderJobs
        activeRenderJobs.delete(operationId);
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
    correctPath = path.join(appPath, '..', 'render-host.html');
    log.info(
      `[getRenderHostPath] Development mode path (relative to appPath parent): ${correctPath}`
    );
  }

  return correctPath;
}

// --- Utility Functions ---
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
      `[RenderWindowHandlers ${operationId}] Removing temp directory: ${tempDirPath}`
    );
    await fs.rm(tempDirPath, { recursive: true, force: true });
    log.info(
      `[RenderWindowHandlers ${operationId}] Removed temp directory: ${tempDirPath}`
    );
  } catch (error) {
    log.error(
      `[RenderWindowHandlers ${operationId}] Error removing temp directory:`,
      error
    );
  }
}

async function assembleClipsFromStates(
  statePngs: Array<{ path: string; duration: number }>,
  outputPath: string,
  frameRate: number,
  operationId: string,
  progressCallback?: ProgressCallback
): Promise<{ success: boolean; outputPath: string; error?: string }> {
  log.info(
    `[assembleClipsFromStates ${operationId}] Starting assembly with ${statePngs.length} state PNGs...`
  );

  if (statePngs.length === 0) {
    log.warn(
      `[assembleClipsFromStates ${operationId}] No state PNGs provided.`
    );
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
  const ffmpegPath = 'ffmpeg';

  const ASSEMBLY_START_PERCENT = 10;
  const ASSEMBLY_END_PERCENT = 40;
  const ASSEMBLY_PROGRESS_RANGE = ASSEMBLY_END_PERCENT - ASSEMBLY_START_PERCENT;

  try {
    // Build concat list
    log.info(
      `[assembleClipsFromStates ${operationId}] Writing concat list file: ${concatListPath}`
    );
    let concatContent = 'ffconcat version 1.0\n\n';
    for (const state of statePngs) {
      const relativePath = path
        .relative(tempDirPath, state.path)
        .replace(/\\/g, '/');
      concatContent += `file '${relativePath}'\n`;
      concatContent += `duration ${state.duration.toFixed(6)}\n\n`;
    }
    if (statePngs.length > 0) {
      const lastState = statePngs[statePngs.length - 1];
      const lastRelativePath = path
        .relative(tempDirPath, lastState.path)
        .replace(/\\/g, '/');
      concatContent += `\nfile '${lastRelativePath}'\n`;
    }

    await fs.writeFile(concatListPath, concatContent, 'utf8');
    log.info(`[assembleClipsFromStates ${operationId}] Concat list created.`);

    // Spawn FFmpeg
    log.info(
      `[assembleClipsFromStates ${operationId}] Assembling overlay video to ${outputPath}`
    );
    const totalConcatDuration = statePngs.reduce(
      (sum, st) => sum + st.duration,
      0
    );

    await new Promise<void>((resolveConcat, rejectConcat) => {
      const concatProcess = spawn(ffmpegPath, [
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-c:v',
        'prores_ks',
        '-profile:v',
        '4444',
        '-pix_fmt',
        'yuva444p10le',
        '-r',
        frameRate.toString(),
        '-progress',
        'pipe:1',
        '-y',
        outputPath,
      ]);

      // O3 suggestion: track this FFmpeg process
      activeRenderJobs.get(operationId)?.processes.push(concatProcess);

      let stdoutData = '';
      let stderrData = '';
      let lastProgressReportTime = 0;
      const progressUpdateInterval = 500; // ms

      concatProcess.stdout.on('data', (data: Buffer) => {
        stdoutData += data.toString();
        const lines = stdoutData.split('\n');
        stdoutData = lines.pop() || '';

        lines.forEach(line => {
          if (line.startsWith('out_time_ms=')) {
            const timeMs = parseInt(line.split('=')[1], 10);
            if (!isNaN(timeMs) && totalConcatDuration > 0) {
              const currentTime = timeMs / 1_000_000;
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
                  stage: `Assembling overlay video... (${Math.round(
                    currentProgress
                  )}%)`,
                });
              }
            }
          }
        });
      });

      concatProcess.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString();
      });

      concatProcess.on('error', err => {
        stderrData = stderrData.slice(-1024);
        rejectConcat(
          new Error(
            `FFmpeg concat error: ${err.message}\nStderr (Last 1KB): ${stderrData}`
          )
        );
      });

      concatProcess.on('close', code => {
        if (code === 0) {
          progressCallback?.({
            operationId,
            percent: ASSEMBLY_END_PERCENT,
            stage: 'Overlay assembly complete',
          });
          resolveConcat();
        } else {
          stderrData = stderrData.slice(-1024);
          rejectConcat(
            new Error(
              `FFmpeg concat exited with code ${code}\nStderr (Last 1KB): ${stderrData}`
            )
          );
        }
      });
    });

    log.info(
      `[assembleClipsFromStates ${operationId}] Concatenation successful.`
    );
    return { success: true, outputPath };
  } catch (error: any) {
    log.error(`[assembleClipsFromStates ${operationId}] Failed:`, error);
    progressCallback?.({
      operationId,
      percent: ASSEMBLY_END_PERCENT,
      stage: 'Assembly failed',
      error: error.message || 'Unknown assembly error',
    });
    return {
      success: false,
      outputPath: '',
      error: error.message || 'Unknown assembly error',
    };
  } finally {
    // Cleanup concat list
    log.info(
      `[assembleClipsFromStates ${operationId}] Cleaning up concat list file...`
    );
    await fs.unlink(concatListPath).catch(err => {
      if (err.code !== 'ENOENT') {
        log.warn(`Failed to delete concat list: ${err.message}`);
      }
    });
  }
}

interface MergeVideoAndOverlayOptions {
  baseVideoPath: string;
  originalMediaPath: string;
  overlayVideoPath: string;
  targetSavePath: string;
  overlayMode: 'overlayOnVideo' | 'blackVideo';
  operationId: string;
  videoDuration: number;
  progressCallback?: ProgressCallback;
}

async function mergeVideoAndOverlay(
  options: MergeVideoAndOverlayOptions
): Promise<{ success: boolean; finalOutputPath: string; error?: string }> {
  const {
    baseVideoPath,
    originalMediaPath,
    overlayVideoPath,
    targetSavePath,
    overlayMode,
    operationId,
    videoDuration,
    progressCallback,
  } = options;

  log.info(
    `[mergeVideoAndOverlay ${operationId}] Starting final merge. Duration: ${videoDuration}s.`
  );

  // same progress-range code as before, if you have it:
  const MERGE_START_PERCENT = 40;
  const MERGE_END_PERCENT = 100;
  const MERGE_PROGRESS_RANGE = MERGE_END_PERCENT - MERGE_START_PERCENT;

  // ensure overlay exists, etc...
  if (!(await fs.stat(overlayVideoPath).catch(() => false))) {
    progressCallback?.({
      operationId,
      percent: MERGE_START_PERCENT,
      stage: 'Merge failed: Overlay file missing',
      error: `Overlay file not found: ${overlayVideoPath}`,
    });
    throw new Error(`Overlay file not found: ${overlayVideoPath}`);
  }

  // Decide which FFmpeg arguments to use based on overlayMode
  // ---------------------------------------------------------
  let videoCodec = 'libx264';
  const outputPixFmtArgs: string[] = [];

  if (os.platform() === 'darwin') {
    log.info(
      `[mergeVideoAndOverlay ${operationId}] macOS detected, using h264_videotoolbox.`
    );
    videoCodec = 'h264_videotoolbox';
    outputPixFmtArgs.push('-pix_fmt', 'yuv420p');
  } else {
    log.info(
      `[mergeVideoAndOverlay ${operationId}] Using software encoder libx264.`
    );
  }

  // [CHANGED] Two different sets of inputs/filter mappings:
  const ffmpegArgs =
    overlayMode === 'overlayOnVideo'
      ? [
          // "overlayOnVideo" → burn alpha overlay on top of the real video
          '-i',
          baseVideoPath, // real video w/ audio
          '-i',
          overlayVideoPath, // alpha overlay
          '-filter_complex',
          '[0:v][1:v]overlay=format=auto[out]',
          '-map',
          '[out]',
          '-map',
          '0:a?', // copy audio from the real file
          '-c:a',
          'copy',
          '-c:v',
          videoCodec,
          ...outputPixFmtArgs,
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-progress',
          'pipe:1',
          '-y',
          targetSavePath,
        ]
      : [
          // "blackVideo" → burn alpha overlay on top of silent black video,
          // then inject original audio from the real file
          '-i',
          baseVideoPath, // black video (silent)
          '-i',
          overlayVideoPath, // alpha overlay
          '-i',
          originalMediaPath, // real file for audio
          '-filter_complex',
          '[0:v][1:v]overlay=format=auto[out]',
          '-map',
          '[out]',
          '-map',
          '2:a', // i.e. "third input" is the real file audio
          '-c:a',
          'copy',
          '-c:v',
          videoCodec,
          ...outputPixFmtArgs,
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-progress',
          'pipe:1',
          '-y',
          targetSavePath,
        ];

  log.info(
    `[mergeVideoAndOverlay ${operationId}] FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`
  );

  return new Promise((resolve, reject) => {
    const ffmpegPath = 'ffmpeg';
    const mergeProcess = spawn(ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // track the process in activeRenderJobs, as you do
    activeRenderJobs.get(operationId)?.processes.push(mergeProcess);

    let stdoutData = '';
    let stderrData = '';
    let lastProgressReportTime = 0;
    const progressUpdateInterval = 500;

    mergeProcess.stdout.on('data', (data: Buffer) => {
      stdoutData += data.toString();
      const lines = stdoutData.split('\n');
      stdoutData = lines.pop() || '';

      lines.forEach(line => {
        if (line.startsWith('out_time_ms=')) {
          const timeMs = parseInt(line.split('=')[1], 10);
          if (!isNaN(timeMs) && videoDuration > 0) {
            const currentTime = timeMs / 1_000_000;
            const currentProgress = (currentTime / videoDuration) * 100;
            const overallPercent = Math.round(
              MERGE_START_PERCENT +
                (currentProgress * MERGE_PROGRESS_RANGE) / 100
            );
            const now = Date.now();
            if (
              now - lastProgressReportTime > progressUpdateInterval ||
              overallPercent >= MERGE_END_PERCENT - 1
            ) {
              lastProgressReportTime = now;
              progressCallback?.({
                operationId,
                percent: Math.min(MERGE_END_PERCENT - 1, overallPercent),
                stage: `Merging video... (${Math.round(currentProgress)}%)`,
              });
            }
          }
        }
      });
    });

    mergeProcess.stderr.on('data', (data: Buffer) => {
      stderrData += data.toString();
    });

    mergeProcess.on('error', err => {
      stderrData = stderrData.slice(-1024); // last 1KB
      log.error(
        `[mergeVideoAndOverlay ${operationId}] FFmpeg spawn error:`,
        err
      );
      progressCallback?.({
        operationId,
        percent: MERGE_START_PERCENT,
        stage: 'Merge failed (spawn error)',
        error: err.message,
      });
      reject(
        new Error(
          `FFmpeg spawn error: ${err.message}\nStderr (Last 1KB): ${stderrData}`
        )
      );
    });

    mergeProcess.on('close', code => {
      log.info(
        `[mergeVideoAndOverlay ${operationId}] FFmpeg process exited with code ${code}.`
      );
      if (code === 0) {
        log.info(
          `[mergeVideoAndOverlay ${operationId}] Merge successful: ${targetSavePath}`
        );
        resolve({ success: true, finalOutputPath: targetSavePath });
      } else {
        stderrData = stderrData.slice(-1024);
        log.error(
          `[mergeVideoAndOverlay ${operationId}] Merge failed (exit code ${code}).`
        );
        progressCallback?.({
          operationId,
          percent: MERGE_END_PERCENT,
          stage: 'Merge failed',
          error: `FFmpeg exited with code ${code}`,
        });
        reject(
          new Error(
            `Final merge failed. Exit code: ${code}\nStderr (Last 1KB): ${stderrData}`
          )
        );
      }
    });
  });
}
