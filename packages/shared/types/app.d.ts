declare module '@shared-types/app' {
  import type { IpcRenderer } from 'electron';
  import type { SubtitleStylePresetKey } from '@shared/constants/subtitle-styles';
  import type { FFmpegService } from '@app/services';
  import type { FileManager } from '@app/services';

  // === Subtitle Generation and Processing ===
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

  // === Translation Related Types ===
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

  // === Progress Callbacks ===
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

  // === URL Processing ===
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

  // === Render Results ===
  interface ExposedRenderResult {
    // Add this interface if not already defined globally
    success: boolean;
    outputPath?: string;
    error?: string;
    cancelled?: boolean;
    operationId: string;
  }

  // === Electron API and File Operations ===
  interface ElectronAPI {
    hasVideoTrack: (filePath: string) => Promise<boolean>;
    ping: () => Promise<string>;
    saveFile: (options: SaveFileOptions) => Promise<SaveFileResult>;
    openFile: (options?: OpenFileOptions) => Promise<OpenFileResult>;
    moveFile: (
      sourcePath: string,
      destinationPath: string
    ) => Promise<{ success?: boolean; error?: string }>;
    deleteFile: (options: DeleteFileOptions) => Promise<DeleteFileResult>;

    // === Add generateSubtitles and its progress listener ===
    generateSubtitles: (
      options: GenerateSubtitlesOptions
    ) => Promise<GenerateSubtitlesResult>;

    onGenerateSubtitlesProgress: (
      callback: ProgressEventCallback | null
    ) => () => void;
    onMergeSubtitlesProgress: (
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

    // --- ADD THESE LINES for Subtitle Target Language ---
    getSubtitleTargetLanguage: () => Promise<string>; // Main handler provides default 'original'
    setSubtitleTargetLanguage: (
      lang: string
    ) => Promise<{ success: boolean; error?: string }>;
    // --- END ADD ---

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
    saveVideoPlaybackPosition: (
      filePath: string,
      position: number
    ) => Promise<void>;
    getVideoPlaybackPosition: (filePath: string) => Promise<number | null>;
    // --- END ADD ---
  }

  // === File and Subtitle Options ===
  export interface GenerateSubtitlesOptions {
    videoPath?: string;
    videoFile?: File;
    targetLanguage: string;
    streamResults?: boolean; // Whether to stream partial results
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
    sourceLang?: string; // Optional string property
  }

  export interface OpenFileResult {
    canceled: boolean;
    filePaths: string[]; // ← no longer optional
    bookmarks?: string[];
    fileContents?: string[];
    error?: string;
  }

  export interface FileData {
    name: string;
    path: string;
    size: number;
    type: string;
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
    /** Electron showOpenDialog flags */
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

  export type EditField = 'start' | 'end' | 'original' | 'translation';
  export type EditArgs = {
    index: number;
    field: EditField;
    value: number | string;
  };

  // === Translation Options and Results ===
  export interface TranslateSubtitlesOptions {
    subtitles: string;
    sourceLanguage: string;
    targetLanguage: string;
  }

  export interface TranslateSubtitlesResult {
    translatedSubtitles: string;
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

  // Add ReviewTranslationBatchArgs type
  export interface ReviewTranslationBatchArgs {
    segments: SrtSegment[]; // Assuming the 'any[]' in original code corresponds to SrtSegment[]
    startIndex: number;
    endIndex: number;
    targetLang: string;
  }

  // === Rendering Options ===
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

  export type VideoQuality = 'high' | 'mid' | 'low';
}
