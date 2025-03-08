import { app, dialog, BrowserWindow } from "electron";
import fs from "fs/promises";
import path from "path";
import log from "electron-log";

export class FileManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileManagerError";
  }
}

export class FileManager {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(app.getPath("userData"), "temp");
  }

  /**
   * Ensure the temporary directory exists
   */
  async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      log.info(`Temp directory created at: ${this.tempDir}`);
    } catch (error) {
      log.error("Failed to create temp directory:", error);
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
      log.info("Temp directory cleaned up");
    } catch (error) {
      log.error("Error cleaning up temp directory:", error);
      throw new FileManagerError(`Error cleaning up temp directory: ${error}`);
    }
  }

  /**
   * Save content to a file with a dialog
   */
  async saveFile(
    content: string,
    defaultPath?: string,
    filters?: { name: string; extensions: string[] }[]
  ): Promise<string> {
    try {
      const window = BrowserWindow.getFocusedWindow();
      if (!window) {
        throw new FileManagerError("No focused window found");
      }

      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        defaultPath,
        filters: filters || [
          { name: "Text Files", extensions: ["txt", "srt"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (canceled || !filePath) {
        throw new FileManagerError("File save was canceled");
      }

      await fs.writeFile(filePath, content, "utf8");
      log.info(`File saved to: ${filePath}`);
      return filePath;
    } catch (error) {
      log.error("Error saving file:", error);
      throw new FileManagerError(`Error saving file: ${error}`);
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
        throw new FileManagerError("No focused window found");
      }

      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
        filters: filters || [
          { name: "Media Files", extensions: ["mp4", "avi", "mkv", "mov"] },
          { name: "Subtitle Files", extensions: ["srt", "ass", "vtt"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (canceled || filePaths.length === 0) {
        throw new FileManagerError("File open was canceled");
      }

      // For text files, also read the content
      const isTextFile = (filePath: string) => {
        const ext = path.extname(filePath).toLowerCase();
        return [".srt", ".ass", ".vtt", ".txt"].includes(ext);
      };

      if (filePaths.some(isTextFile)) {
        const fileContents = await Promise.all(
          filePaths.map(async (filePath) => {
            if (isTextFile(filePath)) {
              return await fs.readFile(filePath, "utf8");
            }
            return "";
          })
        );
        return { filePaths, fileContents };
      }

      return { filePaths };
    } catch (error) {
      log.error("Error opening file:", error);
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
      await fs.writeFile(filePath, content, "utf8");
      log.info(`Temp file written to: ${filePath}`);
      return filePath;
    } catch (error) {
      log.error("Error writing temp file:", error);
      throw new FileManagerError(`Error writing temp file: ${error}`);
    }
  }

  /**
   * Read content from a file
   */
  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (error) {
      log.error(`Error reading file ${filePath}:`, error);
      throw new FileManagerError(`Error reading file: ${error}`);
    }
  }
}
