import { useCallback, RefObject } from 'react';

// Define the type for the ref object that holds focus information
interface FocusRef {
  index: number | null;
  field: 'start' | 'end' | 'text' | null;
}

/**
 * Custom hook to restore focus to the last focused input field after updates.
 * It relies on specific ID patterns for the input elements: `subtitle-{index}-{field}`.
 */
export function useRestoreFocus(focusRef: RefObject<FocusRef>) {
  const restoreFocus = useCallback(() => {
    if (
      focusRef.current &&
      focusRef.current.index !== null &&
      focusRef.current.field
    ) {
      const { index, field } = focusRef.current;
      // Construct the ID of the element to focus
      const elementId = `subtitle-${index}-${field}`;
      const elementToFocus = document.getElementById(elementId);

      if (elementToFocus) {
        // Use requestAnimationFrame to ensure focus happens after potential DOM updates
        requestAnimationFrame(() => {
          elementToFocus.focus();

          // If it's an input or textarea, try to restore cursor position
          if (
            (elementToFocus instanceof HTMLInputElement ||
              elementToFocus instanceof HTMLTextAreaElement) &&
            typeof elementToFocus.selectionStart === 'number' &&
            typeof elementToFocus.selectionEnd === 'number'
          ) {
            // Attempt to move cursor to the end
            // A more sophisticated approach might store/restore exact cursor position
            const length = elementToFocus.value.length;
            elementToFocus.selectionStart = length;
            elementToFocus.selectionEnd = length;
          }
        });
      } else {
        console.warn(
          `[useRestoreFocus] Element with ID ${elementId} not found.`
        );
      }

      // Clear the ref after attempting to restore focus
      // focusRef.current = { index: null, field: null };
      // Keep the ref set for potential retries or debounced updates
    }
  }, [focusRef]);

  return restoreFocus;
}
