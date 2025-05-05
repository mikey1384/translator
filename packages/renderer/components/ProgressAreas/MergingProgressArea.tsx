import { useState, useEffect } from 'react';
import { colors } from '../../styles.js';
import ProgressArea from './ProgressArea.js';
import * as OperationIPC from '@ipc/operation';

interface MergingProgressAreaProps {
  mergeProgress: number;
  mergeStage?: string;
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
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('MergingProgressArea received operationId:', operationId);
    }
  }, [operationId]);

  const handleCancel = async () => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('Cancel button clicked, operationId:', operationId);
    }

    if (
      !window.confirm(
        "Are you sure you want to cancel the subtitle merge? Any progress will be lost and you'll need to start again."
      )
    ) {
      return;
    }

    setIsCancelling(true);

    if (!operationId) {
      console.warn('Cannot cancel merge: operationId is null.');
      onSetIsMergingInProgress(false);
      return;
    }
    try {
      console.log(`Attempting to cancel merge operation: ${operationId}`);
      const result = await OperationIPC.cancel(operationId);
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
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        '[MergingProgressArea] handleClose called by ProgressArea, signaling parent.'
      );
    }
    onSetIsMergingInProgress(false);
  };

  return (
    <ProgressArea
      isVisible={isMergingInProgress}
      title="Merge in Progress"
      progress={mergeProgress}
      stage={mergeStage ?? ''}
      progressBarColor={
        isCancelling
          ? colors.danger
          : mergeProgress >= 100
            ? colors.success
            : MERGE_PROGRESS_COLOR
      }
      isCancelling={isCancelling}
      operationId={operationId}
      onCancel={handleCancel}
      onClose={handleClose}
      autoCloseDelay={autoCloseDelay}
    />
  );
}
