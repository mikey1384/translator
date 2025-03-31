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
