import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { app } from 'electron';
import { settingsStore } from '../../store/settings-store.js';

/**
 * Where a video export lands when the user hasn't picked a place: the last
 * folder they exported to, else the video's own folder, else Movies/Videos.
 * Paths picked in our own save dialog are remembered here so a render
 * request can only write to a path the user actually chose.
 */

const chosenPaths = new Set<string>();

export function registerChosenExportPath(filePath: string): void {
  chosenPaths.add(path.resolve(filePath));
}

export function isChosenExportPath(filePath: string): boolean {
  return chosenPaths.has(path.resolve(filePath));
}

export function forgetChosenExportPath(filePath: string): void {
  chosenPaths.delete(path.resolve(filePath));
}

async function isWritableDirectory(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return false;
    await fs.access(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

/** App-private folders (downloads cache, temp) are not where people look. */
function isAppPrivateDirectory(dir: string): boolean {
  const privateRoots = [os.tmpdir()];
  try {
    privateRoots.push(app.getPath('userData'), app.getPath('temp'));
  } catch {
    // Not available outside Electron (tests).
  }
  return privateRoots.some(root => root && isInside(dir, root));
}

function safeAppPath(
  name: Parameters<typeof app.getPath>[0]
): string | undefined {
  try {
    return app.getPath(name);
  } catch {
    return undefined;
  }
}

export function getLastExportDirectory(): string | null {
  const value = settingsStore.get('lastExportVideoDirectory', null);
  return typeof value === 'string' && value.trim() ? value : null;
}

export function rememberExportDirectory(dir: string): void {
  try {
    settingsStore.set('lastExportVideoDirectory', dir);
  } catch {
    // Remembering is a convenience only.
  }
}

export async function resolveDefaultExportDirectory(
  sourcePath?: string | null
): Promise<string> {
  const candidates = [
    getLastExportDirectory(),
    sourcePath ? path.dirname(sourcePath) : null,
    safeAppPath('videos'),
    safeAppPath('downloads'),
    safeAppPath('home'),
  ];
  for (const dir of candidates) {
    if (!dir) continue;
    if (isAppPrivateDirectory(dir)) continue;
    if (await isWritableDirectory(dir)) return dir;
  }
  return safeAppPath('home') ?? os.homedir();
}

export function exportBaseName(sourcePath?: string | null): string {
  const base = sourcePath
    ? path.basename(sourcePath, path.extname(sourcePath))
    : 'video';
  return `${base || 'video'}-subtitled`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** `<dir>/<base>.mp4`, or `<base>-2.mp4`… when taken. Never an existing file. */
export async function uniqueExportPath(
  dir: string,
  base: string
): Promise<string> {
  let candidate = path.join(dir, `${base}.mp4`);
  for (let n = 2; await exists(candidate); n += 1) {
    candidate = path.join(dir, `${base}-${n}.mp4`);
  }
  return candidate;
}

export async function resolveDefaultExportPath(
  sourcePath?: string | null
): Promise<string> {
  const dir = await resolveDefaultExportDirectory(sourcePath);
  return uniqueExportPath(dir, exportBaseName(sourcePath));
}
