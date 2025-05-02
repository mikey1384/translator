import { useCallback } from 'react';
import { SrtSegment } from '../../../types/interface.js';

interface FocusedInput {
  index: number | null;
  field: 'start' | 'end' | 'text' | null;
}

export const useRestoreFocus = (
  focusedInputRef: React.MutableRefObject<FocusedInput>
) => {
  return useCallback(() => {
    const { index, field } = focusedInputRef.current;
    if (index === null || field === null) return;
    const inputId = `subtitle-${index}-${field}`;
    const inputToFocus = document.getElementById(inputId);
    if (inputToFocus) {
      (inputToFocus as HTMLElement).focus();
      if (inputToFocus instanceof HTMLInputElement) {
        const length = inputToFocus.value.length;
        inputToFocus.setSelectionRange(length, length);
      }
    }
  }, [focusedInputRef]);
};

export const useSubtitleNavigation = (
  subtitles: SrtSegment[],
  subtitleRefs: React.MutableRefObject<(HTMLElement | null)[]>,
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
    const playerInstance = videoPlayerRef; // Direct use of state value

    // Check if playerInstance exists and currentTime is a valid property/method
    if (playerInstance && typeof playerInstance.currentTime === 'number') {
      currentTime = playerInstance.currentTime;
    } else if (
      playerInstance &&
      typeof playerInstance.currentTime === 'function'
    ) {
      try {
        currentTime = playerInstance.currentTime();
      } catch (e) {
        // Error handling for currentTime function call can be added here if needed
      }
    } else {
      // Keep currentTime as 0 if videoPlayerRef state is invalid
    }

    // 1. Find subtitle containing current time
    const indexInRange = subtitles.findIndex(
      sub => currentTime >= sub.start && currentTime <= sub.end
    );

    let currentSubtitleIndex = indexInRange;

    // 2. If not found, find the *next* subtitle
    if (currentSubtitleIndex === -1) {
      const nextIndex = subtitles.findIndex(sub => currentTime < sub.start);
      currentSubtitleIndex = nextIndex;
    }

    // 3. If still not found (e.g., time is after last subtitle), do nothing
    if (currentSubtitleIndex === -1) {
      return;
    }

    // 4. Scroll to the found index
    const el = subtitleRefs?.current[currentSubtitleIndex];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-subtitle');
      setTimeout(() => {
        el.classList.remove('highlight-subtitle');
      }, 2000);
    } else {
      // Handle case where element is not found if necessary
    }
  }, [subtitles, subtitleRefs, videoPlayerRef]);

  return { scrollToCurrentSubtitle };
};
