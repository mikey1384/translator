import { dialog, BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import log from 'electron-log';

export class FileManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileManagerError';
  }
}

export class FileManager {
  private tempDir: string;

  constructor(tempDirPath: string) {
    if (!tempDirPath) {
      console.error(
        '[FileManager] Critical Error: tempDirPath argument is required.'
      );
      throw new Error('FileManager requires a tempDirPath');
    }
    this.tempDir = tempDirPath;
    log.info(
      `[FileManager] Initialized. Temp directory set to: ${this.tempDir}`
    );
  }

  getTempDir(): string {
    return this.tempDir;
  }

  async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      log.info(`Temp directory created at: ${this.tempDir}`);
    } catch (error) {
      log.error('Failed to create temp directory:', error);
      throw new FileManagerError(`Failed to create temp directory: ${error}`);
    }
  }

  async cleanup(): Promise<void> {
    try {
      log.info(`[FileManager] Attempting to delete directory: ${this.tempDir}`);
      await fs.rm(this.tempDir, { recursive: true, force: true });
      log.info(
        `[FileManager] fs.rm command completed (v2) for: ${this.tempDir}`
      );
      log.info(`Successfully cleaned up temp directory: ${this.tempDir}`);
    } catch (error) {
      log.error(
        `[FileManager] CRITICAL ERROR cleaning up temp directory ${this.tempDir}:`,
        error
      );
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

      log.info('saveFile called with options:', {
        contentLength: content?.length,
        defaultPath,
        hasFilters: Boolean(filters),
      });

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
        log.info('File open canceled by user.');
        return { canceled: true, filePaths: [] };
      }

      log.info('Files selected:', result.filePaths);

      const subtitleExtensions = ['.srt', '.vtt', '.ass', '.txt'];
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
                  log.error(
                    `Error reading file content for ${filePath}:`,
                    readError
                  );
                  return `Error reading file: ${readError.message}`;
                }
              }
              return '';
            })
          );
          log.info('Successfully read content for subtitle files.');
        } catch (contentError: any) {
          log.error('Error processing file contents:', contentError);
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
      log.error('Error opening file dialog:', error);
      return {
        canceled: false,
        filePaths: [],
        error: `Error opening file: ${error.message || error}`,
      };
    }
  }

  async writeTempFile(content: string, extension: string): Promise<string> {
    try {
      const filename = `temp_${Date.now()}${extension}`;
      const filePath = path.join(this.tempDir, filename);
      await fs.writeFile(filePath, content, 'utf8');
      log.info(`Temp file written to: ${filePath}`);
      return filePath;
    } catch {
      log.error('Error writing temp file.');
      throw new FileManagerError('Error writing temp file.');
    }
  }

  /**
   * Read content from a file
   */
  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      log.error(`Error reading file ${filePath}.`);
      throw new FileManagerError('Error reading file.');
    }
  }

  /**
   * Move a file from source to destination
   * This copies the file and then deletes the original
   */
  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      log.info(`Moving file from ${sourcePath} to ${destinationPath}`);

      try {
        await fs.access(sourcePath);
      } catch (error) {
        throw new FileManagerError(
          `Source file does not exist or is not accessible: ${sourcePath}`
        );
      }

      const destDir = path.dirname(destinationPath);
      await fs.mkdir(destDir, { recursive: true });

      await fs.copyFile(sourcePath, destinationPath);
      log.info(`File copied to ${destinationPath}`);

      await fs.unlink(sourcePath);
      log.info(`Original file ${sourcePath} deleted`);
    } catch (error) {
      log.error(
        `Error moving file from ${sourcePath} to ${destinationPath}:`,
        error
      );
      throw new FileManagerError(
        `Failed to move file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Copy a file from source to destination
   */
  async copyFile(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      log.info(`Copying file from ${sourcePath} to ${destinationPath}`);

      try {
        await fs.access(sourcePath);
      } catch (error) {
        throw new FileManagerError(
          `Source file does not exist or is not accessible: ${sourcePath}`
        );
      }

      const destDir = path.dirname(destinationPath);
      await fs.mkdir(destDir, { recursive: true });

      await fs.copyFile(sourcePath, destinationPath);
      log.info(`File copied to ${destinationPath}`);
    } catch (error) {
      log.error(
        `Error copying file from ${sourcePath} to ${destinationPath}:`,
        error
      );
      throw new FileManagerError(
        `Failed to copy file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      log.info(`File ${filePath} deleted`);
    } catch (error) {
      log.error(`Error deleting file ${filePath}:`, error);
      throw new FileManagerError(`Error deleting file: ${error}`);
    }
  }
}
