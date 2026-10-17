import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { app } from 'electron';
import log from 'electron-log';
import { renderOperationPathToken } from '../../utils/render-operation-id.js';
import {
  RENDER_TEMP_DIR_PREFIX,
  sweepStaleRenderTempDirs,
} from '../../utils/render-temp-sweep.js';

// Temp dirs of renders in flight, so the startup sweep never touches them and
// quitting can remove them (they can hold a full-size merged video).
const liveTempDirs = new Set<string>();

export async function createOperationTempDir({
  operationId,
}: {
  operationId: string;
}): Promise<string> {
  const dir = path.join(
    app.getPath('temp'),
    `${RENDER_TEMP_DIR_PREFIX}${renderOperationPathToken(operationId)}`
  );
  log.info(`[temp-utils] mkdir ${dir}`);
  liveTempDirs.add(path.resolve(dir));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanupTempDir({
  tempDirPath,
  operationId,
}: {
  tempDirPath: string | null;
  operationId: string;
}): Promise<void> {
  if (!tempDirPath) return;
  try {
    await fs.rm(tempDirPath, { recursive: true, force: true });
    log.info(`[temp-utils ${operationId}] rm -rf ${tempDirPath}`);
  } catch (e) {
    log.error(`[temp-utils ${operationId}] cleanup failed`, e);
  } finally {
    liveTempDirs.delete(path.resolve(tempDirPath));
  }
}

/** Startup: remove render temp dirs that a crash or forced quit left behind. */
export async function sweepStaleRenderTempDirsAtStartup(): Promise<void> {
  try {
    const removed = await sweepStaleRenderTempDirs({
      tempRoot: app.getPath('temp'),
      liveDirs: liveTempDirs,
      fs: {
        readdir: dir => fs.readdir(dir),
        stat: p => fs.stat(p),
        rm: p => fs.rm(p, { recursive: true, force: true }),
      },
    });
    if (removed.length > 0) {
      log.info(
        `[temp-utils] Removed ${removed.length} stale render temp dir(s).`
      );
    }
  } catch (e) {
    log.warn('[temp-utils] Stale render temp sweep failed', e);
  }
}

/** Quit: best-effort synchronous removal of in-flight render temp dirs. */
export function cleanupLiveRenderTempDirsSync(): void {
  for (const dir of liveTempDirs) {
    try {
      fsSync.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      log.warn(`[temp-utils] Could not remove ${dir} on quit`, e);
    }
  }
  liveTempDirs.clear();
}
