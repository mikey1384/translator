import { useState } from 'react';
import type { TFunction } from 'i18next';
import Button from '../Button';
import Modal from '../Modal';
import {
  cancelButtonStyles,
  progressHeaderStyles,
  progressPercentStyles,
  progressRightStyles,
  progressWrapperStyles,
} from './TranscriptSummaryPanel.styles';
import {
  progressBarBackgroundStyles,
  progressBarFillStyles,
} from '../../styles';
import { formatPercent } from '../../utils/formatNumbers';

type TranscriptSummaryProgressProps = {
  isCancelling: boolean;
  /** Stops the run; rejects when it couldn't be stopped. */
  onCancel: () => Promise<void>;
  progressLabel: string;
  progressPercent: number;
  show: boolean;
  t: TFunction;
};

export default function TranscriptSummaryProgress({
  isCancelling,
  onCancel,
  progressLabel,
  progressPercent,
  show,
  t,
}: TranscriptSummaryProgressProps) {
  // The app's own dialog in the UI language, like dubbing and translation:
  // native confirm() buttons follow the OS language.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  if (!show) return null;

  async function stop() {
    setStopError(null);
    try {
      await onCancel();
      setConfirmOpen(false);
    } catch {
      setStopError(
        t(
          'errors.cancelSummaryFailedPlain',
          "Couldn't stop the summary. Try again."
        )
      );
    }
  }

  return (
    <div className={progressWrapperStyles}>
      <div className={progressHeaderStyles}>
        <span>{progressLabel || t('summary.status.inProgress')}</span>
        <div className={progressRightStyles}>
          <span className={progressPercentStyles}>
            {formatPercent(Math.round(progressPercent))}
          </span>
          <button
            className={cancelButtonStyles}
            onClick={() => {
              setStopError(null);
              setConfirmOpen(true);
            }}
            disabled={isCancelling || progressPercent >= 100}
            title={t('summary.cancel', 'Cancel')}
            aria-label={t('summary.cancel', 'Cancel')}
          >
            {isCancelling ? '...' : '×'}
          </button>
        </div>
      </div>
      <div className={progressBarBackgroundStyles}>
        <div className={progressBarFillStyles(progressPercent)} />
      </div>
      <Modal
        open={confirmOpen}
        title={t('dialogs.cancelSummaryTitle', 'Stop the summary?')}
        titleId="confirm-cancel-summary-title"
        onClose={() => {
          if (!isCancelling) setConfirmOpen(false);
        }}
        actions={
          <>
            <Button
              variant="text"
              onClick={() => setConfirmOpen(false)}
              disabled={isCancelling}
            >
              {t('dialogs.keepSummarizing', 'Keep going')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void stop()}
              isLoading={isCancelling}
            >
              {t('dialogs.stopSummarizing', 'Stop')}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }} role={stopError ? 'alert' : undefined}>
          {stopError ??
            t(
              'dialogs.cancelSummaryBody',
              "The summary and highlights made so far won't be kept."
            )}
        </p>
      </Modal>
    </div>
  );
}
