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
          .setError('No SRT file available for translation');
      } catch {
        // No URL store in this context; swallow.
      }
    }
    return { success: false, reason: 'no_subtitles' as const };
  }

  const targetLanguage = useUIStore.getState().targetLanguage;
  const operationId = `${operationPrefix ?? 'translate'}-${Date.now()}`;

  return executeSrtTranslation({
    segments,
    targetLanguage,
    operationId,
  });
}

export type RunFullTranslationResult = Awaited<
  ReturnType<typeof runFullSrtTranslation>
>;
