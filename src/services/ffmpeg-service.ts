import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises'; // Import promises version
import { app } from 'electron';
import log from 'electron-log';
// import ffmpegPath from '@ffmpeg-installer/ffmpeg'; // No longer needed
// import ffprobePath from '@ffprobe-installer/ffprobe'; // No longer needed
import os from 'os';
import nodeProcess from 'process'; // Use alias to avoid conflict with ChildProcess type
import { createRequire } from 'module'; // <-- Import createRequire
// Import the helper and type
import {
  ASS_STYLE_PRESETS,
  AssStylePresetKey,
} from '../shared/constants/subtitle-styles.js';
import { v4 as uuidv4 } from 'uuid'; // Import uuid for unique directory names
import { cancellationService } from './cancellation-service.js';

export class FFmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FFmpegError';
  }
}

export class FFmpegService {
  private ffmpegPath: string;
  private ffprobePath: string;
  private tempDir: string;
  // private activeProcesses: Map<string, ChildProcessWithoutNullStreams> = // No longer needed
  //   new Map();

  constructor() {
    const require = createRequire(import.meta.url);
    try {
      // Use the module's own path property
      this.ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
      this.ffprobePath = require('@ffprobe-installer/ffprobe').path;
      log.info(`FFmpeg path (from module): ${this.ffmpegPath}`);
      log.info(`FFprobe path (from module): ${this.ffprobePath}`);

      // Fix paths for packaged app - replace app.asar with app.asar.unpacked
      if (app.isPackaged) {
        this.ffmpegPath = this.ffmpegPath.replace(
          'app.asar/',
          'app.asar.unpacked/'
        );
        this.ffprobePath = this.ffprobePath.replace(
          'app.asar/',
          'app.asar.unpacked/'
        );
        log.info(`Adjusted FFmpeg path: ${this.ffmpegPath}`);
        log.info(`Adjusted FFprobe path: ${this.ffprobePath}`);
      }

      // Verify paths exist
      if (!fs.existsSync(this.ffmpegPath)) {
        log.error(`Resolved ffmpeg path does not exist: ${this.ffmpegPath}`);
        throw new Error(
          `Resolved ffmpeg path check failed: ${this.ffmpegPath}`
        );
      }
      if (!fs.existsSync(this.ffprobePath)) {
        log.error(`Resolved ffprobe path does not exist: ${this.ffprobePath}`);
        throw new Error(
          `Resolved ffprobe path check failed: ${this.ffprobePath}`
        );
      }
    } catch (error: any) {
      log.error(`Failed to initialize FFmpegService paths: ${error.message}`);
      log.error(`Error stack: ${error.stack}`); // Log stack for better debug
      this.ffmpegPath = 'ffmpeg'; // Fallback to system path
      this.ffprobePath = 'ffprobe';
      log.warn(
        'Falling back to system paths for ffmpeg/ffprobe due to initialization error.'
      );
    }

    // Determine temp directory based on OS and packaging status
    this.tempDir = this.determineTempDir();
    this.ensureTempDirSync();

    log.info(`FFmpegService initialized. Temp dir: ${this.tempDir}`);
  }

  private determineTempDir(): string {
    // Use app.getPath('userData')/temp in packaged apps for a standard, persistent location
    if (app.isPackaged) {
      const userDataTemp = path.join(app.getPath('userData'), 'temp');
      log.info(`Packaged mode, using userData temp dir: ${userDataTemp}`);
      return userDataTemp;
    } else {
      // Use OS temp dir in development
      const osTemp = os.tmpdir();
      log.info(`Development mode, using OS temp dir: ${osTemp}`);
      return osTemp;
    }
  }

  // Ensure sync version exists if called in constructor
  private ensureTempDirSync(): void {
    try {
      if (!fs.existsSync(this.tempDir)) {
        log.info(`Creating temp directory: ${this.tempDir}`);
        fs.mkdirSync(this.tempDir, { recursive: true });
      } else {
        log.info(`Temp directory already exists: ${this.tempDir}`);
      }
    } catch (error) {
      log.error(`Failed to ensure temp directory ${this.tempDir}:`, error);
      // Consider throwing or handling this more gracefully
      throw new Error(
        `Failed to create or access temp directory: ${this.tempDir}`
      );
    }
  }

  getTempDir(): string {
    return this.tempDir;
  }

  getFFmpegPath(): string {
    return this.ffmpegPath;
  }

  getFFprobePath(): string {
    return this.ffprobePath;
  }

  async extractAudio(
    videoPath: string,
    progressCallback?: (progress: { percent: number; stage: string }) => void,
    operationId?: string,
    signal?: AbortSignal
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new FFmpegError(`Input video file not found: ${videoPath}`);
    }

    const outputPath = path.join(
      this.tempDir,
      `${path.basename(videoPath, path.extname(videoPath))}_audio.mp3`
    );

