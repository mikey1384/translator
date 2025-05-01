import { useState, useRef, Dispatch, SetStateAction, useEffect } from 'react';
import { debounce } from 'lodash';
import { EditField, SrtSegment } from '../../../../types/interface.js';
import { srtTimeToSeconds } from '../../../../shared/helpers/index.js';
import { useRestoreFocus } from './useRestoreFocus.js';
import { DEBOUNCE_DELAY_MS } from '../../../../shared/constants/index.js';

type EditArgs = {
  index: number;
  field: EditField;
  value: number | string;
};

export function useSubtitleEditing({
  subtitles,
  onSetSubtitleSegments,
}: {
  subtitles: SrtSegment[] | undefined;
  onSetSubtitleSegments: Dispatch<SetStateAction<SrtSegment[]>>;
}) {
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
    field: EditField | null;
  }>({ index: null, field: null });

  // Internal focus restoration logic is handled by useRestoreFocus
  useRestoreFocus(focusedInputRef);

  // --- Handler Functions (moved from EditSubtitles) ---

  // Use standard function declaration
  function handleTimeInputBlur(index: number, field: 'start' | 'end') {
    if (!subtitles || !onSetSubtitleSegments) return; // Guard against undefined props

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

    onSetSubtitleSegments(current =>
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
  }

  // Use standard function declaration
  function handleEditSubtitle({ index, field, value }: EditArgs) {
    if (!subtitles || !onSetSubtitleSegments) return; // Guard against undefined props

    focusedInputRef.current = { index, field };

    if (field === 'original' || field === 'translation') {
      // Debounce-set the *translation* field
      const debounceTextKey = `${index}-${field}`;

      if (!debouncedTextUpdateRef.current[debounceTextKey]) {
        debouncedTextUpdateRef.current[debounceTextKey] = debounce(
          (newValue: string) => {
            onSetSubtitleSegments(curr => {
              const out = [...curr];
              if (out[index]) out[index] = { ...out[index], [field]: newValue };
              return out;
            });
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
    if (!debouncedTimeUpdateRef?.current[debounceKey]) {
      debouncedTimeUpdateRef.current[debounceKey] = debounce((val: string) => {
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
          onSetSubtitleSegments(curr =>
            curr.map((sub, i) => {
              if (i !== index) return sub;
              return { ...sub, start: numValue, end: newEnd };
            })
          );
        } else {
          // Ensure end >= start when editing end time
          const finalEnd = Math.max(numValue, currentSub.start);
          onSetSubtitleSegments(curr =>
            curr.map((sub, i) =>
              i === index ? { ...sub, end: finalEnd } : sub
            )
          );
        }
      }, DEBOUNCE_DELAY_MS);
    }

    debouncedTimeUpdateRef?.current[debounceKey](String(value));
  }

  useEffect(() => {
    const currentDebouncedTimeUpdates = debouncedTimeUpdateRef?.current;
    const currentDebouncedTextUpdates = debouncedTextUpdateRef?.current;

    return () => {
      Object.values(currentDebouncedTimeUpdates).forEach(fn => fn.cancel());
      Object.values(currentDebouncedTextUpdates).forEach(fn => fn.cancel());
    };
  }, []);

  return {
    editingTimesState,
    handleEditSubtitle,
    handleTimeInputBlur,
  };
}
