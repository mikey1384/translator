import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { SrtSegment } from '@shared-types/app';
import {
  buildSubtitleSidecarContent,
  restoreSegmentsFromSubtitleSidecar,
} from '../../shared/helpers/subtitle-sidecar.js';

const SAVED_SUBTITLE_METADATA_DIR_NAME = 'saved-subtitle-metadata';
const SAVED_SUBTITLE_METADATA_SUFFIX = '.json';
const require = createRequire(import.meta.url);

function getElectronApp(): { getPath(name: string): string } {
  return require('electron').app as { getPath(name: string): string };
}

function resolveSavedSubtitleMetadataRootDir(rootDir?: string): string {
  return (
    rootDir ||
    path.join(
      getElectronApp().getPath('userData'),
      SAVED_SUBTITLE_METADATA_DIR_NAME
    )
  );
}

function normalizeSavedSubtitlePath(filePath: string): string {
  return path.normalize(String(filePath || '').trim());
}

export function getSavedSubtitleMetadataCachePath(
  filePath: string,
  rootDir?: string
): string {
  const normalizedPath = normalizeSavedSubtitlePath(filePath);
  const hash = createHash('sha256').update(normalizedPath).digest('hex');
  return path.join(
    resolveSavedSubtitleMetadataRootDir(rootDir),
    `${hash}${SAVED_SUBTITLE_METADATA_SUFFIX}`
  );
}

export async function writeTextFileAtomically(
  filePath: string,
  content: string
): Promise<void> {
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });

  const tempPath = path.join(
    dirPath,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {
      // Ignore temp cleanup failures after the real write error.
    }
    throw error;
  }
}

async function writeWithRetries(
  writer: () => Promise<void>,
  maxAttempts = 2
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await writer();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 50 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function saveSavedSubtitleMetadata(args: {
  filePath: string;
  srtContent: string;
  segments: SrtSegment[];
  rootDir?: string;
}): Promise<void> {
  const normalizedPath = normalizeSavedSubtitlePath(args.filePath);
  if (!normalizedPath) {
    throw new Error('A saved subtitle path is required to cache metadata.');
  }

  const cachePath = getSavedSubtitleMetadataCachePath(
    normalizedPath,
    args.rootDir
  );
  const cacheContent = buildSubtitleSidecarContent({
    segments: args.segments,
    srtContent: args.srtContent,
  });

  await writeWithRetries(() =>
    writeTextFileAtomically(cachePath, cacheContent)
  );
}

export async function readSavedSubtitleMetadata(args: {
  filePath: string;
  srtContent: string;
  rootDir?: string;
}): Promise<SrtSegment[] | null> {
  const normalizedPath = normalizeSavedSubtitlePath(args.filePath);
  if (!normalizedPath) {
    return null;
  }

  const cachePath = getSavedSubtitleMetadataCachePath(
    normalizedPath,
    args.rootDir
  );

  try {
    const cacheContent = await fs.readFile(cachePath, 'utf8');
    return restoreSegmentsFromSubtitleSidecar({
      srtContent: args.srtContent,
      sidecarContent: cacheContent,
    });
  } catch {
    return null;
  }
}
