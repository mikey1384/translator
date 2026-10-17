import { executeDubGeneration } from '../containers/GenerateSubtitles/utils/subtitleGeneration';
import { useSubStore, useUIStore, useVideoStore } from '../state';
import { useUrlStore } from '../state/url-store';
import { i18n } from '../i18n';
import { segmentsForDub } from './dubPlan';
import { ensureSubtitlesTranslatedForDubbing } from './runFullTranslation';

/**
 * Dub the mounted subtitles into the selected output language with the
 * chosen voice and mix. Every Dub button (the Dub view, the video side menu,
 * the Step 2 panel) goes through here so they translate, or skip a
 * same-language translation, the same way.
 */
export async function runMountedDub({
  videoDurationSeconds,
  fallbackVideoPath,
}: {
  videoDurationSeconds?: number | null;
  fallbackVideoPath?: string | null;
} = {}): Promise<boolean> {
  const initial = useSubStore.getState();
  const hasText = initial.order.some(id =>
    String(
      initial.segments[id]?.translation || initial.segments[id]?.original || ''
    ).trim()
  );
  if (!hasText) {
    useUrlStore
      .getState()
      .setValidationError(
        i18n.t(
          'subtitles.noSubtitlesToDub',
          'Make or open subtitles for this video first, then dub it.'
        )
      );
    return false;
  }

  // Dub the selected output language, not whatever text happens to be
  // mounted: translate first when translations are missing or were made for
  // a different language; voice the originals when they are already in it.
  const ready = await ensureSubtitlesTranslatedForDubbing();
  if (!ready.ok) return false;

  const subtitleState = useSubStore.getState();
  const segments = segmentsForDub(
    subtitleState.order.map(id => subtitleState.segments[id]),
    ready.useOriginal ? 'use-original' : 'ready'
  );
  const videoStoreState = useVideoStore.getState();
  const sourceVideoPath =
    videoStoreState.originalPath ??
    subtitleState.sourceVideoPath ??
    fallbackVideoPath ??
    videoStoreState.path;
  const { dubVoice, targetLanguage } = useUIStore.getState();

  const result = await executeDubGeneration({
    segments,
    operationId: `dub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    videoPath: sourceVideoPath,
    voice: dubVoice,
    targetLanguage,
    videoDurationSeconds: videoDurationSeconds ?? undefined,
  });
  return result.success;
}
