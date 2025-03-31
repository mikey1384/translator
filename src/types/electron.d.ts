import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  MergeSubtitlesOptions,
  SaveFileOptions,
  SaveFileResult,
  OpenFileOptions,
  OpenFileResult,
  TranslateSubtitlesOptions,
  TranslateSubtitlesResult,
} from './interface';

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
  onGenerateSubtitlesProgress: (
    callback: ProgressEventCallback | null
  ) => () => void;
  onTranslateSubtitlesProgress: (
    callback: ProgressEventCallback | null
  ) => () => void;
  generateSubtitles: (
    options: GenerateSubtitlesOptions
  ) => Promise<GenerateSubtitlesResult>;
  translateSubtitles: (
    params: TranslateSubtitlesOptions
  ) => Promise<TranslateSubtitlesResult>;
  saveFile: (options: SaveFileOptions) => Promise<SaveFileResult>;
  showMessage: (message: string) => void;
  mergeSubtitles: (
    options: Omit<MergeSubtitlesOptions, 'outputPath'> & {
      operationId?: string;
    }
  ) => Promise<{
    success: boolean;
    tempOutputPath?: string;
    error?: string;
    operationId: string;
  }>;
  onMergeSubtitlesProgress: (
    callback: ProgressEventCallback | null
  ) => () => void;
  openFile: (options: OpenFileOptions) => Promise<OpenFileResult>;
  cancelMerge: (
    operationId: string
  ) => Promise<{ success: boolean; error?: string }>;
  moveFile: (
    sourcePath: string,
    targetPath: string
  ) => Promise<{ success: boolean; error?: string }>;
  deleteFile: (options: {
    filePathToDelete: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
