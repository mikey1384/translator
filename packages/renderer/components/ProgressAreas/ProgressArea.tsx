import { useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreditStore } from '../../state/credit-store';
import { useUIStore } from '../../state/ui-store';
import { useAiStore } from '../../state/ai-store';
import { logButton, logTask } from '../../utils/logger.js';
import {
  estimateTranscriptionHours,
  estimateTranslatableHours,
  formatDubbingTime,
  formatHours,
} from '../../utils/creditEstimates';
import {
  resolveDubbingCreditProvider,
  resolveDubbingProvider,
  resolveTranscriptionProvider,
  resolveTranslationDraftProvider,
  resolveTranslationReviewProvider,
  type ByoRuntimeState,
} from '../../state/byo-runtime';
import CreditBalance, { type OperationType } from '../CreditBalance';
import SettingsButton from '../SettingsButton';
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

interface ProgressAreaProps {
  isVisible: boolean;
  progress: number;
  stage: string;
  title: string;
  progressBarColor: string;
  operationId: string | null;
  onCancel: (operationId: string) => Promise<void> | void;
  autoCloseDelay?: number;
  isCancelling?: boolean;
  onClose: () => void;
  subLabel?: string;
  notice?: ReactNode;
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
  onCancel,
  isCancelling,
  onClose,
  autoCloseDelay = 4000,
  subLabel,
  notice,
}: ProgressAreaProps) {
  const { t } = useTranslation();
  const credits = useCreditStore(s => s.credits);
  const qualityTranslation = useUIStore(s => s.qualityTranslation);
  const byoUnlocked = useAiStore(s => s.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(s => s.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(s => s.byoElevenLabsUnlocked);
  const preferredTranscriptionProvider = useAiStore(
    s => s.preferredTranscriptionProvider
  );
  const preferredDubbingProvider = useAiStore(s => s.preferredDubbingProvider);
  const stage5DubbingTtsProvider = useAiStore(s => s.stage5DubbingTtsProvider);
  const useStrictByoMode = useAiStore(s => s.useStrictByoMode);
  const useByo = useAiStore(s => s.useByo);
  const keyPresent = useAiStore(s => s.keyPresent);
  const anthropicKeyPresent = useAiStore(s => s.anthropicKeyPresent);
  const useByoAnthropic = useAiStore(s => s.useByoAnthropic);
  const useByoElevenLabs = useAiStore(s => s.useByoElevenLabs);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);
  const preferClaudeTranslation = useAiStore(s => s.preferClaudeTranslation);
  const preferClaudeReview = useAiStore(s => s.preferClaudeReview);
  const preferClaudeSummary = useAiStore(s => s.preferClaudeSummary);

  const runtimeState = useMemo<ByoRuntimeState>(
    () => ({
      useStrictByoMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      byoElevenLabsUnlocked,
      useByo,
      useByoAnthropic,
      useByoElevenLabs,
      keyPresent,
      anthropicKeyPresent,
      elevenLabsKeyPresent,
      preferClaudeTranslation,
      preferClaudeReview,
      preferClaudeSummary,
      preferredTranscriptionProvider,
      preferredDubbingProvider,
      stage5DubbingTtsProvider,
    }),
    [
      useStrictByoMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      byoElevenLabsUnlocked,
      useByo,
      useByoAnthropic,
      useByoElevenLabs,
      keyPresent,
      anthropicKeyPresent,
      elevenLabsKeyPresent,
      preferClaudeTranslation,
      preferClaudeReview,
      preferClaudeSummary,
      preferredTranscriptionProvider,
      preferredDubbingProvider,
      stage5DubbingTtsProvider,
    ]
  );

  const operationType: OperationType = operationId
    ? operationId.startsWith('translate-')
      ? 'translation'
      : operationId.startsWith('transcribe-')
        ? 'transcription'
        : operationId.startsWith('dub-')
          ? 'dubbing'
          : 'general'
    : 'general';

  const coverageText = useMemo(() => {
    if (
      operationType === 'general' ||
      typeof credits !== 'number' ||
      credits <= 0
    ) {
      return undefined;
    }

    const translationDraftProvider =
      resolveTranslationDraftProvider(runtimeState);
    const translationReviewProvider =
      resolveTranslationReviewProvider(runtimeState);
    const resolvedTranscriptionProvider =
      resolveTranscriptionProvider(runtimeState);
    const resolvedDubbingProvider = resolveDubbingProvider(runtimeState);
    if (operationType === 'transcription') {
      if (resolvedTranscriptionProvider !== 'stage5') {
        return undefined;
      }
      const hours = estimateTranscriptionHours(credits);
      return hours != null ? `(~${formatHours(hours)})` : undefined;
    }

    if (operationType === 'translation') {
      if (
        translationDraftProvider !== 'stage5' ||
        translationReviewProvider !== 'stage5'
      ) {
        return undefined;
      }
      const hours = estimateTranslatableHours(credits, qualityTranslation);
      if (hours == null) return undefined;
      const time = formatHours(hours);
      return qualityTranslation ? `(hq mode: ~${time})` : `(~${time})`;
    }

    if (operationType === 'dubbing') {
      if (resolvedDubbingProvider !== 'stage5') {
        return undefined;
      }
      return `(${formatDubbingTime(
        credits,
        resolveDubbingCreditProvider(runtimeState)
      )})`;
    }

    return undefined;
  }, [operationType, credits, runtimeState, qualityTranslation]);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (isVisible && progress >= 100) {
      timer = setTimeout(() => {
        onClose();
      }, autoCloseDelay);
    }
    return () => clearTimeout(timer);
  }, [progress, isVisible, onClose, autoCloseDelay]);

  const handleCloseOrCancelClick = async () => {
    try {
      const isCancel = progress < 100;
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
    if (progress < 100) {
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

  return (
    <div className={workflowStatusOverlayStyles}>
      <div className={workflowStatusStackStyles}>
        <div className={workflowStatusCardStyles}>
          <div className={workflowStatusHeaderStyles}>
            <div className={workflowStatusHeadingStyles}>
              <div className={workflowStatusTitleRowStyles}>
                <h3 className={workflowStatusTitleStyles}>{title}</h3>
              </div>
              <div className={workflowStatusUtilityRowStyles}>
                <CreditBalance
                  operationType={operationType}
                  suffixText={coverageText}
                />
                <SettingsButton variant="icon" />
              </div>
            </div>
            <button
              className={workflowStatusIconButtonStyles}
              onClick={handleCloseOrCancelClick}
              disabled={isCancelling}
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
              <span className={workflowStatusStageTextStyles}>{stage}</span>
              {progress > 0 && (
                <span className={workflowStatusPercentStyles}>
                  {progress.toFixed(1)}%
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
