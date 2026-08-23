import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface InstallLockLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface InstallLockOptions {
  logger: InstallLockLogger;
  isProcessLive?: (pid: number) => boolean;
  tokenFactory?: () => string;
}

interface WaitForInstallLockOptions<T> extends InstallLockOptions {
  lockFile: string;
  findReadyValue: () => Promise<T | null>;
  maxWaitTime: number;
  checkInterval: number;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
}

export type InstallLockWaitResult<T> =
  | { readyValue: T; lockToken: null }
  | { readyValue: null; lockToken: string };

function defaultIsProcessLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === 'EPERM') return true;
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function parseLockPid(lockContent: string): number | null {
  let rawPid: unknown;
  try {
    rawPid = JSON.parse(lockContent).pid;
  } catch {
    // Accept the legacy PID-only lock long enough to recover or wait for an
    // installer launched by the preceding app version.
    rawPid = lockContent.trim();
  }

  if (typeof rawPid === 'number') {
    return Number.isSafeInteger(rawPid) && rawPid > 0 ? rawPid : null;
  }
  if (typeof rawPid !== 'string' || !/^[1-9][0-9]*$/.test(rawPid)) {
    return null;
  }
  const parsedPid = Number(rawPid);
  return Number.isSafeInteger(parsedPid) ? parsedPid : null;
}

function reclaimDirectoryFor(lockFile: string): string {
  return `${lockFile}.reclaim`;
}

async function clearAbandonedReclaims(
  lockFile: string,
  isProcessLive: (pid: number) => boolean
): Promise<boolean> {
  const reclaimDirectory = reclaimDirectoryFor(lockFile);
  await fs.mkdir(reclaimDirectory, { recursive: true });
  const entries = await fs.readdir(reclaimDirectory);

  for (const entry of entries) {
    const match = /^reclaim-([1-9][0-9]*)-[0-9A-Za-z._-]+$/.exec(entry);
    if (!match) {
      throw new Error(`Unexpected installation-lock recovery entry: ${entry}`);
    }

    const reclaimerPid = Number(match[1]);
    if (!Number.isSafeInteger(reclaimerPid)) {
      throw new Error(
        `Invalid installation-lock recovery process identifier: ${match[1]}`
      );
    }
    if (isProcessLive(reclaimerPid)) return false;

    await fs.unlink(path.join(reclaimDirectory, entry)).catch((error: any) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  return true;
}

async function sameFileIdentity(
  leftPath: string,
  rightPath: string
): Promise<boolean> {
  const [left, right] = await Promise.all([
    fs.stat(leftPath, { bigint: true }),
    fs.stat(rightPath, { bigint: true }),
  ]);
  return left.dev === right.dev && left.ino === right.ino;
}

export async function acquireInstallLock(
  lockFile: string,
  options: InstallLockOptions
): Promise<string | null> {
  const { logger } = options;
  const isProcessLive = options.isProcessLive ?? defaultIsProcessLive;
  const lockToken = (options.tokenFactory ?? randomUUID)();
  if (!/^[0-9A-Za-z._-]+$/.test(lockToken)) {
    throw new Error('Installation lock token contains unsupported characters.');
  }

  try {
    await fs.mkdir(path.dirname(lockFile), { recursive: true });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!(await clearAbandonedReclaims(lockFile, isProcessLive))) {
        return null;
      }

      const candidateFile = `${lockFile}.candidate-${process.pid}-${lockToken}`;
      try {
        try {
          // Publish a complete record in one namespace operation. Creating the
          // final file and filling it in separately exposes an empty lock that
          // another process can misclassify as stale. A hard link is atomic and
          // keeps the prepared bytes on the same filesystem on every platform
          // supported by the packaged app.
          await fs.writeFile(
            candidateFile,
            `${JSON.stringify({ pid: process.pid, token: lockToken })}\n`,
            { flag: 'wx', mode: 0o600 }
          );
          await fs.link(candidateFile, lockFile);
          return lockToken;
        } finally {
          await fs.unlink(candidateFile).catch(error => {
            if (error.code !== 'ENOENT') {
              // The final lock is already a complete hard link. A leftover
              // candidate name is untidy but must not turn successful lock
              // acquisition into an unowned live lock.
              logger.warn(
                `[HeadlessChrome] Failed to remove installation-lock candidate: ${error}`
              );
            }
          });
        }
      } catch (error: any) {
        if (error.code !== 'EEXIST') throw error;
      }

      let pid: number | null = null;
      try {
        pid = parseLockPid(await fs.readFile(lockFile, 'utf8'));
      } catch (error: any) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }

      if (pid !== null && isProcessLive(pid)) {
        logger.info(
          `[HeadlessChrome] Installation already in progress (PID: ${pid})`
        );
        return null;
      }

      const reclaimFile = path.join(
        reclaimDirectoryFor(lockFile),
        `reclaim-${process.pid}-${lockToken}`
      );
      try {
        await fs.link(lockFile, reclaimFile);
      } catch (error: any) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }

      try {
        // Inspect the exact inode we linked, not a pathname that another stale
        // contender may already have removed and replaced. While this recovery
        // link exists, new publishers wait, so the identity comparison and
        // unlink cannot delete a successor's live lock.
        const snapshotContent = await fs.readFile(reclaimFile, 'utf8');
        const snapshotPid = parseLockPid(snapshotContent);
        if (snapshotPid !== null && isProcessLive(snapshotPid)) return null;

        logger.info(
          `[HeadlessChrome] Removing stale installation lock${snapshotPid === null ? '' : ` for PID ${snapshotPid}`}`
        );
        let matchesSnapshot = false;
        try {
          const currentContent = await fs.readFile(lockFile, 'utf8');
          matchesSnapshot =
            currentContent === snapshotContent &&
            (await sameFileIdentity(lockFile, reclaimFile));
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (matchesSnapshot) {
          await fs.unlink(lockFile).catch((error: any) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      } finally {
        await fs.unlink(reclaimFile).catch((error: any) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }

    return null;
  } catch (error) {
    logger.error(
      `[HeadlessChrome] Failed to acquire installation lock: ${error}`
    );
    throw error;
  }
}

export async function releaseInstallLock(
  lockFile: string,
  lockToken: string,
  logger: InstallLockLogger
): Promise<void> {
  try {
    const lockContent = await fs.readFile(lockFile, 'utf8');
    let currentToken: unknown;
    try {
      currentToken = JSON.parse(lockContent).token;
    } catch {
      currentToken = null;
    }
    if (currentToken !== lockToken) {
      logger.warn(
        '[HeadlessChrome] Installation lock ownership changed before release; leaving it intact'
      );
      return;
    }
    await fs.unlink(lockFile);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      logger.warn(
        `[HeadlessChrome] Failed to release installation lock: ${error}`
      );
    }
  }
}

export async function waitForInstallLock<T>(
  options: WaitForInstallLockOptions<T>
): Promise<InstallLockWaitResult<T>> {
  const now = options.now ?? Date.now;
  const delay =
    options.delay ??
    (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const deadline = now() + options.maxWaitTime;

  for (;;) {
    const readyValue = await options.findReadyValue();
    if (readyValue !== null) return { readyValue, lockToken: null };

    const lockToken = await acquireInstallLock(options.lockFile, options);
    if (lockToken !== null) return { readyValue: null, lockToken };

    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(
        'Headless Chrome installation timeout - concurrent installation did not complete'
      );
    }
    options.logger.info(
      '[HeadlessChrome] Waiting for concurrent installation to complete...'
    );
    await delay(Math.min(options.checkInterval, remaining));
  }
}
