import {
  useState,
  useEffect,
  useCallback,
  useRef,
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
  setError: Dispatch<SetStateAction<string>>,
  subtitleSourceId?: number
): UseSubtitleSavingReturn {
  const [canSaveDirectly, setCanSaveDirectly] = useState(false);
  const lastSavePathRef = useRef<string | null>(null);

  useEffect(() => {
    const initialPath = localStorage.getItem('originalSrtPath');
    if (initialPath) {
      lastSavePathRef.current = initialPath;
      setCanSaveDirectly(true);
    } else {
      lastSavePathRef.current = null;
      setCanSaveDirectly(false);
    }
  }, []);

  useEffect(() => {
    if (subtitleSourceId !== undefined && subtitleSourceId > 0) {
      console.log(
        '[useSubtitleSaving] Subtitle source changed, clearing last save path.'
      );
      lastSavePathRef.current = null;
      setCanSaveDirectly(false);
    }
  }, [subtitleSourceId]);

  const handleSaveSrt = useCallback(async () => {
    const currentSavePath = lastSavePathRef.current;
    console.log('[useSubtitleSaving] Attempting to save directly...');

    if (!currentSavePath) {
      console.warn(
        '[useSubtitleSaving] No original path found. Redirecting to Save As...'
      );
      await handleSaveEditedSrtAs();
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
        filePath: currentSavePath,
      };

      console.log(`[useSubtitleSaving] Saving content to: ${currentSavePath}`);
      const result = await saveFileWithRetry(saveOptions);

      if (result?.filePath) {
        console.log(
          `[useSubtitleSaving] File saved successfully to: ${result.filePath}`
        );
        alert('File saved successfully!');
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

  const handleSaveEditedSrtAs = useCallback(async () => {
    if (!subtitles || subtitles.length === 0) {
      setError('No subtitle content to save.');
      return;
    }

    try {
      const currentSavePath = lastSavePathRef.current;
      let suggestedName = DEFAULT_FILENAME;
      if (currentSavePath) {
        suggestedName = currentSavePath;
      } else {
        // Fallback if no original path, maybe check loaded video/srt file name?
      }

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
        lastSavePathRef.current = result.filePath;
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
