import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { app } from "electron";
import log from "electron-log";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import ffprobePath from "@ffprobe-installer/ffprobe";
import os from "os";

export class FFmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FFmpegError";
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
      this.tempDir = path.join(app.getPath("userData"), "temp");
    } catch (error) {
      // Fallback to OS temp directory if app is not ready yet
      log.warn("Electron app not ready, using OS temp directory as fallback");
      this.tempDir = path.join(os.tmpdir(), "translator-electron-temp");
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
        "-i",
        videoPath,
        "-vn", // No video
        "-acodec",
        "libmp3lame",
        "-q:a",
        "4", // Quality setting
        outputPath,
      ]);

      return outputPath;
    } catch (error) {
      log.error("Error extracting audio:", error);
      throw new FFmpegError(`Failed to extract audio: ${error}`);
    }
  }

  /**
   * Get the duration of a media file in seconds
   */
  async getMediaDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.ffprobePath, [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ]);

      let output = "";

      process.stdout.on("data", (data) => {
        output += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          if (isNaN(duration)) {
            reject(new FFmpegError("Could not parse media duration"));
          } else {
            resolve(duration);
          }
        } else {
          reject(new FFmpegError(`FFprobe process exited with code ${code}`));
        }
      });

      process.on("error", (err) => {
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
          "-i",
          videoPath,
          "-i",
          subtitlesPath,
          "-c:v",
          "copy",
          "-c:a",
          "copy",
          "-c:s",
          "mov_text",
          "-metadata:s:s:0",
          "language=eng",
          outputPath,
        ],
        duration,
        progressCallback
      );

      return outputPath;
    } catch (error) {
      log.error("Error merging subtitles:", error);
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
      await this.runFFmpeg(["-i", srtPath, outputPath]);

      return outputPath;
    } catch (error) {
      log.error("Error converting SRT to ASS:", error);
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
      let output = "";

      process.stderr.on("data", (data) => {
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

      process.on("close", (code) => {
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

      process.on("error", (err) => {
        reject(new FFmpegError(`FFmpeg error: ${err.message}`));
      });
    });
  }

  /**
   * Extract a segment of audio from a file
   */
  async extractAudioSegment(
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.ffmpegPath, [
        "-i",
        inputPath,
        "-ss",
        startTime.toString(),
        "-t",
        duration.toString(),
        "-acodec",
        "libmp3lame",
        "-q:a",
        "4",
        outputPath,
      ]);

      process.on("close", (code) => {
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

      process.on("error", (err) => {
        reject(
          new FFmpegError(`Error extracting audio segment: ${err.message}`)
        );
      });
    });
  }
}
