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

function isProtectedSavePhaseStage(stage: string): boolean {
  const normalized = stage.trim().toLowerCase();
  return (
    normalized.includes('waiting for save location') ||
    normalized.includes('choose where to save') ||
    normalized.includes('saving') ||
    normalized.includes('copying to destination')
  );
}

export default function MergingProgressArea({
  autoCloseDelay = 4_000,
}: { autoCloseDelay?: number } = {}) {
  const { t } = useTranslation();
  const merge = useTaskStore(s => s.merge) as MergeSlice;
  const patchMerge = useTaskStore(s => s.setMerge);
  const { inProgress, percent, stage, id } = merge;

  const [isCancelling, setIsCancelling] = useState(false);
  const [savePhaseNotice, setSavePhaseNotice] = useState<string | null>(null);

  const cancelDisabled = useMemo(
    () => isProtectedSavePhaseStage(stage) || savePhaseNotice != null,
    [savePhaseNotice, stage]
  );

  useEffect(() => {
    if (!inProgress) {
      setIsCancelling(false);
      setSavePhaseNotice(null);
    }
  }, [inProgress]);

  useEffect(() => {
    if (!isProtectedSavePhaseStage(stage)) {
      setSavePhaseNotice(null);
    }
  }, [stage, t]);

  useEffect(() => {
    devLog('[MergePA] op id →', id);
  }, [id]);

  const handleCancel = useCallback(async () => {
    if (!id) {
      console.warn('[MergePA] no operation id – nothing to cancel');
      return;
    }
    try {
      devLog('[MergePA] cancelling', id);
      const result = await subtitleRendererClient.cancelMerge(id);
      if (!result.accepted) {
        if (result.reason === 'save_phase') {
          setSavePhaseNotice(
            t(
              'progress.mergeSavePhaseNoCancel',
              'This save step can’t be cancelled now.'
            )
          );
        }
        return;
      }
      setIsCancelling(true);
      patchMerge({ stage: 'Cancelling...', inProgress: true });
    } catch (err: any) {
      devError('[MergePA] cancel failed', err);
    }
  }, [id, patchMerge, t]);

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
      cancelDisabled={cancelDisabled}
      operationId={id ?? null}
      onCancel={handleCancel}
      onClose={handleClose}
      subLabel={savePhaseNotice ?? undefined}
      autoCloseDelay={
        percent >= 100 && !stage.toLowerCase().includes('error')
          ? autoCloseDelay
          : undefined
      }
    />
  );
}
