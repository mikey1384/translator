import type {
  OpenFileOptions,
  SaveFileOptions,
  OpenFileResult,
  SaveFileResult,
} from '@shared-types/app';

export function open(options?: OpenFileOptions): Promise<OpenFileResult> {
  return window.electron.openFile(options);
}

export function save(options: SaveFileOptions): Promise<SaveFileResult> {
  return window.electron.saveFile(options);
}

export function copy(
  sourcePath: string,
  destinationPath: string
): Promise<{ success?: boolean; error?: string }> {
  return window.electron.copyFile(sourcePath, destinationPath);
}

export function readFileContent(
  filePath: string
): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
  return window.electron.readFileContent(filePath);
}
