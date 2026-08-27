import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import fsp from 'node:fs/promises';

type DownloadLibraryLogger = {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
};

export type ReclaimUrlDownloadLibraryResult = {
  /** Paths deleted by this call or already absent when deletion was attempted. */
  reclaimedPaths: string[];
  /** Paths whose regular files were unlinked by this call. */
  deletedPaths: string[];
  /** Paths that were already absent when this call checked them. */
  alreadyAbsentPaths: string[];
  failedPaths: Array<{ filePath: string; error: string }>;
};

export type UrlDownloadPromotionOwnership = {
  rollback: () => Promise<void>;
};

export const URL_DOWNLOAD_LIBRARY_DIRNAME = 'downloaded-media';
export const URL_DOWNLOAD_PROMOTION_PARTIAL_DIRNAME =
  '.stage5-url-promotion-partials';
export const LEGACY_URL_DOWNLOAD_SCRATCH_DIRNAME = 'translator-electron';
export const URL_DOWNLOAD_SCRATCH_DIRNAME = {
  production: 'translator-electron-work',
  development: 'translator-electron-dev-work',
} as const;

export function getUrlDownloadLibraryDir(userDataDir: string): string {
  return path.join(userDataDir, URL_DOWNLOAD_LIBRARY_DIRNAME);
}

export function getUrlDownloadPromotionPartialDir(libraryDir: string): string {
  return path.join(libraryDir, URL_DOWNLOAD_PROMOTION_PARTIAL_DIRNAME);
}

/**
 * Removes staged promotions left by crashes or power loss. Incomplete files
 * live in a dedicated app-owned directory, so startup cleanup never has to
 * infer ownership from user-visible media filenames.
 */
export async function cleanupInterruptedUrlDownloadPromotions(options: {
  libraryDir: string;
  logger?: DownloadLibraryLogger;
}): Promise<void> {
  const libraryDir = String(options.libraryDir || '');
  if (!libraryDir) {
    throw new Error('The download library is required for partial cleanup.');
  }
  const partialDir = getUrlDownloadPromotionPartialDir(libraryDir);
  await fsp.rm(partialDir, { recursive: true, force: true });
  options.logger?.info?.(
    `[url-download-library] Cleaned interrupted promotion directory: ${partialDir}`
  );
}

export function getUrlDownloadScratchDir(
  systemTempDir: string,
  isPackaged: boolean
): string {
  return path.join(
    systemTempDir,
    isPackaged
      ? URL_DOWNLOAD_SCRATCH_DIRNAME.production
      : URL_DOWNLOAD_SCRATCH_DIRNAME.development
  );
}

export function getLegacyUrlDownloadScratchDir(systemTempDir: string): string {
  return path.join(systemTempDir, LEGACY_URL_DOWNLOAD_SCRATCH_DIRNAME);
}

/**
 * Reclaims scratch files left by releases that predate the separate
 * production/development work directories. Running this on every packaged
 * startup is intentional: a crash during a previous cleanup is retried later.
 */
export async function cleanupLegacyUrlDownloadScratchDir(options: {
  systemTempDir: string;
  logger?: DownloadLibraryLogger;
}): Promise<void> {
  const systemTempDir = String(options.systemTempDir || '');
  if (!systemTempDir) {
    throw new Error(
      'The system temp directory is required for legacy cleanup.'
    );
  }

  const legacyDir = getLegacyUrlDownloadScratchDir(systemTempDir);
  await fsp.rm(legacyDir, { recursive: true, force: true });
  options.logger?.info?.(
    `[url-download-library] Cleaned legacy scratch directory: ${legacyDir}`
  );
}

function sanitizeOperationId(operationId: string): string {
  return String(operationId || 'download')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw error;
  }
}

export function isUrlDownloadLibraryFilePath(
  libraryDirValue: string,
  filePathValue: string
): boolean {
  const libraryDir = path.resolve(String(libraryDirValue || ''));
  const filePath = path.resolve(String(filePathValue || ''));
  const relativePath = path.relative(libraryDir, filePath);
  return (
    Boolean(relativePath) &&
    !path.isAbsolute(relativePath) &&
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== '..' &&
    path.dirname(relativePath) === '.'
  );
}

/**
 * Deletes managed downloads whose renderer history ownership ended. Only
 * direct, regular-file children of the app's download library are eligible;
 * renderer-provided paths can never escape into arbitrary user storage.
 */
