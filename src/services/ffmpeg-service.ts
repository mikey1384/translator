import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises'; // Import promises version
import { app } from 'electron';
import log from 'electron-log';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import os from 'os';
import nodeProcess from 'process'; // Use alias to avoid conflict with ChildProcess type
// Import the helper and type
import {
  getAssStyleLine,
  AssStylePresetKey,
} from '../renderer/constants/subtitle-styles';
import { v4 as uuidv4 } from 'uuid'; // Import uuid for unique directory names

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
  private activeProcesses = new Map<string, ChildProcess>();

  constructor() {
    this.ffmpegPath = ffmpegPath.path;
    this.ffprobePath = ffprobePath.path;

    try {
      this.tempDir = path.join(app.getPath('userData'), 'temp');
    } catch (error) {
      log.warn('Electron app not ready, using OS temp directory as fallback');
      this.tempDir = path.join(os.tmpdir(), 'translator-electron-temp');
    }

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    log.info(`FFmpeg path: ${this.ffmpegPath}`);
    log.info(`FFprobe path: ${this.ffprobePath}`);
    log.info(`Temp directory: ${this.tempDir}`);
  }

  getTempDir(): string {
    return this.tempDir;
  }

  async extractAudio(videoPath: string): Promise<string> {
    const outputPath = path.join(
      this.tempDir,
      `${path.basename(videoPath, path.extname(videoPath))}_audio.mp3`
    );

    try {
      await this.runFFmpeg([
        '-i',
        videoPath,
        '-vn',
        '-acodec',
        'libmp3lame',
        '-q:a',
        '4', // Lower quality for faster extraction (adjust if needed)
        '-y', // Overwrite output without asking
        outputPath,
      ]);

      return outputPath;
    } catch (error) {
      log.error('Error extracting audio:', error);
      throw new FFmpegError(`Failed to extract audio: ${error}`);
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
      const subtitleFilter = `subtitles=filename='${escapedAssPath}'`;
      log.info(
        `[${operationId}] Using subtitle filter: ${subtitleFilter} (relying on Fontconfig/Env)`
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

      progressCallback?.({ percent: 15, stage: 'Starting video encoding' });

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

      progressCallback?.({ percent: 98, stage: 'Validating output file' });
      await this.validateOutputFile(outputPath);

      log.info(
        `[${operationId}] Subtitle merge process completed successfully.`
      );
      progressCallback?.({ percent: 100, stage: 'Merge complete' });
      return outputPath;
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
    const styleLine = getAssStyleLine(stylePreset, fontSize);

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
      log.info(`Running FFmpeg command: ${this.ffmpegPath} ${args.join(' ')}`);
      const ffmpegProcess = spawn(this.ffmpegPath, args, {
        env: env || nodeProcess.env,
      });

      if (operationId) {
        this.activeProcesses.set(operationId, ffmpegProcess);
        log.info(
          `[${operationId}] FFmpeg process started (PID: ${ffmpegProcess.pid})`
        );
      } else {
        log.info(`FFmpeg process started (PID: ${ffmpegProcess.pid})`);
      }

      let stderrOutput = '';
      const progressRegex = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/;

      ffmpegProcess.stdout.on('data', (data: Buffer) => {
        log.info(`FFmpeg stdout: ${data.toString()}`);
      });

      ffmpegProcess.stderr.on('data', (data: Buffer) => {
        const line = data.toString();
        stderrOutput += line;
        // log.debug(`FFmpeg stderr line: ${line.trim()}`); // Log raw stderr lines if needed

        if (totalDuration && progressCallback) {
          try {
            const match = line.match(progressRegex);
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
              // log.debug(`FFmpeg Progress: ${progressPercent.toFixed(1)}% (Current: ${currentTime}s, Total: ${totalDuration}s)`);
              progressCallback(progressPercent);
            }
          } catch (e) {
            log.warn('Failed to parse FFmpeg progress line:', e);
          }
        }
      });

      ffmpegProcess.on('close', (code: number | null) => {
        if (operationId) {
          this.activeProcesses.delete(operationId);
          log.info(
            `[${operationId}] FFmpeg process finished (PID: ${ffmpegProcess.pid})`
          );
        } else {
          log.info(`FFmpeg process finished (PID: ${ffmpegProcess.pid})`);
        }

        if (code === 0) {
          log.info(`FFmpeg process exited successfully (Code: ${code})`);
          resolve();
        } else {
          log.error(`FFmpeg process exited with error code ${code}.`);
          log.error(`FFmpeg stderr output:\n${stderrOutput}`); // Log accumulated stderr on error
          reject(
            new FFmpegError(
              `FFmpeg process exited with code ${code}. Check logs for details.`
            )
          );
        }
      });

      ffmpegProcess.on('error', (err: Error) => {
        if (operationId) {
          this.activeProcesses.delete(operationId);
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
    const process = this.activeProcesses.get(operationId);
    if (process && !process.killed) {
      log.info(
        `[${operationId}] Attempting to cancel FFmpeg process (PID: ${process.pid})`
      );
      const killed = process.kill('SIGTERM'); // Send SIGTERM first
      if (!killed) {
        log.warn(`[${operationId}] Failed to send SIGTERM, trying SIGKILL.`);
        process.kill('SIGKILL'); // Force kill if SIGTERM failed
      }
      this.activeProcesses.delete(operationId);
      log.info(`[${operationId}] Process cancellation requested.`);
      return true;
    }
    log.warn(`[${operationId}] No active process found to cancel.`);
    return false;
  }

  /**
   * Splits a large audio file into smaller chunks.
   *
   * @param audioPath Path to the input audio file.
   * @param chunkDurationSeconds Desired duration of each chunk in seconds.
   * @param operationId Optional operation ID for logging.
   * @returns Promise<Array<{ path: string; startTime: number }>> An array of objects, each containing the path to a chunk file and its start time offset.
   */
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
