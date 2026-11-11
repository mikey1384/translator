import { useSubStore } from '../state/subtitle-store';
import { saveMountedSubtitleDocument } from './subtitle-documents';
import type { SrtSegment } from '@shared-types/app';

const scopes = new Map<
  string,
  {
    generation: number;
    revision: number;
    pending: Promise<void>;
    scheduled: boolean;
    closed: boolean;
  }
>();

export function beginTranslationDocumentScope(operationId: string): () => void {
  const state = useSubStore.getState();
  scopes.set(operationId, {
    generation: state.documentGeneration,
    revision: state.editRevision,
    pending: Promise.resolve(),
    scheduled: false,
    closed: false,
  });
  return () => {
    scopes.delete(operationId);
  };
}

/** Coalesce queued snapshots and serialize writes, including the first save
 * that establishes the document ID. Read the latest cues when the write starts. */
export function queueTranslationCheckpoint(operationId: string): void {
  const scope = scopes.get(operationId);
  if (!scope || scope.closed || scope.scheduled) return;
  scope.scheduled = true;
  scope.pending = scope.pending
    .then(async () => {
      scope.scheduled = false;
      if (translationDocumentIsCurrent(operationId))
        await saveMountedSubtitleDocument({ keepDirty: true });
    })
    .catch(() => {});
}

/** Close the progress writer before the final response is applied/saved. */
export async function flushTranslationCheckpoints(
  operationId: string
): Promise<void> {
  const scope = scopes.get(operationId);
  if (!scope) return;
  scope.closed = true;
  await scope.pending;
}

export function translationDocumentIsCurrent(operationId: string): boolean {
  const scope = scopes.get(operationId);
  const state = useSubStore.getState();
  return Boolean(
    scope &&
    scope.generation === state.documentGeneration &&
    scope.revision === state.editRevision
  );
}

/** The invoke response owns final state once the progress writer is closed. */
export function translationProgressIsCurrent(operationId: string): boolean {
  return (
    !scopes.get(operationId)?.closed &&
    translationDocumentIsCurrent(operationId)
  );
}

/** Persist canonical results even when cancellation raced the final progress
 * event. This also drains the initial interrupted-job save via the shared queue. */
export async function applyTranslationCheckpoint(
  operationId: string,
  segments: SrtSegment[]
): Promise<boolean> {
  await flushTranslationCheckpoints(operationId);
  if (!translationDocumentIsCurrent(operationId)) return false;
  useSubStore
    .getState()
    .applyTranslations(segments, { matchByIndex: false, markDirty: true });
  // This synchronous edit belongs to the operation. Later user edits must
  // still invalidate the scope while the save is awaiting IPC.
  scopes.get(operationId)!.revision = useSubStore.getState().editRevision;
  const saved = await saveMountedSubtitleDocument({ keepDirty: true });
  if (!translationDocumentIsCurrent(operationId)) return false;
  if (!saved.success)
    throw new Error(saved.error || 'Failed to save translation progress');
  return true;
}
