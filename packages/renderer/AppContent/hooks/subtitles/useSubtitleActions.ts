import { Dispatch, SetStateAction } from 'react';
import { saveFileWithRetry } from '../../../../shared/helpers/electron-ipc.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { DEFAULT_FILENAME } from '../../../../shared/constants/index.js';
import { useSubStore } from '../../../state/subtitle-store.js';

export function useSubtitleActions({
  originalSrtFilePath,
  setSaveError,
  onSaveAsComplete,
  showOriginalText,
}: {
  originalSrtFilePath: string | null;
  setSaveError: Dispatch<SetStateAction<string>>;
  onSaveAsComplete: (newFilePath: string) => void;
  showOriginalText: boolean;
}): {
  handleSaveSrt: () => Promise<void>;
  handleSaveEditedSrtAs: () => Promise<void>;
} {
  function getCurrentSegments() {
    const { order, segments } = useSubStore.getState();
    return order.map(id => segments[id]);
  }

  async function handleSaveEditedSrtAs(): Promise<void> {
    const liveSegments = getCurrentSegments();
    if (liveSegments.length === 0) {
      setSaveError('No subtitle content to save.');
      return;
    }

    try {
      let suggestedName = originalSrtFilePath || DEFAULT_FILENAME;

      if (!suggestedName.toLowerCase().endsWith('.srt')) {
        const nameWithoutExt = suggestedName.includes('.')
          ? suggestedName.substring(0, suggestedName.lastIndexOf('.'))
          : suggestedName;
        suggestedName = `${nameWithoutExt}.srt`;
      }

      const srtContent = buildSrt({
        segments: liveSegments,
        mode: showOriginalText ? 'dual' : 'translation',
      });

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
      setSaveError('');
      const result = await saveFileWithRetry(saveOptions);
      console.log('[useSubtitleSaving] Result from Save As:', result);

      if (result?.filePath) {
        console.log(
          `[useSubtitleSaving] File saved via Save As: ${result.filePath}`
        );
        onSaveAsComplete(result.filePath);
        alert(`File saved successfully to:
${result.filePath}`);
      } else if (result?.error && !result.error.includes('canceled')) {
        setSaveError(`Save As failed: ${result.error}`);
      } else {
        setSaveError('');
      }
    } catch (error: any) {
      const message = error.message || String(error);
      setSaveError(`Error during Save As: ${message}`);
      console.error(`[useSubtitleSaving] Error during Save As: ${message}`);
    }
  }

  async function handleSaveSrt(): Promise<void> {
    console.log('[useSubtitleSaving] Attempting to save...');

    const liveSegments = getCurrentSegments();
    if (liveSegments.length === 0) {
      setSaveError('No subtitle content to save.');
      return;
    }

    if (!originalSrtFilePath) {
      console.warn(
        '[useSubtitleSaving] No original path. Redirecting to Save As...'
      );
      await handleSaveEditedSrtAs();
      return;
    }

    try {
      setSaveError('');
      const srtContent = buildSrt({
        segments: liveSegments,
        mode: showOriginalText ? 'dual' : 'translation',
      });

      const saveOptions = {
        content: srtContent,
        filePath: originalSrtFilePath,
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
      } else if (result?.error) {
        setSaveError(`Save failed: ${result.error}`);
        console.error(`[useSubtitleSaving] Save failed: ${result.error}`);
      }
    } catch (error: any) {
      const message = error.message || String(error);
      setSaveError(`Error saving SRT file: ${message}`);
      console.error(`[useSubtitleSaving] Error during direct save: ${message}`);
    }
  }

  return {
    handleSaveSrt,
    handleSaveEditedSrtAs,
  };
}
