import {
  pendingTranslationReview,
  translationCompletionStage,
} from './translationReview';
import { buildSrt } from '../../shared/helpers';
import * as SubtitlesIPC from '../ipc/subtitles';
import { useSubStore, useTaskStore } from '../state';
import { useUrlStore } from '../state/url-store';
import { i18n } from '../i18n';
import { registerStage5CreditRefreshOperation } from './creditRefreshOperations';
import { resolveTranslationFailure } from './translationFailure';
import {
  beginTranslationDocumentScope,
  translationDocumentIsCurrent,
  flushTranslationCheckpoints,
  applyTranslationCheckpoint,
} from './translation-document-scope';
import { persistMountedTranslation } from '../containers/GenerateSubtitles/utils/subtitleGeneration';

let resuming = false;
export async function resumeTranslationReview(): Promise<boolean> {
  if (resuming) return false;
  const state = useSubStore.getState();
  const segments = state.order.map(id => ({ ...state.segments[id] }));
  const pending = pendingTranslationReview(segments);
  if (!pending) return true;
  const operationId = `translate-review-${crypto.randomUUID()}`;
  if (
    !useTaskStore
      .getState()
      .tryStartTranslation(operationId, i18n.t('translationReview.resume'))
  )
    return false;
  resuming = true;
  const endScope = beginTranslationDocumentScope(operationId);
  registerStage5CreditRefreshOperation(operationId);
  useUrlStore.getState().clearError();
  try {
    const result = await SubtitlesIPC.translateSubtitles({
      segments,
      subtitles: buildSrt({ segments, mode: 'dual' }),
      targetLanguage: pending.language,
      operationId,
      qualityTranslation: true,
      reviewOnly: true,
    });
    await flushTranslationCheckpoints(operationId);
    // A changed document or user edit owns the screen; a late result cannot
    // replace it. Progress is protected by the same scope.
    if (!translationDocumentIsCurrent(operationId)) return false;
    const finished = result.translatedSegments ?? result.partialSegments;
    if (finished?.length) {
      if (!(await applyTranslationCheckpoint(operationId, finished)))
        return false;
      await persistMountedTranslation(pending.language);
      if (!translationDocumentIsCurrent(operationId)) return false;
    }
    if (result.success) {
      useTaskStore.getState().setTranslation({
        stage: translationCompletionStage(result),
        percent: 100,
        inProgress: false,
        isCompleted: result.review?.status !== 'incomplete',
      });
      return result.review?.status !== 'incomplete';
    }
    const failure = resolveTranslationFailure({
      error: result.error,
      cancelled: Boolean(result.cancelled),
      operationId,
    });
    useTaskStore.getState().setTranslation({
      stage: failure.stage,
      percent: 100,
      inProgress: false,
      isCompleted: false,
    });
    if (failure.banner)
      useUrlStore.getState().setOperationError(failure.banner);
    return false;
  } catch (error) {
    if (!translationDocumentIsCurrent(operationId)) return false;
    const failure = resolveTranslationFailure({ error, operationId });
    useTaskStore.getState().setTranslation({
      stage: failure.stage,
      inProgress: false,
      isCompleted: false,
    });
    if (failure.banner)
      useUrlStore.getState().setOperationError(failure.banner);
    return false;
  } finally {
    if (useTaskStore.getState().translation.id === operationId)
      useTaskStore.getState().setTranslation({ inProgress: false });
    await flushTranslationCheckpoints(operationId);
    endScope();
    resuming = false;
  }
}
