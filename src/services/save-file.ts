import { BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path'; // Import path module

export class SaveFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFileError';
  }
}

export interface SaveFileOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  content: string;
  filePath?: string; // Add filePath option
  forceDialog?: boolean; // Add forceDialog option
  title?: string; // Add title option
}

export class SaveFileService {
  private static instance: SaveFileService;

  private constructor() {}

  public static getInstance(): SaveFileService {
    if (!SaveFileService.instance) {
      SaveFileService.instance = new SaveFileService();
    }
    return SaveFileService.instance;
  }

  public async saveFile(options: SaveFileOptions): Promise<string> {
    try {
      const { defaultPath, filters, content, filePath, forceDialog } = options;
      let targetPath: string | undefined = undefined;

      // Log all received parameters for debugging
      console.log('[saveFile] Received options:', options);

      // Decide whether to show the dialog or save directly
      if (filePath && !forceDialog) {
        console.log('[saveFile] Direct save requested to:', filePath);
        targetPath = filePath;
        // Ensure the directory exists before writing
        const dir = path.dirname(filePath);
        try {
          await fs.promises.mkdir(dir, { recursive: true });
        } catch (mkdirError: any) {
          // Ignore EEXIST error (directory already exists), rethrow others
          if (mkdirError.code !== 'EEXIST') {
            throw new SaveFileError(
              `Failed to create directory ${dir}: ${mkdirError.message}`
            );
          }
        }
      } else {
        console.log(
          '[saveFile] Save dialog requested. ForceDialog:',
          forceDialog
        );
        const window =
          BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        if (!window) {
          throw new SaveFileError(
            'No application window available to show save dialog.'
          );
        }

        const dialogResult = await dialog.showSaveDialog(window, {
          defaultPath,
          filters: filters || [
            { name: 'SRT Files', extensions: ['srt'] }, // Prioritize SRT
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          title: options.title || 'Save File', // Use title from options if provided
        });

        console.log('[saveFile] Dialog result:', dialogResult);

        if (dialogResult.canceled || !dialogResult.filePath) {
          throw new SaveFileError('File save was canceled by user');
        }
        targetPath = dialogResult.filePath;
      }

      // Perform the actual file writing
      if (!targetPath) {
        // This should ideally not happen if logic above is correct
        throw new SaveFileError('No target path determined for saving.');
      }

      console.log(
        `[saveFile] Writing content (${content.length} bytes) to: ${targetPath}`
      );
      await fs.promises.writeFile(targetPath, content, 'utf8');
      console.log(`[saveFile] File saved successfully to: ${targetPath}`);
      return targetPath;
    } catch (error: any) {
      // Log the specific error that occurred
      const errorMessage =
        error instanceof SaveFileError
          ? error.message
          : `Unexpected error saving file: ${error.message || error}`;
      console.error('[saveFile] Error:', errorMessage, 'Options:', {
        ...options,
        content: '(omitted)',
      }); // Avoid logging large content

      // Rethrow as SaveFileError or propagate original SaveFileError
      if (error instanceof SaveFileError) {
        throw error;
      } else {
        throw new SaveFileError(errorMessage);
      }
    }
  }
}
