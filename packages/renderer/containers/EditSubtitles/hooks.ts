import { useCallback } from 'react';
import { SrtSegment } from '@shared-types/app';
import { flashSubtitle } from '../../utils/flashSubtitle';

const getHeaderOffset = () => {
  const header = document.querySelector('.fixed-video-container');
  return header?.getBoundingClientRect().height ?? 0;
};

export function scrollPrecisely(el: HTMLElement, smooth = false) {
  const offset = getHeaderOffset();
  const absoluteY = window.scrollY + el.getBoundingClientRect().top - offset;

  window.scrollTo({ top: absoluteY, behavior: smooth ? 'smooth' : 'auto' });
}

export function scrollWhenReady(
  id: string,
  subtitleRefs: React.RefObject<Record<string, HTMLElement | null>>,
  smooth = true,
  tries = 0,
  maxTries = 30,
  onSuccess?: () => void
): boolean {
  const el = subtitleRefs.current[id];
  if (el) {
    if (!document.contains(el)) {
      console.log(
        `[review scrollWhenReady] Element ${id} detached before scroll.`
      );
      return false;
    }

    console.log(
      `[review scrollWhenReady] Found element for ${id}, scrolling...`
    );
    scrollPrecisely(el, smooth);

    // Highlight logic moved here
    requestAnimationFrame(() => flashSubtitle(el));

    onSuccess?.();

    return true; // Indicate success
  }

  if (tries < maxTries) {
    console.log(
      `[review scrollWhenReady] Waiting for element ${id} (try ${tries + 1})`
    );
    requestAnimationFrame(() =>
      scrollWhenReady(id, subtitleRefs, smooth, tries + 1, maxTries, onSuccess)
    );
    return false; // Indicate still trying
  } else {
    console.warn(`[review scrollWhenReady] Gave up waiting for refs of ${id}`);
    return false; // Indicate failure
  }
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
      // Default scroll behavior for navigation should be instant ('auto')
      scrollPrecisely(el, false);

      requestAnimationFrame(() => flashSubtitle(el));
    }
  }, [subtitles, subtitleRefs, videoPlayerRef]);

  return { scrollToCurrentSubtitle };
};
