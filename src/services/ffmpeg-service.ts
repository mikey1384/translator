import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { app } from 'electron';
import log from 'electron-log';
import nodeProcess from 'process';
import { createRequire } from 'module';
import {
  ASS_STYLE_PRESETS,
  AssStylePresetKey,
} from '../shared/constants/subtitle-styles.js';

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
  private activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(tempDirPath: string) {
    const require = createRequire(import.meta.url);
    try {
      this.ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
      this.ffprobePath = require('@ffprobe-installer/ffprobe').path;
      log.info(`FFmpeg path (from module): ${this.ffmpegPath}`);
      log.info(`FFprobe path (from module): ${this.ffprobePath}`);

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
      log.error(`Error stack: ${error.stack}`);
      this.ffmpegPath = 'ffmpeg';
      this.ffprobePath = 'ffprobe';
      log.warn('Falling back to system paths for ffmpeg/ffprobe.');
    }

    if (!tempDirPath) {
      console.error(
        '[FFmpegService] Critical Error: tempDirPath argument is required.'
      );
      throw new Error('FFmpegService requires a tempDirPath');
    }
    this.tempDir = tempDirPath;
    this.ensureTempDirSync();
    log.info(`FFmpegService initialized. Temp dir set to: ${this.tempDir}`);
  }

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

  async extractAudio({
    videoPath,
    progressCallback,
    operationId,
  }: {
    videoPath: string;
    progressCallback?: (progress: { percent: number; stage?: string }) => void;
    operationId?: string;
  }): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new FFmpegError(`Input video file not found: ${videoPath}`);
    }

    const outputPath = path.join(
      this.tempDir,
      `${path.basename(videoPath, path.extname(videoPath))}_audio.mp3`
    );

    try {
      progressCallback?.({
        percent: 1,
        stage: 'Analyzing video file...',
      });

      const stats = fs.statSync(videoPath);
      const fileSizeMB = Math.round(stats.size / (1024 * 1024));
      const duration = await this.getMediaDuration(videoPath);
      const durationMin = Math.round(duration / 60);
      let estimatedTimeSeconds = Math.round(duration * 0.1);
      if (fileSizeMB > 1000) estimatedTimeSeconds *= 1.5;
      const ANALYSIS_END = 3;
      const PREP_END = 5;
      const EXTRACTION_START = 5;
      const EXTRACTION_END = 10;
      progressCallback?.({
        percent: ANALYSIS_END,
        stage: `Preparing audio extraction for ${fileSizeMB} MB video (${durationMin} min)...`,
      });
      const resolution = await this.getVideoResolution(videoPath).catch(() => ({
        width: 1280,
        height: 720,
      }));
      const isHighRes = resolution.width > 1920 || resolution.height > 1080;
      progressCallback?.({
        percent: PREP_END,
        stage: `Starting audio extraction (est. ${Math.round(estimatedTimeSeconds / 60)} min)...`,
      });
      const audioQuality = isHighRes ? '4' : '2';
      const audioRate = '16000';
      const startTime = Date.now();
      let lastProgressPercent = EXTRACTION_START;

      const ffmpegArgs = [
        '-i',
        videoPath,
        '-vn',
        '-acodec',
        'libmp3lame',
        '-q:a',
        audioQuality,
        '-ar',
        audioRate,
        '-ac',
        '1',
        '-progress',
        'pipe:1',
        '-y',
        outputPath,
      ];

      await this.runFFmpeg({
        args: ffmpegArgs,
        operationId,
        totalDuration: duration,
        progressCallback: ffmpegProgress => {
          const scaledPercent =
            EXTRACTION_START +
            (ffmpegProgress * (EXTRACTION_END - EXTRACTION_START)) / 100;
          if (scaledPercent - lastProgressPercent >= 0.5) {
            lastProgressPercent = scaledPercent;
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
        },
        filePath: videoPath,
      });

      progressCallback?.({
        percent: EXTRACTION_END,
        stage: 'Audio extraction complete...',
      });
      return outputPath;
    } catch (error) {
      log.error(`[extractAudio${operationId ? `/${operationId}` : ''}]`, error);
      if (error instanceof Error && error.message === 'Operation cancelled') {
        log.info(`[extractAudio/${operationId}] Caught cancellation error.`);
        throw error;
      }
      try {
        await fsp.unlink(outputPath);
      } catch (cleanupError: any) {
        log.warn(
          `Failed to delete invalid file ${outputPath} during cleanup: ${cleanupError.message}`
        );
      }
      throw error;
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
          reject(new FFmpegError(`FFprobe exited with code ${code}`));
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
          reject(new FFmpegError(`FFprobe exited with code ${code}`));
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
      const stats = fs.statSync(filePath);
      if (stats.size < 1000) {
        throw new FFmpegError(`Output file is too small: ${stats.size} bytes`);
      }
      const duration = await this.getMediaDuration(filePath);
      if (isNaN(duration) || duration <= 0) {
        throw new FFmpegError('Invalid output file: duration is invalid');
      }
    } catch (error: unknown) {
      try {
        await fsp.unlink(filePath);
        log.info(`Deleted invalid output file: ${filePath}`);
      } catch (cleanupError: any) {
        log.warn(
          `Failed to delete invalid file ${filePath} during cleanup: ${cleanupError.message}`
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

    log.info(
      `[${operationId}] Starting subtitle merge (Font: ${fontSize}, Style: ${stylePreset})`
    );
    log.info(`[${operationId}] Video path: ${videoPath}`);
    log.info(`[${operationId}] Subtitles path: ${subtitlesPath}`);
    log.info(`[${operationId}] Output path: ${outputPath}`);

    const duration = await this.getMediaDuration(videoPath);
    log.info(`[${operationId}] Video duration: ${duration} seconds`);
    progressCallback?.({ percent: 5, stage: 'Preparing subtitle style' });
    tempAssPath = await this.prepareStyledAss(
      subtitlesPath,
      fontSize,
      stylePreset,
      operationId
    );
    progressCallback?.({ percent: 10, stage: 'Applying subtitle style' });
    const env = { ...nodeProcess.env };
    const escapedAssPath = tempAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    const subtitleFilter = `subtitles='${escapedAssPath}':force_style='FontName=Arial,FontSize=${fontSize}'`;
    log.info(`[${operationId}] Using subtitle filter: ${subtitleFilter}`);
    const ffmpegArgs = [
      '-y',
      '-loglevel',
      'level+verbose',
      '-i',
      videoPath,
      '-vf',
      subtitleFilter,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      outputPath,
    ];

    log.info(`[${operationId}] FFmpeg arguments: ${ffmpegArgs.join(' ')}`);
    if (!fs.existsSync(tempAssPath)) {
      log.error(
        `[${operationId}] ASS file doesn't exist right before FFmpeg execution!`
      );
      throw new Error(`Subtitle file missing before execution: ${tempAssPath}`);
    }

    progressCallback?.({ percent: 15, stage: 'Starting video encoding' });
    try {
      await this.runFFmpeg({
        args: ffmpegArgs,
        operationId,
        totalDuration: duration,
        progressCallback: (progress: number) => {
          const scaledPercent = 15 + (progress * (95 - 15)) / 100;
          progressCallback?.({
            percent: Math.min(95, scaledPercent),
            stage: `Encoding video with subtitles`,
          });
        },
        env,
        filePath: videoPath,
      });
      progressCallback?.({ percent: 98, stage: 'Validating output file' });
      if (fs.existsSync(outputPath)) {
        await this.validateOutputFile(outputPath);
        log.info(`[${operationId}] Subtitle merge completed successfully.`);
        progressCallback?.({ percent: 100, stage: 'Merge complete' });
        return outputPath;
      } else {
        log.info(`[${operationId}] Merge was cancelled, no output file.`);
        progressCallback?.({ percent: 100, stage: 'Merge cancelled' });
        return '';
      }
    } catch (error) {
      log.error(`[${operationId}] Error during subtitle merge:`, error);
      if (tempAssPath && fs.existsSync(tempAssPath)) {
        try {
          await fsp.unlink(tempAssPath);
          log.info(
            `[${operationId}] Cleaned up temporary ASS file after error: ${tempAssPath}`
          );
        } catch (cleanupError: any) {
          log.warn(
            `[${operationId}] Failed to delete temporary ASS file ${tempAssPath} after merge error: ${cleanupError.message}`
          );
        }
      }
      throw new FFmpegError(
        `Failed to merge subtitles: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      if (tempAssPath && fs.existsSync(tempAssPath)) {
        try {
          await fsp.unlink(tempAssPath);
          log.info(
            `[${operationId}] Cleaned up temporary ASS file in finally block: ${tempAssPath}`
          );
        } catch (cleanupError: any) {
          log.warn(
            `[${operationId}] Failed to delete temporary ASS file ${tempAssPath} during final cleanup: ${cleanupError.message}`
          );
        }
      }
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
    const styleLine = ASS_STYLE_PRESETS[stylePreset]
      .replace('{fontSize}', fontSize.toString())
      .replace('{fontName}', 'Arial');
    const assHeader = `[Script Info]
Title: Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    try {
      const originalContent = await fsp.readFile(originalSubtitlePath, 'utf-8');
      let assEvents = '';
      const originalExt = path.extname(originalSubtitlePath).toLowerCase();
      if (originalExt === '.srt') {
        const blocks = originalContent.trim().split(/\r?\n\r?\n/);
        for (const block of blocks) {
          const lines = block.trim().split(/\r?\n/);
          if (lines.length < 3) continue;
          const timeLine = lines[1];
          const textLines = lines.slice(2);
          const timeMatch = timeLine?.match(
            /(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/
          );
          if (timeMatch) {
            const start = this.formatAssTime(timeMatch[1]);
            const end = this.formatAssTime(timeMatch[2]);
            const text = textLines
              .join('\\N')
              .replace(/\{/g, '\\{')
              .replace(/\}/g, '\\}');
            assEvents += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
          }
        }
      } else if (originalExt === '.ass') {
        const eventsMatch = originalContent.match(/\n\[Events\]\r?\n(.*)/is);
        if (eventsMatch && eventsMatch[1]) {
          assEvents = eventsMatch[1].trim() + '\n';
        } else {
          assEvents = '';
        }
      } else {
        throw new Error(`Unsupported subtitle format: ${originalExt}`);
      }
      const finalAssContent = assHeader + assEvents;
      await fsp.writeFile(tempAssPath, finalAssContent, 'utf-8');
      return tempAssPath;
    } catch (error) {
      if (fs.existsSync(tempAssPath)) {
        try {
          await fsp.unlink(tempAssPath);
        } catch (cleanupError: any) {
          log.warn(
            `Failed to delete temporary ASS file ${tempAssPath} during error handling: ${cleanupError.message}`
          );
        }
      }
      throw error;
    }
  }

  private formatAssTime(srtTime: string): string {
    const timeWithDot = srtTime.replace(',', '.');
    const match = timeWithDot.match(/(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})/);
    if (!match) {
      return '0:00:00.00';
    }
    const [, hours, minutes, seconds, milliseconds] = match;
    const centiseconds = Math.round(
      parseInt(milliseconds.padEnd(3, '0'), 10) / 10
    )
      .toString()
      .padStart(2, '0');
    return `${parseInt(hours, 10)}:${minutes}:${seconds}.${centiseconds}`;
  }

  private runFFmpeg({
    args,
    operationId,
    totalDuration,
    progressCallback,
    env,
    filePath,
  }: {
    args: string[];
    operationId?: string;
    totalDuration?: number;
    progressCallback?: (progress: number) => void;
    env?: NodeJS.ProcessEnv;
    filePath?: string;
  }): Promise<void> {
    // Ensure the base temporary directory exists right before spawning
    // This guards against it being deleted after service initialization.
    try {
      if (!fs.existsSync(this.tempDir)) {
        log.info(
          `[runFFmpeg] Temp directory ${this.tempDir} missing, creating...`
        );
        fs.mkdirSync(this.tempDir, { recursive: true });
      }
    } catch (error) {
      log.error(
        `[runFFmpeg] Failed to ensure temp directory ${this.tempDir}:`,
        error
      );
      // Propagate the error, as ffmpeg will likely fail anyway
      return Promise.reject(
        new FFmpegError(
          `Failed to create or access temp directory before running FFmpeg: ${this.tempDir}`
        )
      );
    }

    return new Promise<void>((resolve, reject) => {
      const spawnOptions = {
        env: env ?? nodeProcess.env,
        cwd: filePath ? path.dirname(filePath) : this.tempDir,
      };
      log.info(
        `[${operationId || 'ffmpeg'}] Spawning FFmpeg: ${this.ffmpegPath} ${JSON.stringify(args)}`
      );
      log.info(
        `[${operationId || 'ffmpeg'}] Path check immediately before spawn: ${this.ffmpegPath}`
      );
      const ffmpegProcess = spawn(this.ffmpegPath, args, spawnOptions);
      const processId = `FFmpeg [${operationId || 'generic'}] (PID: ${ffmpegProcess.pid})`;

      // --- Store the process for cancellation ---
      if (operationId) {
        if (this.activeProcesses.has(operationId)) {
          log.warn(
            `[${processId}] Operation ID ${operationId} already exists in active processes map. Overwriting.`
          );
        }
        this.activeProcesses.set(operationId, ffmpegProcess);
        log.info(`[${processId}] Stored process for potential cancellation.`);
      } else {
        log.warn(
          `[${processId}] Process started without operationId, cancellation not possible via standard mechanism.`
        );
      }
      // --- End Store ---

      let stderrOutput = '';

      ffmpegProcess.stdout.on('data', (data: Buffer) => {
        log.info(`FFmpeg stdout: ${data.toString()}`);
      });

      ffmpegProcess.stderr.on('data', (data: Buffer) => {
        const line = data.toString();
        const lines = line.split(/\r?\n/);
        lines.forEach(singleLine => {
          if (singleLine.trim()) {
            log.info(`[FFmpeg STDERR] ${singleLine.trim()}`);
          }
        });
        stderrOutput += line;
        if (totalDuration && progressCallback) {
          try {
            let updated = false;
            lines.forEach(singleLine => {
              const timeMatch = singleLine.match(
                /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/
              );
              if (timeMatch) {
                const [_, hh, mm, ss, cs] = timeMatch;
                const currentTime = +hh * 3600 + +mm * 60 + +ss + +cs / 100;
                const progressPercent = Math.min(
                  100,
                  Math.max(0, (currentTime / totalDuration) * 100)
                );
                progressCallback(progressPercent);
                updated = true;
              }
            });
            if (!updated) {
              const match = stderrOutput.match(
                /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/
              );
              if (match) {
                const [_, hh, mm, ss, cs] = match;
                const currentTime = +hh * 3600 + +mm * 60 + +ss + +cs / 100;
                const progressPercent = Math.min(
                  100,
                  Math.max(0, (currentTime / totalDuration) * 100)
                );
                progressCallback(progressPercent);
              }
            }
          } catch (error) {
            log.warn('Failed to parse FFmpeg progress line:', error);
          }
        }
      });

      ffmpegProcess.on(
        'close',
        (code: number | null, signal: NodeJS.Signals | null) => {
          const wasCancelled = (ffmpegProcess as any).wasCancelled === true;
          const statusMessage = `code: ${code}, signal: ${signal}, cancelled_flag: ${wasCancelled}`;
          log.info(`[${processId}] Process closed (${statusMessage}).`);

          // --- Remove the process from the map ---
          if (operationId) {
            const deleted = this.activeProcesses.delete(operationId);
            if (deleted) {
              log.info(
                `[${processId}] Removed process from active map on close.`
              );
            } else {
              // This might happen if cancelOperation already removed it, which is fine.
              log.warn(
                `[${processId}] Process not found in active map during close event (might have been cancelled/removed prior).`
              );
            }
          }
          // --- End Remove ---

          if (wasCancelled) {
            log.warn(`[${processId}] Process was cancelled.`);
            reject(new FFmpegError('Operation cancelled')); // Reject specifically for cancellation
          } else if (code === 0) {
            log.info(`[${processId}] Process completed successfully.`);
            resolve();
          } else {
            log.error(
              `[${processId}] Process exited abnormally (${statusMessage}). Stderr tail:`
            );
            const stderrLines = stderrOutput.split('\n');
            const relevantStderr = stderrLines.slice(-20).join('\n');
            log.error(relevantStderr);
            reject(
              new FFmpegError(`FFmpeg failed with ${statusMessage}. See logs.`)
            );
          }
        }
      );

      ffmpegProcess.on('error', (err: Error) => {
        log.error(
          `[${processId}] Error spawning or during process execution:`,
          err
        );

        // --- Remove the process from the map on error ---
        if (operationId) {
          this.activeProcesses.delete(operationId);
          log.info(
            `[${processId}] Removed process from active map due to process error.`
          );
        }
        // --- End Remove ---

        reject(new FFmpegError(`Failed to run ffmpeg: ${err.message}`));
      });
    });
  }

  async extractAudioSegment({
    inputPath,
    outputPath,
    startTime,
    duration,
    operationId,
  }: {
    inputPath: string;
    outputPath: string;
    startTime: number;
    duration: number;
    operationId?: string;
  }): Promise<string> {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-ss',
      startTime.toString(),
      '-t',
      duration.toString(),
      '-vn',
      '-acodec',
      'libmp3lame',
      '-q:a',
      '5',
      outputPath,
    ];
    try {
      log.info(`Extracting audio segment: ${startTime}s for ${duration}s`);
      await this.runFFmpeg({ args, operationId, filePath: inputPath });
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new FFmpegError('Output audio segment is empty or missing.');
      }
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
      const noiseTolerance = '-30dB';
      const minSilenceDuration = '1.5';
      const process = spawn(this.ffmpegPath, [
        '-i',
        inputAudioPath,
        '-af',
        `silencedetect=noise=${noiseTolerance}:d=${minSilenceDuration}`,
        '-f',
        'null',
        '-',
      ]);
      let stderrOutput = '';

      process.stderr.on('data', data => {
        stderrOutput += data.toString();
        const lines = stderrOutput.split('\n');
        stderrOutput = lines.pop() || '';
        lines.forEach(line => {
          if (line.includes('silence_start')) {
            const match = line.match(/silence_start: (\d+\.?\d*)/);
            if (match && match[1]) silenceStarts.push(parseFloat(match[1]));
          } else if (line.includes('silence_end')) {
            const match = line.match(/silence_end: (\d+\.?\d*)/);
            if (match && match[1]) silenceEnds.push(parseFloat(match[1]));
          }
        });
      });

      process.on('close', code => {
        const lines = stderrOutput.split('\n');
        lines.forEach(line => {
          if (line.includes('silence_start')) {
            const match = line.match(/silence_start: (\d+\.?\d*)/);
            if (match && match[1]) silenceStarts.push(parseFloat(match[1]));
          } else if (line.includes('silence_end')) {
            const match = line.match(/silence_end: (\d+\.?\d*)/);
            if (match && match[1]) silenceEnds.push(parseFloat(match[1]));
          }
        });
        silenceStarts.sort((a, b) => a - b);
        silenceEnds.sort((a, b) => a - b);
        if (code === 0) {
          resolve({ silenceStarts, silenceEnds });
        } else {
          reject(new FFmpegError(`Silence detection exited with code ${code}`));
        }
      });

      process.on('error', err => {
        reject(new FFmpegError(`Silence detection failed: ${err.message}`));
      });
    });
  }

  public cancelOperation(operationId: string): void {
    const process = this.activeProcesses.get(operationId);
    if (process && !process.killed) {
      log.info(
        `[FFmpegService] Killing FFmpeg process for operationId=${operationId}`
      );
      // Set a flag to indicate cancellation before killing
      (process as any).wasCancelled = true;
      process.kill('SIGKILL');
      // No need to delete here, the 'close' handler will do it.
    } else if (process && process.killed) {
      log.warn(
        `[FFmpegService] Attempted to cancel already finished/killed process for operationId=${operationId}`
      );
      // Optionally, ensure it's removed if it somehow lingered
      this.activeProcesses.delete(operationId);
    } else {
      log.warn(
        `[FFmpegService] No active FFmpeg process found for operationId=${operationId} to cancel.`
      );
    }
  }
}
