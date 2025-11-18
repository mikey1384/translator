import path from 'path';
import { app } from 'electron';

export function getAssetsPath(...parts: string[]): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(app.getAppPath(), 'assets');
  return path.join(base, 'fonts', ...parts);
}
