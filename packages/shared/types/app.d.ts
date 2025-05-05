declare module '@shared-types/app' {
  import type { IpcRenderer } from 'electron';
  import type { SubtitleStylePresetKey } from '@shared/constants/subtitle-styles';
  import type { FFmpegService } from '@app/services';
  import type { FileManager } from '@app/services';

  // =========================================
  // === General & Utility Types
  // =========================================

  export type VideoQuality = 'high' | 'mid' | 'low';

  export interface CancelOperationResult {
    success: boolean;
    error?: string;
  }

  // =========================================
  // === File Operations
  // =========================================

  export interface OpenFileOptions {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
    properties?: (
      | 'openFile'
      | 'openDirectory'
      | 'multiSelections'
      | 'showHiddenFiles'
      | 'createDirectory'
      | 'promptToCreate'
      | 'noResolveAliases'
      | 'treatPackageAsDirectory'
      | 'dontAddToRecent'
    )[];
  }

  export interface OpenFileResult {
    canceled: boolean;
    filePaths: string[];
    bookmarks?: string[];
    fileContents?: string[];
    error?: string;
  }

  export interface SaveFileOptions {
    content: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
    filePath?: string;
    title?: string;
  }

  export interface SaveFileResult {
    filePath: string;
    error?: string;
  }

  export interface DeleteFileOptions {
    filePath: string;
  }

  export interface DeleteFileResult {
    success: boolean;
    error?: string;
  }

  export interface FileData {
    name: string;
    path: string;
    size: number;
    type: string;
  }

  // =========================================
  // === Video Metadata & Playback
  // =========================================

  export interface VideoMetadataResult {
    success: boolean;
    metadata?: {
      duration: number;
      width: number;
      height: number;
      frameRate: number;
    };
    error?: string;
  }

  // =========================================
  // === Progress Callbacks
  // =========================================

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

  export type ProgressCallback = (progress: {
    percent: number;
    stage: string;
    current?: number;
    total?: number;
    partialResult?: string;
    error?: string;
    batchStartIndex?: number;
  }) => void;

  // =========================================
  // === URL Processing
  // =========================================

  export interface ProcessUrlOptions {
    url: string;
    quality?: VideoQuality;
    operationId?: string;
  }

  export interface ProcessUrlResult {
    success: boolean;
    subtitles?: string;
    videoPath?: string;
    filePath?: string;
    filename?: string;
    size?: number;
    fileUrl?: string;
    originalVideoPath?: string;
    error?: string;
    operationId?: string;
    cancelled?: boolean;
  }

  export type UrlProgressCallback = (progress: {
    percent: number;
    stage: string;
    error?: string;
    operationId?: string;
    current?: number;
    total?: number;
  }) => void;

  // =========================================
  // === Subtitle Generation & Processing
  // =========================================

  export interface SrtSegment {
    index: number;
    start: number;
    end: number;
    original: string;
    translation?: string;
    reviewedInBatch?: number;
  }

  export interface SubtitleHandlerServices {
    ffmpegService: FFmpegService;
    fileManager: FileManager;
  }

  interface GenerateSubtitlesFromAudioArgs {
    inputAudioPath: string;
    progressCallback?: GenerateProgressCallback;
    signal: AbortSignal;
    operationId?: string;
    services: {
      ffmpegService: FFmpegService;
      fileManager: FileManager;
    };
    options?: {
      targetLang?: string;
    };
  }

  interface GenerateProgressCallback {
    (progress: {
      percent: number;
      stage: string;
      partialResult?: string;
      current?: number;
      total?: number;
      error?: string;
      batchStartIndex?: number;
    });
  }

  export interface GenerateSubtitlesOptions {
    videoPath?: string;
    videoFile?: File;
    targetLanguage: string;
    streamResults?: boolean;
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
    sourceLang?: string;
  }

  export interface GenerateSubtitlesResult {
    cancelled?: boolean;
    subtitles?: string;
    error?: string;
    success: boolean;
  }

  // =========================================
  // === Subtitle Translation
  // =========================================

  export interface TranslateSubtitlesOptions {
    subtitles: string;
    sourceLanguage: string;
    targetLanguage: string;
  }

  export interface TranslateSubtitlesResult {
    translatedSubtitles: string;
    error?: string;
  }

  interface TranslateBatchArgs {
    batch: {
      segments: any[];
      startIndex: number;
      endIndex: number;
      targetLang?: string;
    };
    targetLang: string;
    operationId: string;
    signal?: AbortSignal;
  }

  export interface ReviewTranslationBatchArgs {
    segments: SrtSegment[];
    startIndex: number;
    endIndex: number;
    targetLang: string;
  }

  export interface CancelTranslationResult {
    success: boolean;
    error?: string;
  }

  // =========================================
  // === Subtitle Editing
  // =========================================

  export type EditField = 'start' | 'end' | 'original' | 'translation';
  export type EditArgs = {
    index: number;
    field: EditField;
    value: number | string;
  };

  // =========================================
  // === Subtitle Rendering
  // =========================================

  export interface RenderSubtitlesOptions {
    fontSizePx: number;
    operationId: string;
    srtContent: string;
    outputDir: string;
    videoDuration: number;
    videoWidth: number;
    videoHeight: number;
    frameRate: number;
    originalVideoPath?: string;
    overlayMode?: 'overlayOnVideo' | 'blackVideo';
    stylePreset?: SubtitleStylePresetKey;
    outputMode?: 'original' | 'translation' | 'dual';
  }

  export interface ExposedRenderResult {
    success: boolean;
    outputPath?: string;
    error?: string;
    cancelled?: boolean;
    operationId: string;
  }

  // =========================================
  // === System & Configuration
  // =========================================

  export interface ApiKeyStatusResult {
    success: boolean;
    status?: {
      openai: boolean;
    };
    error?: string;
  }

  // =========================================
  // === Electron API (Main -> Renderer Communication Contract)
  // =========================================

  interface ElectronAPI {
    saveFile: (options: SaveFileOptions) => Promise<SaveFileResult>;
    openFile: (options?: OpenFileOptions) => Promise<OpenFileResult>;
    moveFile: (
      sourcePath: string,
      destinationPath: string
    ) => Promise<{ success?: boolean; error?: string }>;
    deleteFile: (options: DeleteFileOptions) => Promise<DeleteFileResult>;
    copyFile: (
      sourcePath: string,
      destinationPath: string
    ) => Promise<{ success?: boolean; error?: string }>;
    readFileContent: (
      filePath: string
    ) => Promise<{ success: boolean; data?: ArrayBuffer; error?: string }>;

    hasVideoTrack: (filePath: string) => Promise<boolean>;
    getVideoMetadata: (filePath: string) => Promise<VideoMetadataResult>;
    saveVideoPlaybackPosition: (
      filePath: string,
      position: number
    ) => Promise<void>;
    getVideoPlaybackPosition: (filePath: string) => Promise<number | null>;

    generateSubtitles: (
      options: GenerateSubtitlesOptions
    ) => Promise<GenerateSubtitlesResult>;
    onGenerateSubtitlesProgress: (
      callback: ProgressEventCallback | null
    ) => () => void;
    onMergeSubtitlesProgress: (
      callback: ProgressEventCallback | null
    ) => () => void;

    translateSubtitles: (
      options: TranslateSubtitlesOptions
    ) => Promise<TranslateSubtitlesResult>;
    onTranslateSubtitlesProgress: (
      callback: ProgressEventCallback | null
    ) => () => void;

    sendPngRenderRequest: (options: RenderSubtitlesOptions) => void;
    onPngRenderResult: (
      callback: (result: ExposedRenderResult) => void
    ) => () => void;

    processUrl: (options: ProcessUrlOptions) => Promise<ProcessUrlResult>;
    onProcessUrlProgress: (callback: UrlProgressCallback | null) => () => void;

    cancelOperation: (operationId: string) => Promise<CancelOperationResult>;

    getApiKeyStatus: () => Promise<ApiKeyStatusResult>;
    saveApiKey: (
      keyType: 'openai',
      apiKey: string
    ) => Promise<{ success: boolean; error?: string }>;

    ping: () => Promise<string>;
    showMessage: (message: string) => Promise<void>;
    getLocaleUrl: (lang: string) => Promise<string>;
    getLanguagePreference: () => Promise<string>;
    setLanguagePreference: (
      lang: string
    ) => Promise<{ success: boolean; error?: string }>;
    getSubtitleTargetLanguage: () => Promise<string>;
    setSubtitleTargetLanguage: (
      lang: string
    ) => Promise<{ success: boolean; error?: string }>;

    sendFindInPage: (options: {
      text: string;
      findNext?: boolean;
      forward?: boolean;
      matchCase?: boolean;
    }) => void;
    sendStopFind: () => void;
    onShowFindBar: (callback: () => void) => () => void;
    onFindResults: (
      callback: (results: {
        matches: number;
        activeMatchOrdinal: number;
        finalUpdate: boolean;
      }) => void
    ) => () => void;
  }
}
