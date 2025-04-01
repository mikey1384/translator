import { BrowserWindow, dialog } from 'electron';
import fs from 'fs';

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
      const { defaultPath, filters, content } = options;

      // Log all parameters for debugging
      console.log('saveFile called with options:', {
        contentLength: content?.length,
        defaultPath,
        hasFilters: Boolean(filters),
      });

      // Get the window reference more robustly
      const window =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]; // Fallback

      if (!window) {
        // Only throw if absolutely no window is available
        throw new SaveFileError(
          'No application window available to show save dialog.'
        );
      }

      const { canceled, filePath: selectedPath } = await dialog.showSaveDialog(
        window, // Pass the potentially fallback window reference
        {
          defaultPath,
          filters: filters || [
            { name: 'Text Files', extensions: ['txt', 'srt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        }
      );

      if (canceled || !selectedPath) {
        throw new SaveFileError('File save was canceled');
      }

      await fs.promises.writeFile(selectedPath, content, 'utf8');
      console.log(`File saved to: ${selectedPath}`);
      return selectedPath;
    } catch (error: any) {
      const errorMessage = `Error saving file: ${error.message || error}`;
      console.error(errorMessage, {
        defaultPath: options.defaultPath,
      });
      throw new SaveFileError(errorMessage);
    }
  }
}