    // --- Attach signal listener if provided --- START ---
    const abortHandler = () => {
      log.info(
        `[extractAudio/${operationId}] Abort signal received! Attempting to cancel via service.`
      );
      if (operationId) {
        cancellationService.cancelOperation(operationId);
      }
    };
    if (signal) {
      if (signal.aborted) {
        // If already aborted before starting, throw immediately
        log.info(
          `[extractAudio/${operationId}] Operation already cancelled before starting extraction.`
        );
        throw new Error('Operation cancelled');
      }
      signal.addEventListener('abort', abortHandler);
    }
    // --- Attach signal listener if provided --- END ---

    try {
      // Report initial progress
      progressCallback?.({
        percent: 1,
        stage: 'Analyzing video file (this usually takes 10-15 seconds)...',
      });

      // First, get the video stats
      const stats = fs.statSync(videoPath);
      const fileSizeMB = Math.round(stats.size / (1024 * 1024));

      // Get video duration
      const duration = await this.getMediaDuration(videoPath);
      const durationMin = Math.round(duration / 60);

      // Estimate extraction time (rough heuristic - better than nothing)
      let estimatedTimeSeconds = Math.round(duration * 0.1); // Assume 10x faster than realtime
      if (fileSizeMB > 1000) estimatedTimeSeconds *= 1.5; // Larger files take longer

      // Calculate a better progress percentage distribution
      const ANALYSIS_END = 3;
      const PREP_END = 5;
      const EXTRACTION_START = 5;
      const EXTRACTION_END = 10;

      progressCallback?.({
        percent: ANALYSIS_END,
        stage: `Preparing audio extraction for ${fileSizeMB} MB video (${durationMin} min)...`,
      });

      // Get video metadata for optimization
      const resolution = await this.getVideoResolution(videoPath).catch(() => ({
        width: 1280,
        height: 720,
      }));
      const isHighRes = resolution.width > 1920 || resolution.height > 1080;

      progressCallback?.({
        percent: PREP_END,
        stage: `Starting audio extraction (estimated time: ${Math.round(estimatedTimeSeconds / 60)} min)...`,
      });

      // Optimize extraction parameters based on video size
      const audioQuality = isHighRes ? '4' : '2'; // Lower quality for faster extraction on high-res videos
      const audioRate = '16000'; // 16kHz is sufficient for speech recognition

      // Track time to provide better estimates in future
      const startTime = Date.now();

      // Capture last progress update to avoid repeating the same percentage
      let lastProgressPercent = EXTRACTION_START;

      await this.runFFmpeg(
        [
          '-i',
          videoPath,
          '-vn', // No video
          '-acodec',
          'libmp3lame',
          '-q:a',
          audioQuality,
          '-ar',
          audioRate, // Audio sample rate
          '-ac',
          '1', // Mono audio (sufficient for transcription)
          '-progress',
          'pipe:1', // Output progress to stdout
          '-y', // Overwrite output without asking
          outputPath,
        ],
        operationId,
        duration,
        ffmpegProgress => {
          // Scale FFmpeg progress to our desired range (5-10%)
          const scaledPercent =
            EXTRACTION_START +
            (ffmpegProgress * (EXTRACTION_END - EXTRACTION_START)) / 100;

          // Only update if progress has changed by at least 0.5%
          if (scaledPercent - lastProgressPercent >= 0.5) {
            lastProgressPercent = scaledPercent;

            // Calculate elapsed and estimated remaining time
            const elapsedMs = Date.now() - startTime;
            const elapsedSec = Math.round(elapsedMs / 1000);

            let timeMessage = '';
            if (ffmpegProgress > 0) {
              const totalEstimatedSec = Math.round(
                elapsedSec / (ffmpegProgress / 100)
              );
              const remainingSec = Math.max(0, totalEstimatedSec - elapsedSec);

              if (remainingSec > 60) {
                timeMessage = ` (~ ${Math.round(remainingSec / 60)} min remaining)`;
              } else {
                timeMessage = ` (~ ${remainingSec} sec remaining)`;
              }
            }

            progressCallback?.({
              percent: Math.min(EXTRACTION_END, scaledPercent),
              stage: `Extracting audio: ${Math.round(ffmpegProgress)}%${timeMessage}`,
            });
          }
        }
      );

      // Make sure there's a final update to exactly 10% before transitioning to next stage
      progressCallback?.({
        percent: EXTRACTION_END,
        stage: 'Audio extraction complete, preparing for transcription...',
      });

      return outputPath;
    } catch (error) {
      log.error(
        `[extractAudio${operationId ? `/${operationId}` : ''}] Error:`,
        error
      );
      // Check if the error is due to our explicit cancellation
      if (error instanceof Error && error.message === 'Operation cancelled') {
        log.info(`[extractAudio/${operationId}] Caught cancellation error.`);
        throw error; // Re-throw the specific cancellation error
      }
      // Handle other FFmpeg errors
      throw error; // Re-throw other errors
    } finally {
      // --- Remove signal listener --- START ---
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      // --- Remove signal listener --- END ---
    }
  }

  async getMediaDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.ffprobePath, [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);

      let output = '';

      process.stdout.on('data', data => {
        output += data.toString();
      });

      process.stderr.on('data', data => {
        log.error(`FFprobe stderr for duration check: ${data}`);
      });

      process.on('close', code => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          if (isNaN(duration)) {
            reject(new FFmpegError('Could not parse media duration'));
          } else {
            resolve(duration);
          }
        } else {
          reject(new FFmpegError(`FFprobe process exited with code ${code}`));
        }
      });

      process.on('error', err => {
        reject(new FFmpegError(`FFprobe error: ${err.message}`));
      });
    });
  }

  async getVideoResolution(
    filePath: string
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.ffprobePath, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=s=x:p=0',
        filePath,
      ]);

      let output = '';
      process.stdout.on('data', data => {
        output += data.toString();
      });

      process.stderr.on('data', data => {
        log.error(`FFprobe stderr for resolution check: ${data}`);
      });

      process.on('close', code => {
        if (code === 0) {
          const [width, height] = output.trim().split('x').map(Number);
          if (!isNaN(width) && !isNaN(height)) {
            resolve({ width, height });
          } else {
            reject(new FFmpegError('Could not parse video resolution'));
          }
        } else {
          reject(new FFmpegError(`FFprobe process exited with code ${code}`));
        }
      });

      process.on('error', err => {
        reject(new FFmpegError(`FFprobe error: ${err.message}`));
      });
    });
  }

  async validateOutputFile(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new FFmpegError(`Output file was not created: ${filePath}`);
    }

    try {
      // Check file size first, it's faster
      const stats = fs.statSync(filePath);
      if (stats.size < 1000) {
        // Use a smaller threshold, e.g., 1KB
        throw new FFmpegError(`Output file is too small: ${stats.size} bytes`);
      }

      // Now check duration
      const duration = await this.getMediaDuration(filePath);
      if (isNaN(duration) || duration <= 0) {
        throw new FFmpegError('Invalid output file: duration is invalid');
      }
    } catch (error: unknown) {
      // If validation fails, try to delete the invalid file
      try {
        await fsp.unlink(filePath);
        log.info(`Deleted invalid output file: ${filePath}`);
      } catch (unlinkError) {
        log.error(
          `Failed to delete invalid output file ${filePath}:`,
          unlinkError
        );
      }
      throw new FFmpegError(
        `Invalid output file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async mergeSubtitles(
    videoPath: string,
    subtitlesPath: string,
    outputPath: string,
    operationId: string,
    fontSize: number = 40,
    stylePreset: AssStylePresetKey = 'Default',
    progressCallback?: (progress: { percent: number; stage: string }) => void
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new FFmpegError(`Input video file does not exist: ${videoPath}`);
    }
    if (!fs.existsSync(subtitlesPath)) {
      throw new FFmpegError(`Subtitle file does not exist: ${subtitlesPath}`);
    }

    let tempAssPath: string | null = null;

    try {
      log.info(
        `[${operationId}] Starting subtitle merge (Font: ${fontSize}, Style: ${stylePreset})`
      );
      log.info(`[${operationId}] Video path: ${videoPath}`);
      log.info(`[${operationId}] Original Subtitles path: ${subtitlesPath}`);
      log.info(`[${operationId}] Using provided output path: ${outputPath}`);

      // Get video info early
      const duration = await this.getMediaDuration(videoPath);
      log.info(`[${operationId}] Video duration: ${duration} seconds`);

      // --- Prepare Styled ASS --- START
      progressCallback?.({ percent: 5, stage: 'Preparing subtitle style' });
      tempAssPath = await this.prepareStyledAss(
        subtitlesPath,
        fontSize,
        stylePreset,
        operationId
      );
      log.info(`[${operationId}] Prepared styled ASS file: ${tempAssPath}`);
      progressCallback?.({ percent: 10, stage: 'Applying subtitle style' });
      // --- Prepare Styled ASS --- END

      // --- Determine Font Path --- START
      const isDev = !app.isPackaged;
      const relativeFontPath = isDev ? 'assets/fonts' : 'fonts';
      const fontsDir = path.join(
        isDev ? app.getAppPath() : nodeProcess.resourcesPath, // Use alias here
        relativeFontPath
      );
      log.info(`[${operationId}] Determined fonts directory: ${fontsDir}`);

      // --- Prepare Environment for FFmpeg --- START
      const env = { ...nodeProcess.env }; // Use alias here
      const fontsConfPath = path.join(fontsDir, 'fonts.conf');

      if (nodeProcess.platform !== 'win32' && fs.existsSync(fontsConfPath)) {
        // On Linux/macOS, set FONTCONFIG_FILE if fonts.conf exists
        env.FONTCONFIG_FILE = fontsConfPath;
        log.info(`[${operationId}] Setting FONTCONFIG_FILE=${fontsConfPath}`);
      } else if (nodeProcess.platform !== 'win32') {
        log.warn(
          `[${operationId}] fonts.conf not found at ${fontsConfPath}, Fontconfig might not use bundled fonts.`
        );
      }
      // --- Prepare Environment for FFmpeg --- END

      // --- Prepare FFmpeg Subtitle Filter --- START
      // Escape path for FFmpeg filter graph complex syntax
      const escapedAssPath = tempAssPath!
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:');

      // Define the subtitle filter *without* fontdir, relying on FONTCONFIG_FILE env var
      const subtitleFilter = `subtitles='${escapedAssPath}':force_style='FontName=Arial,FontSize=${fontSize}'`;
      log.info(
        `[${operationId}] Using more direct subtitle filter: ${subtitleFilter}`
      );
      // --- Prepare FFmpeg Subtitle Filter --- END

      const ffmpegArgs = [
        '-y',
        '-loglevel',
        'level+verbose',
        '-i',
        videoPath,
        '-vf',
        subtitleFilter, // Use filter with fontdir
        '-c:v',
        'libx264',
        '-preset',
        'medium', // Faster preset for quicker feedback, adjust if needed
        '-crf',
        '20', // Slightly higher CRF for faster encoding, adjust if needed
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac', // Copy audio stream if possible for speed? Let's stick to re-encoding for now.
        '-b:a',
        '160k', // Slightly lower audio bitrate
        outputPath,
      ];

      log.info(`[${operationId}] FFmpeg arguments: ${ffmpegArgs.join(' ')}`);

      // Log subtitle file contents for debugging
      try {
        const assContent = await fsp.readFile(tempAssPath!, 'utf-8');
        log.info(
          `[${operationId}] Styled ASS content (first 500 chars): ${assContent.substring(0, 500)}`
        );
      } catch (err) {
        log.warn(`[${operationId}] Couldn't read ASS file for logging: ${err}`);
      }

      // Verify subtitle file exists right before execution
      if (!fs.existsSync(tempAssPath!)) {
        log.error(
          `[${operationId}] Critical: ASS file doesn't exist right before FFmpeg execution!`
        );
        throw new Error(
          `Subtitle file missing before execution: ${tempAssPath}`
        );
      }

      progressCallback?.({ percent: 15, stage: 'Starting video encoding' });

      try {
        await this.runFFmpeg(
          ffmpegArgs,
          operationId,
          duration,
          progress => {
            if (progressCallback) {
              // Scale ffmpeg progress (0-100) to the range 15-95
              const scaledProgress = 15 + progress * 0.8;
              progressCallback({
                percent: Math.min(95, scaledProgress),
                stage: 'Encoding video with subtitles',
              });
            }
          },
          env
        );

        // If we got here, the process completed successfully (either normally or by cancellation)
        progressCallback?.({ percent: 98, stage: 'Validating output file' });

        // Only validate if the output file exists (it won't if cancelled)
        if (fs.existsSync(outputPath)) {
          await this.validateOutputFile(outputPath);
          log.info(
            `[${operationId}] Subtitle merge process completed successfully.`
          );
          progressCallback?.({ percent: 100, stage: 'Merge complete' });
          return outputPath;
        } else {
          log.info(
            `[${operationId}] Merge was cancelled, output file doesn't exist.`
          );
          progressCallback?.({ percent: 100, stage: 'Merge cancelled' });
          return ''; // Return empty string to indicate cancellation
        }
      } catch (ffmpegError) {
        // Check if the process was cancelled (we can tell by checking if the process still exists in cancellationService)
        if (!cancellationService.isOperationActive(operationId)) {
          log.info(
            `[${operationId}] FFmpeg process was cancelled, treating as successful cancellation.`
          );
          progressCallback?.({ percent: 100, stage: 'Merge cancelled' });
          return ''; // Return empty string to indicate cancellation
        }

        // If not cancelled, rethrow the error
        throw ffmpegError;
      }
    } catch (error) {
      log.error(`[${operationId}] Error during subtitle merge:`, error);
      progressCallback?.({ percent: 0, stage: 'Merge failed' });
      throw new FFmpegError(
        `Failed to merge subtitles: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // --- Cleanup Temporary ASS File --- START
      if (tempAssPath && fs.existsSync(tempAssPath)) {
        try {
          await fsp.unlink(tempAssPath);
          log.info(
            `[${operationId}] Cleaned up temporary ASS file: ${tempAssPath}`
          );
        } catch (cleanupError) {
          log.warn(
            `[${operationId}] Failed to clean up temporary ASS file ${tempAssPath}:`,
            cleanupError
          );
        }
      }
      // --- Cleanup Temporary ASS File --- END
    }
  }

  private async prepareStyledAss(
    originalSubtitlePath: string,
    fontSize: number,
    stylePreset: AssStylePresetKey,
    operationId: string
  ): Promise<string> {
    const tempAssPath = path.join(
      this.tempDir,
      `styled_${operationId}_${Date.now()}.ass`
    );
    log.info(
      `[${operationId}] Creating temporary styled ASS at: ${tempAssPath}`
    );

    // Get the style line using the helper function
    const styleLine = ASS_STYLE_PRESETS[stylePreset]
      .replace('{fontSize}', fontSize.toString())
      .replace('{fontName}', 'Arial');

    const assHeader = `[Script Info]
; Script generated by Translator Electron App
Title: Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine} // Use the generated style line

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    try {
      const originalContent = await fsp.readFile(originalSubtitlePath, 'utf-8');
      let assEvents = '';

      const originalExt = path.extname(originalSubtitlePath).toLowerCase();

      if (originalExt === '.srt') {
        // Convert SRT to ASS Events
        const blocks = originalContent.trim().split(/\r?\n\r?\n/);
        for (const block of blocks) {
          const lines = block.trim().split(/\r?\n/);
          if (lines.length < 3) continue; // Skip invalid blocks

          const timeLine = lines[1];
          const textLines = lines.slice(2);

          const timeMatch = timeLine?.match(
            /(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/
          );

          if (timeMatch) {
            const start = this.formatAssTime(timeMatch[1]);
            const end = this.formatAssTime(timeMatch[2]);
            // Replace SRT newlines with ASS \N and escape ASS special chars {, }
            const text = textLines
              .join('\\N')
              .replace(/\{/g, '\\{')
              .replace(/\}/g, '\\}');
            assEvents += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
          }
        }
      } else if (originalExt === '.ass') {
        // Extract existing events if it's already ASS
        const eventsMatch = originalContent.match(/\n\[Events\]\r?\n(.*)/is); // Use 's' flag for dotall
        if (eventsMatch && eventsMatch[1]) {
          // Just take the events part, the header will be replaced
          assEvents = eventsMatch[1].trim() + '\n';
        } else {
          log.warn(
            `[${operationId}] Could not extract events from existing ASS file: ${originalSubtitlePath}`
          );
          // Optionally, try a simpler regex or proceed with empty events
          assEvents = ''; // Fallback to empty if parsing fails
        }
      } else {
        throw new Error(
          `Unsupported subtitle format for styling: ${originalExt}`
        );
      }

      const finalAssContent = assHeader + assEvents;
      await fsp.writeFile(tempAssPath, finalAssContent, 'utf-8');
      log.info(
        `[${operationId}] Successfully wrote styled ASS file: ${tempAssPath}`
      );
      return tempAssPath;
    } catch (error) {
      log.error(
        `[${operationId}] Error preparing styled ASS file: ${error instanceof Error ? error.message : String(error)}`
      );
      // Attempt to clean up potentially partially written file
      if (fs.existsSync(tempAssPath)) {
        try {
          await fsp.unlink(tempAssPath);
        } catch {
          /* ignore cleanup error */
        }
      }
      throw error; // Rethrow to be caught by mergeSubtitles
    }
  }

  // Helper to convert SRT time (00:00:00,000) or (0:00:00.000) to ASS time (0:00:00.00)
  private formatAssTime(srtTime: string): string {
    const timeWithDot = srtTime.replace(',', '.');
    // Match H:MM:SS.ms
    const match = timeWithDot.match(/(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})/);
    if (!match) {
      log.warn(`Could not parse SRT time format: ${srtTime}`);
      return '0:00:00.00'; // Fallback
    }
    const [, hours, minutes, seconds, milliseconds] = match;
    // Convert milliseconds to centiseconds (hundredths of a second)
    const centiseconds = Math.round(
      parseInt(milliseconds.padEnd(3, '0'), 10) / 10
    )
      .toString()
      .padStart(2, '0');

    return `${parseInt(hours, 10)}:${minutes}:${seconds}.${centiseconds}`;
  }

  private runFFmpeg(
    args: string[],
    operationId?: string,
    totalDuration?: number,
    progressCallback?: (progress: number) => void,
    env?: NodeJS.ProcessEnv
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const spawnOptions = {
        env: env || nodeProcess.env,
        cwd: this.tempDir, // Explicitly set CWD to the temp directory
      };
      log.info(
        `[${operationId || 'ffmpeg'}] Spawning FFmpeg with: `,
        `\n  Command: ${this.ffmpegPath}`,
        `\n  Args: ${JSON.stringify(args)}`,
        `\n  Options: ${JSON.stringify(spawnOptions)}`
      );

      const ffmpegProcess = spawn(this.ffmpegPath, args, spawnOptions);

      // Track if this operation is being cancelled
      let isCancelling = false;

      if (operationId) {
        // Register process with cancellation service
        cancellationService.registerProcess(operationId, ffmpegProcess);
        log.info(
          `[${operationId}] FFmpeg process started (PID: ${ffmpegProcess.pid})`
        );
      } else {
        log.info(`FFmpeg process started (PID: ${ffmpegProcess.pid})`);
      }

      let stderrOutput = '';

      ffmpegProcess.stdout.on('data', (data: Buffer) => {
        log.info(`FFmpeg stdout: ${data.toString()}`);
      });

      ffmpegProcess.stderr.on('data', (data: Buffer) => {
        const line = data.toString();
        // --- CHANGED: Log every stderr line using console.log --- START ---
        const lines = line.split(/\r?\n/);
        lines.forEach(singleLine => {
          if (singleLine.trim()) {
            // Avoid logging empty lines
            log.info(`[FFmpeg STDERR] ${singleLine.trim()}`); // Changed to log.info
          }
        });
        // --- CHANGED: Log every stderr line using console.log --- END ---
        stderrOutput += line;

        if (totalDuration && progressCallback) {
          try {
            // Check each line for time information
            let updated = false;
            lines.forEach(singleLine => {
              // Use a more robust regex pattern for time that matches both formats: HH:MM:SS.ms and frame=X time=HH:MM:SS.ms
              const timeMatch = singleLine.match(
                /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/
              );
              if (timeMatch) {
                const hours = parseInt(timeMatch[1], 10);
                const minutes = parseInt(timeMatch[2], 10);
                const seconds = parseInt(timeMatch[3], 10);
                const centiseconds = parseInt(timeMatch[4], 10);
                const currentTime =
                  hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
                const progressPercent = Math.min(
                  100,
                  Math.max(0, (currentTime / totalDuration) * 100)
                );

                log.info(
                  `[FFmpeg Progress Callback Invoked] OpID: ${operationId || 'N/A'} | CurrentTime: ${currentTime.toFixed(2)}s | TotalDuration: ${totalDuration?.toFixed(2)}s | Percent: ${progressPercent.toFixed(2)}%`
                );
                progressCallback(progressPercent);
                updated = true;
              }
            });

            // If we couldn't find the time in individual lines, try the accumulated output as before
            if (!updated) {
              const match = stderrOutput.match(
                /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/
              );
              if (match) {
                const hours = parseInt(match[1], 10);
                const minutes = parseInt(match[2], 10);
                const seconds = parseInt(match[3], 10);
                const centiseconds = parseInt(match[4], 10);
                const currentTime =
                  hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
                const progressPercent = Math.min(
                  100,
                  Math.max(0, (currentTime / totalDuration) * 100)
                );

                log.info(
                  `[FFmpeg Progress Callback Invoked] OpID: ${operationId || 'N/A'} | CurrentTime: ${currentTime.toFixed(2)}s | TotalDuration: ${totalDuration?.toFixed(2)}s | Percent: ${progressPercent.toFixed(2)}%`
                );
                progressCallback(progressPercent);
              }
            }
          } catch (e) {
            log.warn('Failed to parse FFmpeg progress line:', e);
          }
        }
      });

      ffmpegProcess.on('close', (code: number | null) => {
        if (operationId) {
          // --- Check the wasCancelled flag set by the CancellationService --- START ---
          // Check if this process was marked as being cancelled
          isCancelling = (ffmpegProcess as any).wasCancelled === true;
          // --- Check the wasCancelled flag set by the CancellationService --- END ---
          // Always unregister when the process ends
          log.info(
            `[${operationId}] FFmpeg process finished (PID: ${ffmpegProcess.pid}) - Was Explicitly Cancelled: ${isCancelling}`
          );
        } else {
          log.info(`FFmpeg process finished (PID: ${ffmpegProcess.pid})`);
        }

        // --- Modify logic for cancellation --- START ---
        if (isCancelling) {
          log.info(
            `FFmpeg process (${ffmpegProcess.pid}) was cancelled externally via service. Rejecting promise.`
          );
          // Reject with a specific error for cancellation
          reject(new Error('Operation cancelled')); // Reject with specific error
        } else if (code === 0) {
          log.info(`FFmpeg process exited successfully (Code: 0)`);
          resolve();
        } else {
          log.error(`FFmpeg process exited with error code ${code}.`);
          log.error(`FFmpeg stderr output:\\n${stderrOutput}`); // Log accumulated stderr on error
          reject(
            new FFmpegError(
              `FFmpeg process exited with code ${code}. Check logs for details.`
            )
          );
        }
        // --- Modify logic for cancellation --- END ---
      });

      ffmpegProcess.on('error', (err: Error) => {
        if (operationId) {
          log.info(
            `[${operationId}] FFmpeg process errored (PID: ${ffmpegProcess.pid})`
          );
        } else {
          log.info(`FFmpeg process errored (PID: ${ffmpegProcess.pid})`);
        }
        log.error(`FFmpeg process error: ${err.message}`);
        reject(new FFmpegError(`FFmpeg process error: ${err.message}`));
      });
    });
  }

  async extractAudioSegment(
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number
  ): Promise<string> {
    const args = [
      '-y', // Overwrite output
      '-i',
      inputPath,
      '-ss',
      startTime.toString(), // Start time
      '-t',
      duration.toString(), // Duration
      '-vn', // No video
      '-acodec',
      'libmp3lame', // Use MP3 codec
      '-q:a',
      '5', // Quality level (0-9, lower is better quality, larger file)
      outputPath,
    ];

    try {
      log.info(`Extracting audio segment: ${startTime}s for ${duration}s`);
      await this.runFFmpeg(args);
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new FFmpegError(
          'Output audio segment is empty or was not created.'
        );
      }
      log.info(`Successfully extracted audio segment to: ${outputPath}`);
      return outputPath;
    } catch (error) {
      log.error('Error extracting audio segment:', error);
      throw new FFmpegError(`Failed to extract audio segment: ${error}`);
    }
  }

  async detectSilenceBoundaries(inputAudioPath: string): Promise<{
    silenceStarts: number[];
    silenceEnds: number[];
  }> {
    return new Promise((resolve, reject) => {
      const silenceStarts: number[] = [];
      const silenceEnds: number[] = [];

      // Parameters for silence detection
      const noiseTolerance = '-30dB'; // Noise level threshold
      const minSilenceDuration = '1.5'; // Minimum duration of silence to detect (in seconds)

      log.info(
        `Detecting silence in ${inputAudioPath} (tolerance: ${noiseTolerance}, min duration: ${minSilenceDuration}s)`
      );

      const process = spawn(this.ffmpegPath, [
        '-i',
        inputAudioPath,
        '-af',
        `silencedetect=noise=${noiseTolerance}:d=${minSilenceDuration}`,
        '-f',
        'null', // Don't output a file
        '-', // Output to stdout/stderr
      ]);

      let stderrOutput = '';

      process.stderr.on('data', data => {
        stderrOutput += data.toString();
        // Process lines as they come in
        const lines = stderrOutput.split('\n');
        stderrOutput = lines.pop() || ''; // Keep the last partial line

        lines.forEach(line => {
          if (line.includes('silence_start')) {
            const match = line.match(/silence_start: (\d+\.?\d*)/);
            if (match && match[1]) {
              silenceStarts.push(parseFloat(match[1]));
            }
          } else if (line.includes('silence_end')) {
            const match = line.match(/silence_end: (\d+\.?\d*)/);
            if (match && match[1]) {
              silenceEnds.push(parseFloat(match[1]));
            }
          }
        });
      });

      process.on('close', code => {
        log.info(`Silence detection process exited with code ${code}`);

        // Process any remaining stderr output
        const lines = stderrOutput.split('\n');
        lines.forEach(line => {
          if (line.includes('silence_start')) {
            const match = line.match(/silence_start: (\d+\.?\d*)/);
            if (match && match[1]) {
              silenceStarts.push(parseFloat(match[1]));
            }
          } else if (line.includes('silence_end')) {
            const match = line.match(/silence_end: (\d+\.?\d*)/);
            if (match && match[1]) {
              silenceEnds.push(parseFloat(match[1]));
            }
          }
        });

        // Sort the results
        silenceStarts.sort((a, b) => a - b);
        silenceEnds.sort((a, b) => a - b);

        log.info(
          `Silence detection found ${silenceStarts.length} starts and ${silenceEnds.length} ends.`
        );
        // log.debug('Silence Starts:', silenceStarts);
        // log.debug('Silence Ends:', silenceEnds);

        resolve({ silenceStarts, silenceEnds });
      });

      process.on('error', err => {
        log.error(`Silence detection process error: ${err.message}`);
        reject(new FFmpegError(`Silence detection failed: ${err.message}`));
      });
    });
  }

  public cancelOperation(operationId: string): boolean {
    return cancellationService.cancelOperation(operationId);
  }

  public isActiveProcess(operationId: string): boolean | undefined {
    return cancellationService.isOperationActive(operationId);
  }

  async splitAudioIntoChunks(
    audioPath: string,
    chunkDurationSeconds: number = 600, // Default 10 minutes
    operationId?: string
  ): Promise<{ path: string; startTime: number }[]> {
    const logPrefix = operationId ? `[${operationId}] ` : '';
    log.info(`${logPrefix}Starting audio splitting for: ${audioPath}`);

    if (!fs.existsSync(audioPath)) {
      throw new FFmpegError(`Input audio file not found: ${audioPath}`);
    }

    const totalDuration = await this.getMediaDuration(audioPath);
    log.info(`${logPrefix}Total audio duration: ${totalDuration} seconds.`);

    if (totalDuration <= 0 || isNaN(totalDuration)) {
      throw new FFmpegError(
        `Invalid audio duration detected: ${totalDuration}`
      );
    }

    const numChunks = Math.ceil(totalDuration / chunkDurationSeconds);
    log.info(
      `${logPrefix}Splitting into ${numChunks} chunks of max ${chunkDurationSeconds} seconds.`
    );

    const chunksDir = path.join(this.tempDir, `chunks_${uuidv4()}`);
    try {
      await fsp.mkdir(chunksDir, { recursive: true });
      log.info(
        `${logPrefix}Created temporary directory for chunks: ${chunksDir}`
      );
    } catch (err) {
      log.error(
        `${logPrefix}Failed to create chunk directory: ${chunksDir}`,
        err
      );
      throw new FFmpegError(
        `Failed to create chunk directory: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const chunkPromises: Promise<{ path: string; startTime: number }>[] = [];

    for (let i = 0; i < numChunks; i++) {
      const startTime = i * chunkDurationSeconds;
      // Calculate actual duration for this chunk (last chunk might be shorter)
      const currentChunkDuration = Math.min(
        chunkDurationSeconds,
        totalDuration - startTime
      );

      // Ensure duration is positive
      if (currentChunkDuration <= 0) {
        log.warn(
          `${logPrefix}Skipping chunk ${i + 1} due to zero or negative duration.`
        );
        continue;
      }

      const chunkFileName = `chunk_${String(i + 1).padStart(4, '0')}${path.extname(audioPath)}`;
      const chunkOutputPath = path.join(chunksDir, chunkFileName);

      const args = [
        '-i',
        audioPath,
        '-ss',
        startTime.toFixed(6), // Use precise start time
        '-t',
        currentChunkDuration.toFixed(6), // Use precise duration
        '-vn', // No video
        '-acodec',
        'copy', // Copy codec - faster, assumes compatible format
        '-y', // Overwrite without asking
        chunkOutputPath,
      ];

      // Add a promise for running ffmpeg for this chunk
      const chunkPromise = new Promise<{ path: string; startTime: number }>(
        (resolve, reject) => {
          log.info(
            `${logPrefix}Creating chunk ${i + 1}/${numChunks}: ${chunkOutputPath} (Start: ${startTime.toFixed(3)}s, Duration: ${currentChunkDuration.toFixed(3)}s)`
          );
          const process = spawn(this.ffmpegPath, args);

          let stderrOutput = '';
          process.stderr.on('data', data => {
            stderrOutput += data.toString();
          });

          process.on('close', code => {
            if (code === 0) {
              log.info(
                `${logPrefix}Successfully created chunk ${i + 1}/${numChunks}`
              );
              resolve({ path: chunkOutputPath, startTime });
            } else {
              log.error(
                `${logPrefix}FFmpeg failed for chunk ${i + 1}. Code: ${code}. Path: ${chunkOutputPath}`
              );
              log.error(`${logPrefix}FFmpeg stderr: ${stderrOutput}`);
              reject(
                new FFmpegError(
                  `FFmpeg process for chunk ${i + 1} exited with code ${code}. Stderr: ${stderrOutput.substring(0, 500)}`
                )
              );
            }
          });

          process.on('error', err => {
            log.error(
              `${logPrefix}FFmpeg spawn error for chunk ${i + 1}:`,
              err
            );
            reject(
              new FFmpegError(
                `FFmpeg spawn error for chunk ${i + 1}: ${err.message}`
              )
            );
          });
        }
      );
      chunkPromises.push(chunkPromise);
    }

    try {
      const chunkResults = await Promise.all(chunkPromises);
      log.info(
        `${logPrefix}Successfully created all ${chunkResults.length} audio chunks.`
      );
      // We don't delete the chunksDir here, the caller (generate-subtitles handler) should do that
      return chunkResults;
    } catch (error) {
      log.error(`${logPrefix}Error during audio chunk creation:`, error);
      // Attempt cleanup of the chunk directory on error
      try {
        await fsp.rm(chunksDir, { recursive: true, force: true });
        log.info(
          `${logPrefix}Cleaned up chunk directory due to error: ${chunksDir}`
        );
      } catch (cleanupError) {
        log.error(
          `${logPrefix}Failed to cleanup chunk directory after error: ${chunksDir}`,
          cleanupError
        );
      }
      throw error; // Re-throw the original error
    }
  }
}
