declare module '@shared-types/app' {
  import type { SubtitleStylePresetKey } from '@shared/constants/subtitle-styles';
  import type { FFmpegService } from '@app/services';
  import type { FileManager } from '@app/services';

  // =========================================
  // === General & Utility Types
  // =========================================

  export type VideoQuality =
    | 'high'
    | 'mid'
    | 'low'
    | '4320p'
    | '2160p'
    | '1440p'
    | '1080p'
    | '720p'
    | '480p'
    | '360p'
    | '240p';

  export interface CancelOperationResult {
    success: boolean;
    error?: string;
    message?: string;
  }

  export interface UpdateRequiredNotice {
    error: 'update-required';
    message: string;
    minVersion?: string;
    clientVersion?: string;
    downloadUrl?: string;
    source?: 'stage5-api' | 'relay' | 'unknown';
  }

  export interface ErrorReportSystemInfo {
    platform: string;
    arch: string;
    release?: string;
    cpu?: string;
    isAppleSilicon?: boolean;
  }

  export interface ErrorReportContext {
    generatedAt: string;
    app: {
      name: string;
      version: string;
      isPackaged: boolean;
      environment: 'development' | 'production';
      electronVersion?: string;
      chromeVersion?: string;
      nodeVersion?: string;
      logFilePath?: string | null;
    };
    system: ErrorReportSystemInfo;
    endpoints: {
      stage5ApiUrl: string;
      relayUrl: string;
    };
    mainLog: {
      available: boolean;
      tail: string;
      error?: string;
      lineCount: number;
    };
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
    content?: string;
    sourcePath?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
    filePath?: string;
    forceDialog?: boolean;
    title?: string;
  }

  export interface SaveFileResult {
    success: boolean;
    filePath?: string;
    error?: string;
  }

  export interface DeleteFileOptions {
    filePath: string;
  }

  export interface DeleteFileResult {
    success: boolean;
    error?: string;
  }

  export type StoredSubtitleKind = 'transcription' | 'translation';

  export interface StoredSubtitleEntry {
    id: string;
    kind: StoredSubtitleKind;
    targetLanguage: string | null;
    filePath: string;
    sourceVideoPaths: string[];
    sourceUrls: string[];
    createdAt: string;
    updatedAt: string;
  }

  export interface StoredTranscriptAnalysisEntry {
    id: string;
    transcriptHash: string;
    summaryLanguage: string;
    effortLevel: SummaryEffortLevel;
    filePath: string;
    sourceVideoPaths: string[];
    sourceUrls: string[];
    libraryEntryIds: string[];
    createdAt: string;
    updatedAt: string;
  }

