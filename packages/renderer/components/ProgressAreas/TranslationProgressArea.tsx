import { useState, useCallback } from 'react';
import ProgressArea from './ProgressArea';
import { colors } from '../../styles';

import { useTaskStore } from '../../state';
import * as OperationIPC from '@ipc/operation';

/* ------------------------------------------------------------------ */
/* util – dev-only logging                                             */
/* ------------------------------------------------------------------ */
const dev = {
  log: (...a: any[]) =>
    process.env.NODE_ENV !== 'production' && console.log(...a),
  error: (...a: any[]) =>
    process.env.NODE_ENV !== 'production' && console.error(...a),
};

/* ------------------------------------------------------------------ */
const BAR_COLOR = colors.progressTranslate;

export default function TranslationProgressArea({
  autoCloseDelay = 3_000,
}: { autoCloseDelay?: number } = {}) {
  /* pull translation slice from the global task store */
  const {
    translation: { inProgress, percent, stage, id },
    setTranslation,
  } = useTaskStore(s => ({
    translation: s.translation,
    setTranslation: s.setTranslation,
  }));

  const [isCancelling, setIsCancelling] = useState(false);

  /* ---------------- cancel handler ---------------- */
  const handleCancel = useCallback(async () => {
    if (!id) {
      alert('Cannot cancel – operation id missing.');
      setTranslation({ inProgress: false });
      return;
    }

    if (
      !window.confirm(
        "Cancel translation?\n\nProgress will be lost and you'll need to start again."
      )
    ) {
      return;
    }

    setIsCancelling(true);
    try {
      dev.log('[TPA] sending cancel for', id);
      await OperationIPC.cancel(id);
    } catch (err: any) {
      dev.error('[TPA] cancel failed', err);
      alert(`Failed to cancel: ${err.message || err}`);
    } finally {
      setIsCancelling(false);
      setTranslation({ inProgress: false });
    }
  }, [id, setTranslation]);

  /* ---------------- close handler (auto-hide) ----- */
  const handleClose = useCallback(() => {
    dev.log('[TPA] closed manually/auto');
    setTranslation({ inProgress: false });
  }, [setTranslation]);

  /* ---------------- render ------------------------ */
  return (
    <ProgressArea
      isVisible={inProgress}
      title="Translation in Progress"
      progress={percent}
      stage={stage}
      progressBarColor={
        isCancelling
          ? colors.danger
          : percent >= 100
            ? colors.success
            : BAR_COLOR
      }
      operationId={id ?? null}
      isCancelling={isCancelling}
      onCancel={handleCancel}
      onClose={handleClose}
      autoCloseDelay={autoCloseDelay}
    />
  );
}
