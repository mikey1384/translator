import { useCallback } from 'react';
import { EditField } from '@shared-types/app';

export interface FocusedInput {
  index: number | null;
  field: EditField | null;
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
