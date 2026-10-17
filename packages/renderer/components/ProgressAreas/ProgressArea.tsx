import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { localizeLegacyStage } from './legacy-stage-text';
import { logButton, logTask } from '../../utils/logger.js';
import CreditBalance, { type OperationType } from '../CreditBalance';
import {
  workflowStatusBodyStyles,
  workflowStatusCardStyles,
  workflowStatusHeaderStyles,
  workflowStatusHeadingStyles,
  workflowStatusIconButtonStyles,
  workflowStatusOverlayStyles,
  workflowStatusPercentStyles,
  workflowStatusProgressFillStyles,
  workflowStatusProgressTrackStyles,
  workflowStatusStackStyles,
  workflowStatusStageRowStyles,
  workflowStatusStageTextStyles,
  workflowStatusSubLabelStyles,
  workflowStatusTitleRowStyles,
  workflowStatusTitleStyles,
  workflowStatusUtilityRowStyles,
} from '../workflow-surface-styles';
import { resolveProgressOperationComplete } from './progress-operation-state';
import { useProgressPresentation } from './progress-presentation';
import { colors } from '../../styles';
import {
  inlineStatusActivityStyles,
  inlineStatusBarStyles,
  inlineStatusCancelStyles,
  inlineStatusFillStyles,
  inlineStatusMainStyles,
  inlineStatusMetaStyles,
  inlineStatusRowStyles,
  inlineStatusStageStyles,
  inlineStatusTitleStyles,
  inlineStatusTrackStyles,
} from '../workspace/workspace-styles';
import { formatPercent } from '../../utils/formatNumbers';
import { isDubbingOperation } from '../../utils/operationKind';

interface ProgressAreaProps {
  isVisible: boolean;
  progress: number;
  stage: string;
  title: string;
  progressBarColor: string;
  operationId: string | null;
  operationComplete?: boolean;
  onCancel: (operationId: string) => Promise<void> | void;
  autoCloseDelay?: number;
  isCancelling?: boolean;
  cancelDisabled?: boolean;
  onClose: () => void;
  subLabel?: string;
  notice?: ReactNode;
  verticalOffsetPx?: number;
}

export const PROGRESS_BAR_HEIGHT = 156;

// --- Component Implementation ---
export default function ProgressArea({
  isVisible,
  progress,
  stage,
  title,
  progressBarColor,
  operationId,
  operationComplete,
  onCancel,
  isCancelling,
  cancelDisabled,
  onClose,
  autoCloseDelay = 4000,
  subLabel,
  notice,
  verticalOffsetPx,
}: ProgressAreaProps) {
  const { t } = useTranslation();
  const stageText = localizeLegacyStage(stage, t);
  const presentation = useProgressPresentation();
  const isOperationComplete = resolveProgressOperationComplete(
    progress,
    operationComplete
  );

  const operationType: OperationType = operationId
    ? operationId.startsWith('translate-')
      ? 'translation'
      : operationId.startsWith('transcribe-')
        ? 'transcription'
        : isDubbingOperation(operationId)
          ? 'dubbing'
          : 'general'
    : 'general';

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (isVisible && isOperationComplete) {
      timer = setTimeout(() => {
        onClose();
      }, autoCloseDelay);
    }
    return () => clearTimeout(timer);
  }, [isOperationComplete, isVisible, onClose, autoCloseDelay]);

  const handleCloseOrCancelClick = async () => {
    try {
      const isCancel = !isOperationComplete;
      const action = isCancel ? 'progress_cancel' : 'progress_close';
      logButton(action, { title, operationId: operationId ?? undefined });
      if (isCancel && operationId) {
        const kind = operationId.startsWith('transcribe-')
          ? 'transcription'
          : operationId.startsWith('translate-')
            ? 'translation'
            : 'merge';
        logTask('cancel', kind as any, { operationId });
      }
    } catch {
      // Ignore logging errors
    }
    if (!isOperationComplete) {
      if (!operationId) {
        console.warn(
          `[ProgressArea] Cannot trigger cancel for "${title}": operationId is missing.`
        );
        onClose();
        return;
      }
      try {
        await onCancel(operationId);
      } catch (error) {
        console.error(
          `[ProgressArea] Error during onCancel call for ${operationId} ("${title}"):`,
          error
        );
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!isVisible) {
    return null;
  }

  if (presentation === 'inline') {
    // One accent: running work is yellow; finished and failed keep meaning.
    const fill =
      progressBarColor === colors.danger || progressBarColor === colors.success
        ? progressBarColor
        : colors.primary;
    return (
      <div className={inlineStatusBarStyles} role="status" aria-live="polite">
        <div className={inlineStatusRowStyles}>
          {!isOperationComplete ? (
            <span className={inlineStatusActivityStyles} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : null}
          <div className={inlineStatusMainStyles}>
            <span className={inlineStatusTitleStyles}>{title}</span>
            <span className={inlineStatusStageStyles}>{stageText}</span>
          </div>
          {progress > 0 ? (
            <span className={inlineStatusMetaStyles}>
              {formatPercent(progress)}
            </span>
          ) : null}
          <button
            type="button"
            className={inlineStatusCancelStyles}
            onClick={handleCloseOrCancelClick}
            disabled={isCancelling || (!isOperationComplete && cancelDisabled)}
            aria-label={t(
              'common.closeOrCancelProcess',
              'Close or cancel process'
            )}
          >
            {isCancelling ? '…' : '×'}
          </button>
        </div>
        {notice}
        {subLabel ? (
          <p className={inlineStatusStageStyles}>{subLabel}</p>
        ) : null}
        <div className={inlineStatusTrackStyles}>
          <div className={inlineStatusFillStyles(fill, progress)} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={workflowStatusOverlayStyles}
      style={
        verticalOffsetPx
          ? { transform: `translateY(${verticalOffsetPx}px)` }
          : undefined
      }
    >
      <div className={workflowStatusStackStyles}>
        <div className={workflowStatusCardStyles}>
          <div className={workflowStatusHeaderStyles}>
            <div className={workflowStatusHeadingStyles}>
              <div className={workflowStatusTitleRowStyles}>
                <h3 className={workflowStatusTitleStyles}>{title}</h3>
              </div>
              <div className={workflowStatusUtilityRowStyles}>
                {/* The balance in minutes of video, like the header pill; a
                    second per-task "hours left" figure only contradicted it. */}
                <CreditBalance operationType={operationType} />
              </div>
            </div>
            <button
              className={workflowStatusIconButtonStyles}
              onClick={handleCloseOrCancelClick}
              disabled={
                isCancelling || (!isOperationComplete && cancelDisabled)
              }
              aria-label={t(
                'common.closeOrCancelProcess',
                'Close or cancel process'
              )}
            >
              {isCancelling ? '...' : '×'}
            </button>
          </div>

          <div className={workflowStatusBodyStyles}>
            {notice}
            <div className={workflowStatusStageRowStyles}>
              <span className={workflowStatusStageTextStyles}>{stageText}</span>
              {progress > 0 && (
                <span className={workflowStatusPercentStyles}>
                  {formatPercent(progress, undefined, 1)}
                </span>
              )}
            </div>
            {subLabel && (
              <p className={workflowStatusSubLabelStyles}>{subLabel}</p>
            )}
            <div className={workflowStatusProgressTrackStyles}>
              <div
                className={workflowStatusProgressFillStyles(
                  progressBarColor,
                  progress
                )}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
