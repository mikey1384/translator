import type { VideoSuggestionProgress } from '@shared-types/app';

export type SuggestionProgressCallback =
  | ((progress: VideoSuggestionProgress) => void)
  | undefined;

export function emitSuggestionProgress(
  onProgress: SuggestionProgressCallback,
  payload: VideoSuggestionProgress
): void {
  if (!onProgress) return;
  try {
    onProgress(payload);
  } catch {
    // Ignore observer callback errors.
  }
}

export function startProgressPulse({
  onProgress,
  operationId,
  phase,
  messages,
  startedAt,
  intervalMs = 2200,
  extra,
}: {
  onProgress: SuggestionProgressCallback;
  operationId: string;
  phase: VideoSuggestionProgress['phase'];
  messages: string[];
  startedAt: number;
  intervalMs?: number;
  extra?: () => Partial<VideoSuggestionProgress>;
}): () => void {
  if (!onProgress || messages.length === 0) return () => void 0;
  let index = 0;
  const timer = setInterval(() => {
    const msg = messages[index % messages.length];
    index += 1;
    emitSuggestionProgress(onProgress, {
      operationId,
      phase,
      message: msg,
      elapsedMs: Date.now() - startedAt,
      ...(extra ? extra() : {}),
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
