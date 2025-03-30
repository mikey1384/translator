import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  MergeSubtitlesOptions,
  MergeSubtitlesResult,
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
  saveFile: (params: SaveFileOptions) => Promise<SaveFileResult>;
  showMessage: (message: string) => void;
  mergeSubtitles: (
    options: MergeSubtitlesOptions
  ) => Promise<MergeSubtitlesResult & { operationId?: string }>;
  onMergeSubtitlesProgress: (
    callback: ProgressEventCallback | null
  ) => () => void;
  openFile: (options: OpenFileOptions) => Promise<OpenFileResult>;
  cancelMerge: (
    operationId: string
  ) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