export async function reclaimUrlDownloadLibraryFiles(options: {
  libraryDir: string;
  filePaths: string[];
  logger?: DownloadLibraryLogger;
}): Promise<ReclaimUrlDownloadLibraryResult> {
  const libraryDir = path.resolve(String(options.libraryDir || ''));
  const candidates = Array.from(
    new Set(
      (Array.isArray(options.filePaths) ? options.filePaths : [])
        .map(filePath => String(filePath || '').trim())
        .filter(Boolean)
        .map(filePath => path.resolve(filePath))
    )
  );
  const result: ReclaimUrlDownloadLibraryResult = {
    reclaimedPaths: [],
    deletedPaths: [],
    alreadyAbsentPaths: [],
    failedPaths: [],
  };

  for (const filePath of candidates) {
    if (!isUrlDownloadLibraryFilePath(libraryDir, filePath)) {
      options.logger?.warn?.(
        `[url-download-library] Refusing to reclaim a path outside the managed library: ${filePath}`
      );
      continue;
    }

    try {
      const stats = await fsp.lstat(filePath);
      if (!stats.isFile()) {
        options.logger?.warn?.(
          `[url-download-library] Refusing to reclaim a non-file library entry: ${filePath}`
        );
        continue;
      }
      await fsp.unlink(filePath);
      result.reclaimedPaths.push(filePath);
      result.deletedPaths.push(filePath);
      options.logger?.info?.(
        `[url-download-library] Reclaimed unowned managed download: ${filePath}`
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        // The desired disk state is already satisfied. Reporting the path as
        // reclaimed lets durable cleanup ownership end without conflating a
        // refused, still-existing directory or symlink with success.
        result.reclaimedPaths.push(filePath);
        result.alreadyAbsentPaths.push(filePath);
        continue;
      }
      const message =
        error instanceof Error
          ? error.message
          : String(error || 'Unknown error');
      result.failedPaths.push({ filePath, error: message });
      options.logger?.warn?.(
        `[url-download-library] Failed to reclaim managed download: ${filePath}`,
        error
      );
    }
  }

  return result;
}

type DestinationReservation = {
  destinationPath: string;
  reservationPath: string;
};

function reservationIdentity(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function tryReserveDestinationPath(
  partialDir: string,
  destinationPath: string
): Promise<DestinationReservation | null> {
  if (await pathExists(destinationPath)) return null;
  const reservationPath = path.join(
    partialDir,
    `${createHash('sha256')
      .update(reservationIdentity(destinationPath))
      .digest('hex')}.reserve`
  );
  let handle: Awaited<ReturnType<typeof fsp.open>> | null = null;
  try {
    handle = await fsp.open(reservationPath, 'wx', 0o600);
    await handle.close();
    handle = null;
  } catch (error) {
    await handle?.close().catch(() => void 0);
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return null;
    throw error;
  }
  if (await pathExists(destinationPath)) {
    await fsp.rm(reservationPath, { force: true });
    return null;
  }
  return { destinationPath, reservationPath };
}

async function reserveDestinationPath(
  libraryDir: string,
  sourcePath: string,
  operationId: string,
  partialDir: string
): Promise<DestinationReservation> {
  const sourceName = path.basename(sourcePath);
  const extension = path.extname(sourceName);
  const stem = path.basename(sourceName, extension);
  const operationSuffix = sanitizeOperationId(operationId);
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate =
      suffix === 0
        ? path.join(libraryDir, sourceName)
        : path.join(
            libraryDir,
            `${stem}-${operationSuffix || 'download'}${suffix === 1 ? '' : `-${suffix}`}${extension}`
          );
    const reservation = await tryReserveDestinationPath(partialDir, candidate);
    if (reservation) return reservation;
  }

  throw new Error('Could not reserve a unique path for the downloaded video.');
}

/**
 * Transfers ownership of a completed URL download from disposable scratch
 * storage to the app's persistent media library. The returned path is the only
 * path renderers should mount or retain in download history.
 */
