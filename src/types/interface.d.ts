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
  CancelMergeResult,
  TranslateSubtitlesOptions,
  TranslateSubtitlesResult,
} from './interface'; // Make sure this path is correct
import { AssStylePresetKey } from '../renderer/constants/subtitle-styles'; // Import the type
export type VideoQuality = 'low' | 'mid' | 'high'; // <-- Export type here

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

// --- Add types for URL Processing --- START ---
interface ProcessUrlOptions {
  url: string;
  quality?: VideoQuality; // Add optional quality setting
}

interface ProcessUrlResult {
  success: boolean;
  subtitles?: string; // The generated subtitles (kept for backward compatibility)
  videoPath?: string; // Path to the downloaded video file
  filePath?: string; // Alternative name for videoPath (for backwards compatibility)
  filename?: string; // Name of the downloaded file
  size?: number; // Size of the downloaded file in bytes
  fileUrl?: string; // Direct file:// URL to the downloaded video
  originalVideoPath?: string; // Path to the downloaded temp file (for potential later use/cleanup by renderer?)
  error?: string;
  operationId?: string;
}

// Define a specific progress type for URL processing (download + generation)
type UrlProgressCallback = (progress: {
  percent: number;
  stage: string;
  error?: string;
  operationId?: string;
  current?: number; // Optional for transcription stage
  total?: number; // Optional for transcription stage
}) => void;
// --- Add types for URL Processing --- END ---

interface ExposedRenderResult {
  // Add this interface if not already defined globally
  success: boolean;
  outputPath?: string;
  error?: string;
  cancelled?: boolean;
  operationId: string;
}

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
  ) => Promise<{ success?: boolean; error?: string }>;
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

  // === URL Processing ===
  processUrl: (options: ProcessUrlOptions) => Promise<ProcessUrlResult>;
  onProcessUrlProgress: (callback: UrlProgressCallback | null) => () => void;

  // === API Key Management ===
  getApiKeyStatus: () => Promise<{
    success: boolean;
    status: { openai: boolean };
    error?: string;
  }>;
  saveApiKey: (
    keyType: 'openai',
    apiKey: string
  ) => Promise<{ success: boolean; error?: string }>;

  // Add the missing showMessage method
  showMessage: (message: string) => Promise<void>;

  // Add copyFile signature
  copyFile: (
    sourcePath: string,
    destinationPath: string
  ) => Promise<{ success?: boolean; error?: string }>;

  // === Add readFileContent === START ===
  readFileContent: (
    filePath: string
  ) => Promise<{ success: boolean; data?: ArrayBuffer; error?: string }>;
  // === Add readFileContent === END ===

  // Translation cancellation
  cancelOperation: (operationId: string) => Promise<CancelOperationResult>;

  // Find-in-Page Functions
  sendFindInPage: (options: {
    text: string;
    findNext?: boolean;
    forward?: boolean;
    matchCase?: boolean;
  }) => void;
  sendStopFind: () => void;
  onShowFindBar: (callback: () => void) => () => void; // Listener returns cleanup function
  onFindResults: (
    callback: (results: {
      matches: number;
      activeMatchOrdinal: number;
      finalUpdate: boolean;
    }) => void
  ) => () => void; // Listener returns cleanup function

  // === Get Locale URL ===
  getLocaleUrl: (lang: string) => Promise<string>;

  // === Language Preferences ===
  getLanguagePreference: () => Promise<string>;
  setLanguagePreference: (
    lang: string
  ) => Promise<{ success: boolean; error?: string }>;

  getVideoMetadata: (filePath: string) => Promise<{
    success: boolean;
    metadata?: {
      duration: number;
      width: number;
      height: number;
      frameRate: number;
    };
    error?: string;
  }>;

  sendPngRenderRequest: (options: RenderSubtitlesOptions) => void;
  onPngRenderResult: (
    callback: (result: ExposedRenderResult) => void
  ) => () => void; // Listener returns cleanup fn
}

