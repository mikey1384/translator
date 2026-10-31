import { useCallback } from 'react';
import { SrtSegment } from '@shared-types/app';
import { flashSubtitle, settleIntoView } from '../../../utils/scroll.js';
import { currentSubtitleIndex } from '../../../utils/currentSubtitle.js';
import { getNativePlayerInstance } from '../../../native-player.js';

export function flashReviewedSegment({
  id,
  subtitleRefs,
  onSuccess,
}: {
  id: string;
  subtitleRefs: React.RefObject<Record<string, HTMLElement | null>>;
  onSuccess?: () => void;
}) {
  const el = subtitleRefs.current[id];
  if (el) {
    if (!document.contains(el)) {
      return false;
    }
    requestAnimationFrame(() => flashSubtitle(el));
    onSuccess?.();

    return true;
  }
}

export const useSubtitleNavigation = (
  subtitles: SrtSegment[],
  subtitleRefs: React.RefObject<Record<string, HTMLElement | null>>,
  videoPlayerRef: any
) => {
  const scrollToCurrentSubtitle = useCallback(() => {
    if (subtitles.length === 0) {
      return;
    }
    let currentTime = 0;
    const playerInstance = getNativePlayerInstance() ?? videoPlayerRef;
    if (!playerInstance) return;

    if (playerInstance && typeof playerInstance.currentTime === 'number') {
      currentTime = playerInstance.currentTime;
    } else if (
      playerInstance &&
      typeof playerInstance.currentTime === 'function'
    ) {
      try {
        currentTime = playerInstance.currentTime();
      } catch {
        // Error handling for currentTime function call can be added here if needed
      }
    }

    const index = currentSubtitleIndex(subtitles, currentTime);
    if (index === -1) {
      return;
    }

    const el = subtitleRefs.current[subtitles[index].id];
    if (el) {
      settleIntoView(el);
      // Flash on every scroll, including 'Go to current subtitle'
      requestAnimationFrame(() => flashSubtitle(el));
    }
  }, [subtitles, subtitleRefs, videoPlayerRef]);

  return { scrollToCurrentSubtitle };
};
