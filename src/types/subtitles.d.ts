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

interface SubtitleHandlerServices {
  ffmpegService: FFmpegService;
  fileManager: FileManager;
}
