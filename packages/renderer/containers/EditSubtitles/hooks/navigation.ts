import { useCallback } from 'react';
import { SrtSegment } from '@shared-types/app';

function smoothScrollTo(y: number) {
  const root = (document.scrollingElement ||
    document.documentElement) as HTMLElement;
  root.style.scrollBehavior = 'smooth';
  root.scrollTo({ top: y });
  setTimeout(() => {
    root.style.scrollBehavior = 'auto';
  }, 600);
}

export function scrollPrecisely(
  el: HTMLElement,
  smooth = false,
  extraOffset = 0
) {
  const offset = getHeaderOffset() + extraOffset;
  const absoluteY = window.scrollY + el.getBoundingClientRect().top - offset;

  if (smooth) {
    smoothScrollTo(absoluteY);
  } else {
    window.scrollTo({ top: absoluteY, behavior: 'auto' });
  }

  function getHeaderOffset() {
    const header = document.querySelector('.fixed-video-container');
    return header?.getBoundingClientRect().height ?? 0;
  }
}

export function scrollWhenReady({
  id,
  subtitleRefs,
  smooth = true,
  tries = 0,
  maxTries = 30,
  onSuccess,
}: {
  id: string;
  subtitleRefs: React.RefObject<Record<string, HTMLElement | null>>;
  smooth?: boolean;
  tries?: number;
  maxTries?: number;
  onSuccess?: () => void;
}): boolean {
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

    requestAnimationFrame(() => flashSubtitle(el));

    onSuccess?.();

    return true;
  }

  if (tries < maxTries) {
    console.log(
      `[review scrollWhenReady] Waiting for element ${id} (try ${tries + 1})`
    );
    requestAnimationFrame(() =>
      scrollWhenReady({
        id,
        subtitleRefs,
        smooth,
        tries: tries + 1,
        maxTries,
        onSuccess,
      })
    );
    return false; // Indicate still trying
  } else {
    console.warn(`[review scrollWhenReady] Gave up waiting for refs of ${id}`);
    return false; // Indicate failure
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

export function flashSubtitle(node: HTMLElement | null) {
  if (!node) return;

  node.classList.remove('highlight-subtitle');
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  node.offsetWidth;
  node.classList.add('highlight-subtitle');

  function handleEnd() {
    if (node) {
      node.classList.remove('highlight-subtitle');
      node.removeEventListener('animationend', handleEnd);
    }
  }
  node.addEventListener('animationend', handleEnd);
}
