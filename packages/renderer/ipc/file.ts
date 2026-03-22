import type {
  DetachSubtitleDocumentSourceOptions,
  DetachSubtitleDocumentSourceResult,
  FindSubtitleDocumentForFileOptions,
  FindSubtitleDocumentForFileResult,
  FindSubtitleDocumentForSourceOptions,
  FindSubtitleDocumentForSourceResult,
  ReadSavedSubtitleMetadataOptions,
  ReadSavedSubtitleMetadataResult,
  ReadSubtitleDocumentOptions,
  ReadSubtitleDocumentResult,
  OpenFileOptions,
  SaveFileOptions,
  SaveSubtitleDocumentOptions,
  SaveSubtitleDocumentResult,
  SaveSubtitleDocumentRecordOptions,
  SaveSubtitleDocumentRecordResult,
  OpenFileResult,
  SaveFileResult,
} from '@shared-types/app';

export function open(options?: OpenFileOptions): Promise<OpenFileResult> {
  return window.electron.openFile(options);
}

export function save(options: SaveFileOptions): Promise<SaveFileResult> {
  return window.electron.saveFile(options);
}

export function saveSubtitleDocumentRecord(
  options: SaveSubtitleDocumentRecordOptions
): Promise<SaveSubtitleDocumentRecordResult> {
  return window.electron.saveSubtitleDocumentRecord(options);
}

export function readSubtitleDocument(
  options: ReadSubtitleDocumentOptions
): Promise<ReadSubtitleDocumentResult> {
  return window.electron.readSubtitleDocument(options);
}

export function findSubtitleDocumentForFile(
  options: FindSubtitleDocumentForFileOptions
): Promise<FindSubtitleDocumentForFileResult> {
  return window.electron.findSubtitleDocumentForFile(options);
}

export function findSubtitleDocumentForSource(
  options: FindSubtitleDocumentForSourceOptions
): Promise<FindSubtitleDocumentForSourceResult> {
  return window.electron.findSubtitleDocumentForSource(options);
}

export function detachSubtitleDocumentSource(
  options: DetachSubtitleDocumentSourceOptions
): Promise<DetachSubtitleDocumentSourceResult> {
  return window.electron.detachSubtitleDocumentSource(options);
}

export function saveSubtitleDocument(
  options: SaveSubtitleDocumentOptions
): Promise<SaveSubtitleDocumentResult> {
  return window.electron.saveSubtitleDocument(options);
}

export function copy(
  sourcePath: string,
  destinationPath: string
): Promise<{ success?: boolean; error?: string }> {
  return window.electron.copyFile(sourcePath, destinationPath);
}

export function readFileContent(filePath: string): Promise<{
  success: boolean;
  data?: ArrayBuffer | ArrayBufferView;
  error?: string;
}> {
  return window.electron.readFileContent(filePath);
}

export function readSavedSubtitleMetadata(
  options: ReadSavedSubtitleMetadataOptions
): Promise<ReadSavedSubtitleMetadataResult> {
  return window.electron.readSavedSubtitleMetadata(options);
}

export function getFileSize(
  filePath: string
): Promise<{ success: boolean; sizeBytes?: number; error?: string }> {
  return window.electron.getFileSize(filePath);
}

export function getFileIdentity(filePath: string): Promise<{
  success: boolean;
  identity?: string;
  sizeBytes?: number;
  mtimeMs?: number;
  birthtimeMs?: number;
  dev?: number;
  ino?: number;
  error?: string;
}> {
  return window.electron.getFileIdentity(filePath);
}

export function getDiskSpace(filePath: string): Promise<{
  success: boolean;
  freeBytes?: number;
  totalBytes?: number;
  error?: string;
}> {
  return window.electron.getDiskSpace(filePath);
}

export function getTempDiskSpace(): Promise<{
  success: boolean;
  freeBytes?: number;
  totalBytes?: number;
  error?: string;
}> {
  return window.electron.getTempDiskSpace();
}
