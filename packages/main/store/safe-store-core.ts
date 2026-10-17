import fs from 'node:fs';
import path from 'node:path';

// Electron-free core of the safe store, so it can be unit tested with `conf`.

export type SafeStoreLogger = {
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type QuarantinedStoreFile = {
  /** Where the unreadable file was moved. */
  quarantinedPath: string;
  /** Raw text of the unreadable file ('' when it could not be read). */
  rawContent: string;
};

export type OpenStoreSafelyOptions<S> = {
  filePath: string;
  create: () => S;
  logger?: SafeStoreLogger;
  now?: () => Date;
  onQuarantined?: (info: QuarantinedStoreFile) => void;
};

function timestampForFileName(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function buildQuarantinePath(filePath: string, date: Date): string {
  const ext = path.extname(filePath);
  const base = ext ? filePath.slice(0, -ext.length) : filePath;
  return `${base}.corrupt-${timestampForFileName(date)}${ext || '.json'}`;
}

function quarantineFile(
  filePath: string,
  date: Date
): QuarantinedStoreFile | null {
  if (!fs.existsSync(filePath)) return null;
  let rawContent = '';
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch {
    rawContent = '';
  }
  let quarantinedPath = buildQuarantinePath(filePath, date);
  for (let i = 1; fs.existsSync(quarantinedPath); i++) {
    quarantinedPath = buildQuarantinePath(filePath, date).replace(
      /(\.[^.]+)$/,
      `-${i}$1`
    );
  }
  fs.renameSync(filePath, quarantinedPath);
  return { quarantinedPath, rawContent };
}

/**
 * Opens a JSON-backed store. When the file on disk can't be read (truncated
 * by a crash, emptied by a full disk, mangled by a sync tool), the bad file is
 * moved aside with a timestamp, never deleted, and a fresh store is created,
 * so one damaged file can't stop the app from launching.
 */
export function openStoreSafely<S>({
  filePath,
  create,
  logger = console,
  now = () => new Date(),
  onQuarantined,
}: OpenStoreSafelyOptions<S>): S {
  try {
    return create();
  } catch (error) {
    let quarantined: QuarantinedStoreFile | null = null;
    try {
      quarantined = quarantineFile(filePath, now());
    } catch (moveError) {
      logger.error(
        `[safe-store] Could not move unreadable ${filePath} aside:`,
        moveError
      );
    }
    if (!quarantined) throw error;
    logger.warn(
      `[safe-store] ${path.basename(filePath)} was unreadable and was moved to ${quarantined.quarantinedPath}; starting fresh.`,
      error
    );
    const store = create();
    try {
      onQuarantined?.(quarantined);
    } catch (recoverError) {
      logger.error(
        `[safe-store] Recovery after quarantining ${filePath} failed:`,
        recoverError
      );
    }
    return store;
  }
}

const DEVICE_ID_PATTERN = /"deviceId"\s*:\s*"([^"\s]{8,128})"/;

/** Pulls a device id out of a damaged JSON file's raw text, if it survived. */
export function salvageDeviceId(rawContent: string): string | null {
  const match = DEVICE_ID_PATTERN.exec(rawContent || '');
  return match ? match[1] : null;
}

function cleanId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The device id (which the user's credits are tied to) is kept in two files.
 * Prefer the primary copy, then the mirror, then whatever was salvaged from a
 * quarantined file, and only mint a new id when every copy is gone.
 */
export function resolveDeviceId({
  primary,
  mirror,
  salvaged,
  generate,
}: {
  primary: unknown;
  mirror: unknown;
  salvaged?: Array<string | null | undefined>;
  generate: () => string;
}): {
  id: string;
  writePrimary: boolean;
  writeMirror: boolean;
  /** No copy survived: the id was just minted. */
  generated: boolean;
} {
  const primaryId = cleanId(primary);
  const mirrorId = cleanId(mirror);
  const salvagedId = (salvaged || []).map(cleanId).find(Boolean) || null;
  const existing = primaryId || mirrorId || salvagedId;
  const id = existing || generate();
  return {
    id,
    generated: !existing,
    writePrimary: primaryId !== id,
    writeMirror: mirrorId !== id,
  };
}

/** One-time notices the renderer shows after a damaged store was reset. */
export type StartupNotice = 'settingsReset' | 'deviceIdReplaced';

/**
 * Which resets the user must hear about: preferences lost with a damaged
 * app-settings file, and a device id minted because every copy of the old
 * one was damaged (purchased minutes stay on the old id). A first launch
 * also mints an id, but no store was quarantined then, so it stays silent.
 */
export function startupNoticesFor({
  quarantinedStores,
  deviceIdGenerated,
}: {
  quarantinedStores: Iterable<string>;
  deviceIdGenerated: boolean;
}): StartupNotice[] {
  const names = new Set(quarantinedStores);
  const notices: StartupNotice[] = [];
  if (names.has('app-settings')) notices.push('settingsReset');
  if (
    deviceIdGenerated &&
    (names.has('device-config') || names.has('stage5-auth'))
  ) {
    notices.push('deviceIdReplaced');
  }
  return notices;
}
