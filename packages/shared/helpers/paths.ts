import path from 'path';
import { app } from 'electron';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getAssetsPath(...parts: string[]): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'fonts', ...parts);
  }
  return path.join(__dirname, '..', '..', 'fonts', ...parts);
}
