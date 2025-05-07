import { useEffect } from 'react';
import { colors } from '../../styles.js';
import ProgressArea from './ProgressArea.js';
import subtitleRendererClient from '../../clients/subtitle-renderer-client.js';

interface MergingProgressAreaProps {
  mergeProgress: number;
  mergeStage: string;
  onSetIsMergingInProgress: (isMerging: boolean) => void;
  operationId: string | null;
  isMergingInProgress: boolean;
}

const MERGE_PROGRESS_COLOR = colors.progressMerge;

export default function MergingProgressArea({
  mergeProgress,
  mergeStage,
  onSetIsMergingInProgress,
  operationId,
  isMergingInProgress,
}: MergingProgressAreaProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('MergingProgressArea received operationId:', operationId);
    }
  }, [operationId]);

  const handleCancelMerge = async () => {
    if (!operationId) {
      console.warn(
        '[MergingProgressArea] Cannot cancel merge: operationId is missing.'
      );
      onSetIsMergingInProgress(false);
      return;
    }
    try {
      console.log(
        `[MergingProgressArea] Sending cancel request for merge ${operationId}`
      );
      subtitleRendererClient.cancelMerge(operationId);
    } catch (error) {
      console.error(
        `[MergingProgressArea] Error sending cancel request for merge ${operationId}:`,
        error
      );
    } finally {
      onSetIsMergingInProgress(false); // Ensure progress bar hides after attempt
    }
  };

  return (
    <ProgressArea
      isVisible={isMergingInProgress}
      title="Merging Video & Subtitles"
      progress={mergeProgress}
      stage={mergeStage}
      progressBarColor={
        mergeStage.toLowerCase().includes('error')
          ? colors.danger
          : mergeProgress >= 100
            ? colors.success
            : MERGE_PROGRESS_COLOR
      }
      isCancelling={false}
      operationId={operationId}
      onCancel={handleCancelMerge}
      onClose={() => onSetIsMergingInProgress(false)}
      autoCloseDelay={
        mergeProgress >= 100 && !mergeStage.toLowerCase().includes('error')
          ? 4000
          : undefined
      }
    />
  );
}
