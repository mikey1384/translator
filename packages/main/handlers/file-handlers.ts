import path from 'path';
import fs from 'fs/promises';
import { IpcMainInvokeEvent } from 'electron';
import { FileManager } from '../services/file-manager.js';
import { SaveFileService, SaveFileOptions } from '../services/save-file.js';
import { OpenFileResult, OpenFileOptions } from '@shared-types/app';

interface FileHandlerServices {
  fileManager: FileManager;
  saveFileService: SaveFileService;
}

let fileManagerInstance: FileManager | null = null;
let saveFileServiceInstance: SaveFileService | null = null;

export function initializeFileHandlers(services: FileHandlerServices): void {
  if (!services || !services.fileManager || !services.saveFileService) {
    throw new Error(
      '[file-handlers] Required services (fileManager, saveFileService) not provided.'
    );
  }
  fileManagerInstance = services.fileManager;
  saveFileServiceInstance = services.saveFileService;
  console.info('[handlers/file-handlers.ts] Initialized.');
}

function checkServicesInitialized(): {
  fileManager: FileManager;
  saveFileService: SaveFileService;
} {
  if (!fileManagerInstance || !saveFileServiceInstance) {
    throw new Error('[file-handlers] Services not initialized before use.');
  }
  return {
    fileManager: fileManagerInstance,
    saveFileService: saveFileServiceInstance,
  };
}

export async function handleSaveFile(
  _event: IpcMainInvokeEvent,
  options: SaveFileOptions
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const { saveFileService } = checkServicesInitialized();
    const filePath = await saveFileService.saveFile(options);
    return { success: true, filePath };
  } catch (error: any) {
    console.error('[handleSaveFile] Error:', error);
    return { success: false, error: error.message || String(error) };
  }
}

export async function handleOpenFile(
  _event: IpcMainInvokeEvent,
  options: OpenFileOptions
): Promise<OpenFileResult> {
  try {
    const { fileManager } = checkServicesInitialized();
    const result = await fileManager.openFile(options);
    return result;
  } catch (error: any) {
    console.error('[handleOpenFile] Error:', error);
    return {
      canceled: false,
      filePaths: [],
      error: error.message || String(error),
    };
  }
}

export async function handleMoveFile(
  _event: IpcMainInvokeEvent,
  sourcePath: string,
  destinationPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { fileManager } = checkServicesInitialized();
    await fileManager.moveFile(sourcePath, destinationPath);
    return { success: true };
  } catch (error: any) {
    console.error('[handleMoveFile] Error:', error);
    return { success: false, error: error.message || String(error) };
  }
}

export async function handleCopyFile(
  _event: IpcMainInvokeEvent,
  sourcePath: string,
  destinationPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { fileManager } = checkServicesInitialized();
    await fileManager.copyFile(sourcePath, destinationPath);
    return { success: true };
  } catch (error: any) {
    console.error('[handleCopyFile] Error:', error);
    return { success: false, error: error.message || String(error) };
  }
}

interface DeleteFileArgs {
  filePathToDelete: string;
}

export async function handleDeleteFile(
  _event: IpcMainInvokeEvent,
  { filePathToDelete }: DeleteFileArgs
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!filePathToDelete) {
    return { success: false, error: 'No file path provided for deletion' };
  }

  try {
    const { fileManager } = checkServicesInitialized();
    try {
      await fs.access(filePathToDelete);
      console.log(`[handleDeleteFile] Deleting file: ${filePathToDelete}`);
      await fileManager.deleteFile(filePathToDelete);
      return { success: true };
    } catch (accessError: any) {
      if (accessError.code === 'ENOENT') {
        console.log(
          `[handleDeleteFile] File does not exist: ${filePathToDelete}`
        );
        return {
          success: true,
          message: 'File does not exist, no deletion needed',
        };
      } else {
        throw accessError;
      }
    }
  } catch (error: any) {
    console.error(
      `[handleDeleteFile] Error deleting ${filePathToDelete}:`,
      error
    );
    return { success: false, error: error.message || String(error) };
  }
}

export async function handleReadFileContent(
  _event: IpcMainInvokeEvent,
  filePath: string
): Promise<{ success: boolean; data?: Buffer; error?: string }> {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'Invalid file path provided.' };
  }
  try {
    const normalizedPath = path.normalize(filePath);
    await fs.access(normalizedPath, fs.constants.R_OK);
    const buffer = await fs.readFile(normalizedPath);
    return { success: true, data: buffer };
  } catch (error: any) {
    console.error(`[handleReadFileContent] Error reading ${filePath}:`, error);
    return {
      success: false,
      error: error.message || 'Failed to read file content.',
    };
  }
}
