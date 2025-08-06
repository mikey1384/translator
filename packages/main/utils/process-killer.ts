import log from 'electron-log';
import { execa } from 'execa';

/**
 * Forcefully terminate a Windows process tree using taskkill.
 * This is more reliable than POSIX signals for terminating processes like FFmpeg and yt-dlp on Windows.
 * 
 * @param pid - Process ID to terminate
 * @param logPrefix - Optional prefix for log messages (defaults to 'process-killer')
 * @returns Promise<boolean> - true if successful, false if failed
 */
export async function forceKillWindows({
  pid,
  logPrefix = 'process-killer'
}: {
  pid: number;
  logPrefix?: string;
}): Promise<boolean> {
  try {
    // Use taskkill with /F (force) and /T (tree) to kill the process and all children
    await execa('taskkill', ['/PID', pid.toString(), '/T', '/F'], {
      windowsHide: true,
    });
    
    log.info(`[${logPrefix}] Successfully force-killed process tree PID ${pid} on Windows`);
    return true;
  } catch (error) {
    log.error(`[${logPrefix}] Failed to force-kill process PID ${pid}:`, error);
    return false;
  }
}

/**
 * Cross-platform process termination with Windows-specific handling.
 * Uses taskkill on Windows for reliable termination, falls back to POSIX signals on other platforms.
 * 
 * @param childProcess - Child process to terminate
 * @param logPrefix - Optional prefix for log messages
 * @returns Promise<void>
 */
export async function terminateProcess({
  childProcess,
  logPrefix = 'process-killer'
}: {
  childProcess: { pid?: number; killed?: boolean; kill: (signal?: string) => boolean };
  logPrefix?: string;
}): Promise<void> {
  if (!childProcess || childProcess.killed) {
    return;
  }

  if (process.platform === 'win32' && childProcess.pid) {
    // On Windows, use taskkill for reliable termination
    log.info(`[${logPrefix}] Force-killing Windows process tree PID: ${childProcess.pid}`);
    
    const killed = await forceKillWindows({ pid: childProcess.pid, logPrefix });
    
    if (!killed) {
      // Fallback to signal if taskkill fails
      log.warn(`[${logPrefix}] taskkill failed, trying SIGTERM fallback`);
      try {
        childProcess.kill('SIGTERM');
      } catch {
        // Ignore errors since process might already be dead
      }
    }
  } else {
    // Non-Windows: use regular SIGINT
    try {
      childProcess.kill('SIGINT');
    } catch {
      // Ignore errors since process might already be dead
    }
  }
} 