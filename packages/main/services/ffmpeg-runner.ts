import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import process from 'process';
import which from 'which';
import { app } from 'electron';

log.info(
  '[ffmpeg-runner] module loaded ***',
  new Error().stack?.split('\n')[2]
);

export class FFmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FFmpegError';
  }
}

export interface FFmpegContext {
  readonly tempDir: string;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  run(args: string[], opts?: RunOpts): Promise<void>;
  getMediaDuration(file: string, signal?: AbortSignal): Promise<number>;
  hasVideoTrack(file: string): Promise<boolean>;
  getVideoMetadata(file: string): Promise<VideoMeta>;
  cancelOperation(id: string): void;
}

export interface RunOpts {
  operationId?: string;
  totalDuration?: number;
  progress?: (pct: number) => void;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface AudioSliceOpts {
  input: string;
  output: string;
  start: number;
  duration: number;
  operationId?: string;
  signal?: AbortSignal;
}

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  frameRate: number;
}

let _ffmpegCached: string | null = null;

async function pickBinary(
  bundled: () => Promise<string>,
  fallbackName: string
): Promise<string> {
  // 1. bundled copy
  try {
    const p = await bundled();
    return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p;
  } catch {
    log.debug(`[ffmpeg-runner] no bundled ${fallbackName} module`);
  }

  // 2. user PATH
  const p = which.sync(fallbackName, { nothrow: true });
  if (p) return p;

  throw new Error(`${fallbackName} executable not available`);
}

export async function findFfmpeg(): Promise<string> {
  if (_ffmpegCached) return _ffmpegCached;
  const ffmpegPath = await pickBinary(async () => {
    const mod = await import('@ffmpeg-installer/ffmpeg');
    let p = mod.path as string;
    if (app.isPackaged) p = p.replace('app.asar', 'app.asar.unpacked');
    return p;
  }, 'ffmpeg');
  _ffmpegCached = ffmpegPath;
  log.info(`[ffmpeg-runner] final ffmpeg path => ${ffmpegPath}`);
  return ffmpegPath;
}

let _ffprobeCached: string | null = null;
export async function findFfprobe(): Promise<string> {
  if (_ffprobeCached) return _ffprobeCached;
  const ffprobePath = await pickBinary(async () => {
    const mod = await import('@ffprobe-installer/ffprobe');
    let p = mod.path as string;
    if (app.isPackaged) p = p.replace('app.asar', 'app.asar.unpacked');
    return p;
  }, 'ffprobe');
  _ffprobeCached = ffprobePath;
  log.info(`[ffmpeg-runner] final ffprobe path => ${ffprobePath}`);
  return ffprobePath;
}

export const resolvedFfmpeg = () => _ffmpegCached;
export const resolvedFfprobe = () => _ffprobeCached;

