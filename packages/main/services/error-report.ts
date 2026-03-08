import { app } from 'electron';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ErrorReportContext } from '@shared-types/app';
import { RELAY_URL, STAGE5_API_URL } from './endpoints.js';

const MAX_MAIN_LOG_TAIL_BYTES = 32 * 1024;
const MAX_MAIN_LOG_TAIL_LINES = 180;

function getMainLogFilePath(): string {
  const logDirPath = app.isPackaged ? app.getPath('logs') : '.';
  const logFileName = app.isPackaged ? 'main.log' : 'dev-main.log';
  return path.resolve(logDirPath, logFileName);
}

function countNonEmptyLines(text: string): number {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean).length;
}

function trimLogTail(text: string, maxLines: number): string {
  const normalized = text.replace(/\r\n/g, '\n');
  const firstNewline = normalized.indexOf('\n');
  const withoutPartialLine =
    firstNewline >= 0 && !normalized.startsWith('[')
      ? normalized.slice(firstNewline + 1)
      : normalized;
  const lines = withoutPartialLine.split('\n');
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n').trim();
}

async function readLogTail(filePath: string): Promise<{
  available: boolean;
  tail: string;
  error?: string;
  lineCount: number;
}> {
  try {
    const handle = await fsPromises.open(filePath, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.size) {
        return {
          available: true,
          tail: '',
          lineCount: 0,
        };
      }

      const length = Math.min(stats.size, MAX_MAIN_LOG_TAIL_BYTES);
      const offset = Math.max(0, stats.size - length);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      const tail = trimLogTail(buffer.toString('utf8'), MAX_MAIN_LOG_TAIL_LINES);
      return {
        available: true,
        tail,
        lineCount: countNonEmptyLines(tail),
      };
    } finally {
      await handle.close();
    }
  } catch (error: any) {
    return {
      available: false,
      tail: '',
      error: String(error?.message || error || 'Failed to read main log'),
      lineCount: 0,
    };
  }
}

export async function getErrorReportContext(): Promise<ErrorReportContext> {
  const logFilePath = getMainLogFilePath();
  const mainLog = await readLogTail(logFilePath);

  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      environment: app.isPackaged ? 'production' : 'development',
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      logFilePath,
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpu: os.cpus()?.[0]?.model ?? '',
      isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
    },
    endpoints: {
      stage5ApiUrl: STAGE5_API_URL,
      relayUrl: RELAY_URL,
    },
    mainLog,
  };
}
