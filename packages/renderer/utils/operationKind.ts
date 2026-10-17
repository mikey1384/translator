/**
 * Which task slot an operation id belongs to. App-started jobs use a prefix
 * ("dub-…"); jobs the assistant starts end with their kind ("agent-…-dub").
 * Both must show the same progress bar and stop button.
 */
export type TaskOperationKind = 'translation' | 'transcription' | 'dubbing';

export function taskOperationKind(
  operationId: string | null | undefined
): TaskOperationKind | null {
  if (!operationId) return null;
  if (
    operationId.startsWith('translate-') ||
    /-translate(-cue)?$/.test(operationId)
  ) {
    return 'translation';
  }
  if (
    operationId.startsWith('transcribe-') ||
    /-transcribe(-cue)?$/.test(operationId)
  ) {
    return 'transcription';
  }
  if (operationId.startsWith('dub-') || /-dub$/.test(operationId)) {
    return 'dubbing';
  }
  return null;
}

export const isTranslationOperation = (id: string | null | undefined) =>
  taskOperationKind(id) === 'translation';
export const isTranscriptionOperation = (id: string | null | undefined) =>
  taskOperationKind(id) === 'transcription';
export const isDubbingOperation = (id: string | null | undefined) =>
  taskOperationKind(id) === 'dubbing';
