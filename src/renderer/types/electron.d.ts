interface ElectronAPI {
  onGenerateSubtitlesProgress: (
    callback: (
      event: any,
      progress: {
        partialResult: string;
        percent: number;
        stage: string;
        current?: number;
        total?: number;
        warning?: string;
      }
    ) => void
  ) => () => void;
  onTranslateSubtitlesProgress: (
    callback: (
      event: any,
      progress: {
        partialResult: string;
        percent: number;
        stage: string;
        current?: number;
        total?: number;
        warning?: string;
      }
    ) => void
  ) => () => void;
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
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
