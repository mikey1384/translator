import {
  useState,
  useEffect,
  useCallback,
  Dispatch,
  SetStateAction,
} from 'react';
import { SrtSegment } from '../../../../types/interface';
import { saveFileWithRetry } from '../../../helpers/electron-ipc';
import { generateSrtContent } from '../utils';
import { DEFAULT_FILENAME } from '../constants';

interface UseSubtitleSavingReturn {
  canSaveDirectly: boolean;
  handleSaveSrt: () => Promise<void>;
  handleSaveEditedSrtAs: () => Promise<void>;
}

export function useSubtitleSaving(
  subtitles: SrtSegment[] | undefined,
  setError: Dispatch<SetStateAction<string>>
): UseSubtitleSavingReturn {
  const [canSaveDirectly, setCanSaveDirectly] = useState(false);
  // State to hold the original file name suggestion if needed (can be derived)
  // const [originalSrtFile, setOriginalSrtFile] = useState<File | null>(null); // Maybe not needed here

  // Check localStorage for original path on mount and when subtitles change
  // (Might need adjustment if subtitles reference changes too often)
  useEffect(() => {
    const path = localStorage.getItem('originalSrtPath');
    setCanSaveDirectly(!!path);
  }, [subtitles]); // Re-check if subtitles change slightly (e.g., length), might be too sensitive

  // Function to save SRT content directly to the original path
  const handleSaveSrt = useCallback(async () => {
    const originalPath = localStorage.getItem('originalSrtPath');
    console.log('[useSubtitleSaving] Attempting to save directly...');

    if (!originalPath) {
      console.warn(
        '[useSubtitleSaving] No original path found. Cannot perform direct save.'
      );
      setError(
        'Cannot save directly. Use "Save As..." first or load an SRT file.'
      );
      return;
    }

    if (!subtitles || subtitles.length === 0) {
      setError('No subtitle content to save.');
      return;
    }

    try {
      setError('');
      const srtContent = generateSrtContent(subtitles);

      const saveOptions = {
        content: srtContent,
        filePath: originalPath,
      };

      console.log(`[useSubtitleSaving] Saving content to: ${originalPath}`);
      const result = await saveFileWithRetry(saveOptions);

      if (result?.filePath) {
        console.log(
          `[useSubtitleSaving] File saved successfully to: ${result.filePath}`
        );
        alert('File saved successfully!'); // Consider a less intrusive notification
      } else if (result.error) {
        setError(`Save failed: ${result.error}`);
        console.error(`[useSubtitleSaving] Save failed: ${result.error}`);
      }
    } catch (error: any) {
      const message = error.message || String(error);
      setError(`Error saving SRT file: ${message}`);
      console.error(`[useSubtitleSaving] Error during direct save: ${message}`);
    }
  }, [subtitles, setError]);

  // Function to save edited SRT content to a new file path
  const handleSaveEditedSrtAs = useCallback(async () => {
    if (!subtitles || subtitles.length === 0) {
      setError('No subtitle content to save.');
      return;
    }

    try {
      // Suggest a filename (can refine this logic)
      const originalSavedPath = localStorage.getItem('originalSrtPath');
      let suggestedName = DEFAULT_FILENAME;
      if (originalSavedPath) {
        suggestedName = originalSavedPath;
      } else {
        // Fallback if no original path, maybe check loaded video/srt file name?
      }

      // Ensure it ends with .srt
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
        forceDialog: true,
      };

      console.log(
        '[useSubtitleSaving] Attempting Save As with options:',
        saveOptions
      );
      setError('');
      const result = await saveFileWithRetry(saveOptions);
      console.log('[useSubtitleSaving] Result from Save As:', result);

      if (result?.filePath) {
        console.log(
          `[useSubtitleSaving] Storing new path from Save As: ${result.filePath}`
        );
        // Update localStorage with the *new* path for subsequent direct saves
        localStorage.setItem('originalSrtPath', result.filePath);
        // Maybe clear other related paths?
        localStorage.setItem('originalLoadPath', result.filePath);
        localStorage.setItem('targetPath', result.filePath);
        // Update state to enable direct save button
        setCanSaveDirectly(true);

        alert(`File saved successfully to:\n${result.filePath}`);
      } else if (result.error && !result.error.includes('canceled')) {
        setError(`Save As failed: ${result.error}`);
      }
    } catch (error: any) {
      const message = error.message || String(error);
      setError(`Error during Save As: ${message}`);
      console.error(`[useSubtitleSaving] Error during Save As: ${message}`);
    }
  }, [subtitles, setError]);

  return {
    canSaveDirectly,
    handleSaveSrt,
    handleSaveEditedSrtAs,
  };
}
