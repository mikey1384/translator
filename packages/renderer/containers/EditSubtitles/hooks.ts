import { useCallback } from 'react';
import { SrtSegment } from '@shared-types/app';

const getHeaderOffset = () => {
  const header = document.querySelector('.fixed-video-container');
  return header?.getBoundingClientRect().height ?? 0;
};

export function scrollPrecisely(el: HTMLElement) {
  const offset = getHeaderOffset();
  const absoluteY = window.scrollY + el.getBoundingClientRect().top - offset;

  window.scrollTo({ top: absoluteY, behavior: 'auto' });
}

interface FocusedInput {
  index: number | null;
  field: 'start' | 'end' | 'text' | null;
}

export const useRestoreFocus = (
  focusedInputRef: React.RefObject<FocusedInput>
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
      scrollPrecisely(el);

      requestAnimationFrame(() => {
        el.classList.add('highlight-subtitle');
        setTimeout(() => {
          el.classList.remove('highlight-subtitle');
        }, 2000);
      });
    }
  }, [subtitles, subtitleRefs, videoPlayerRef]);

  return { scrollToCurrentSubtitle };
};
