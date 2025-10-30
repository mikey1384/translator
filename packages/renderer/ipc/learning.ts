import type {
  LearningEntry,
  RecordTranscriptionPayload,
  RecordTranslationPayload,
} from '@shared-types/app';

export function recordTranscription(
  payload: RecordTranscriptionPayload
): Promise<LearningEntry> {
  return (window as any).electron.recordLearningTranscription(payload);
}

export function recordTranslation(
  payload: RecordTranslationPayload
): Promise<LearningEntry | null> {
  return (window as any).electron.recordLearningTranslation(payload);
}

export function listEntries(): Promise<LearningEntry[]> {
  return (window as any).electron.listLearningEntries();
}
