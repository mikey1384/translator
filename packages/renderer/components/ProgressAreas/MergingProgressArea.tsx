import { useEffect, useCallback, useState } from 'react';
import { colors } from '../../styles.js';
import ProgressArea from './ProgressArea.js';
import subtitleRendererClient from '../../clients/subtitle-renderer-client.js';
import { useTaskStore } from '../../state';

const MERGE_PROGRESS_COLOR = colors.progressMerge;

const devLog = (...a: any[]) =>
  process.env.NODE_ENV !== 'production' && console.log(...a);
const devError = (...a: any[]) =>
  process.env.NODE_ENV !== 'production' && console.error(...a);

export default function MergingProgressArea({
  autoCloseDelay = 4_000,
}: { autoCloseDelay?: number } = {}) {
  const {
    merge: { inProgress, percent, stage, id },
    setMerge: patchMerge,
  } = useTaskStore(s => ({
    merge: s.merge,
    setMerge: s.setMerge,
  }));

  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    devLog('[MergePA] op id →', id);
  }, [id]);

  const handleCancel = useCallback(async () => {
    if (!id) {
      console.warn('[MergePA] no operation id – nothing to cancel');
      patchMerge({ inProgress: false });
      return;
    }
    setIsCancelling(true);
    try {
      devLog('[MergePA] cancelling', id);
      await subtitleRendererClient.cancelMerge(id);
    } catch (err: any) {
      devError('[MergePA] cancel failed', err);
    } finally {
      setIsCancelling(false);
      patchMerge({ inProgress: false });
    }
  }, [id, patchMerge]);

  const handleClose = useCallback(() => {
    patchMerge({ inProgress: false });
  }, [patchMerge]);

  return (
    <ProgressArea
      isVisible={inProgress}
      title="Merging Video & Subtitles"
      progress={percent}
      stage={stage}
      progressBarColor={
        stage.toLowerCase().includes('error')
          ? colors.danger
          : percent >= 100
            ? colors.success
            : MERGE_PROGRESS_COLOR
      }
      isCancelling={isCancelling}
      operationId={id ?? null}
      onCancel={handleCancel}
      onClose={handleClose}
      autoCloseDelay={
        percent >= 100 && !stage.toLowerCase().includes('error')
          ? autoCloseDelay
          : undefined
      }
    />
  );
}
