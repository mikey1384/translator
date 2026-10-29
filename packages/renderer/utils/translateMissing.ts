import { buildSrt, parseSrt, secondsToSrtTime } from '../../shared/helpers';
import * as SubtitlesIPC from '../ipc/subtitles';
import { useSubStore, useTaskStore, useUIStore } from '../state';
import { useUrlStore } from '../state/url-store';
import { resolveTranslationFailure } from './translationFailure';
import { i18n } from '../i18n';
import { registerStage5CreditRefreshOperation } from './creditRefreshOperations';
import { isExplicitCancellation } from '../../shared/cancelled-error';
import { isTextInLanguage } from './detectTextLanguage';

/**
 * Translates only untranslated subtitle items using the existing streaming pipeline.
 * Uses operationId starting with `translate-missing-` so progress-buffer applies
 * partial updates by timecode to the correct items during both translate and review phases.
 */
export async function translateMissingUntranslated(): Promise<boolean> {
  // Guard: do not allow translation while transcription is active
  if (useTaskStore.getState().transcription.inProgress) {
    return false;
  }
  useUrlStore.getState().clearError();
  const targetLanguage = useUIStore.getState().targetLanguage || 'english';
  const store = useSubStore.getState();

  const missing = store.order
    .map(id => store.segments[id])
    .filter(s => (s.original || '').trim() && !(s.translation || '').trim());

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
  useTaskStore.getState().setTranslation({
    id: operationId,
    stage: i18n.t('generateSubtitles.status.starting'),
    percent: 0,
    inProgress: true,
    isCompleted: false,
  });

  try {
    const res = await SubtitlesIPC.translateSubtitles({
      segments: missing,
      subtitles: srtContent,
      targetLanguage,
      operationId,
      qualityTranslation: useUIStore.getState().qualityTranslation,
    });

    if (res?.success && res?.translatedSubtitles) {
      const translatedSegs =
        res.translatedSegments ?? parseSrt(res.translatedSubtitles);
      if (res.translatedSegments) {
        useSubStore.getState().applyTranslations(res.translatedSegments, {
          markDirty: true,
          matchByIndex: false,
        });
      } else {
        // Build map by time key -> translated text
        const byTimeKey = new Map<string, string | undefined>();
        for (const seg of translatedSegs) {
          const key = `${secondsToSrtTime(seg.start)}-->${secondsToSrtTime(seg.end)}`;
          byTimeKey.set(key, seg.translation);
        }

        // Apply translations back to store for only missing ones
        const applyStore = useSubStore.getState();
        for (const seg of missing) {
          const key = `${secondsToSrtTime(seg.start)}-->${secondsToSrtTime(seg.end)}`;
          const translated = byTimeKey.get(key);
          if (translated && translated.trim()) {
            applyStore.update(seg.id, { translation: translated });
          }
        }
      }

      useTaskStore.getState().setTranslation({
        stage: i18n.t('generateSubtitles.status.completed'),
        percent: 100,
        inProgress: false,
        isCompleted: true,
      });
      return true;
    }

    if (res?.partialSegments?.length)
      useSubStore.getState().applyTranslations(res.partialSegments, {
        matchByIndex: false,
        markDirty: true,
      });

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
  }
}
