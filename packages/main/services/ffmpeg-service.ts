import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { app } from 'electron';
import log from 'electron-log';
import nodeProcess from 'process';
import { createRequire } from 'module';

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
    signal,
  }: {
    videoPath: string;
    progressCallback?: (progress: { percent: number; stage?: string }) => void;
    operationId?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new FFmpegError(`Input video file not found: ${videoPath}`);
    }

    const outputPath = path.join(
      this.tempDir,
      `${path.basename(videoPath, path.extname(videoPath))}_audio.wav`
    );

    try {
      progressCallback?.({
        percent: 1,
        stage: 'Analyzing video file...',
      });

      const stats = fs.statSync(videoPath);
      const fileSizeMB = Math.round(stats.size / (1024 * 1024));
      const duration = await this.getMediaDuration(videoPath, signal);
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
      progressCallback?.({
        percent: PREP_END,
        stage: `Starting audio extraction (est. ${Math.round(estimatedTimeSeconds / 60)} min)...`,
      });
      const audioRate = '16000';
      const startTime = Date.now();
      let lastProgressPercent = EXTRACTION_START;

      const ffmpegArgs = [
        '-i',
        videoPath,
        '-vn',
        '-acodec',
        'pcm_s16le',
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
        signal,
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

  async getMediaDuration(
    filePath: string,
    signal?: AbortSignal
  ): Promise<number> {
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

      if (signal) {
        const killSig = nodeProcess.platform === 'win32' ? 'SIGTERM' : 'SIGINT';
        const onAbort = () => {
          if (!process.killed) {
            log.info(
              `[getMediaDuration] Killing ffprobe process due to abort signal`
            );
            process.kill(killSig);
          }
        };
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
          process.once('close', () =>
            signal.removeEventListener('abort', onAbort)
          );
        }
      }

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
  private runFFmpeg({
    args,
    operationId,
    totalDuration,
    progressCallback,
    env,
    filePath,
    signal,
  }: {
    args: string[];
    operationId?: string;
    totalDuration?: number;
    progressCallback?: (progress: number) => void;
    env?: NodeJS.ProcessEnv;
    filePath?: string;
    signal?: AbortSignal;
  }): Promise<void> {
    if (signal?.aborted) {
      throw new FFmpegError('Operation aborted');
    }
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
      (ffmpegProcess as any).wasCancelled = false; // flag

      if (signal) {
        const onAbort = () => {
          if (!ffmpegProcess.killed) {
            (ffmpegProcess as any).wasCancelled = true;
            try {
              const sig = process.platform === 'win32' ? 'SIGTERM' : 'SIGINT';
              ffmpegProcess.kill(sig);
            } catch {
              /* already exited */
            }
            progressCallback?.(0); // optional
          }
        };

        void (signal.aborted
          ? onAbort()
          : signal.addEventListener('abort', onAbort, { once: true }));

        const cleanupAbort = () => signal.removeEventListener('abort', onAbort);
        ffmpegProcess.once('close', cleanupAbort);
        ffmpegProcess.once('error', cleanupAbort);
      }
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

        if (operationId) {
          this.activeProcesses.delete(operationId);
          log.info(
            `[${processId}] Removed process from active map due to process error.`
          );
        }

        reject(new FFmpegError(`Failed to run ffmpeg: ${err.message}`));
      });
    });
  }

  async extractAudioSegment(opts: {
    inputPath: string;
    outputPath: string;
    startTime: number;
    duration: number;
    operationId?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const { inputPath, outputPath, startTime, duration, operationId, signal } =
      opts;
    const args = [
      '-y',
      '-ss',
      startTime.toString(),
      '-t',
      duration.toString(),
      '-i',
      inputPath,
      '-vn',
      '-af',
      'afftdn=nf=-25,agate=threshold=-30dB',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
      '-f',
      'mp3',
      outputPath,
    ];

    await this.runFFmpeg({ args, operationId, filePath: inputPath, signal });
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new FFmpegError('Output audio segment is empty or missing.');
    }
    return outputPath;
  }

  async detectSilenceBoundaries(inputAudioPath: string): Promise<{
    silenceStarts: number[];
    silenceEnds: number[];
  }> {
    return new Promise((resolve, reject) => {
      const silenceStarts: number[] = [];
      const silenceEnds: number[] = [];
      const noiseTolerance = '-35dB';
      const minSilenceDuration = '0.5';
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

  public async hasVideoTrack(filePath: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!fs.existsSync(filePath)) {
        return reject(new FFmpegError(`Input file not found: ${filePath}`));
      }
      const args = [
        '-v',
        'error',
        '-select_streams',
        'v:0', // Check for the first video stream
        '-show_entries',
        'stream=index',
        '-of',
        'csv=s=x:p=0',
        filePath,
      ];
      log.info(`[hasVideoTrack] Running ffprobe with args: ${args.join(' ')}`);
      const process = spawn(this.ffprobePath, args);

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', chunk => {
        stdout += chunk.toString();
      });
      process.stderr.on('data', chunk => {
        stderr += chunk.toString();
        log.error(`[hasVideoTrack] ffprobe stderr: ${chunk.toString()}`);
      });

      process.on('close', code => {
        if (code === 0) {
          const hasVideo = stdout.trim().length > 0;
          log.info(
            `[hasVideoTrack] Probe result for ${filePath}: ${hasVideo ? 'Has video track' : 'No video track'}`
          );
          resolve(hasVideo);
        } else {
          log.warn(
            `[hasVideoTrack] ffprobe exited with code ${code} for ${filePath}. Assuming no video track. Stderr: ${stderr}`
          );
          resolve(false);
        }
      });

      process.on('error', err => {
        log.error(
          `[hasVideoTrack] ffprobe spawn error for ${filePath}: ${err.message}`
        );
        reject(new FFmpegError(`ffprobe error: ${err.message}`));
      });
    });
  }

  async getVideoMetadata(inputPath: string): Promise<{
    duration: number;
    width: number;
    height: number;
    frameRate: number;
  }> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v',
        'error',
        '-show_entries',
        'stream=index,codec_type,width,height,r_frame_rate:format=duration',
        '-of',
        'json',
        inputPath,
      ];

      const child = execFile(this.ffprobePath, args);
      let json = '',
        stderr = '';

      child.stdout?.on('data', d => (json += d));
      child.stderr?.on('data', d => (stderr += d));

      child.on('error', err =>
        reject(new FFmpegError(`ffprobe exec error: ${err.message}`))
      );

      child.on('close', code => {
        if (code !== 0) {
          return reject(
            new FFmpegError(
              `ffprobe exited with ${code}. ${stderr || 'no stderr'}`
            )
          );
        }

        try {
          const data = JSON.parse(json);
          const streams = data.streams ?? [];

          // first video stream if it exists, else first stream (audio)
          const v =
            streams.find((s: any) => s.codec_type === 'video') ||
            streams[0] ||
            {};

          const width = Number(v.width ?? 0) || 0;
          const height = Number(v.height ?? 0) || 0;

          let frameRate = 0;
          if (typeof v.r_frame_rate === 'string') {
            const [num, den] = v.r_frame_rate.split('/');
            frameRate = den && Number(den) ? Number(num) / Number(den) : 0;
          }

          const duration =
            parseFloat(v.duration ?? data.format?.duration ?? '0') || 0;

          if (!duration)
            throw new Error('duration not found in ffprobe output');

          resolve({ duration, width, height, frameRate });
        } catch (err: any) {
          reject(
            new FFmpegError(`Failed to parse ffprobe output: ${err.message}`)
          );
        }
      });
    });
  }

  async makeBlackVideo({
    out,
    w,
    h,
    fps,
    dur,
  }: {
    out: string;
    w: number;
    h: number;
    fps: number;
    dur: number;
  }) {
    await this.runFFmpeg({
      args: [
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${w}x${h}:r=${fps}`,
        '-t',
        String(dur),

        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '22',

        '-pix_fmt',
        'yuv420p',
        '-an',
        out,
      ],
      operationId: 'makeBlackVideo',
    });
  }
}
