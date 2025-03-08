import { contextBridge, ipcRenderer } from "electron";

// Define the types for our API
export interface IpcApi {
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
}

// Expose our API to the renderer process
contextBridge.exposeInMainWorld("electron", {
  // Subtitle generation
  generateSubtitles: (options: GenerateSubtitlesOptions) =>
    ipcRenderer.invoke("generate-subtitles", options),
  onGenerateSubtitlesProgress: (callback: ProgressCallback) =>
    ipcRenderer.on("generate-subtitles-progress", (_event, progress) =>
      callback(progress)
    ),

  // Subtitle translation
  translateSubtitles: (options: TranslateSubtitlesOptions) =>
    ipcRenderer.invoke("translate-subtitles", options),
  onTranslateSubtitlesProgress: (callback: ProgressCallback) =>
    ipcRenderer.on("translate-subtitles-progress", (_event, progress) =>
      callback(progress)
    ),

  // Video merging
  mergeSubtitles: (options: MergeSubtitlesOptions) =>
    ipcRenderer.invoke("merge-subtitles", options),
  onMergeSubtitlesProgress: (callback: ProgressCallback) =>
    ipcRenderer.on("merge-subtitles-progress", (_event, progress) =>
      callback(progress)
    ),

  // File operations
  saveFile: (options: SaveFileOptions) =>
    ipcRenderer.invoke("save-file", options),
  openFile: (options: OpenFileOptions) =>
    ipcRenderer.invoke("open-file", options),
} as IpcApi);
