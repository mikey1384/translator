import path from 'path';
import fs from 'fs/promises';
import { IpcMainInvokeEvent } from 'electron';
import { app } from 'electron';
import { FileManager } from '../services/file-manager.js';
import { SaveFileService, SaveFileOptions } from '../services/save-file.js';
import {
  OpenFileResult,
  OpenFileOptions,
  ReadSavedSubtitleMetadataOptions,
  ReadSavedSubtitleMetadataResult,
  SaveSubtitleDocumentOptions,
  SaveSubtitleDocumentResult,
} from '@shared-types/app';
import {
  getSubtitleSidecarPath,
} from '../../shared/helpers/subtitle-sidecar.js';
import {
  readSavedSubtitleMetadata,
  saveSavedSubtitleMetadata,
} from '../services/saved-subtitle-metadata.js';
import { saveSubtitleDocumentRecord } from '../services/subtitle-documents.js';

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

function buildSubtitleSaveWarning(args: {
  documentSaved: boolean;
  metadataCacheSaved: boolean;
  documentError?: string;
  metadataCacheError?: string;
  sidecarCleanupError?: string;
}): string | null {
  const documentError = String(args.documentError || '').trim();
  const metadataCacheError = String(args.metadataCacheError || '').trim();
  const sidecarCleanupError = String(args.sidecarCleanupError || '').trim();

  if (!args.documentSaved) {
    const base =
      'Subtitle file saved, but Stage5 could not update its internal subtitle document. The exported SRT is fine, but Stage5 reopen fidelity may be out of date.';
    const details = [documentError, metadataCacheError, sidecarCleanupError]
      .filter(Boolean)
      .join(' ');
    return details ? `${base} ${details}` : base;
  }

  if (!args.metadataCacheSaved) {
    const base =
      'Subtitle file saved, but Stage5 metadata could not be saved internally. Reopening in Stage5 may lose word timings or bilingual structure.';
    return metadataCacheError ? `${base} ${metadataCacheError}` : base;
  }

  if (sidecarCleanupError) {
    const base =
      'Subtitle file saved, but Stage5 could not remove an old adjacent metadata file.';
    return `${base} ${sidecarCleanupError}`;
  }

  return null;
}

