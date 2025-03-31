import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import log from 'electron-log';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import os from 'os';

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
        '4',
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
      const duration = await this.getMediaDuration(filePath);
      if (isNaN(duration) || duration <= 0) {
        throw new FFmpegError('Invalid output file: duration is invalid');
      }

      const stats = fs.statSync(filePath);
      if (stats.size < 10000) {
        throw new FFmpegError(`Output file is too small: ${stats.size} bytes`);
      }
    } catch (error: unknown) {
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
    progressCallback?: (progress: { percent: number; stage: string }) => void
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new FFmpegError(`Input video file does not exist: ${videoPath}`);
    }
    if (!fs.existsSync(subtitlesPath)) {
      throw new FFmpegError(`Subtitle file does not exist: ${subtitlesPath}`);
    }

    try {
      log.info(`[${operationId}] Starting subtitle merge process`);
      log.info(`[${operationId}] Video path: ${videoPath}`);
      log.info(`[${operationId}] Subtitles path: ${subtitlesPath}`);

      // Use the outputPath provided directly, don't recalculate
      // const tempOutputPath = path.join(
      //   this.tempDir,
      //   `temp_merge_${Date.now()}_${path.basename(outputPath)}`
      // );
      // log.info(`[${operationId}] Temporary output path: ${tempOutputPath}`);
      log.info(`[${operationId}] Using provided output path: ${outputPath}`); // Log the correct path

      const { width, height } = await this.getVideoResolution(videoPath);
      const duration = await this.getMediaDuration(videoPath);

      log.info(`[${operationId}] Video resolution: ${width}x${height}`);
      log.info(`[${operationId}] Video duration: ${duration} seconds`);

      const subtitleExt = path.extname(subtitlesPath).toLowerCase();
      const isAss = subtitleExt === '.ass';

      const subtitleArgs = isAss
        ? [
            '-vf',
            `scale=${width}:${height},subtitles='${subtitlesPath.replace(/'/g, "'\\''")}'`,
            '-c:v',
            'libx264',
            '-preset',
            'slow',
            '-crf',
            '18',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
          ]
        : [
            '-i',
            subtitlesPath,
            '-c:s',
            'mov_text',
            '-metadata:s:s:0',
            'language=eng',
          ];

      log.info(`[${operationId}] FFmpeg arguments: ${subtitleArgs.join(' ')}`);

      await this.runFFmpeg(
        [
          '-loglevel',
          'verbose',
          '-i',
          videoPath,
          ...subtitleArgs,
          // tempOutputPath, // Use the argument directly
          outputPath,
        ],
        operationId,
        duration,
        progress => {
          if (progressCallback) {
            progressCallback({
              percent: progress,
              stage: 'Merging subtitles with video',
            });
          }
        }
      );

      log.info(`[${operationId}] FFmpeg process completed successfully`);

      // Validate the correct outputPath
      await this.validateOutputFile(outputPath);
      log.info(`[${operationId}] Output file validated successfully`);

      // Return the correct outputPath
      return outputPath;
    } catch (error) {
      log.error(`[${operationId}] Error merging subtitles:`, error);
      throw new FFmpegError(`Failed to merge subtitles: ${error}`);
    }
  }

  async convertSrtToAss(
    srtPath: string,
    fontSize: number = 24
  ): Promise<string> {
    const outputPath = path.join(
      this.tempDir,
      `${path.basename(srtPath, path.extname(srtPath))}.ass`
    );

    try {
      if (fontSize !== 24) {
        await this.runFFmpeg([
          '-i',
          srtPath,
          '-c:s',
          'ssa',
          '-metadata:s:s:0',
          `Style=FontSize=${fontSize}`,
          outputPath,
        ]);
      } else {
        // Use default conversion if no custom font size
        await this.runFFmpeg(['-i', srtPath, outputPath]);
      }

      return outputPath;
    } catch (error) {
      log.error('Error converting SRT to ASS:', error);
      throw new FFmpegError(`Failed to convert SRT to ASS: ${error}`);
    }
  }

  private runFFmpeg(
    args: string[],
    operationId?: string,
    totalDuration?: number,
    progressCallback?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const fullCommand = `${this.ffmpegPath} ${args.join(' ')}`;
      log.info(
        `[${operationId || 'ffmpeg'}] Spawning FFmpeg command: ${fullCommand}`
      );
      const process = spawn(this.ffmpegPath, args);
      log.info(
        `[${operationId || 'ffmpeg'}] Spawning FFmpeg with args: ${args.join(' ')}`
      );

      if (operationId) {
        this.activeProcesses.set(operationId, process);
        log.info(`[${operationId}] Process started and tracked.`);
      }

      // Add timeout handling
      const TIMEOUT = 60 * 60 * 1000; // 1 hour
      const timeoutId = setTimeout(() => {
        log.warn(`[${operationId || 'ffmpeg'}] Process timed out after 1 hour`);
        process.kill('SIGKILL');
        reject(new FFmpegError('FFmpeg process timed out after 1 hour'));
      }, TIMEOUT);

      let output = '';
      let lastProgressUpdate = Date.now();
      const PROGRESS_TIMEOUT = 30 * 1000; // 30 seconds

      // Monitor for process hanging
      const progressInterval = setInterval(() => {
        const now = Date.now();
        if (now - lastProgressUpdate > PROGRESS_TIMEOUT) {
          log.warn(
            `[${operationId || 'ffmpeg'}] No progress update for ${Math.floor((now - lastProgressUpdate) / 1000)} seconds`
          );
          // Don't kill the process, just log the warning
        }
      }, 5000);

      process.stderr.on('data', data => {
        const dataStr = data.toString();
        output += dataStr;
        lastProgressUpdate = Date.now();

        // Log all FFmpeg output for debugging
        log.debug(
          `[${operationId || 'ffmpeg'}] stderr chunk: ${dataStr.trim()}`
        );

        // Check for common FFmpeg errors
        if (dataStr.includes('Error') || dataStr.includes('error')) {
          log.warn(
            `[${operationId || 'ffmpeg'}] FFmpeg reported error: ${dataStr.trim()}`
          );
        }

        if (progressCallback && totalDuration && totalDuration > 0) {
          const timeMatch = dataStr.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (timeMatch) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;
            const progressPercent = Math.min(
              100,
              Math.round((currentTime / totalDuration) * 100)
            );

            progressCallback(progressPercent);
          }
        }
      });

      process.stdout.on('data', data => {
        const dataStr = data.toString();
        log.debug(
          `[${operationId || 'ffmpeg'}] stdout chunk: ${dataStr.trim()}`
        );
      });

      process.on('close', code => {
        clearTimeout(timeoutId);
        clearInterval(progressInterval);

        log.info(
          `[${operationId || 'ffmpeg'}] 'close' event received. Exit code: ${code}`
        );

        log.info(
          `[${operationId || 'ffmpeg'}] Process exited with code ${code}.`
        );
        if (operationId) {
          this.activeProcesses.delete(operationId);
          log.info(`[${operationId}] Process stopped tracking.`);
        }
        if (code === 0) {
          resolve();
        } else {
          reject(
            new FFmpegError(
              `FFmpeg process exited with code ${code}: ${output}`
            )
          );
        }
      });

      process.on('error', err => {
        clearTimeout(timeoutId);
        clearInterval(progressInterval);

        log.error(`[${operationId || 'ffmpeg'}] FFmpeg error: ${err.message}`);
        if (operationId) {
          this.activeProcesses.delete(operationId);
          log.error(`[${operationId}] Process stopped tracking due to error.`);
        }
        reject(new FFmpegError(`FFmpeg error: ${err.message}`));
      });

      // Monitor process state
      process.on('exit', code => {
        log.info(
          `[${operationId || 'ffmpeg'}] Process exited with code ${code}`
        );
      });
    });
  }

  async extractAudioSegment(
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.ffmpegPath, [
        '-i',
        inputPath,
        '-ss',
        startTime.toString(),
        '-t',
        duration.toString(),
        '-acodec',
        'libmp3lame',
        '-q:a',
        '2',
        outputPath,
      ]);

      const TIMEOUT = 10 * 60 * 1000;
      const timeoutId = setTimeout(() => {
        process.kill('SIGKILL');
        reject(new FFmpegError('Audio extraction timed out after 10 minutes'));
      }, TIMEOUT);

      process.on('close', code => {
        clearTimeout(timeoutId);

        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(
            new FFmpegError(
              `Failed to extract audio segment, process exited with code ${code}`
            )
          );
        }
      });

      process.on('error', err => {
        clearTimeout(timeoutId);

        log.error('Error in audio segment extraction:', err);
        reject(
          new FFmpegError(`Error extracting audio segment: ${err.message}`)
        );
      });
    });
  }

  async detectSilenceBoundaries(inputAudioPath: string): Promise<{
    silenceStarts: number[];
    silenceEnds: number[];
  }> {
    return new Promise((resolve, reject) => {
      const silenceStarts: number[] = [];
      const silenceEnds: number[] = [];
      const ffmpegProcess = spawn(this.ffmpegPath, [
        '-i',
        inputAudioPath,
        '-af',
        'silencedetect=noise=-50dB:d=0.5',
        '-f',
        'null',
        '-',
      ]);

      // Add timeout handling
      const TIMEOUT = 15 * 60 * 1000; // 15 minutes
      const timeoutId = setTimeout(() => {
        ffmpegProcess.kill('SIGKILL');
        reject(new FFmpegError('Silence detection timed out after 15 minutes'));
      }, TIMEOUT);

      let stderr = '';
      ffmpegProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpegProcess.on('close', code => {
        clearTimeout(timeoutId);

        if (code !== 0) {
          reject(new FFmpegError(`Silence detection failed with code ${code}`));
          return;
        }

        const startRegex = /silence_start:\s*([\d.]+)/g;
        const endRegex = /silence_end:\s*([\d.]+)/g;

        let match;
        while ((match = startRegex.exec(stderr)) !== null) {
          silenceStarts.push(parseFloat(match[1]));
        }
        while ((match = endRegex.exec(stderr)) !== null) {
          silenceEnds.push(parseFloat(match[1]));
        }

        if (
          silenceEnds.length > 0 &&
          silenceEnds[0] > 0 &&
          silenceStarts.length === silenceEnds.length - 1
        ) {
          silenceStarts.unshift(0);
        }

        resolve({ silenceStarts, silenceEnds });
      });

      ffmpegProcess.on('error', (err: Error) => {
        clearTimeout(timeoutId);

        log.error('Error in silence detection:', err);
        reject(new FFmpegError(`Silence detection error: ${err.message}`));
      });
    });
  }

  public cancelOperation(operationId: string): boolean {
    const process = this.activeProcesses.get(operationId);
    if (process) {
      log.warn(`[${operationId}] Attempting to cancel operation.`);
      try {
        const killed = process.kill('SIGTERM');
        if (killed) {
          log.warn(`[${operationId}] Kill signal sent successfully.`);
          this.activeProcesses.delete(operationId);
          return true;
        } else {
          log.error(`[${operationId}] Kill signal failed to send.`);
          this.activeProcesses.delete(operationId);
          return false;
        }
      } catch (error: any) {
        log.error(
          `[${operationId}] Error sending kill signal: ${error.message}`
        );
        this.activeProcesses.delete(operationId);
        return false;
      }
    } else {
      log.warn(
        `[${operationId}] Cancel request received, but process not found (may have already finished).`
      );
      return false;
    }
  }
}
