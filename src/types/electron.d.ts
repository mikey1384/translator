interface ElectronAPI {
  onGenerateSubtitlesProgress: (
    callback:
      | ((
          event: any,
          progress: {
            partialResult: string;
            percent: number;
            stage: string;
            current?: number;
            total?: number;
            warning?: string;
          }
        ) => void)
      | null
  ) => () => void;
  onTranslateSubtitlesProgress: (
    callback:
      | ((
          event: any,
          progress: {
            partialResult: string;
            percent: number;
            stage: string;
            current?: number;
            total?: number;
            warning?: string;
          }
        ) => void)
      | null
  ) => () => void;
  generateSubtitles: (options: {
    videoFile?: File;
    videoPath?: string;
    targetLanguage: string;
    showOriginalText?: boolean;
  }) => Promise<{
    subtitles: string;
    error?: string;
  }>;
  translateSubtitles: (params: {
    subtitles: string;
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<{
    translatedSubtitles: string;
    error?: string;
  }>;
  saveFile: (params: {
    content: string;
    defaultPath: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{
    filePath: string;
    error?: string;
  }>;
  showMessage: (message: string) => void;
  mergeSubtitles: (options: {
    videoPath: string;
    subtitlesPath: string;
  }) => Promise<{
    outputPath: string;
    error?: string;
  }>;
  onMergeSubtitlesProgress: (
    callback: (
      event: any,
      progress: {
        percent: number;
        stage: string;
        current?: number;
        total?: number;
        warning?: string;
      }
    ) => void
  ) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
