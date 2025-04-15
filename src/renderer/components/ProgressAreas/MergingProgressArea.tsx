import { useState, useEffect } from 'react';
import { colors } from '../../styles.js';
import { useTranslation } from 'react-i18next';
import ProgressArea from './ProgressArea.js';

interface MergingProgressAreaProps {
  mergeProgress: number;
  mergeStage: string;
  isMergingInProgress: boolean;
  onSetIsMergingInProgress: (inProgress: boolean) => void;
  operationId: string | null;
  autoCloseDelay?: number;
}

const MERGE_PROGRESS_COLOR = colors.warning;

export default function MergingProgressArea({
  mergeProgress,
  mergeStage,
  isMergingInProgress,
  onSetIsMergingInProgress,
  operationId,
  autoCloseDelay = 5000,
}: MergingProgressAreaProps) {
  const { t } = useTranslation();
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    console.log('MergingProgressArea received operationId:', operationId);
  }, [operationId]);

  const handleCancel = async () => {
    console.log('Cancel button clicked, operationId:', operationId);

    if (!window.confirm(t('editSubtitles.mergeControls.cancel_confirmation'))) {
      return;
    }

    setIsCancelling(true);

    if (!operationId) {
      console.warn('Cannot cancel merge: operationId is null.');
      setIsCancelling(false);
      onSetIsMergingInProgress(false);
      return;
    }
    try {
      console.log(`Attempting to cancel merge operation: ${operationId}`);
      const result = await window.electron.cancelOperation(operationId);
      console.log(`Cancellation result for ${operationId}:`, result);
      if (result.success) {
        console.log(`Successfully canceled operation ${operationId}`);
      } else {
        console.error(
          `Failed to cancel operation ${operationId}:`,
          result.error
        );
      }
    } catch (error) {
      console.error(`Error calling cancelOperation for ${operationId}:`, error);
    } finally {
      setIsCancelling(false);
      onSetIsMergingInProgress(false);
    }
  };

  const handleClose = () => {
    console.log(
      '[MergingProgressArea] handleClose called by ProgressArea, signaling parent.'
    );
    onSetIsMergingInProgress(false);
  };

  return (
    <ProgressArea
      isVisible={isMergingInProgress}
      title={t('mergeProgress.title', 'Merge in Progress')}
      progress={mergeProgress}
      stage={mergeStage}
      progressBarColor={
        mergeProgress >= 100 ? colors.success : MERGE_PROGRESS_COLOR
      }
      isCancelling={isCancelling}
      operationId={operationId}
      onCancel={handleCancel}
      onClose={handleClose}
      autoCloseDelay={autoCloseDelay}
    />
  );
}
