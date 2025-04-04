import { BrowserWindow, dialog, app } from 'electron';
import fs from 'fs';
import path from 'path';

// --- Simple JSON Storage --- START ---
const SETTINGS_FILE_NAME = 'save-settings.json';
let settingsFilePath: string | null = null;

function getSettingsFilePath(): string {
  if (!settingsFilePath) {
    try {
      // Ensure app path is available
      const userDataPath = app.getPath('userData');
      settingsFilePath = path.join(userDataPath, SETTINGS_FILE_NAME);
    } catch (e) {
      // Fallback if app path isn't ready (shouldn't happen in normal flow)
      console.error('Failed to get userData path, using fallback path.', e);
      settingsFilePath = path.join(__dirname, SETTINGS_FILE_NAME); // Less ideal fallback
    }
  }
  return settingsFilePath;
}

interface SaveSettings {
  lastSaveDirectory?: string;
}

function loadSettings(): SaveSettings {
  const filePath = getSettingsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as SaveSettings;
    }
  } catch (error) {
    console.error(
      `[SaveFileService] Error loading settings from ${filePath}:`,
      error
    );
  }
  return {}; // Return empty object if file doesn't exist or fails to parse
}

function saveSettings(settings: SaveSettings): void {
  const filePath = getSettingsFilePath();
  try {
    const data = JSON.stringify(settings, null, 2); // Pretty print JSON
    fs.writeFileSync(filePath, data, 'utf-8');
  } catch (error) {
    console.error(
      `[SaveFileService] Error saving settings to ${filePath}:`,
      error
    );
  }
}
// --- Simple JSON Storage --- END ---

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
  filePath?: string;
  forceDialog?: boolean;
  title?: string;
}

export class SaveFileService {
  private static instance: SaveFileService;
  // Load last directory from our JSON storage
  private lastSaveDirectory: string | undefined;

  private constructor() {
    const settings = loadSettings();
    this.lastSaveDirectory = settings.lastSaveDirectory;
    console.log(
      `[SaveFileService] Initialized with stored directory: ${this.lastSaveDirectory || 'none'}`
    );
  }

  public static getInstance(): SaveFileService {
    if (!SaveFileService.instance) {
      SaveFileService.instance = new SaveFileService();
    }
    return SaveFileService.instance;
  }

  // Helper to persist the last directory
  private persistLastDirectory(dirPath: string | undefined): void {
    if (dirPath && dirPath !== this.lastSaveDirectory) {
      this.lastSaveDirectory = dirPath;
      const currentSettings = loadSettings(); // Load current settings
      saveSettings({ ...currentSettings, lastSaveDirectory: dirPath }); // Update only lastSaveDirectory
      console.log(
        `[SaveFileService] Stored last save directory: ${this.lastSaveDirectory}`
      );
    }
  }

  public async saveFile(options: SaveFileOptions): Promise<string> {
    try {
      const { defaultPath, filters, content, filePath, forceDialog } = options;
      let targetPath: string | undefined = undefined;

      console.log('[saveFile] Received options:', options);

      if (filePath && !forceDialog) {
        console.log('[saveFile] Direct save requested to:', filePath);
        targetPath = filePath;
        const dir = path.dirname(filePath);
        try {
          await fs.promises.mkdir(dir, { recursive: true });
          this.persistLastDirectory(dir); // Use helper to save
        } catch (mkdirError: any) {
          if (mkdirError.code !== 'EEXIST') {
            throw new SaveFileError(
              `Failed to create directory ${dir}: ${mkdirError.message}`
            );
          } else {
            this.persistLastDirectory(dir); // Use helper to save even if dir existed
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

        // Use the loaded lastSaveDirectory for the dialog default
        const dialogDefaultPath = defaultPath || this.lastSaveDirectory;
        console.log(
          `[saveFile] Using dialog default path: ${dialogDefaultPath}`
        );

        const dialogResult = await dialog.showSaveDialog(window, {
          defaultPath: dialogDefaultPath,
          filters: filters || [
            { name: 'SRT Files', extensions: ['srt'] },
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          title: options.title || 'Save File',
        });

        console.log('[saveFile] Dialog result:', dialogResult);

        if (dialogResult.canceled || !dialogResult.filePath) {
          throw new SaveFileError('File save was canceled by user');
        }
        targetPath = dialogResult.filePath;

        this.persistLastDirectory(path.dirname(targetPath)); // Use helper to save
      }

      if (!targetPath) {
        throw new SaveFileError('No target path determined for saving.');
      }

      console.log(
        `[saveFile] Writing content (${content.length} bytes) to: ${targetPath}`
      );
      await fs.promises.writeFile(targetPath, content, 'utf8');
      console.log(`[saveFile] File saved successfully to: ${targetPath}`);
      return targetPath;
    } catch (error: any) {
      const errorMessage =
        error instanceof SaveFileError
          ? error.message
          : `Unexpected error saving file: ${error.message || error}`;
      console.error('[saveFile] Error:', errorMessage, 'Options:', {
        ...options,
        content: '(omitted)',
      });

      if (error instanceof SaveFileError) {
        throw error;
      } else {
        throw new SaveFileError(errorMessage);
      }
    }
  }
}
