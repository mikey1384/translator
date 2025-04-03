import {
  useState,
  useRef,
  useCallback,
  Dispatch,
  SetStateAction,
  useEffect,
} from 'react';
import { debounce } from 'lodash';
import { SrtSegment } from '../../../../types/interface';
import { srtTimeToSeconds } from '../utils';
import { useRestoreFocus } from './useRestoreFocus';
import { DEBOUNCE_DELAY_MS } from '../constants';

// Define the hook's return type for clarity
interface UseSubtitleEditingReturn {
  editingTimesState: Record<string, string>;
  handleEditSubtitle: (
    index: number,
    field: 'start' | 'end' | 'text',
    value: number | string
  ) => void;
  handleTimeInputBlur: (index: number, field: 'start' | 'end') => void;
  // We don't need to return restoreFocus as it's used internally by the handlers
}

export function useSubtitleEditing(
  subtitles: SrtSegment[] | undefined,
  setSubtitles: Dispatch<SetStateAction<SrtSegment[]>> | undefined
): UseSubtitleEditingReturn {
  const [editingTimesState, setEditingTimesState] = useState<
    Record<string, string>
  >({});

  // Debounced references
  const debouncedTimeUpdateRef = useRef<
    Record<string, ReturnType<typeof debounce>>
  >({});
  const debouncedTextUpdateRef = useRef<
    Record<string, ReturnType<typeof debounce>>
  >({});

  // Used to restore focus after editing
  const focusedInputRef = useRef<{
    index: number | null;
    field: 'start' | 'end' | 'text' | null;
  }>({ index: null, field: null });

  // Internal focus restoration logic
  const restoreFocus = useRestoreFocus(focusedInputRef);

  // --- Handler Functions (moved from EditSubtitles) ---

  const handleTimeInputBlur = useCallback(
    (index: number, field: 'start' | 'end') => {
      if (!subtitles || !setSubtitles) return; // Guard against undefined props

      const editKey = `${index}-${field}`;
      const currentEditValue = editingTimesState[editKey];
      if (!currentEditValue) {
        return;
      }

      let numValue: number;
      if (currentEditValue.includes(':')) {
        numValue = srtTimeToSeconds(currentEditValue);
      } else {
        numValue = parseFloat(currentEditValue);
      }

      if (isNaN(numValue) || numValue < 0) {
        setEditingTimesState(prev => {
          const newTimes = { ...prev };
          delete newTimes[editKey];
          return newTimes;
        });
        return;
      }

      const currentSub = subtitles[index];
      if (!currentSub) return;

      const prevSub = index > 0 ? subtitles[index - 1] : null;
      let newEnd = currentSub.end;

      if (field === 'start') {
        if (prevSub && numValue < prevSub.start) {
          // Handle potential overlap if needed
        }
        if (numValue >= currentSub.end) {
          const originalDuration = currentSub.end - currentSub.start;
          // Ensure non-negative duration, default to small duration if start==end
          const safeDuration = originalDuration > 0 ? originalDuration : 0.1;
          newEnd = numValue + safeDuration;
        }
      }

      setSubtitles(current =>
        current.map((sub, i) => {
          if (i !== index) return sub;
          return field === 'start'
            ? { ...sub, start: numValue, end: newEnd }
            : { ...sub, end: Math.max(numValue, sub.start) }; // Ensure end >= start
        })
      );

      setEditingTimesState(prev => {
        const newTimes = { ...prev };
        delete newTimes[editKey];
        return newTimes;
      });
    },
    [editingTimesState, subtitles, setSubtitles]
  );

  const handleEditSubtitle = useCallback(
    (
      index: number,
      field: 'start' | 'end' | 'text',
      value: number | string
    ) => {
      if (!subtitles || !setSubtitles) return; // Guard against undefined props

      focusedInputRef.current = { index, field };

      if (field === 'text') {
        const debounceTextKey = `${index}-text`;
        if (!debouncedTextUpdateRef.current[debounceTextKey]) {
          debouncedTextUpdateRef.current[debounceTextKey] = debounce(
            (newText: string) => {
              setSubtitles(current =>
                current.map((sub, i) =>
                  i === index ? { ...sub, text: newText } : sub
                )
              );
              // Attempt to restore focus after text update too
              setTimeout(() => restoreFocus(), 50);
            },
            DEBOUNCE_DELAY_MS
          );
        }
        debouncedTextUpdateRef.current[debounceTextKey](value as string);
        return;
      }

      setEditingTimesState(prev => ({
        ...prev,
        [`${index}-${field}`]: String(value),
      }));

      const debounceKey = `${index}-${field}`;
      if (!debouncedTimeUpdateRef.current[debounceKey]) {
        debouncedTimeUpdateRef.current[debounceKey] = debounce(
          (val: string) => {
            let numValue: number;
            if (val.includes(':')) {
              numValue = srtTimeToSeconds(val);
            } else {
              numValue = parseFloat(val);
            }
            if (isNaN(numValue) || numValue < 0) return;

            const currentSub = subtitles[index];
            if (!currentSub) return;

            const prevSub = index > 0 ? subtitles[index - 1] : null;
            let newEnd = currentSub.end;

            if (field === 'start') {
              if (prevSub && numValue < prevSub.start) {
                // Handle potential overlap if needed
              }
              if (numValue >= currentSub.end) {
                const duration = currentSub.end - currentSub.start;
                const safeDuration = duration > 0 ? duration : 0.1;
                newEnd = numValue + safeDuration;
              }
              setSubtitles(curr =>
                curr.map((sub, i) => {
                  if (i !== index) return sub;
                  return { ...sub, start: numValue, end: newEnd };
                })
              );
            } else {
              // Ensure end >= start when editing end time
              const finalEnd = Math.max(numValue, currentSub.start);
              setSubtitles(curr =>
                curr.map((sub, i) =>
                  i === index ? { ...sub, end: finalEnd } : sub
                )
              );
            }

            setTimeout(() => restoreFocus(), 50);
          },
          DEBOUNCE_DELAY_MS
        );
      }

      debouncedTimeUpdateRef.current[debounceKey](String(value));
    },
    [subtitles, setSubtitles, restoreFocus] // Include restoreFocus
  );

  // Clear debounce timers on unmount
  useEffect(() => {
    return () => {
      Object.values(debouncedTimeUpdateRef.current).forEach(fn => fn.cancel());
      Object.values(debouncedTextUpdateRef.current).forEach(fn => fn.cancel());
    };
  }, []);

  return {
    editingTimesState,
    handleEditSubtitle,
    handleTimeInputBlur,
  };
}
