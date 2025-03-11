import { app, dialog, BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import log from 'electron-log';
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
      // Fallback to OS temp directory if app is not ready yet
      log.warn(
        'Electron app not ready, using OS temp directory as fallback for FileManager'
      );
      this.tempDir = path.join(os.tmpdir(), 'translator-electron-temp');
    }

    log.info(`FileManager temp directory: ${this.tempDir}`);
  }

  /**
   * Ensure the temporary directory exists
   */
  async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      log.info(`Temp directory created at: ${this.tempDir}`);
    } catch (error) {
      log.error('Failed to create temp directory:', error);
      throw new FileManagerError(`Failed to create temp directory: ${error}`);
    }
  }

  /**
   * Clean up the temporary directory
   */
  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      await fs.mkdir(this.tempDir, { recursive: true });
      log.info('Temp directory cleaned up');
    } catch (error) {
      log.error('Error cleaning up temp directory:', error);
      throw new FileManagerError(`Error cleaning up temp directory: ${error}`);
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
      const { defaultPath, filters, filePath } = options;

      // Log all parameters for debugging
      log.info('saveFile called with options:', {
        contentLength: content?.length,
        defaultPath,
        hasFilters: Boolean(filters),
        filePath,
      });

      // If a filePath is provided, save directly to that path without showing a dialog
      if (filePath) {
        log.info(`Attempting to save directly to file: ${filePath}`);

        // Check if this is a synthetic path from browser uploads
        if (filePath.startsWith('/temp/')) {
          log.info(
            `Detected synthetic browser path: ${filePath}, using Save As dialog instead`
          );
          // For synthetic paths, use Save As with the filename
          const filename = filePath.split('/').pop() || 'subtitle.srt';

          // Show Save As dialog with browser filename
          const window = BrowserWindow.getFocusedWindow();
          if (!window) {
            throw new FileManagerError('No focused window found');
          }

          const { canceled, filePath: selectedPath } =
            await dialog.showSaveDialog(window, {
              defaultPath: filename,
              filters: filters || [
                { name: 'Text Files', extensions: ['txt', 'srt'] },
                { name: 'All Files', extensions: ['*'] },
              ],
            });

          if (canceled || !selectedPath) {
            throw new FileManagerError('File save was canceled');
          }

          await fs.writeFile(selectedPath, content, 'utf8');
          log.info(`Synthetic path converted to real path: ${selectedPath}`);
          return selectedPath;
        }

        try {
          // Verify the file path is valid and accessible
          const pathInfo = await fs.stat(filePath).catch(e => {
            log.warn(
              `Path does not exist or is not accessible: ${filePath}`,
              e
            );
            // Check permissions
            return null;
          });

          if (pathInfo && !pathInfo.isFile()) {
            log.error(`Path exists but is not a file: ${filePath}`);
            throw new FileManagerError(
              `Cannot save to ${filePath}: not a file`
            );
          }
        } catch (statError: any) {
          // If it's not a "file doesn't exist" error, check for permission issues
          if (statError.code !== 'ENOENT') {
            log.error(`Error checking file path: ${statError.code}`, statError);

            // Check for specific permission errors
            if (statError.code === 'EACCES') {
              log.error(`Permission denied for file: ${filePath}`);
              throw new FileManagerError(
                `Permission denied: Cannot write to ${filePath}. Try using Save As instead.`
              );
            }

            throw statError;
          }
          // Otherwise we'll try to create the file
          log.info(`File doesn't exist yet, will create it: ${filePath}`);
        }

        // Try to write the file with proper error handling for permissions
        try {
          await fs.writeFile(filePath, content, 'utf8');
          log.info(`File saved directly to: ${filePath}`);
          return filePath;
        } catch (writeError: any) {
          // Handle permission errors specifically
          if (writeError.code === 'EACCES') {
            log.error(`Permission denied when writing to file: ${filePath}`);

            // Try to save to Downloads folder as fallback
            try {
              const downloadsPath = path.join(
                app.getPath('downloads'),
                path.basename(filePath)
              );
              log.info(
                `Attempting to save to Downloads folder instead: ${downloadsPath}`
              );

              await fs.writeFile(downloadsPath, content, 'utf8');
              log.info(`File saved to Downloads folder: ${downloadsPath}`);

              // Return special message that UI can detect
              throw new FileManagerError(
                `Permission denied for ${filePath}. File was saved to Downloads folder: ${downloadsPath}`
              );
            } catch (fallbackError) {
              log.error('Failed to save to Downloads folder:', fallbackError);
              throw new FileManagerError(
                `Permission denied for ${filePath}. Please try Save As to choose a different location.`
              );
            }
          }

          // Re-throw other errors
          throw writeError;
        }
      }

      // Otherwise, show a save dialog
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
      log.info(`File saved to: ${selectedPath}`);
      return selectedPath;
    } catch (error: any) {
      const errorMessage = `Error saving file: ${error.message || error}`;
      log.error(errorMessage, {
        defaultPath: options.defaultPath,
        hasFilePath: Boolean(options.filePath),
        path: options.filePath || options.defaultPath,
      });
      throw new FileManagerError(errorMessage);
    }
  }

  /**
   * Open a file with a dialog
   */
  async openFile(
    filters?: { name: string; extensions: string[] }[],
    multiple = false
  ): Promise<{ filePaths: string[]; fileContents?: string[] }> {
    try {
      const window = BrowserWindow.getFocusedWindow();
      if (!window) {
        throw new FileManagerError('No focused window found');
      }

      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: filters || [
          { name: 'Media Files', extensions: ['mp4', 'avi', 'mkv', 'mov'] },
          { name: 'Subtitle Files', extensions: ['srt', 'ass', 'vtt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (canceled || filePaths.length === 0) {
        throw new FileManagerError('File open was canceled');
      }

      // For text files, also read the content
      const isTextFile = (filePath: string) => {
        const ext = path.extname(filePath).toLowerCase();
        return ['.srt', '.ass', '.vtt', '.txt'].includes(ext);
      };

      if (filePaths.some(isTextFile)) {
        try {
          const fileContents = await Promise.all(
            filePaths.map(async filePath => {
              if (isTextFile(filePath)) {
                try {
                  const content = await fs.readFile(filePath, 'utf8');
                  log.info(
                    `Successfully read file content from: ${filePath}, length: ${content.length}`
                  );
                  return content;
                } catch (readError: any) {
                  log.error(
                    `Error reading file content from: ${filePath}`,
                    readError
                  );
                  throw new FileManagerError(
                    `Failed to read file content: ${readError.message}`
                  );
                }
              }
              return '';
            })
          );
          return { filePaths, fileContents };
        } catch (contentError) {
          log.error('Error processing file contents', contentError);
          throw contentError;
        }
      }

      return { filePaths };
    } catch (error) {
      log.error('Error opening file:', error);
      throw new FileManagerError(`Error opening file: ${error}`);
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
      log.info(`Temp file written to: ${filePath}`);
      return filePath;
    } catch (error) {
      log.error('Error writing temp file:', error);
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
      log.error(`Error reading file ${filePath}:`, error);
      throw new FileManagerError(`Error reading file: ${error}`);
    }
  }
}
