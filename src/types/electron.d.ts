import { IpcRenderer } from 'electron';
import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  MergeSubtitlesOptions,
  MergeSubtitlesResult,
  SaveFileOptions,
  SaveFileResult,
  OpenFileOptions,
  OpenFileResult,
  DeleteFileOptions,
  DeleteFileResult,
  MoveFileResult,
  CancelMergeResult,
  TranslateSubtitlesOptions,
  TranslateSubtitlesResult,
} from './interface'; // Make sure this path is correct

// Define a reusable type for the progress event callback
type ProgressEventCallback = (
  event: any,
  progress: {
    partialResult?: string;
    percent: number;
    stage: string;
    current?: number;
    total?: number;
    warning?: string;
    operationId?: string;
  }
) => void;

interface ElectronAPI {
  ping: () => Promise<string>;
  saveFile: (options: SaveFileOptions) => Promise<SaveFileResult>;
  openFile: (options?: OpenFileOptions) => Promise<OpenFileResult>;
  mergeSubtitles: (
    options: MergeSubtitlesOptions
  ) => Promise<MergeSubtitlesResult>;
  onMergeSubtitlesProgress: (
    callback: ProgressEventCallback | null
  ) => () => void;
  moveFile: (
    sourcePath: string,
    destinationPath: string
  ) => Promise<MoveFileResult>;
  deleteFile: (options: DeleteFileOptions) => Promise<DeleteFileResult>;
  cancelMerge: (operationId: string) => Promise<CancelMergeResult>;

  // === Add generateSubtitles and its progress listener ===
  generateSubtitles: (
    options: GenerateSubtitlesOptions
  ) => Promise<GenerateSubtitlesResult>;
  onGenerateSubtitlesProgress: (
    callback: ProgressEventCallback | null
  ) => () => void;

  // === Add Subtitle Translation ===
  translateSubtitles: (
    options: TranslateSubtitlesOptions
  ) => Promise<TranslateSubtitlesResult>;
  onTranslateSubtitlesProgress: (
    callback: ProgressEventCallback | null
  ) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    ipcRenderer: IpcRenderer;
  }
}

// This export is necessary to treat this file as a module
export {};
