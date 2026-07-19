import { executeSrtTranslation } from '../containers/GenerateSubtitles/utils/subtitleGeneration';
import { useSubStore, useUIStore } from '../state';
import { useUrlStore } from '../state/url-store';

type TranslateAllOptions = {
  /** Optional callback fired when there are no subtitles mounted. */
  onNoSubtitles?: () => void;
  /** Allows callers to customize the translate operation prefix for telemetry. */
  operationPrefix?: string;
};

export async function runFullSrtTranslation(options: TranslateAllOptions = {}) {
  const { onNoSubtitles, operationPrefix } = options;
  const subStore = useSubStore.getState();
  const segments = subStore.order.map(id => subStore.segments[id]);

  if (!segments.length) {
    if (onNoSubtitles) onNoSubtitles();
    else {
      try {
        useUrlStore
          .getState()
          .setValidationError('No SRT file available for translation');
      } catch (err) {
        // URL store may not be available in all contexts (e.g., direct API calls)
        console.debug(
          '[runFullTranslation] Could not set error on URL store:',
          err
        );
      }
    }
    return { success: false, reason: 'no_subtitles' as const };
  }

  const targetLanguage = useUIStore.getState().targetLanguage;
  const operationId = `${operationPrefix ?? 'translate'}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  return executeSrtTranslation({
    segments,
    targetLanguage,
    operationId,
  });
}

export type RunFullTranslationResult = Awaited<
  ReturnType<typeof runFullSrtTranslation>
>;

/**
 * Make sure the mounted subtitles carry translations in the currently selected
 * output language before dubbing. Without this, dubbing falls back to the
 * original-language text (the dubber prefers `translation` but silently uses
 * `original` when it is empty), so pressing Dub right after transcribing — or
 * after switching the output language — voices the wrong language.
 *
 * Returns `{ ok: true }` when the subtitles are ready to dub; runs the full
 * translation flow first when they are not. Translation failures/cancellations
 * are surfaced by the translation flow itself; callers should just stop.
 */
export async function ensureSubtitlesTranslatedForDubbing(options?: {
  operationPrefix?: string;
}): Promise<{ ok: boolean }> {
  const subStore = useSubStore.getState();
  const segments = subStore.order.map(id => subStore.segments[id]);
  if (!segments.length) {
    return { ok: true };
  }

  const hasUntranslated = segments.some(
    seg => (seg.original || '').trim() && !(seg.translation || '').trim()
  );
  const translatedLanguage = String(subStore.targetLanguage || '')
    .trim()
    .toLowerCase();
  const selectedLanguage = String(useUIStore.getState().targetLanguage || '')
    .trim()
    .toLowerCase();
  // Only force a re-translation when we know what language the current
  // translations are in and it differs from the selected output language.
  // Mounted SRTs with translations of unknown language dub as-is.
  const translatedToOtherLanguage = Boolean(
    translatedLanguage &&
    selectedLanguage &&
    translatedLanguage !== selectedLanguage
  );

  if (!hasUntranslated && !translatedToOtherLanguage) {
    return { ok: true };
  }

  const result = await runFullSrtTranslation({
    operationPrefix: options?.operationPrefix ?? 'dub-translate',
  });
  return { ok: Boolean(result?.success) };
}
