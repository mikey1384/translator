import { useState, useCallback, useMemo, useEffect } from 'react';
import { colors } from '../../styles';
import ProgressArea from './ProgressArea';
import { useTaskStore } from '../../state';
import * as OperationIPC from '@ipc/operation';

/* ------------------------------------------------------------------ */
/* 📐  Constants & helpers                                             */
/* ------------------------------------------------------------------ */
const TRANSLATION_PROGRESS_COLOR = colors.progressTranslate;

const devLog = (...a: any[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(...a);
  }
};
const devError = (...a: any[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error(...a);
  }
};

type TranslationSlice = {
  inProgress: boolean;
  percent: number;
  stage: string;
  id?: string;
};

export default function TranslationProgressArea({
  autoCloseDelay = 3_000,
}: { autoCloseDelay?: number } = {}) {
  /* -------------------------------------------------------------- */
  /* 1 ️⃣  read from zustand                                        */
  /* -------------------------------------------------------------- */
  const {
    translation: { inProgress, percent, stage, id },
    setTranslation: patchTranslation,
  } = useTaskStore(s => ({
    translation: s.translation,
    setTranslation: s.setTranslation,
  })) as {
    translation: TranslationSlice;
    setTranslation: (p: Partial<TranslationSlice>) => void;
  };

  /* -------------------------------------------------------------- */
  /* 2 ️⃣  local UI state                                           */
  /* -------------------------------------------------------------- */
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    devLog('[TransPA] op id →', id);
  }, [id]);

  /* -------------------------------------------------------------- */
  /* 3 ️⃣  handlers                                                */
  /* -------------------------------------------------------------- */
  const handleCancel = useCallback(async () => {
    if (!id) {
      console.warn('[TransPA] no operation id – nothing to cancel');
      patchTranslation({ inProgress: false });
      return;
    }

    if (
      !window.confirm(
        "Cancel translation? Progress will be lost and you'll need to start again."
      )
    )
      return;

    setIsCancelling(true);

    try {
      devLog('[TransPA] cancelling', id);
      await OperationIPC.cancel(id);
    } catch (err: any) {
      devError('[TransPA] cancel failed', err);
      alert(`Failed to cancel the operation: ${err.message || err}`);
    } finally {
      setIsCancelling(false);
      patchTranslation({ inProgress: false });
    }
  }, [id, patchTranslation]);

  const handleClose = useCallback(() => {
    patchTranslation({ inProgress: false });
  }, [patchTranslation]);

  /* -------------------------------------------------------------- */
  /* 4 ️⃣  derived colour                                           */
  /* -------------------------------------------------------------- */
  const progressBarColor = useMemo(() => {
    if (isCancelling) return colors.danger;
    if (percent >= 100) return colors.success;
    return TRANSLATION_PROGRESS_COLOR;
  }, [isCancelling, percent]);

  /* -------------------------------------------------------------- */
  /* 5 ️⃣  short-circuit when idle                                  */
  /* -------------------------------------------------------------- */
  if (!inProgress) return null;

  /* -------------------------------------------------------------- */
  /* 6 ️⃣  render                                                  */
  /* -------------------------------------------------------------- */
  return (
    <ProgressArea
      isVisible={inProgress}
      title="Translation in Progress"
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
