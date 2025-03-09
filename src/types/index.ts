// Type definitions for our API parameters and responses
export type ProgressCallback = (progress: {
  percent: number;
  stage: string;
}) => void;

export interface GenerateSubtitlesOptions {
  videoPath?: string;
  videoFile?: File;
  language: string;
}

export interface GenerateSubtitlesResult {
  subtitles: string;
  error?: string;
}

export interface TranslateSubtitlesOptions {
  subtitles: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslateSubtitlesResult {
  translatedSubtitles: string;
  error?: string;
}

export interface MergeSubtitlesOptions {
  videoPath: string;
  subtitlesPath: string;
  outputPath?: string;
}

export interface MergeSubtitlesResult {
  outputPath: string;
  error?: string;
}

export interface SaveFileOptions {
  content: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  filePath?: string; // Direct path to save to without showing dialog
}

export interface SaveFileResult {
  filePath: string;
  error?: string;
}

export interface OpenFileOptions {
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}

export interface OpenFileResult {
  filePaths: string[];
  fileContents?: string[];
  error?: string;
  canceled?: boolean;
}

// Define the types for the API
export interface IpcApi {
  // Test methods
  ping: () => Promise<string>;
  showMessage: (message: string) => Promise<boolean>;
  test: () => string;

  // Subtitle generation
  generateSubtitles: (
    options: GenerateSubtitlesOptions
  ) => Promise<GenerateSubtitlesResult>;
  onGenerateSubtitlesProgress: (callback: ProgressCallback) => void;

  // Subtitle translation
  translateSubtitles: (
    options: TranslateSubtitlesOptions
  ) => Promise<TranslateSubtitlesResult>;
  onTranslateSubtitlesProgress: (callback: ProgressCallback) => void;

  // Video merging
  mergeSubtitles: (
    options: MergeSubtitlesOptions
  ) => Promise<MergeSubtitlesResult>;
  onMergeSubtitlesProgress: (callback: ProgressCallback) => void;

  // File operations
  saveFile: (options: SaveFileOptions) => Promise<SaveFileResult>;
  openFile: (options: OpenFileOptions) => Promise<OpenFileResult>;
}
