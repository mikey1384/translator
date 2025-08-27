import type {
  GenerateSubtitlesOptions,
  RenderSubtitlesOptions,
  ExposedRenderResult,
  ProgressEventCallback,
  GenerateSubtitlesResult,
} from '@shared-types/app';

type PngRenderResult = {
  operationId: string;
  success: boolean;
  outputPath?: string;
  error?: string;
};

export function onPngRenderResult(
  callback: (result: PngRenderResult) => void
): () => void {
  return window.electron.onPngRenderResult(callback);
}

export function sendPngRenderRequest(options: RenderSubtitlesOptions): void {
  window.electron.sendPngRenderRequest(options);
}

export function generate(
  options: GenerateSubtitlesOptions
): Promise<GenerateSubtitlesResult> {
  return window.electron.generateSubtitles(options);
}

export function onGenerateProgress(
  callback: ProgressEventCallback
): () => void {
  return window.electron.onGenerateSubtitlesProgress(callback);
}

export function onMergeProgress(callback: ProgressEventCallback): () => void {
  return window.electron.onMergeSubtitlesProgress(callback);
}

export function onRenderPngResult(
  callback: (result: ExposedRenderResult) => void
): () => void {
  return window.electron.onPngRenderResult(callback);
}

export function getTargetLanguage(): Promise<string | null> {
  return window.electron.getSubtitleTargetLanguage();
}

export function setTargetLanguage(
  lang: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setSubtitleTargetLanguage(lang);
}

export function translateSubtitles(options: {
  subtitles: string;
  sourceLanguage?: string;
  targetLanguage: string;
  operationId?: string;
}): Promise<{ translatedSubtitles: string; error?: string }> {
  // Ensure sourceLanguage is a string for type contract if not provided
  const payload = {
    sourceLanguage: '',
    ...options,
  } as {
    subtitles: string;
    sourceLanguage: string;
    targetLanguage: string;
    operationId?: string;
  };
  return window.electron.translateSubtitles(payload);
}

export const cancelPngRender = (operationId: string): void => {
  window.electron.cancelPngRender(operationId);
};
