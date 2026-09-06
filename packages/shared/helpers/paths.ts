import path from 'path';
import fs from 'node:fs';
import { app } from 'electron';

export function getAssetsPath(...parts: string[]): string {
  let base = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(app.getAppPath(), 'assets');
  if (!app.isPackaged && !fs.existsSync(base)) {
    // Agent development launches packages/main; assets live at the repo root.
    base = path.resolve(app.getAppPath(), '../..', 'assets');
  }
  return path.join(base, 'fonts', ...parts);
}
