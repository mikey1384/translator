import { useState, useCallback } from 'react';
import { colors } from '../../styles.js';
import ProgressArea from './ProgressArea.js';
import * as OperationIPC from '@ipc/operation';

const devLog = (...args: any[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(...args);
  }
};

const devError = (...args: any[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error(...args);
  }
};

interface TranslationProgressAreaProps {
  translationProgress: number;
  translationStage: string;
  isTranslationInProgress: boolean;
  onSetIsTranslationInProgress: (inProgress: boolean) => void;
  autoCloseDelay?: number;
  translationOperationId?: string | null;
}

const TRANSLATION_PROGRESS_COLOR = colors.info;

export default function TranslationProgressArea({
  translationProgress,
  translationStage,
  isTranslationInProgress,
  onSetIsTranslationInProgress,
  autoCloseDelay = 3000,
  translationOperationId,
}: TranslationProgressAreaProps) {
  const [isCancelling, setIsCancelling] = useState(false);

  const handleTranslationCancel = useCallback(
    async (id?: string | null) => {
      if (!id) {
        console.warn('[TranslationProgressArea] No operationId to cancel.');
        onSetIsTranslationInProgress(false);
        return;
      }

      if (
        !window.confirm(
          "Are you sure you want to cancel the translation? Progress will be lost and you'll need to start again."
        )
      ) {
        return;
      }

      setIsCancelling(true);

      try {
        devLog(`[TranslationProgressArea] Attempting electron cancel: ${id}`);
        await OperationIPC.cancel(id);
        devLog(
          `[TranslationProgressArea] Electron cancel request sent for ${id}.`
        );
      } catch (error) {
        devError(
          `[TranslationProgressArea] Error calling cancelOperation for ${id}:`,
          error
        );
      } finally {
        setIsCancelling(false);
        onSetIsTranslationInProgress(false);
      }
    },
    [onSetIsTranslationInProgress]
  );

  const handleClose = useCallback(() => {
    devLog(
      '[TranslationProgressArea] handleClose called by ProgressArea, signaling parent.'
    );
    onSetIsTranslationInProgress(false);
  }, [onSetIsTranslationInProgress]);

  return (
    <ProgressArea
      isCancelling={isCancelling}
      isVisible={isTranslationInProgress}
      title="Translation in Progress"
      progress={translationProgress}
      stage={translationStage}
      progressBarColor={
        isCancelling
          ? colors.danger
          : translationProgress >= 100
            ? colors.success
            : TRANSLATION_PROGRESS_COLOR
      }
      operationId={translationOperationId ?? null}
      onCancel={handleTranslationCancel}
      onClose={handleClose}
      autoCloseDelay={autoCloseDelay}
    />
  );
}
