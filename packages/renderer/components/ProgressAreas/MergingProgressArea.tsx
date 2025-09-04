import { useEffect, useCallback, useState, useMemo } from 'react';
import { colors } from '../../styles.js';
import ProgressArea from './ProgressArea.js';
import { useTranslation } from 'react-i18next';
import subtitleRendererClient from '../../clients/subtitle-renderer-client.js';
import { useTaskStore } from '../../state';

const MERGE_PROGRESS_COLOR = colors.progressMerge;

const devLog = (...a: any[]) => {
  if (!window.env.isPackaged) {
    console.log(...a);
  }
};
const devError = (...a: any[]) => {
  if (!window.env.isPackaged) {
    console.error(...a);
  }
};

type MergeSlice = {
  inProgress: boolean;
  percent: number;
  stage: string;
  id?: string;
};

export default function MergingProgressArea({
  autoCloseDelay = 4_000,
}: { autoCloseDelay?: number } = {}) {
  const { t } = useTranslation();
  const {
    merge: { inProgress, percent, stage, id },
    setMerge: patchMerge,
  } = useTaskStore(s => ({
    merge: s.merge,
    setMerge: s.setMerge,
  })) as {
    merge: MergeSlice;
    setMerge: (patch: Partial<MergeSlice>) => void;
  };

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
    patchMerge({ inProgress: false, percent: 0, stage: '' });
  }, [patchMerge]);

  const progressBarColor = useMemo(() => {
    return stage.toLowerCase().includes('error')
      ? colors.danger
      : percent >= 100
        ? colors.success
        : MERGE_PROGRESS_COLOR;
  }, [stage, percent]);

  if (!inProgress) return null;

  return (
    <ProgressArea
      isVisible={inProgress}
      title={t('progress.mergingTitle', 'Merging Video & Subtitles')}
      progress={percent}
      stage={stage}
      progressBarColor={progressBarColor}
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
