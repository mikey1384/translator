import { useState } from 'react';
import { colors } from '../../styles.js';
import { useTranslation } from 'react-i18next';
import ProgressArea from './ProgressArea.js';

interface SubtitleProgressInfo {
  current?: number;
  total?: number;
  warning?: string;
}

interface TranslationProgressAreaProps {
  translationProgress: number;
  translationStage: string;
  subtitleProgress?: SubtitleProgressInfo;
  isTranslationInProgress: boolean;
  onSetIsTranslationInProgress: (inProgress: boolean) => void;
  autoCloseDelay?: number;
  partialResult?: string;
  onPartialResult?: (partialResult: string) => void;
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

  const { t } = useTranslation();

  const handleTranslationCancel = async (idToCancel: string) => {
    try {
      console.log(
        `[TranslationProgressArea] Attempting electron cancel: ${idToCancel}`
      );
      await window.electron.cancelOperation(idToCancel);
      console.log(
        `[TranslationProgressArea] Electron cancel request sent for ${idToCancel}.`
      );
      onSetIsTranslationInProgress(false);
    } catch (error) {
      console.error(
        `[TranslationProgressArea] Error calling cancelOperation for ${idToCancel}:`,
        error
      );
      onSetIsTranslationInProgress(false);
    } finally {
      setIsCancelling(false);
      onSetIsTranslationInProgress(false);
    }
  };

  const handleClose = () => {
    console.log(
      '[TranslationProgressArea] handleClose called by ProgressArea, signaling parent.'
    );
    onSetIsTranslationInProgress(false);
  };

  return (
    <ProgressArea
      isCancelling={isCancelling}
      isVisible={isTranslationInProgress}
      title={t('translationProgress.title', 'Translation in Progress')}
      progress={translationProgress}
      stage={translationStage}
      progressBarColor={TRANSLATION_PROGRESS_COLOR}
      operationId={translationOperationId || null}
      onCancel={handleTranslationCancel}
      onClose={handleClose}
      autoCloseDelay={autoCloseDelay}
    />
  );
}