  export interface StoredTranscriptAnalysisArtifact {
    summary: string;
    sections: TranscriptSummarySection[];
    highlights: TranscriptHighlight[];
    highlightStatus: TranscriptHighlightStatus;
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
      rotation?: number;
      displayWidth?: number;
      displayHeight?: number;
    };
    error?: string;
    code?: string;
    details?: string;
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
      /** Machine-readable phase key for ETA / progress logic. */
      phaseKey?: string;
      current?: number;
      total?: number;
      /** Unit for current/total counters (e.g. "chunks", "segments"). */
      unit?: string;
      /** Numeric remaining-time hint from the backend when available. */
      etaSeconds?: number;
      warning?: string;
      operationId?: string;
      batchStartIndex?: number;
      /** AI model or provider being used (e.g. "Claude Opus", "OpenAI TTS"). */
      model?: string;
    }
  ) => void;

  export type ProgressCallback = (progress: {
    percent: number;
    stage: string;
    phaseKey?: string;
    current?: number;
    total?: number;
    unit?: string;
    etaSeconds?: number;
    partialResult?: string;
    error?: string;
    batchStartIndex?: number;
    operationId?: string;
    model?: string;
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
    title?: string;
    thumbnailUrl?: string;
    channel?: string;
    channelUrl?: string;
    durationSec?: number;
    uploadedAt?: string;
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

  export type VideoSuggestionModelPreference =
    | 'default'
    | 'quality'
    | 'gpt-5.1'
    | 'gpt-5.4'
    | 'claude-sonnet-4-6'
    | 'claude-opus-4-6';
  export type Stage5VideoSuggestionMode = 'standard' | 'high';
  export type ByoVideoSuggestionModel =
    | 'gpt-5.1'
    | 'gpt-5.4'
    | 'claude-sonnet-4-6'
    | 'claude-opus-4-6'
    // Migration-only compatibility states for legacy unified preferences.
    | 'follow-draft'
    | 'follow-review';

  export type VideoSuggestionRecency =
    | 'any'
    | 'day'
    | 'week'
    | 'month'
    | 'year';

  export type VideoSuggestionStageKey = 'answerer' | 'planner' | 'retrieval';

  export type VideoSuggestionStageState = 'pending' | 'running' | 'cleared';

  export type VideoSuggestionViewTab = 'results' | 'history' | 'channels';

  export interface VideoSuggestionMessage {
    role: 'user' | 'assistant';
    content: string;
  }

  export interface VideoSuggestionResultItem {
    id: string;
    title: string;
    url: string;
    thumbnailUrl?: string;
    channel?: string;
    channelUrl?: string;
    durationSec?: number;
    uploadedAt?: string;
  }

  export interface VideoSuggestionPreferenceSlots {
    topic?: string;
  }

  export interface VideoSuggestionContextToggles {
    includeDownloadHistory?: boolean;
    includeWatchedChannels?: boolean;
  }

  export interface VideoSuggestionChatRequest {
    history: VideoSuggestionMessage[];
    modelPreference?: VideoSuggestionModelPreference;
    preferredLanguage?: string;
    preferredLanguageName?: string;
    targetCountry?: string;
    youtubeRegionCode?: string;
    youtubeSearchLanguage?: string;
    preferredRecency?: VideoSuggestionRecency;
    savedPreferences?: VideoSuggestionPreferenceSlots;
    continuationId?: string;
    searchQueryOverride?: string;
    excludeUrls?: string[];
    contextToggles?: VideoSuggestionContextToggles;
    recentDownloadTitles?: string[];
    recentChannelNames?: string[];
    operationId?: string;
  }

  export interface VideoSuggestionChatResult {
    success: boolean;
    assistantMessage: string;
    searchQuery?: string;
    youtubeRegionCode?: string;
    youtubeSearchLanguage?: string;
    results?: VideoSuggestionResultItem[];
    capturedPreferences?: VideoSuggestionPreferenceSlots;
    continuationId?: string;
    resolvedModel: string;
    error?: string;
  }

  export type VideoSuggestionProgressPhase =
    | 'planning'
    | 'searching'
    | 'ranking'
    | 'finalizing'
    | 'done'
    | 'error';

  export interface VideoSuggestionProgress {
    operationId: string;
    phase: VideoSuggestionProgressPhase;
    message?: string;
    elapsedMs?: number;
    searchQuery?: string;
    assistantPreview?: string;
    resultCount?: number;
    partialResults?: VideoSuggestionResultItem[];
    stageKey?: VideoSuggestionStageKey;
    stageIndex?: number;
    stageTotal?: number;
    stageState?: VideoSuggestionStageState;
    stageOutcome?: string;
  }

  // =========================================
  // === Subtitle Generation & Processing
  // =========================================

  export interface SrtSegment {
    id: string;
    index: number;
    start: number;
    end: number;
    original: string;
    translation?: string;
    reviewedInBatch?: number;
    _oldText?: string;
    avg_logprob?: number;
    no_speech_prob?: number;
    words?: { start: number; end: number; word: string }[];
  }

  export interface SubtitleHandlerServices {
    ffmpegService: FFmpegService;
    fileManager: FileManager;
  }

  export interface TranscriptSummarySegment {
    start: number;
    end: number;
    text: string;
  }

  export interface TranscriptHighlight {
    id?: string;
    start: number;
    end: number;
    title?: string;
    description?: string;
    score?: number;
    confidence?: number;
    category?: string;
    justification?: string;
    videoPath?: string; // populated when server cuts clips
    lineStart?: number;
    lineEnd?: number;
  }

  export interface TranscriptSummarySection {
    index: number;
    title: string;
    content: string;
  }

  export type SummaryEffortLevel = 'standard' | 'high';
  export type TranscriptHighlightStatus =
    | 'complete'
    | 'degraded'
    | 'not_requested';

  export interface TranscriptSummaryRequest {
    segments: TranscriptSummarySegment[];
    targetLanguage: string;
    operationId?: string;
    videoPath?: string | null;
    includeHighlights?: boolean;
    effortLevel?: SummaryEffortLevel;
  }

  export interface TranscriptSummaryResult {
    success: boolean;
    summary?: string;
    sections?: TranscriptSummarySection[];
    highlights?: TranscriptHighlight[];
    highlightStatus?: TranscriptHighlightStatus;
    error?: string;
    cancelled?: boolean;
    operationId: string;
  }

  export interface TranscriptSummaryProgress {
    percent: number;
    stage: string;
    error?: string;
    partialSummary?: string;
    partialHighlights?: TranscriptHighlight[];
    partialSections?: TranscriptSummarySection[];
    current?: number;
    total?: number;
    operationId?: string;
  }

  export type HighlightAspectMode =
    | 'vertical'
    | 'vertical_reframe'
    | 'vertical_fit'
    | 'original';

  export interface CutHighlightClipRequest {
    videoPath: string;
    highlight: TranscriptHighlight;
    operationId?: string;
    aspectMode?: HighlightAspectMode;
  }

  export interface CutHighlightClipResult {
    success: boolean;
    highlight?: TranscriptHighlight;
    error?: string;
    cancelled?: boolean;
    operationId: string;
  }

  export interface HighlightCutProgress {
    percent: number;
    stage: string;
    operationId?: string;
    highlightId?: string;
    error?: string;
    highlight?: TranscriptHighlight;
  }

  export interface CutCombinedHighlightsRequest {
    videoPath: string;
    highlights: TranscriptHighlight[];
    operationId?: string;
    aspectMode?: HighlightAspectMode;
  }

  export interface CutCombinedHighlightsResult {
    success: boolean;
    videoPath?: string;
    error?: string;
    cancelled?: boolean;
    operationId: string;
  }

  export interface CombinedHighlightCutProgress {
    percent: number;
    stage: string;
    operationId?: string;
    error?: string;
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
      /** Machine-readable phase key for ETA / progress logic. */
      phaseKey?: string;
      partialResult?: string;
      current?: number;
      total?: number;
      /** Unit for current/total counters (e.g. "chunks", "segments"). */
      unit?: string;
      /** Numeric remaining-time hint from the backend when available. */
      etaSeconds?: number;
      error?: string;
      batchStartIndex?: number;
      operationId?: string;
      /** AI model or provider being used (e.g., "ElevenLabs Dubbing", "OpenAI TTS") */
      model?: string;
    });
  }

  export interface GenerateSubtitlesOptions {
    videoPath?: string;
    videoFile?: File;
    /** Stable original source path used for durable transcription recovery. */
    sourceMediaPath?: string;
    /** Stable fallback identity used when the source has no reusable filesystem path. */
    durableRecoverySeed?: string;
    targetLanguage: string;
    streamResults?: boolean;
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
    sourceLang?: string;
    qualityTranscription?: boolean; // true = sequential/contextual, false = fast/batched
  }

  export interface GenerateSubtitlesResult {
    cancelled?: boolean;
    subtitles?: string;
    error?: string;
    success: boolean;
    transcriptionEngine?: 'elevenlabs' | 'whisper' | null;
  }

  // =========================================
  // === Subtitle Translation
  // =========================================

  export interface TranslateSubtitlesOptions {
    subtitles: string;
    sourceLanguage?: string;
    targetLanguage: string;
    operationId?: string;
    qualityTranslation?: boolean; // true = include review, false = skip review
  }

  export interface TranslateSubtitlesResult {
    success: boolean;
    translatedSubtitles?: string;
    cancelled?: boolean;
    error?: string;
    operationId?: string;
  }

  // Single-line translate with explicit context
  export interface TranslateOneLineOptions {
    segment: SrtSegment;
    contextBefore?: SrtSegment[];
    contextAfter?: SrtSegment[];
    targetLanguage: string;
    operationId?: string;
  }

  export interface TranslateOneLineResult {
    translation: string;
    error?: string;
  }

  // Single-line transcription with context and precise audio segment
  export interface TranscribeOneLineOptions {
    videoPath: string;
    sourceUrl?: string | null;
    segment: { start: number; end: number };
    promptContext?: string;
    operationId?: string;
  }

  export interface TranscribeOneLineResult {
    transcript: string;
    segments?: SrtSegment[];
    error?: string;
  }

  // Transcribe remaining portion of a video (append-mode)
  export interface TranscribeRemainingOptions {
    videoPath: string;
    sourceUrl?: string | null;
    start: number;
    end?: number;
    operationId?: string;
    qualityTranscription?: boolean;
  }

  export interface TranscribeRemainingResult {
    segments: SrtSegment[];
    error?: string;
  }

  // =========================================
  // === Dubbing / Voice Synthesis
  // =========================================

  export interface DubSegmentPayload {
    start: number;
    end: number;
    original?: string;
    translation?: string;
    index?: number;
    targetDuration?: number;
    ambientMix?: number;
  }

  export interface DubSubtitlesOptions {
    segments: DubSegmentPayload[];
    videoPath?: string | null;
    targetLanguage?: string;
    voice?: string;
    quality?: 'standard' | 'high';
    operationId: string;
    ambientMix?: number;
    videoDurationSeconds?: number;
    sourceLanguage?: string;
  }

  export interface DubSubtitlesResult {
    success: boolean;
    audioPath?: string;
    videoPath?: string;
    cancelled?: boolean;
    error?: string;
    operationId: string;
    segments?: Array<{
      index: number;
      audioBase64: string;
      targetDuration?: number;
    }>;
    segmentCount?: number;
    chunkCount?: number;
    format?: string;
    voice?: string;
    model?: string;
  }

  export interface PreviewDubVoiceOptions {
    voice: string;
    text?: string;
  }

  export interface PreviewDubVoiceResult {
    success: boolean;
    audioBase64?: string;
    format?: string;
    error?: string;
  }

  interface TranslateBatchArgs {
    batch: {
      segments: any[];
      startIndex: number;
      endIndex: number;
      targetLang?: string;
      contextBefore?: SrtSegment[];
      contextAfter?: SrtSegment[];
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
    displayWidth?: number;
    displayHeight?: number;
    videoRotationDeg?: number;
  }

  export interface ExposedRenderResult {
    success: boolean;
    outputPath?: string;
    error?: string;
    cancelled?: boolean;
    operationId: string;
  }

  // =========================================
  // === Monetisation / Credits
  // =========================================
  export interface CreditBalanceResult {
    success: boolean;
    creditBalance?: number;
    balanceHours?: number;
    creditsPerHour?: number;
    updatedAt?: string;
    error?: string;
  }

  export interface AllByoSettings {
    openAiKeyPresent: boolean;
    anthropicKeyPresent: boolean;
    elevenLabsKeyPresent: boolean;
    useByoOpenAi: boolean;
    useByoAnthropic: boolean;
    useByoElevenLabs: boolean;
    useApiKeysMode: boolean;
    preferClaudeTranslation: boolean;
    preferClaudeReview: boolean;
    preferClaudeSummary: boolean;
    videoSuggestionModelPreference: VideoSuggestionModelPreference;
    stage5VideoSuggestionMode: Stage5VideoSuggestionMode;
    byoVideoSuggestionModel: ByoVideoSuggestionModel;
    preferredTranscriptionProvider: 'elevenlabs' | 'openai' | 'stage5';
    preferredDubbingProvider: 'elevenlabs' | 'openai' | 'stage5';
    stage5DubbingTtsProvider: 'openai' | 'elevenlabs';
  }

  export interface EntitlementsSnapshot {
    byoOpenAi: boolean;
    byoAnthropic: boolean;
    byoElevenLabs: boolean;
    stage5AnthropicReviewAvailable: boolean;
    fetchedAt?: string;
  }

  export interface PostInstallUpdateNotice {
    version: string;
    releaseName?: string;
    releaseDate?: string;
    notes: string;
  }

  // =========================================
  // === Electron API (Main -> Renderer Communication Contract)
  // =========================================

  interface ElectronAPI {
    cancelPngRender: (operationId: string) => void;
    requestPngRenderCancel: (operationId: string) => Promise<{
      accepted: boolean;
      reason: 'accepted' | 'save_phase' | 'cancel_pending' | 'not_found';
    }>;
    requestPngRenderStatus: (operationId: string) => Promise<{
      active: boolean;
      savePhase: boolean;
    }>;
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
    getFileSize: (
      filePath: string
    ) => Promise<{ success: boolean; sizeBytes?: number; error?: string }>;
    getFileIdentity: (filePath: string) => Promise<{
      success: boolean;
      identity?: string;
      sizeBytes?: number;
      mtimeMs?: number;
      birthtimeMs?: number;
      dev?: number;
      ino?: number;
      error?: string;
    }>;
    getDiskSpace: (filePath: string) => Promise<{
      success: boolean;
      freeBytes?: number;
      totalBytes?: number;
      error?: string;
    }>;
    getTempDiskSpace: () => Promise<{
      success: boolean;
      freeBytes?: number;
      totalBytes?: number;
      error?: string;
    }>;
    saveStoredSubtitleArtifact: (options: {
      content: string;
      kind: StoredSubtitleKind;
      targetLanguage?: string | null;
      sourceVideoPath?: string | null;
      sourceUrl?: string | null;
      titleHint?: string | null;
    }) => Promise<{
      success: boolean;
      entry?: StoredSubtitleEntry;
      error?: string;
    }>;
    findStoredSubtitleForVideo: (options: {
      sourceVideoPath?: string | null;
      sourceUrl?: string | null;
      targetLanguage?: string | null;
    }) => Promise<{
      success: boolean;
      entry?: StoredSubtitleEntry | null;
      content?: string;
      error?: string;
    }>;
    syncStoredSubtitleVideoPath: (
      previousPath: string,
      savedPath: string
    ) => Promise<{ success: boolean; updated?: boolean; error?: string }>;
    rememberStoredSubtitleVideoPath: (
      entryId: string,
      sourceVideoPath: string
    ) => Promise<{ success: boolean; updated?: boolean; error?: string }>;
    deleteStoredSubtitleEntry: (
      entryId: string
    ) => Promise<{ success: boolean; removed?: boolean; error?: string }>;
    saveStoredTranscriptAnalysis: (options: {
      transcriptHash: string;
      summaryLanguage: string;
      effortLevel: SummaryEffortLevel;
      summary: string;
      sections?: TranscriptSummarySection[] | null;
      highlights?: TranscriptHighlight[] | null;
      highlightStatus?: TranscriptHighlightStatus | null;
      sourceVideoPath?: string | null;
      sourceUrl?: string | null;
      libraryEntryId?: string | null;
    }) => Promise<{
      success: boolean;
      entry?: StoredTranscriptAnalysisEntry;
      error?: string;
    }>;
    findStoredTranscriptAnalysis: (options: {
      transcriptHash: string;
      summaryLanguage: string;
      effortLevel: SummaryEffortLevel;
      sourceVideoPath?: string | null;
      sourceUrl?: string | null;
      libraryEntryId?: string | null;
    }) => Promise<{
      success: boolean;
      entry?: StoredTranscriptAnalysisEntry | null;
      analysis?: StoredTranscriptAnalysisArtifact;
      error?: string;
    }>;

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
    onDubSubtitlesProgress: (
      callback: ProgressEventCallback | null
    ) => () => void;

    translateSubtitles: (
      options: TranslateSubtitlesOptions
    ) => Promise<TranslateSubtitlesResult>;
    dubSubtitles: (options: DubSubtitlesOptions) => Promise<DubSubtitlesResult>;
    previewDubVoice: (
      options: PreviewDubVoiceOptions
    ) => Promise<PreviewDubVoiceResult>;
    translateOneLine: (
      options: TranslateOneLineOptions
    ) => Promise<TranslateOneLineResult>;
    transcribeOneLine: (
      options: TranscribeOneLineOptions
    ) => Promise<TranscribeOneLineResult>;
    transcribeRemaining: (
      options: TranscribeRemainingOptions
    ) => Promise<TranscribeRemainingResult>;

    sendPngRenderRequest: (options: RenderSubtitlesOptions) => void;
    onPngRenderResult: (
      callback: (result: ExposedRenderResult) => void
    ) => () => void;

    processUrl: (options: ProcessUrlOptions) => Promise<ProcessUrlResult>;
    onProcessUrlProgress: (callback: UrlProgressCallback | null) => () => void;
    suggestVideos: (
      request: VideoSuggestionChatRequest
    ) => Promise<VideoSuggestionChatResult>;
    onVideoSuggestionProgress: (
      callback: (progress: VideoSuggestionProgress) => void
    ) => () => void;

    cancelOperation: (operationId: string) => Promise<CancelOperationResult>;

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

    getCreditBalance: () => Promise<CreditBalanceResult>;
    createCheckoutSession: (
      packId: 'MICRO' | 'STARTER' | 'STANDARD' | 'PRO'
    ) => Promise<string | null>;
    createByoUnlockSession: () => Promise<void>;
    checkEncryptionAvailable: () => Promise<boolean>;
    getAllByoSettings: () => Promise<AllByoSettings>;
    resetCredits: () => Promise<{
      success: boolean;
      creditsAdded?: number;
      error?: string;
    }>;
    resetCreditsToZero: () => Promise<{
      success: boolean;
      error?: string;
    }>;
    isAdminMode: () => Promise<boolean>;
    getOpenAiApiKey: () => Promise<string | null>;
    setOpenAiApiKey: (
      apiKey: string
    ) => Promise<{ success: boolean; error?: string }>;
    clearOpenAiApiKey: () => Promise<{ success: boolean; error?: string }>;
    validateOpenAiApiKey: (
      apiKey?: string
    ) => Promise<{ ok: boolean; error?: string }>;
    getByoProviderEnabled: () => Promise<boolean>;
    setByoProviderEnabled: (
      enabled: boolean
    ) => Promise<{ success: boolean; error?: string }>;
    onCreditsUpdated: (
      callback: (payload: {
        creditBalance: number;
        hoursBalance: number;
      }) => void
    ) => () => void;
    onCheckoutPending: (callback: () => void) => () => void;
    onCheckoutConfirmed: (callback: () => void) => () => void;
    onCheckoutCancelled: (callback: () => void) => () => void;
    getEntitlements: () => Promise<EntitlementsSnapshot>;
    refreshEntitlements: () => Promise<EntitlementsSnapshot>;
    onEntitlementsUpdated: (
      callback: (snapshot: EntitlementsSnapshot) => void
    ) => () => void;
    onEntitlementsError: (
      callback: (payload: { message: string }) => void
    ) => () => void;
    onByoUnlockPending: (callback: () => void) => () => void;
    onByoUnlockConfirmed: (
      callback: (snapshot: EntitlementsSnapshot) => void
    ) => () => void;
    onByoUnlockCancelled: (callback: () => void) => () => void;
    onByoUnlockError: (
      callback: (payload: { message?: string }) => void
    ) => () => void;
    onOpenAiApiKeyChanged: (
      callback: (payload: { hasKey: boolean }) => void
    ) => () => void;

    // Anthropic API key methods
    getAnthropicApiKey: () => Promise<string | null>;
    setAnthropicApiKey: (
      apiKey: string
    ) => Promise<{ success: boolean; error?: string }>;
    clearAnthropicApiKey: () => Promise<{ success: boolean; error?: string }>;
    validateAnthropicApiKey: (
      apiKey?: string
    ) => Promise<{ ok: boolean; error?: string }>;
    getByoAnthropicEnabled: () => Promise<boolean>;
    setByoAnthropicEnabled: (
      enabled: boolean
    ) => Promise<{ success: boolean; error?: string }>;
    onAnthropicApiKeyChanged: (
      callback: (payload: { hasKey: boolean }) => void
    ) => () => void;

    // ElevenLabs API key methods
    getElevenLabsApiKey: () => Promise<string | null>;
    setElevenLabsApiKey: (
      apiKey: string
    ) => Promise<{ success: boolean; error?: string }>;
    clearElevenLabsApiKey: () => Promise<{ success: boolean; error?: string }>;
    validateElevenLabsApiKey: (
      apiKey?: string
    ) => Promise<{ ok: boolean; error?: string }>;
    getByoElevenLabsEnabled: () => Promise<boolean>;
    setByoElevenLabsEnabled: (
      enabled: boolean
    ) => Promise<{ success: boolean; error?: string }>;
    onElevenLabsApiKeyChanged: (
      callback: (payload: { hasKey: boolean }) => void
    ) => () => void;

    // Global API-key mode
    getApiKeyModeEnabled: () => Promise<boolean>;
    setApiKeyModeEnabled: (
      enabled: boolean
    ) => Promise<{ success: boolean; error?: string }>;

    // Claude translation/review preferences
    getPreferClaudeTranslation: () => Promise<boolean>;
    setPreferClaudeTranslation: (
      prefer: boolean
    ) => Promise<{ success: boolean; error?: string }>;
    getPreferClaudeReview: () => Promise<boolean>;
    setPreferClaudeReview: (
      prefer: boolean
    ) => Promise<{ success: boolean; error?: string }>;
    getPreferClaudeSummary: () => Promise<boolean>;
    setPreferClaudeSummary: (
      prefer: boolean
    ) => Promise<{ success: boolean; error?: string }>;
    getStage5VideoSuggestionMode: () => Promise<Stage5VideoSuggestionMode>;
    setStage5VideoSuggestionMode: (
      mode: Stage5VideoSuggestionMode
    ) => Promise<{ success: boolean; error?: string }>;
    getByoVideoSuggestionModel: () => Promise<ByoVideoSuggestionModel>;
    setByoVideoSuggestionModel: (
      model: ByoVideoSuggestionModel
    ) => Promise<{ success: boolean; error?: string }>;
    getVideoSuggestionModelPreference: () => Promise<VideoSuggestionModelPreference>;
    setVideoSuggestionModelPreference: (
      model: VideoSuggestionModelPreference
    ) => Promise<{ success: boolean; error?: string }>;
    getVideoSuggestionTargetCountry: () => Promise<string>;
    setVideoSuggestionTargetCountry: (
      country: string
    ) => Promise<{ success: boolean; error?: string }>;
    getVideoSuggestionRecency: () => Promise<VideoSuggestionRecency>;
    setVideoSuggestionRecency: (
      recency: VideoSuggestionRecency
    ) => Promise<{ success: boolean; error?: string }>;
    getVideoSuggestionPreferenceTopic: () => Promise<string>;
    setVideoSuggestionPreferenceTopic: (
      value: string
    ) => Promise<{ success: boolean; error?: string }>;

    // Provider preferences
    getPreferredTranscriptionProvider: () => Promise<
      'elevenlabs' | 'openai' | 'stage5'
    >;
    setPreferredTranscriptionProvider: (
      provider: 'elevenlabs' | 'openai' | 'stage5'
    ) => Promise<{ success: boolean; error?: string }>;
    getPreferredDubbingProvider: () => Promise<
      'elevenlabs' | 'openai' | 'stage5'
    >;
    setPreferredDubbingProvider: (
      provider: 'elevenlabs' | 'openai' | 'stage5'
    ) => Promise<{ success: boolean; error?: string }>;

    // Stage5 dubbing TTS provider
    getStage5DubbingTtsProvider: () => Promise<'openai' | 'elevenlabs'>;
    setStage5DubbingTtsProvider: (
      provider: 'openai' | 'elevenlabs'
    ) => Promise<{ success: boolean; error?: string }>;

    // System info
    getSystemInfo: () => Promise<{
      platform: string;
      arch: string;
      release?: string;
      cpu?: string;
      isAppleSilicon?: boolean;
    }>;
    getErrorReportContext: () => Promise<ErrorReportContext>;

    connectCookiesForUrl: (url: string) => Promise<{
      success: boolean;
      cookiesWritten: number;
      cancelled: boolean;
      error?: string;
    }>;
    getCookiesStatusForUrl: (url: string) => Promise<{
      count: number;
      hasYouTubeAuth: boolean;
    }>;
    clearCookiesForUrl: (url: string) => Promise<void>;

    // App log
    onAppLog: (callback: (payload: any) => void) => () => void;

    // Transcript summary
    generateTranscriptSummary: (
      options: TranscriptSummaryRequest
    ) => Promise<TranscriptSummaryResult>;
    onTranscriptSummaryProgress: (
      callback: (progress: TranscriptSummaryProgress) => void
    ) => () => void;

    // Highlight clip
    cutHighlightClip: (
      options: CutHighlightClipRequest
    ) => Promise<CutHighlightClipResult>;
    onHighlightCutProgress: (
      callback: (progress: HighlightCutProgress) => void
    ) => () => void;

    // Combined highlights
    cutCombinedHighlights: (
      options: CutCombinedHighlightsRequest
    ) => Promise<CutCombinedHighlightsResult>;
    onCombinedHighlightCutProgress: (
      callback: (progress: CombinedHighlightCutProgress) => void
    ) => () => void;

    // Update System
    updateCheck: () => Promise<any>;
    updateDownload: () => Promise<void>;
    updateInstall: () => Promise<void>;
    updateGetPostInstallNotice: () => Promise<PostInstallUpdateNotice | null>;
    updateClearPostInstallNotice: (version?: string) => Promise<void>;
    updateGetRequiredNotice: () => Promise<UpdateRequiredNotice | null>;
    onUpdateAvailable: (callback: (info: any) => void) => () => void;
    onUpdateProgress: (callback: (percent: number) => void) => () => void;
    onUpdateDownloaded: (callback: () => void) => () => void;
    onUpdateError: (callback: (msg: string) => void) => () => void;
    onUpdateRequired: (
      callback: (payload: UpdateRequiredNotice) => void
    ) => () => void;
  }

  declare global {
    interface Window {
      electron: ElectronAPI;
      fileApi: {
        readText: (p: string) => Promise<string>;
        writeText: (p: string, data: string) => Promise<void>;
        fileExists: (p: string) => Promise<boolean>;
      };
      appShell: {
        openExternal: (url: string) => Promise<void>;
        openPath: (path: string) => Promise<string>;
      };
      env: {
        isPackaged: boolean;
      };
    }
  }
}