declare global {
  interface Window {
    electron: ElectronAPI;
    ipcRenderer: IpcRenderer;
  }
}

// Type definitions for our API parameters and responses
export type ProgressCallback = (progress: {
  percent: number;
  stage: string;
  current?: number;
  total?: number;
  partialResult?: string;
  error?: string;
  batchStartIndex?: number;
}) => void;

export interface GenerateSubtitlesOptions {
  videoPath?: string;
  videoFile?: File;
  targetLanguage: string;
  streamResults?: boolean; // Whether to stream partial results
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}

export interface FileData {
  name: string;
  path: string;
  size: number;
  type: string;
}

export interface GenerateSubtitlesResult {
  subtitles: string;
  segments?: SrtSegment[]; // Structured subtitle data
  error?: string;
}

export interface MergeSubtitlesOptions {
  videoPath?: string;
  subtitlesPath?: string;
  outputPath?: string;
  videoFile?: File;
  srtContent?: string;
  videoFileName?: string;
  videoFileData?: ArrayBuffer;
  operationId?: string;
  fontSize?: number;
  stylePreset?: AssStylePresetKey; // Add style preset key
}

export interface MergeSubtitlesResult {
  success: boolean;
  outputPath?: string;
  cancelled?: boolean;
  error?: string;
  operationId?: string;
}

export interface SaveFileOptions {
  content: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  filePath?: string; // Direct path to save to without showing dialog
  title?: string; // Add title for save dialog
}

export interface SaveFileResult {
  filePath: string;
  error?: string;
}

export interface OpenFileOptions {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}

export interface SrtSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  originalText?: string;
  translatedText?: string;
}

export interface OpenFileResult {
  filePaths?: string[]; // Made optional as checks exist in usage
  fileContents?: string[]; // Made optional as checks exist in usage
  error?: string;
  canceled?: boolean;
}

// Add missing types for translateSubtitles
export interface TranslateSubtitlesOptions {
  subtitles: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslateSubtitlesResult {
  translatedSubtitles: string;
  error?: string;
}

export interface CancelMergeResult {
  success: boolean;
  error?: string;
}

export interface CancelTranslationResult {
  success: boolean;
  error?: string;
}

// Define a generic CancelResult type
export interface CancelOperationResult {
  success: boolean;
  error?: string;
}

// Add GenerateSubtitlesFromAudioArgs type
export interface GenerateSubtitlesFromAudioArgs {
  inputAudioPath: string;
  progressCallback?: ProgressCallback;
  signal?: AbortSignal;
  operationId: string;
  services: {
    ffmpegService: any; // Consider importing FFmpegService type if available globally
    fileManager: any; // Consider importing FileManager type if available globally
  };
}

// Add MergeSubtitlesWithVideoArgs type
export interface MergeSubtitlesWithVideoArgs {
  options: MergeSubtitlesOptions;
  operationId: string;
  services: {
    ffmpegService: any; // Consider importing FFmpegService type
    fileManager: any; // Consider importing FileManager type
  };
  progressCallback?: ProgressCallback;
}

// Add TranslateBatchArgs type
export interface TranslateBatchArgs {
  batch: {
    segments: SrtSegment[];
    startIndex: number;
    endIndex: number;
  };
  targetLang: string;
  operationId: string;
  signal?: AbortSignal;
}

// Add ReviewTranslationBatchArgs type
export interface ReviewTranslationBatchArgs {
  segments: SrtSegment[]; // Assuming the 'any[]' in original code corresponds to SrtSegment[]
  startIndex: number;
  endIndex: number;
  targetLang: string;
}

export interface RenderSubtitlesOptions {
  operationId: string;
  srtContent: string;
  outputDir: string;
  videoDuration: number;
  videoWidth: number;
  videoHeight: number;
  frameRate: number;
  originalVideoPath?: string;
}
