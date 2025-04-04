import { useCallback, Dispatch, SetStateAction } from 'react';
import { SrtSegment } from '../../../../types/interface';
import { saveFileWithRetry } from '../../../helpers/electron-ipc';
import { generateSrtContent } from '../utils';
import { DEFAULT_FILENAME } from '../constants';

// Props for the simplified hook
interface UseSubtitleSavingProps {
  subtitles: SrtSegment[] | undefined;
  originalSrtFilePath: string | null; // Path from parent state
  setSaveError: Dispatch<SetStateAction<string>>; // Keep error reporting
  onSaveAsComplete: (newFilePath: string) => void; // Callback for parent
}

// Return type for the simplified hook
interface UseSubtitleSavingReturn {
  canSaveDirectly: boolean; // Derived directly from originalSrtFilePath
  handleSaveSrt: () => Promise<void>;
  handleSaveEditedSrtAs: () => Promise<void>;
}

export function useSubtitleSaving({
  subtitles,
  originalSrtFilePath,
  setSaveError,
  onSaveAsComplete,
}: UseSubtitleSavingProps): UseSubtitleSavingReturn {
  // Determine if direct saving is possible based on the prop
  const canSaveDirectly = !!originalSrtFilePath;

  // Save As (triggers Save As dialog)
  const handleSaveEditedSrtAs = useCallback(async () => {
    if (!subtitles || subtitles.length === 0) {
      setSaveError('No subtitle content to save.');
      return;
    }

    try {
      let suggestedName = originalSrtFilePath || DEFAULT_FILENAME; // Use original path as suggestion if available

      // Ensure .srt extension
      if (!suggestedName.toLowerCase().endsWith('.srt')) {
        const nameWithoutExt = suggestedName.includes('.')
          ? suggestedName.substring(0, suggestedName.lastIndexOf('.'))
          : suggestedName;
        suggestedName = `${nameWithoutExt}.srt`;
      }

      const srtContent = generateSrtContent(subtitles);

      const saveOptions = {
        title: 'Save SRT File As',
        defaultPath: suggestedName,
        filters: [{ name: 'SRT Files', extensions: ['srt'] }],
        content: srtContent,
        forceDialog: true, // Always force dialog for Save As
      };

      console.log(
        '[useSubtitleSaving] Attempting Save As with options:',
        saveOptions
      );
      setSaveError(''); // Clear previous errors
      const result = await saveFileWithRetry(saveOptions);
      console.log('[useSubtitleSaving] Result from Save As:', result);

      if (result?.filePath) {
        console.log(
          `[useSubtitleSaving] File saved via Save As: ${result.filePath}`
        );
        onSaveAsComplete(result.filePath); // Notify parent about the new path
        alert(`File saved successfully to:\\n${result.filePath}`);
      } else if (result.error && !result.error.includes('canceled')) {
        setSaveError(`Save As failed: ${result.error}`);
      } else {
        setSaveError(''); // Clear error if cancelled
      }
    } catch (error: any) {
      const message = error.message || String(error);
      setSaveError(`Error during Save As: ${message}`);
      console.error(`[useSubtitleSaving] Error during Save As: ${message}`);
    }
  }, [subtitles, originalSrtFilePath, setSaveError, onSaveAsComplete]);

  // Save (uses originalSrtFilePath or redirects to Save As)
  const handleSaveSrt = useCallback(async () => {
    console.log('[useSubtitleSaving] Attempting to save...');

    if (!originalSrtFilePath) {
      console.warn(
        '[useSubtitleSaving] No original path. Redirecting to Save As...'
      );
      await handleSaveEditedSrtAs(); // Redirect if no path
      return;
    }

    if (!subtitles || subtitles.length === 0) {
      setSaveError('No subtitle content to save.');
      return;
    }

    try {
      setSaveError(''); // Clear previous errors
      const srtContent = generateSrtContent(subtitles);

      const saveOptions = {
        content: srtContent,
        filePath: originalSrtFilePath, // Save directly to the known path
      };

      console.log(
        `[useSubtitleSaving] Saving content directly to: ${originalSrtFilePath}`
      );
      const result = await saveFileWithRetry(saveOptions);

      if (result?.filePath) {
        console.log(
          `[useSubtitleSaving] File saved successfully to: ${result.filePath}`
        );
        alert('File saved successfully!');
      } else if (result.error) {
        setSaveError(`Save failed: ${result.error}`);
        console.error(`[useSubtitleSaving] Save failed: ${result.error}`);
      }
    } catch (error: any) {
      const message = error.message || String(error);
      setSaveError(`Error saving SRT file: ${message}`);
      console.error(`[useSubtitleSaving] Error during direct save: ${message}`);
    }
  }, [subtitles, originalSrtFilePath, setSaveError, handleSaveEditedSrtAs]);

  return {
    canSaveDirectly,
    handleSaveSrt,
    handleSaveEditedSrtAs,
  };
}
