import type { TFunction } from 'i18next';
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

type TranscriptSummaryProgressProps = {
  isCancelling: boolean;
  onCancel: () => void;
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
  if (!show) return null;

  return (
    <div className={progressWrapperStyles}>
      <div className={progressHeaderStyles}>
        <span>{progressLabel || t('summary.status.inProgress')}</span>
        <div className={progressRightStyles}>
          <span className={progressPercentStyles}>
            {Math.round(progressPercent)}%
          </span>
          <button
            className={cancelButtonStyles}
            onClick={onCancel}
            disabled={isCancelling || progressPercent >= 100}
            title={t('summary.cancel', 'Cancel')}
          >
            {isCancelling ? '...' : '×'}
          </button>
        </div>
      </div>
      <div className={progressBarBackgroundStyles}>
        <div className={progressBarFillStyles(progressPercent)} />
      </div>
    </div>
  );
}