export async function promoteUrlDownload(options: {
  sourcePath: string;
  libraryDir: string;
  operationId: string;
  persistDestinationOwnership: (
    destinationPath: string
  ) => Promise<UrlDownloadPromotionOwnership>;
  logger?: DownloadLibraryLogger;
}): Promise<string> {
  const sourcePath = path.resolve(String(options.sourcePath || ''));
  const libraryDir = path.resolve(String(options.libraryDir || ''));
  const operationId = String(options.operationId || '').trim();

  if (
    !options.sourcePath ||
    !options.libraryDir ||
    !operationId ||
    typeof options.persistDestinationOwnership !== 'function'
  ) {
    throw new Error(
      'A source path, library directory, operation ID, and ownership persistence callback are required.'
    );
  }

  const sourceStats = await fsp.stat(sourcePath);
  if (!sourceStats.isFile() || sourceStats.size <= 0) {
    throw new Error('The completed URL download is missing or empty.');
  }

  await fsp.mkdir(libraryDir, { recursive: true });
  const partialDir = getUrlDownloadPromotionPartialDir(libraryDir);
  const partialPath = path.join(
    partialDir,
    `${sanitizeOperationId(operationId) || 'download'}-${randomUUID()}.partial`
  );
  let movedSourceToPartial = false;
  let copiedSourceToPartial = false;
  let reservation: DestinationReservation | null = null;
  let ownership: UrlDownloadPromotionOwnership | null = null;
  let ownershipAttempted = false;
  let published = false;

  await fsp.mkdir(partialDir, { recursive: true });
  try {
    try {
      await fsp.rename(sourcePath, partialPath);
      movedSourceToPartial = true;
    } catch (error) {
      const renameError = error as NodeJS.ErrnoException;
      if (renameError.code !== 'EXDEV') throw error;

      await fsp.copyFile(sourcePath, partialPath, constants.COPYFILE_EXCL);
      copiedSourceToPartial = true;
    }

    reservation = await reserveDestinationPath(
      libraryDir,
      sourcePath,
      operationId,
      partialDir
    );
    // Persist the reclaim claim only after staging is complete, but before
    // the final path becomes visible. A crash can now leave a startup-cleaned
    // partial or a claimed final file, never an unclaimed persistent file.
    ownershipAttempted = true;
    ownership = await options.persistDestinationOwnership(
      reservation.destinationPath
    );
    if (!ownership || typeof ownership.rollback !== 'function') {
      throw new Error(
        'Persistent download ownership must provide caller-scoped rollback.'
      );
    }
    // The reservation serializes app promotions. link() is the publication
    // boundary: it is atomic on the library filesystem and fails with EEXIST
    // instead of replacing a path created by any outside actor.
    await fsp.link(partialPath, reservation.destinationPath);
    published = true;
  } catch (error) {
    let ownershipRolledBack = false;
    if (ownership && !published) {
      try {
        await ownership.rollback();
        ownershipRolledBack = true;
      } catch (rollbackError) {
        options.logger?.warn?.(
          '[url-download-library] Failed to roll back unpublished destination ownership; retaining its hidden reservation for recovery.',
          rollbackError
        );
      }
    }
    if (reservation && (!ownershipAttempted || ownershipRolledBack)) {
      await fsp
        .rm(reservation.reservationPath, { force: true })
        .catch(() => void 0);
    }
    if (movedSourceToPartial) {
      try {
        await fsp.link(partialPath, sourcePath);
        await fsp.rm(partialPath, { force: true });
      } catch (restoreError) {
        options.logger?.warn?.(
          `[url-download-library] Failed to restore the staged source without replacing a newer scratch file; retaining the hidden partial: ${partialPath}`,
          restoreError
        );
      }
    } else {
      await fsp.rm(partialPath, { force: true }).catch(() => void 0);
    }
    throw error;
  }

  await fsp.rm(partialPath, { force: true }).catch(error => {
    options.logger?.warn?.(
      `[url-download-library] Published download retained a cleanup partial: ${partialPath}`,
      error
    );
  });
  await fsp.rm(reservation!.reservationPath, { force: true }).catch(error => {
    options.logger?.warn?.(
      `[url-download-library] Published download retained a destination reservation: ${reservation!.reservationPath}`,
      error
    );
  });

  if (copiedSourceToPartial) {
    try {
      await fsp.unlink(sourcePath);
    } catch (unlinkError) {
      options.logger?.warn?.(
        `[url-download-library] Persistent copy was created, but the scratch source could not be removed: ${sourcePath}`,
        unlinkError
      );
    }
  }

  options.logger?.info?.(
    `[url-download-library] Promoted accepted URL download ${operationId}: ${sourcePath} -> ${reservation!.destinationPath}`
  );
  return reservation!.destinationPath;
}
