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
  private activeProcesses = new Map<string, ChildProcess>(); // Map to track active FFmpeg processes

  constructor() {
    this.ffmpegPath = ffmpegPath.path;
    this.ffprobePath = ffprobePath.path;

    // Safely get a temp directory - use app.getPath if available, otherwise use OS temp dir
    try {
      this.tempDir = path.join(app.getPath('userData'), 'temp');
    } catch (error) {
      // Fallback to OS temp directory if app is not ready yet
      log.warn('Electron app not ready, using OS temp directory as fallback');
      this.tempDir = path.join(os.tmpdir(), 'translator-electron-temp');
    }

    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    log.info(`FFmpeg path: ${this.ffmpegPath}`);
    log.info(`FFprobe path: ${this.ffprobePath}`);
    log.info(`Temp directory: ${this.tempDir}`);
  }

  /**
   * Extract audio from a video file
   */
  async extractAudio(videoPath: string): Promise<string> {
    const outputPath = path.join(
      this.tempDir,
      `${path.basename(videoPath, path.extname(videoPath))}_audio.mp3`
    );

    try {
      await this.runFFmpeg([
        '-i',
        videoPath,
        '-vn', // No video
        '-acodec',
        'libmp3lame',
        '-q:a',
        '4', // Quality setting
        outputPath,
      ]);

      return outputPath;
    } catch (error) {
      log.error('Error extracting audio:', error);
      throw new FFmpegError(`Failed to extract audio: ${error}`);
    }
  }

  /**
   * Get the duration of a media file in seconds
   */
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

  /**
   * ===================================================
   * UNUSED & CAUSING BUILD ERRORS - Commented Out
   * ===================================================
   * Merge subtitles into a video file (Simplified version - seems unused)
   */
  // async mergeSubtitlesWithVideo(
  //   videoPath: string,
  //   subtitlesPath: string,
  //   outputPath: string,
  //   progressCallback?: (progress: { percent: number; stage: string }) => void
  // ): Promise<string> {
  //   try {
  //     // First get the duration for progress calculation
  //     const duration = await this.getMediaDuration(videoPath);
  //     log.info(`Duration for progress: ${duration}`);
  //     await this.runFFmpeg(
  //       [
  //         '-i',
  //         videoPath,
  //         '-i',
  //         subtitlesPath,
  //         '-c',
  //         'copy', // Assuming copy for simplicity, might fail
  //         '-c:s',
  //         'mov_text',
  //         '-metadata:s:s:0',
  //         'language=eng',
  //         outputPath,
  //       ],
  //       // FIX ME: Incorrect argument order here - passing duration as operationId
  //       duration.toString(), // THIS IS WRONG - Should be operationId (string), passing as string to satisfy type for now
  //       progress => {
  //         if (progressCallback) {
  //           progressCallback({
  //             percent: progress,
  //             stage: 'Merging subtitles with video',
  //           });
  //         }
  //       }
  //     );

  //     return outputPath;
  //   } catch (error) {
  //     log.error('Error merging subtitles:', error);
  //     throw new FFmpegError(`Failed to merge subtitles: ${error}`);
  //   }
  // }

  /**
   * Merge subtitles into a video file (Handles temporary files)
   */
  async mergeSubtitles(
    videoPath: string,
    subtitlesPath: string,
    outputPath: string,
    operationId: string,
    progressCallback?: (progress: { percent: number; stage: string }) => void
  ): Promise<string> {
    try {
      // First get the duration for progress calculation
      const duration = await this.getMediaDuration(videoPath);

      // Then merge the subtitles
      await this.runFFmpeg(
        [
          // Global options first
          '-loglevel',
          'verbose',
          // Then inputs
          '-i',
          videoPath,
          '-i',
          subtitlesPath,
          // Then output options (re-encode video/audio, add subtitles)
          // '-c:v', 'libx264', // Example re-encoding, adjust as needed
          // '-c:a', 'aac',     // Example re-encoding, adjust as needed
          '-c:s',
          'mov_text',
          '-metadata:s:s:0',
          'language=eng',
          // Finally, the output path
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

  /**
   * Convert SRT subtitles to ASS format
   */
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

  /**
   * Run FFmpeg with the given arguments
   */
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

      // Track the process if an ID is provided
      if (operationId) {
        this.activeProcesses.set(operationId, process);
        log.info(`[${operationId}] Process started and tracked.`);
      }

      let output = '';

      process.stderr.on('data', data => {
        const dataStr = data.toString();
        output += dataStr;
        // Log stderr chunks for debugging hangs
        log.debug(
          `[${operationId || 'ffmpeg'}] stderr chunk: ${dataStr.trim()}`
        );

        // Parse progress information if callback provided
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
        // CRITICAL LOG: Log when the process closes and its code
        log.info(
          `[${operationId || 'ffmpeg'}] 'close' event received. Exit code: ${code}`
        );

        log.info(
          `[${operationId || 'ffmpeg'}] Process exited with code ${code}.`
        );
        // Stop tracking on close
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
        // Stop tracking on error
        if (operationId) {
          this.activeProcesses.delete(operationId);
          log.error(`[${operationId}] Process stopped tracking due to error.`);
        }
        reject(new FFmpegError(`FFmpeg error: ${err.message}`));
      });
    });
  }

  /**
   * Extract a segment of audio from a file
   * @param inputPath Path to the input audio file
   * @param outputPath Path where the extracted segment will be saved
   * @param startTime Start time in seconds
   * @param duration Duration in seconds
   * @returns Promise that resolves with the output path
   */
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
        'libmp3lame', // Or 'aac' or 'copy' if applicable
        '-q:a',
        '2', // Adjust quality as needed
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
        'silencedetect=noise=-50dB:d=0.5', // Adjust parameters as needed
        '-f',
        'null',
        '-', // Output to stderr
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

        // Adjust based on common patterns if needed
        if (
          silenceEnds.length > 0 &&
          silenceEnds[0] > 0 &&
          silenceStarts.length === silenceEnds.length - 1
        ) {
          silenceStarts.unshift(0); // Assume silence starts at 0 if first end > 0
        }

        resolve({ silenceStarts, silenceEnds });
      });

      ffmpegProcess.on('error', (err: Error) => {
        log.error('Error in silence detection:', err);
        reject(err);
      });
    });
  }

  /**
   * Attempt to cancel/kill an active FFmpeg operation by its ID.
   * @param operationId The unique ID of the operation to cancel.
   * @returns True if the process was found and kill signal was sent, false otherwise.
   */
  public cancelOperation(operationId: string): boolean {
    const process = this.activeProcesses.get(operationId);
    if (process) {
      log.warn(`[${operationId}] Attempting to cancel operation.`);
      try {
        // Use SIGTERM first for graceful shutdown, could use SIGKILL for forceful
        const killed = process.kill('SIGTERM');
        if (killed) {
          log.warn(`[${operationId}] Kill signal sent successfully.`);
          // Remove immediately as the 'close' event might not fire reliably after kill
          this.activeProcesses.delete(operationId);
          return true;
        } else {
          log.error(`[${operationId}] Kill signal failed to send.`);
          // Process might have already exited but wasn't cleaned up?
          this.activeProcesses.delete(operationId);
          return false;
        }
      } catch (error: any) {
        log.error(
          `[${operationId}] Error sending kill signal: ${error.message}`
        );
        // Process might have already exited
        this.activeProcesses.delete(operationId); // Clean up map entry
        return false;
      }
    } else {
      log.warn(
        `[${operationId}] Cancel request received, but process not found (may have already finished).`
      );
      return false; // Process not found (might have finished already)
    }
  }
}
