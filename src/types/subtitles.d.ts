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

interface GenerateSubtitlesFromAudioArgs {
  inputAudioPath: string;
  progressCallback?: GenerateProgressCallback;
  signal: AbortSignal;
  operationId?: string;
  services: {
    ffmpegService: FFmpegService;
  };
  options?: {
    targetLang?: string;
  };
}

interface MergeProgressCallback {
  (progress: MergeProgress);
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

interface MergeSubtitlesWithVideoArgs {
  options: MergeSubtitlesOptions;
  operationId: string;
  services: {
    ffmpegService: FFmpegService;
  };
  progressCallback?: MergeProgressCallback;
}

interface SubtitleHandlerServices {
  ffmpegService: FFmpegService;
  fileManager: FileManager;
}
