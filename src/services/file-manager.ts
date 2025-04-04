import { app, dialog, BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export class FileManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileManagerError';
  }
}

export class FileManager {
  private tempDir: string;

  constructor() {
    // Safely get a temp directory - use app.getPath if available, otherwise use OS temp dir
    try {
      this.tempDir = path.join(app.getPath('userData'), 'temp');
    } catch (error) {
      // Use console.warn instead of log.warn
      console.warn(
        'Electron app not ready, using OS temp directory as fallback'
      );
      this.tempDir = path.join(os.tmpdir(), 'translator-electron-temp');
    }

    // Use console.info instead of log.info
    console.info(`FileManager initialized. Temp directory: ${this.tempDir}`);
  }

  /**
   * Ensure the temporary directory exists
   */
  async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      // Use console.info instead of log.info
      console.info(`Temp directory created at: ${this.tempDir}`);
    } catch (error) {
      // Use console.error instead of log.error
      console.error('Failed to create temp directory:', error);
      throw new FileManagerError(`Failed to create temp directory: ${error}`);
    }
  }

  /**
   * Clean up the temporary directory
   */
  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      // Use console.info instead of log.info
      console.info(`Successfully cleaned up temp directory: ${this.tempDir}`);
    } catch (error) {
      // Use console.error instead of log.error
      console.error(`Error cleaning up temp directory ${this.tempDir}:`, error);
      // Don't re-throw, cleanup failure shouldn't crash the app on exit
    }
  }

  /**
   * Save content to a file with a dialog or directly to a specified path
   * @param content The content to save
   * @param options Object containing save options (defaultPath, filters, filePath)
   */
  async saveFile(
    content: string,
    options: {
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
      filePath?: string;
    }
  ): Promise<string> {
    try {
      const { defaultPath, filters } = options;

      // Log all parameters for debugging
      console.info('saveFile called with options:', {
        contentLength: content?.length,
        defaultPath,
        hasFilters: Boolean(filters),
      });

      // Always show a save dialog
      const window = BrowserWindow.getFocusedWindow();
      if (!window) {
        throw new FileManagerError('No focused window found');
      }

      const { canceled, filePath: selectedPath } = await dialog.showSaveDialog(
        window,
        {
          defaultPath,
          filters: filters || [
            { name: 'Text Files', extensions: ['txt', 'srt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        }
      );

      if (canceled || !selectedPath) {
        throw new FileManagerError('File save was canceled');
      }

      await fs.writeFile(selectedPath, content, 'utf8');
      // Use console.info instead of log.info
      console.info(`File saved to: ${selectedPath}`);
      return selectedPath;
    } catch (error: any) {
      const errorMessage = `Error saving file: ${error.message || error}`;
      // Use console.error instead of log.error
      console.error(errorMessage, {
        defaultPath: options.defaultPath,
      });
      throw new FileManagerError(errorMessage);
    }
  }

  /**
   * Open a file with a dialog
   */
  async openFile(options: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: (
      | 'openFile'
      | 'openDirectory'
      | 'multiSelections'
      | 'showHiddenFiles'
      | 'createDirectory'
      | 'promptToCreate'
      | 'noResolveAliases'
      | 'treatPackageAsDirectory'
      | 'dontAddToRecent'
    )[];
    defaultPath?: string;
    buttonLabel?: string;
    message?: string;
    securityScopedBookmarks?: boolean;
  }): Promise<{
    canceled: boolean;
    filePaths: string[];
    bookmarks?: string[];
    fileContents?: string[];
    error?: string;
  }> {
    try {
      const window = BrowserWindow.getFocusedWindow();
      if (!window) {
        throw new FileManagerError('No focused window found for open dialog');
      }

      const result = await dialog.showOpenDialog(window, {
        title: options.title || 'Open File',
        filters: options.filters || [
          { name: 'Media Files', extensions: ['mp4', 'avi', 'mkv', 'mov'] },
          { name: 'Subtitle Files', extensions: ['srt', 'ass', 'vtt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: options.properties || ['openFile'],
        defaultPath: options.defaultPath,
        buttonLabel: options.buttonLabel,
        message: options.message,
        securityScopedBookmarks: options.securityScopedBookmarks,
      });

      if (result.canceled || result.filePaths.length === 0) {
        // Use console.info instead of log.info
        console.info('File open canceled by user.');
        return { canceled: true, filePaths: [] };
      }

      // Use console.info instead of log.info
      console.info('Files selected:', result.filePaths);

      // Optional: Read content for text-based subtitle files
      const subtitleExtensions = ['.srt', '.vtt', '.ass', '.txt']; // Add other text types if needed
      const needsContentRead = result.filePaths.some(fp =>
        subtitleExtensions.includes(path.extname(fp).toLowerCase())
      );

      let fileContents: string[] | undefined = undefined;
      if (needsContentRead) {
        try {
          fileContents = await Promise.all(
            result.filePaths.map(async filePath => {
              if (
                subtitleExtensions.includes(
                  path.extname(filePath).toLowerCase()
                )
              ) {
                try {
                  return await fs.readFile(filePath, 'utf8');
                } catch (readError: any) {
                  // Use console.error instead of log.error
                  console.error(
                    `Error reading file content for ${filePath}:`,
                    readError
                  );
                  // Return null or specific error marker if needed, instead of throwing
                  // Throwing here would fail the whole Promise.all
                  return `Error reading file: ${readError.message}`;
                }
              }
              // Return empty string for non-subtitle files if mixed selection is possible
              return '';
            })
          );
          // Use console.info instead of log.info
          console.info('Successfully read content for subtitle files.');
        } catch (contentError: any) {
          // Use console.error instead of log.error
          console.error('Error processing file contents:', contentError);
          // Decide how to handle partial success, maybe return paths without content?
          return {
            canceled: false,
            filePaths: result.filePaths,
            bookmarks: result.bookmarks,
            error: `Failed to read content for one or more files: ${contentError.message}`,
          };
        }
      }

      return {
        canceled: false,
        filePaths: result.filePaths,
        bookmarks: result.bookmarks,
        fileContents: fileContents,
      };
    } catch (error: any) {
      // Use console.error instead of log.error
      console.error('Error opening file dialog:', error);
      return {
        canceled: false,
        filePaths: [],
        error: `Error opening file: ${error.message || error}`,
      };
    }
  }

  /**
   * Write content to a temporary file
   */
  async writeTempFile(content: string, extension: string): Promise<string> {
    try {
      const filename = `temp_${Date.now()}${extension}`;
      const filePath = path.join(this.tempDir, filename);
      await fs.writeFile(filePath, content, 'utf8');
      // Use console.info instead of log.info
      console.info(`Temp file written to: ${filePath}`);
      return filePath;
    } catch (error) {
      // Use console.error instead of log.error
      console.error('Error writing temp file:', error);
      throw new FileManagerError(`Error writing temp file: ${error}`);
    }
  }

  /**
   * Read content from a file
   */
  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      // Use console.error instead of log.error
      console.error(`Error reading file ${filePath}:`, error);
      throw new FileManagerError(`Error reading file: ${error}`);
    }
  }
}
