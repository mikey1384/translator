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
import { AssStylePresetKey } from '../renderer/constants/subtitle-styles'; // Import the type

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

  // === API Key Management ===
  getApiKeyStatus: () => Promise<{
    success: boolean;
    status: { openai: boolean; anthropic: boolean };
    error?: string;
  }>;
  saveApiKey: (
    keyType: 'openai' | 'anthropic',
    apiKey: string
  ) => Promise<{ success: boolean; error?: string }>;

  // Add the missing showMessage method
  showMessage: (message: string) => Promise<void>;
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
}) => void;

export interface SubtitleSegment {
  id: number;
  start: string; // SRT format: "00:00:00,000"
  end: string;
  text: string;
  translation?: string;
}

export interface GenerateSubtitlesOptions {
  videoPath?: string;
  videoFile?: File;
  targetLanguage: string;
  streamResults?: boolean; // Whether to stream partial results
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}

export interface GenerateSubtitlesResult {
  subtitles: string;
  segments?: SubtitleSegment[]; // Structured subtitle data
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
  tempOutputPath?: string;
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
