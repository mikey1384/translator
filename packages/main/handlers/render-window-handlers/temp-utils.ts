import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';
import log from 'electron-log';

export async function createOperationTempDir({
  operationId,
}: {
  operationId: string;
}): Promise<string> {
  const dir = path.join(app.getPath('temp'), `subtitle-render-${operationId}`);
  log.info(`[temp-utils] mkdir ${dir}`);
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
  }
}
