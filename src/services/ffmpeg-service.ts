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

  async mergeSubtitles(
    videoPath: string,
    subtitlesPath: string,
    outputPath: string,
    operationId: string,
    progressCallback?: (progress: { percent: number; stage: string }) => void
  ): Promise<string> {
    try {
      const duration = await this.getMediaDuration(videoPath);

      await this.runFFmpeg(
        [
          '-loglevel',
          'verbose',
          '-i',
          videoPath,
          '-i',
          subtitlesPath,
          '-c:s',
          'mov_text',
          '-metadata:s:s:0',
          'language=eng',
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

      return outputPath;
    } catch (error) {
      log.error('Error merging subtitles:', error);
      throw new FFmpegError(`Failed to merge subtitles: ${error}`);
    }
  }

  async convertSrtToAss(srtPath: string): Promise<string> {
    const outputPath = path.join(
      this.tempDir,
      `${path.basename(srtPath, path.extname(srtPath))}.ass`
    );

    try {
      await this.runFFmpeg(['-i', srtPath, outputPath]);

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

      let output = '';

      process.stderr.on('data', data => {
        const dataStr = data.toString();
        output += dataStr;
        log.debug(
          `[${operationId || 'ffmpeg'}] stderr chunk: ${dataStr.trim()}`
        );

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

      process.on('close', code => {
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
        log.error(`[${operationId || 'ffmpeg'}] FFmpeg error: ${err.message}`);
        if (operationId) {
          this.activeProcesses.delete(operationId);
          log.error(`[${operationId}] Process stopped tracking due to error.`);
        }
        reject(new FFmpegError(`FFmpeg error: ${err.message}`));
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

      process.on('close', code => {
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

      let stderr = '';
      ffmpegProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpegProcess.on('close', () => {
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
        log.error('Error in silence detection:', err);
        reject(err);
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
