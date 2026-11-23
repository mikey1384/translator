import { useVideoStore } from '../state/video-store';
import { useUIStore } from '../state/ui-store';
import {
  siteNameFromUrl,
  type JobContext,
} from '../../shared/helpers/job-details.js';

// The language the transcription engine heard, remembered for the video it
// was heard in so a later translation of that video can report it.
let heard: { videoPath: string; language: string } | null = null;

export function rememberDetectedLanguage(
  videoPath: string | null | undefined,
  language: string | null | undefined
): void {
  if (videoPath && language) heard = { videoPath, language };
}

/**
 * Job details for the open video: where it was downloaded from (site name
 * only), how long it is, the language heard in it and the chosen target
 * language. Main sends these with credit-based jobs only.
 */
export function currentJobContext(): JobContext {
  const video = useVideoStore.getState();
  const context: JobContext = {};

  const sourceSite = siteNameFromUrl(video.sourceUrl);
  if (sourceSite) context.sourceSite = sourceSite;

  const duration = video.meta?.duration;
  if (
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0
  ) {
    context.videoSeconds = Math.round(duration);
  }

  if (
    heard &&
    (heard.videoPath === video.path || heard.videoPath === video.originalPath)
  ) {
    context.sourceLanguage = heard.language;
  }

  const targetLanguage = useUIStore.getState().targetLanguage;
  if (targetLanguage) context.targetLanguage = targetLanguage;

  return context;
}