export async function handleSaveSubtitleDocument(
  _event: IpcMainInvokeEvent,
  options: SaveSubtitleDocumentOptions
): Promise<SaveSubtitleDocumentResult> {
  try {
    const { saveFileService } = checkServicesInitialized();
    const srtContent = String(options?.srtContent || '');
    if (!srtContent.trim()) {
      return {
        status: 'error',
        error: 'Cannot save empty subtitle content.',
      };
    }
    if (!Array.isArray(options?.segments)) {
      return {
        status: 'error',
        error: 'Subtitle segments are required to save a subtitle document.',
      };
    }

    const filePath = await saveFileService.saveFile({
      content: srtContent,
      defaultPath: options.defaultPath,
      filters: options.filters,
      filePath: options.filePath,
      forceDialog: options.forceDialog,
      title: options.title,
    });

    let metadataCacheSaved = false;
    let metadataCacheError = '';
    let sidecarCleanupError = '';
    let document = undefined;
    let documentSaved = false;
    let documentError = '';

    try {
      document = await saveSubtitleDocumentRecord({
        documentId: options.documentId,
        title: options.documentTitle,
        segments: options.segments,
        sourceVideoPath: options.sourceVideoPath,
        sourceVideoAssetIdentity: options.sourceVideoAssetIdentity,
        sourceUrl: options.sourceUrl,
        subtitleKind: options.subtitleKind,
        targetLanguage: options.targetLanguage,
        importFilePath: options.importFilePath,
        importSrtContent: options.importSrtContent,
        importMode: options.importMode,
        exportFilePath: filePath,
        exportSrtContent: srtContent,
        exportMode: options.fileMode,
        activeLinkedFilePath: options.activeLinkedFilePath ?? filePath,
        activeLinkedFileMode: options.activeLinkedFileMode ?? options.fileMode,
        activeLinkedFileRole: options.activeLinkedFileRole ?? 'export',
        transcriptionEngine: options.transcriptionEngine,
      });
      documentSaved = true;
    } catch (error: any) {
      documentError = error?.message || String(error);
    }

    try {
      await saveSavedSubtitleMetadata({
        filePath,
        srtContent,
        segments: options.segments,
      });
      metadataCacheSaved = true;
    } catch (error: any) {
      metadataCacheError = error?.message || String(error);
    }

    try {
      const sidecarPath = getSubtitleSidecarPath(filePath);
      await fs.rm(sidecarPath, { force: true });
    } catch (error: any) {
      sidecarCleanupError = error?.message || String(error);
    }

    const warning = buildSubtitleSaveWarning({
      documentSaved,
      metadataCacheSaved,
      documentError,
      metadataCacheError,
      sidecarCleanupError,
    });
    if (warning) {
      return {
        status: 'warning',
        filePath,
        warning,
        metadataCacheSaved,
        sidecarSaved: false,
        document,
      };
    }

    return {
      status: 'success',
      filePath,
      metadataCacheSaved,
      sidecarSaved: false,
      document,
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    if (/cancell?ed/i.test(message)) {
      return { status: 'cancelled' };
    }
    return {
      status: 'error',
      error: message,
      metadataCacheSaved: false,
      sidecarSaved: false,
    };
  }
}

export async function handleReadSavedSubtitleMetadata(
  _event: IpcMainInvokeEvent,
  options: ReadSavedSubtitleMetadataOptions
): Promise<ReadSavedSubtitleMetadataResult> {
  try {
    const segments = await readSavedSubtitleMetadata({
      filePath: options.filePath,
      srtContent: options.srtContent,
    });
    return {
      success: true,
      found: segments !== null,
      segments: segments ?? undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || String(error),
    };
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
  filePath?: string;
}

export async function handleDeleteFile(
  _event: IpcMainInvokeEvent,
  args: DeleteFileArgs | string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const filePathToDelete =
    typeof args === 'string'
      ? args
      : String(args?.filePathToDelete || args?.filePath || '').trim();

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

export async function handleGetFileSize(
  _event: IpcMainInvokeEvent,
  filePath: string
): Promise<{ success: boolean; sizeBytes?: number; error?: string }> {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'Invalid file path provided.' };
  }
  try {
    const normalizedPath = path.normalize(filePath);
    const stats = await fs.stat(normalizedPath);
    return { success: true, sizeBytes: stats.size };
  } catch (error: any) {
    console.error(
      `[handleGetFileSize] Error getting size for ${filePath}:`,
      error
    );
    return {
      success: false,
      error: error.message || 'Failed to get file size.',
    };
  }
}

export async function handleGetFileIdentity(
  _event: IpcMainInvokeEvent,
  filePath: string
): Promise<{
  success: boolean;
  identity?: string;
  sizeBytes?: number;
  mtimeMs?: number;
  birthtimeMs?: number;
  dev?: number;
  ino?: number;
  error?: string;
}> {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'Invalid file path provided.' };
  }
  try {
    const normalizedPath = path.normalize(filePath);
    const stats = await fs.stat(normalizedPath);
    const sizeBytes = Number.isFinite(stats.size) ? stats.size : 0;
    const mtimeMs = Number.isFinite(stats.mtimeMs)
      ? Math.round(stats.mtimeMs)
      : 0;
    const birthtimeMs = Number.isFinite(stats.birthtimeMs)
      ? Math.round(stats.birthtimeMs)
      : 0;
    const dev = Number.isFinite(Number((stats as any).dev))
      ? Number((stats as any).dev)
      : 0;
    const ino = Number.isFinite(Number((stats as any).ino))
      ? Number((stats as any).ino)
      : 0;
    const identity = `${dev}:${ino}:${sizeBytes}:${mtimeMs}:${birthtimeMs}`;

    return {
      success: true,
      identity,
      sizeBytes,
      mtimeMs,
      birthtimeMs,
      dev,
      ino,
    };
  } catch (error: any) {
    console.error(
      `[handleGetFileIdentity] Error getting identity for ${filePath}:`,
      error
    );
    return {
      success: false,
      error: error.message || 'Failed to get file identity.',
    };
  }
}

export async function handleGetDiskSpace(
  _event: IpcMainInvokeEvent,
  filePath: string
): Promise<{
  success: boolean;
  freeBytes?: number;
  totalBytes?: number;
  error?: string;
}> {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'Invalid file path provided.' };
  }

  try {
    const normalizedPath = path.normalize(filePath);

    // Prefer statfs on a directory path. If the input is a file, probe its parent directory.
    let probePath = normalizedPath;
    try {
      const stats = await fs.stat(normalizedPath);
      if (stats.isFile()) probePath = path.dirname(normalizedPath);
    } catch {
      // If stat fails (e.g. non-existent path), still try parent directory.
      probePath = path.dirname(normalizedPath);
    }

    const stats = await fs.statfs(probePath);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    return { success: true, freeBytes, totalBytes };
  } catch (error: any) {
    console.error(`[handleGetDiskSpace] Error for ${filePath}:`, error);
    return {
      success: false,
      error: error.message || 'Failed to get disk space.',
    };
  }
}

export async function handleGetTempDiskSpace(
  _event: IpcMainInvokeEvent
): Promise<{
  success: boolean;
  freeBytes?: number;
  totalBytes?: number;
  error?: string;
}> {
  try {
    const tempDir = app.getPath('temp');
    const stats = await fs.statfs(tempDir);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    return { success: true, freeBytes, totalBytes };
  } catch (error: any) {
    console.error(`[handleGetTempDiskSpace] Error:`, error);
    return {
      success: false,
      error: error.message || 'Failed to get disk space.',
    };
  }
}
