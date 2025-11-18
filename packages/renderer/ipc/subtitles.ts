import type {
  GenerateSubtitlesOptions,
  RenderSubtitlesOptions,
  ExposedRenderResult,
  ProgressEventCallback,
  GenerateSubtitlesResult,
  DubSubtitlesOptions,
  DubSubtitlesResult,
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

export function onDubProgress(callback: ProgressEventCallback): () => void {
  return window.electron.onDubSubtitlesProgress(callback);
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
  qualityTranslation?: boolean;
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
    qualityTranslation?: boolean;
  };
  return window.electron.translateSubtitles(payload);
}

export function dubSubtitles(
  options: DubSubtitlesOptions
): Promise<DubSubtitlesResult> {
  return (window.electron as any).dubSubtitles(options);
}

export function previewDubVoice(options: {
  voice: string;
  text?: string;
}): Promise<{
  success: boolean;
  audioBase64?: string;
  format?: string;
  error?: string;
}> {
  return (window.electron as any).previewDubVoice(options);
}

export function generateTranscriptSummary(options: {
  segments: { start: number; end: number; text: string }[];
  targetLanguage: string;
  operationId?: string;
  videoPath?: string | null;
  maxHighlights?: number;
  highlightSubtitleSegments?: {
    start: number;
    end: number;
    original: string;
    translation?: string;
  }[];
  highlightSubtitleMode?: import('@shared-types/app').SubtitleRenderMode;
  highlightStylePreset?: import('@shared/constants/subtitle-styles').SubtitleStylePresetKey;
  highlightBaseFontSize?: number;
}): Promise<{
  summary?: string;
  highlights?: import('@shared-types/app').TranscriptHighlight[];
  sections?: import('@shared-types/app').TranscriptSummarySection[];
  success?: boolean;
  error?: string;
}> {
  return (window.electron as any).generateTranscriptSummary(options);
}

export function onTranscriptSummaryProgress(
  callback: ProgressEventCallback
): () => void {
  return (window.electron as any).onTranscriptSummaryProgress(callback);
}

export function translateOneLine(options: {
  segment: import('@shared-types/app').SrtSegment;
  contextBefore?: import('@shared-types/app').SrtSegment[];
  contextAfter?: import('@shared-types/app').SrtSegment[];
  targetLanguage: string;
  operationId?: string;
}): Promise<{ translation: string; error?: string }> {
  return (window.electron as any).translateOneLine(options);
}

export function transcribeOneLine(options: {
  videoPath: string;
  segment: { start: number; end: number };
  promptContext?: string;
  operationId?: string;
}): Promise<{ transcript: string; error?: string }> {
  return (window.electron as any).transcribeOneLine(options);
}

export function transcribeRemaining(options: {
  videoPath: string;
  start: number;
  end?: number;
  operationId?: string;
  qualityTranscription?: boolean;
}): Promise<{ segments: any[]; error?: string }> {
  return (window.electron as any).transcribeRemaining(options);
}

export const cancelPngRender = (operationId: string): void => {
  window.electron.cancelPngRender(operationId);
};
