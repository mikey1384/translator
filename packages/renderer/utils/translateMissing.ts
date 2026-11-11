import {
  translationCompletionStage,
  documentTranslationReview,
} from './translationReview';
import {
  beginTranslationDocumentScope,
  translationDocumentIsCurrent,
  flushTranslationCheckpoints,
  applyTranslationCheckpoint,
} from './translation-document-scope';
import { buildSrt, parseSrt } from '../../shared/helpers';
import * as SubtitlesIPC from '../ipc/subtitles';
import { useSubStore, useTaskStore, useUIStore } from '../state';
import { useUrlStore } from '../state/url-store';
import { resolveTranslationFailure } from './translationFailure';
import { i18n } from '../i18n';
import { registerStage5CreditRefreshOperation } from './creditRefreshOperations';
import { isExplicitCancellation } from '../../shared/cancelled-error';
import { isTextInLanguage } from './detectTextLanguage';
import { selectMissingSegments } from './untranslatedRange';

/**
 * Translates only untranslated subtitle items using the existing streaming pipeline.
 * Uses operationId starting with `translate-missing-` so progress-buffer applies
 * partial updates by timecode to the correct items during both translate and review phases.
 */
export async function translateMissingUntranslated(
  options: {
    /** Only these lines (a "from here" range); default every missing line. */
    ids?: ReadonlyArray<string>;
  } = {}
): Promise<boolean> {
  // Guard: do not allow translation while transcription is active
  if (useTaskStore.getState().transcription.inProgress) {
    return false;
  }
  useUrlStore.getState().clearError();
  const targetLanguage = useUIStore.getState().targetLanguage || 'english';
  const store = useSubStore.getState();

  const missing = selectMissingSegments(
    store.order.map(id => store.segments[id]),
    options.ids
  );

  if (!missing.length) return true;
  // Lines already in the target language need no (paid) translation.
  if (
    isTextInLanguage(
      missing.map(seg => seg.original),
      targetLanguage
    )
  ) {
    return true;
  }

  // Collapse multi-line original into a single line; avoid re-wrapping on output
  const flattened = missing.map(seg => ({
    ...seg,
    original: (seg.original || '').replace(/\s*\n+\s*/g, ' ').trim(),
  }));
  const srtContent = buildSrt({
    segments: flattened,
    mode: 'original',
    noWrap: true,
  });
  const operationId = `translate-missing-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  registerStage5CreditRefreshOperation(operationId);

  // Initialize translation task progress
  if (
    !useTaskStore
      .getState()
      .tryStartTranslation(
        operationId,
        i18n.t('generateSubtitles.status.starting')
      )
  )
    return false;
  const endScope = beginTranslationDocumentScope(operationId);
  const qualityTranslation = useUIStore.getState().qualityTranslation;

  try {
    const res = await SubtitlesIPC.translateSubtitles({
      segments: missing,
      subtitles: srtContent,
      targetLanguage,
      operationId,
      qualityTranslation,
    });

    await flushTranslationCheckpoints(operationId);
    if (!translationDocumentIsCurrent(operationId)) return false;
    if (res?.success && res?.translatedSubtitles) {
      const translatedSegs =
        res.translatedSegments ?? parseSrt(res.translatedSubtitles);
      if (!(await applyTranslationCheckpoint(operationId, translatedSegs)))
        return false;
      const mounted = useSubStore.getState();
      const review = qualityTranslation
        ? documentTranslationReview(
            mounted.order.map(id => mounted.segments[id]),
            targetLanguage
          )
        : res.review;
      useTaskStore.getState().setTranslation({
        stage: translationCompletionStage({ ...res, review }),
        percent: 100,
        inProgress: false,
        isCompleted: review?.status !== 'incomplete',
      });
      return true;
    }

    if (
      res?.partialSegments?.length &&
      !(await applyTranslationCheckpoint(operationId, res.partialSegments))
    )
      return false;

    const failure = resolveTranslationFailure({
      error: res?.error,
      cancelled: Boolean(res?.cancelled),
      operationId,
    });

    useTaskStore.getState().setTranslation({
      stage: failure.stage,
      percent: 100,
      inProgress: false,
      isCompleted: false,
    });

    if (failure.banner) {
      useUrlStore.getState().setOperationError(failure.banner);
    }
    return false;
  } catch (err: any) {
    if (!translationDocumentIsCurrent(operationId)) return false;
    const failure = resolveTranslationFailure({
      error: err,
      cancelled: isExplicitCancellation(err),
      operationId,
    });

    useTaskStore.getState().setTranslation({
      stage: failure.stage,
      percent: 100,
      inProgress: false,
      isCompleted: false,
    });

    if (failure.banner) {
      useUrlStore.getState().setOperationError(failure.banner);
    }
    return false;
  } finally {
    if (useTaskStore.getState().translation.id === operationId)
      useTaskStore.getState().setTranslation({ inProgress: false });
    await flushTranslationCheckpoints(operationId);
    endScope();
  }
}
