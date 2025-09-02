import { buildSrt, parseSrt, secondsToSrtTime } from '../../shared/helpers';
import * as SubtitlesIPC from '../ipc/subtitles';
import { useSubStore, useTaskStore, useUIStore } from '../state';

/**
 * Translates only untranslated subtitle items using the existing streaming pipeline.
 * Uses operationId starting with `translate-missing-` so progress-buffer applies
 * partial updates by timecode to the correct items during both translate and review phases.
 */
export async function translateMissingUntranslated(): Promise<void> {
  // Guard: do not allow translation while transcription is active
  if (useTaskStore.getState().transcription.inProgress) {
    return;
  }
  const targetLanguage = useUIStore.getState().targetLanguage || 'english';
  const store = useSubStore.getState();

  const missing = store.order
    .map(id => store.segments[id])
    .filter(s => (s.original || '').trim() && !(s.translation || '').trim());

  if (!missing.length) return;

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
  const operationId = `translate-missing-${Date.now()}`;

  // Initialize translation task progress
  useTaskStore.getState().setTranslation({
    id: operationId,
    stage: 'Starting...',
    percent: 0,
    inProgress: true,
  });

  const res = await SubtitlesIPC.translateSubtitles({
    subtitles: srtContent,
    targetLanguage,
    operationId,
  });

  if (res?.translatedSubtitles) {
    const translatedSegs = parseSrt(res.translatedSubtitles);
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

    useTaskStore.getState().setTranslation({
      stage: 'Completed',
      percent: 100,
      inProgress: false,
    });
  } else {
    useTaskStore.getState().setTranslation({ inProgress: false });
  }
}
