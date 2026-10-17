import { executeSrtTranslation } from '../containers/GenerateSubtitles/utils/subtitleGeneration';
import { useSubStore, useUIStore } from '../state';
import { useUrlStore } from '../state/url-store';
import { i18n } from '../i18n';
import { planDubText } from './dubPlan';

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
          .setValidationError(
            i18n.t(
              'subtitles.noSubtitlesToTranslate',
              'Open or make subtitles first, then translate them.'
            )
          );
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
 * Make sure the mounted subtitles carry text in the currently selected output
 * language before dubbing. Without this, dubbing falls back to the
 * original-language text (the dubber prefers `translation` but silently uses
 * `original` when it is empty), so pressing Dub right after transcribing — or
 * after switching the output language — voices the wrong language.
 *
 * Returns `{ ok: true }` when the subtitles are ready to dub, with
 * `useOriginal` when the originals are already in the selected language (dub
 * them via `segmentsForDub`, no translation is paid for). Runs the full
 * translation flow first when needed. Translation failures/cancellations are
 * surfaced by the translation flow itself; callers should just stop.
 */
export async function ensureSubtitlesTranslatedForDubbing(options?: {
  operationPrefix?: string;
}): Promise<{ ok: boolean; useOriginal?: boolean }> {
  const subStore = useSubStore.getState();
  const segments = subStore.order.map(id => subStore.segments[id]);
  if (!segments.length) {
    return { ok: true };
  }

  const plan = planDubText(
    segments,
    useUIStore.getState().targetLanguage,
    subStore.targetLanguage
  );
  if (plan === 'use-original') return { ok: true, useOriginal: true };
  if (plan === 'ready') return { ok: true };

  const result = await runFullSrtTranslation({
    // A translate- id so its progress shows; the dub- part words any
    // credits refusal as dubbing (userFacingError.taskForOperationId).
    operationPrefix: options?.operationPrefix ?? 'translate-dub',
  });
  return { ok: Boolean(result?.success) };
}
