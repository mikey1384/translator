import { spawn } from 'child_process';
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
   * Merge subtitles with a video file
   */
  async mergeSubtitlesWithVideo(
    videoPath: string,
    subtitlesPath: string,
    progressCallback?: (progress: number) => void
  ): Promise<string> {
    const outputPath = path.join(
      this.tempDir,
      `${path.basename(
        videoPath,
        path.extname(videoPath)
      )}_subtitled${path.extname(videoPath)}`
    );

    try {
      // First get the duration for progress calculation
      const duration = await this.getMediaDuration(videoPath);

      // Then merge the subtitles
      await this.runFFmpeg(
        [
          '-i',
          videoPath,
          '-i',
          subtitlesPath,
          '-c:v',
          'copy',
          '-c:a',
          'copy',
          '-c:s',
          'mov_text',
          '-metadata:s:s:0',
          'language=eng',
          outputPath,
        ],
        duration,
        progressCallback
      );

      return outputPath;
    } catch (error) {
      log.error('Error merging subtitles:', error);
      throw new FFmpegError(`Failed to merge subtitles: ${error}`);
    }
  }

  /**
   * Merge subtitles with a video file and specify the output path
   */
  async mergeSubtitles(
    videoPath: string,
    subtitlesPath: string,
    outputPath: string,
    progressCallback?: (progress: { percent: number; stage: string }) => void
  ): Promise<string> {
    try {
      // First get the duration for progress calculation
      const duration = await this.getMediaDuration(videoPath);

      // Then merge the subtitles
      await this.runFFmpeg(
        [
          '-i',
          videoPath,
          '-i',
          subtitlesPath,
          '-c:v',
          'copy',
          '-c:a',
          'copy',
          '-c:s',
          'mov_text',
          '-metadata:s:s:0',
          'language=eng',
          outputPath,
        ],
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
    totalDuration?: number,
    progressCallback?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.ffmpegPath, args);
      let output = '';

      process.stderr.on('data', data => {
        const dataStr = data.toString();
        output += dataStr;

        // Parse progress information if callback provided
        if (progressCallback && totalDuration) {
          const timeMatch = dataStr.match(/time=(\d+):(\d+):(\d+.\d+)/);
          if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
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
        'libmp3lame',
        '-q:a',
        '2', // Using higher quality setting (2 is better than 4)
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

        // If the first silence_end is after 0, add a silence_start at 0
        if (silenceEnds.length > 0 && silenceEnds[0] > 0) {
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
}
