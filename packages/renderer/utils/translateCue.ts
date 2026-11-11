import type {
  TranslateOneLineOptions,
  TranslateOneLineResult,
} from '@shared-types/app';
import * as SubtitlesIPC from '../ipc/subtitles';
import { useTaskStore } from '../state/task-store';
import { useUrlStore } from '../state/url-store';
import { i18n } from '../i18n';
import { isExplicitCancellation } from '../../shared/cancelled-error';
import { translationCompletionStage } from './translationReview';
import { resolveTranslationFailure } from './translationFailure';
import { registerStage5CreditRefreshOperation } from './creditRefreshOperations';
import {
  beginTranslationDocumentScope,
  translationDocumentIsCurrent,
  flushTranslationCheckpoints,
  applyTranslationCheckpoint,
} from './translation-document-scope';

/** Single-cue translation owns the same durable draft/review outcome as a
 * batch, including a paid draft returned with a cancelled or refused review. */
export async function executeCueTranslation(
  options: TranslateOneLineOptions & { operationId: string }
): Promise<TranslateOneLineResult> {
  const { operationId } = options;
  if (
    !useTaskStore
      .getState()
      .tryStartTranslation(
        operationId,
        i18n.t('generateSubtitles.status.starting')
      )
  )
    return {
      success: false,
      operationId,
      error: 'Translator could not start cue translation.',
    };
  const endScope = beginTranslationDocumentScope(operationId);
  registerStage5CreditRefreshOperation(operationId);
  try {
    const result = await SubtitlesIPC.translateOneLine(options);
    await flushTranslationCheckpoints(operationId);
    if (!translationDocumentIsCurrent(operationId))
      return { success: false, cancelled: true, operationId };
    if (
      result.translation?.trim() &&
      !(await applyTranslationCheckpoint(operationId, [
        {
          ...options.segment,
          translation: result.translation,
          translationReview: result.translationReview,
        },
      ]))
    )
      return { success: false, cancelled: true, operationId };
    if (result.success) {
      useTaskStore.getState().setTranslation({
        stage: translationCompletionStage(result),
        percent: 100,
        inProgress: false,
        isCompleted: result.review?.status !== 'incomplete',
      });
    } else {
      const failure = resolveTranslationFailure({
        error: result.error,
        cancelled: result.cancelled,
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
    }
    return result;
  } catch (error) {
    if (!translationDocumentIsCurrent(operationId))
      return { success: false, cancelled: true, operationId };
    const cancelled = isExplicitCancellation(error);
    const failure = resolveTranslationFailure({
      error,
      cancelled,
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
    return {
      success: false,
      cancelled,
      error: error instanceof Error ? error.message : String(error),
      operationId,
    };
  } finally {
    await flushTranslationCheckpoints(operationId);
    if (useTaskStore.getState().translation.id === operationId)
      useTaskStore.getState().setTranslation({ inProgress: false });
    endScope();
  }
}
