import { useCallback } from 'react';
import { SrtSegment } from '@shared-types/app';
import { scrollPrecisely, flashSubtitle } from '../../../utils/scroll.js';

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
    if (!videoPlayerRef) {
      return;
    }

    let currentTime = 0;
    const playerInstance = videoPlayerRef;

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

    const indexInRange = subtitles.findIndex(
      sub => currentTime >= sub.start && currentTime <= sub.end
    );

    let currentSubtitleIndex = indexInRange;

    if (currentSubtitleIndex === -1) {
      const nextIndex = subtitles.findIndex(sub => currentTime < sub.start);
      currentSubtitleIndex = nextIndex;
    }

    if (currentSubtitleIndex === -1) {
      return;
    }

    const el = subtitleRefs.current[subtitles[currentSubtitleIndex].id];
    if (el) {
      // Default scroll behavior for navigation should be instant ('auto')
      scrollPrecisely(el, false);
      // Flash on every scroll, including 'Go to current subtitle'
      requestAnimationFrame(() => flashSubtitle(el));
    }
  }, [subtitles, subtitleRefs, videoPlayerRef]);

  return { scrollToCurrentSubtitle };
};