export async function createFFmpegContext(
  tempDirPath: string
): Promise<FFmpegContext> {
  const ffmpegPath = await findFfmpeg();
  const ffprobePath = await findFfprobe();

  if (!tempDirPath)
    throw new Error('createFFmpegContext requires a tempDirPath');
  if (!fs.existsSync(tempDirPath)) {
    fs.mkdirSync(tempDirPath, { recursive: true });
    log.info(
      `[ffmpeg-runner] re-created missing temp directory: ${tempDirPath}`
    );
  }
  const tempDir = path.resolve(tempDirPath);

  const active = new Map<string, ChildProcessWithoutNullStreams>();

  async function run(args: string[], opts: RunOpts = {}): Promise<void> {
    const { operationId, totalDuration, progress, cwd, env, signal } = opts;
    if (signal?.aborted) throw new FFmpegError('Operation aborted');

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
      log.info(`[ffmpeg-runner] re-created missing temp directory: ${tempDir}`);
    }
    const spawnOpts = {
      env: env ?? process.env,
      cwd: cwd ?? tempDir,
    } as const;

    log.info(
      `[ffmpeg ${operationId ?? 'no-id'}]`,
      `${ffmpegPath} ${args.join(' ')}`
    );
    const child = spawn(ffmpegPath, args, spawnOpts);
    if (operationId) {
      active.set(operationId, child);
    }

    const stderrBuf: string[] = [];
    child.stderr.on('data', d => {
      const line = d.toString();
      stderrBuf.push(line);
      log.error(`[ffmpeg ${operationId ?? 'no-id'}] ${line}`);
      if (totalDuration && progress)
        parseProgress(line, totalDuration, progress);
    });

    if (signal) {
      const abort = () => {
        if (!child.killed)
          child.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGINT');
      };
      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener('abort', abort, { once: true });
      }
      child.once('close', () => signal.removeEventListener('abort', abort));
    }

    return new Promise<void>((resolve, reject) => {
      child.on('error', err => done(err));
      child.on('close', code => {
        if (operationId && active.get(operationId) === child) {
          active.delete(operationId);
        }
        if (code === 0) done();
        else done(new FFmpegError(`ffmpeg exited with code ${code}`));
      });

      function done(err?: Error) {
        if (err) {
          log.error(`[ffmpeg ${operationId ?? 'no-id'}]`, err.message);
          reject(err);
        } else resolve();
      }
    });
  }

  function parseProgress(line: string, total: number, cb: (p: number) => void) {
    const m = line.match(/time=(\d{2}):(\d{2}):(\d{2})(?:\.(\d{2}))?/);
    if (!m) return;
    const [, hh, mm, ss, cs = '0'] = m;
    const cur = +hh * 3600 + +mm * 60 + +ss + +cs / 100;
    cb(Math.min(100, (cur / total) * 100));
  }

  function getMediaDuration(
    file: string,
    signal?: AbortSignal
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file,
      ];
      const p = spawn(ffprobePath, args);
      let out = '';
      p.stdout.on('data', d => (out += d));
      p.stderr.on('data', d => log.debug(`[ffprobe] ${d}`));
      if (signal) {
        const abort = () => !p.killed && p.kill();
        if (signal.aborted) {
          abort();
        } else {
          signal.addEventListener('abort', abort, { once: true });
        }
      }
      p.on('close', c => {
        if (c === 0) {
          const sec = parseFloat(out.trim());
          return isNaN(sec)
            ? reject(new FFmpegError('could not parse duration'))
            : resolve(sec);
        }
        reject(new FFmpegError(`ffprobe exited with ${c}`));
      });
    });
  }

  function hasVideoTrack(file: string): Promise<boolean> {
    return new Promise(res => {
      const p = spawn(ffprobePath, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=s=x:p=0',
        file,
      ]);
      let out = '';
      p.stdout.on('data', d => (out += d));
      p.on('close', () => res(out.trim().length > 0));
    });
  }

  function getVideoMetadata(file: string): Promise<VideoMeta> {
    return new Promise((resolve, reject) => {
      const p = execFile(ffprobePath, [
        '-v',
        'error',
        '-show_entries',
        'stream=index,codec_type,width,height,r_frame_rate:format=duration',
        '-of',
        'json',
        file,
      ]);
      let json = '';
      p.stdout?.on('data', d => (json += d));
      p.on('close', code => {
        if (code !== 0)
          return reject(new FFmpegError(`ffprobe exited with ${code}`));
        try {
          const data = JSON.parse(json);
          const v =
            data.streams?.find((s: any) => s.codec_type === 'video') || {};
          const [num, den] = (v.r_frame_rate || '0/1').split('/');
          resolve({
            duration: parseFloat(data.format?.duration ?? '0'),
            width: +v.width || 0,
            height: +v.height || 0,
            frameRate: +den ? +num / +den : 0,
          });
        } catch (e: any) {
          reject(new FFmpegError(`parse ffprobe json failed: ${e.message}`));
        }
      });
    });
  }

  function cancelOperation(id: string) {
    const p = active.get(id);
    if (p && !p.killed) {
      p.kill('SIGKILL');
      active.delete(id);
      log.info(`[ffmpeg-runner] cancelled ${id}`);
    }
  }

  // DEBUG: Prove we can spawn inside Electron too

  return {
    tempDir,
    ffmpegPath,
    ffprobePath,
    run,
    getMediaDuration,
    hasVideoTrack,
    getVideoMetadata,
    cancelOperation,
  };
}
