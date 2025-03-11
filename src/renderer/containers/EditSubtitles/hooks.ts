import { useCallback } from 'react';

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
  subtitles: any[],
  subtitleRefs: React.MutableRefObject<(HTMLElement | null)[]>
) => {
  const scrollToCurrentSubtitle = useCallback(() => {
    if (subtitles.length === 0) return;
    let currentTime = 0;
    const nativePlayer = (window as any).nativePlayer;
    if (
      nativePlayer &&
      nativePlayer.instance &&
      typeof nativePlayer.instance.currentTime === 'number'
    ) {
      currentTime = nativePlayer.instance.currentTime;
    }
    let currentSubtitleIndex = subtitles.findIndex(
      (sub: any) => currentTime >= sub.start && currentTime <= sub.end
    );
    if (currentSubtitleIndex === -1) {
      currentSubtitleIndex = subtitles.findIndex(
        (sub: any) => currentTime < sub.start
      );
    }
    if (currentSubtitleIndex === -1) return;
    const el = subtitleRefs.current[currentSubtitleIndex];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-subtitle');
      setTimeout(() => {
        el.classList.remove('highlight-subtitle');
      }, 2000);
    }
  }, [subtitles, subtitleRefs]);

  return { scrollToCurrentSubtitle };
};
