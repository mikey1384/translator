import { useEffect } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import { useCreditStore } from '../../state/credit-store';
import { useUIStore } from '../../state/ui-store';
import { useAiStore } from '../../state/ai-store';
import { logButton, logTask } from '../../utils/logger.js';
import {
  CREDITS_PER_TRANSLATION_AUDIO_HOUR,
  TRANSLATION_QUALITY_MULTIPLIER,
  TTS_CREDITS_PER_MINUTE,
} from '../../../shared/constants';
import CreditBalance, { type OperationType } from '../CreditBalance';

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
}

export const PROGRESS_BAR_HEIGHT = 150;

// --- Styles ---
const progressContainerStyles = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1100;
  padding: 18px 24px;
  background-color: rgba(30, 30, 30, 0.75);
  backdrop-filter: blur(12px);
  box-shadow: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-bottom: 1px solid ${colors.border};
  animation: slideDown 0.3s ease-out;

  @keyframes slideDown {
    from {
      transform: translateY(-100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
`;

const headerStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;

  h3 {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
    color: ${colors.primaryLight};
  }
`;

const progressBlockStyles = css`
  padding: 16px;
  background-color: ${colors.light};
  border-radius: 8px;
  border: 1px solid ${colors.border};
  box-shadow: none;
`;

const progressBarContainerStyles = css`
  height: 10px;
  background-color: ${colors.grayLight};
  border-radius: 10px;
  overflow: hidden;
  margin: 8px 0;
  border: 1px solid ${colors.border};
`;

const progressLabelStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 500;
  font-size: 0.95rem;
  color: ${colors.dark};
`;

const closeButtonStyles = css`
  background: none;
  border: none;
  color: ${colors.gray};
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  &:hover {
    color: ${colors.dark};
  }
`;

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
}: ProgressAreaProps) {
  // Compute remaining time to show next to credits in header
  const { credits } = useCreditStore();
  const qualityTranslation = useUIStore(s => s.qualityTranslation);
  const preferredDubbingProvider = useAiStore(s => s.preferredDubbingProvider);
  const stage5DubbingTtsProvider = useAiStore(s => s.stage5DubbingTtsProvider);
  const useByoMaster = useAiStore(s => s.useByoMaster);
  const useByo = useAiStore(s => s.useByo);
  const keyPresent = useAiStore(s => s.keyPresent);
  const useByoElevenLabs = useAiStore(s => s.useByoElevenLabs);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);

  // Check if using BYO for OpenAI operations (transcription/translation)
  const usingByoOpenAi = useByoMaster && useByo && keyPresent;

  // Calculate operation-specific time estimates (only when using credits)
  let suffixText: string | undefined;
  if (typeof credits === 'number' && credits > 0) {
    if (operationId?.startsWith('transcribe-') && !usingByoOpenAi) {
      // Transcription: use base translation hour rate (similar cost)
      const hours = credits / CREDITS_PER_TRANSLATION_AUDIO_HOUR;
      suffixText = `(${Math.floor(hours).toLocaleString()}h)`;
    } else if (operationId?.startsWith('translate-') && !usingByoOpenAi) {
      // Translation: adjust for quality toggle
      const effectiveCreditsPerHour = qualityTranslation
        ? CREDITS_PER_TRANSLATION_AUDIO_HOUR * TRANSLATION_QUALITY_MULTIPLIER
        : CREDITS_PER_TRANSLATION_AUDIO_HOUR;
      const hours = credits / effectiveCreditsPerHour;
      if (hours < 1) {
        suffixText = `(~${Math.ceil(hours * 60)}m)`;
      } else {
        suffixText = `(${Math.floor(hours).toLocaleString()}h)`;
      }
    } else if (operationId?.startsWith('dub-')) {
      // Dubbing: use TTS provider-specific rate
      // Check if using BYO for dubbing (ElevenLabs)
      const usingByoDubbing =
        useByoMaster && useByoElevenLabs && elevenLabsKeyPresent;
      if (!usingByoDubbing) {
        let ttsProvider: 'openai' | 'elevenlabs' = 'openai';
        if (preferredDubbingProvider === 'stage5') {
          ttsProvider = stage5DubbingTtsProvider;
        }
        const creditsPerMin = TTS_CREDITS_PER_MINUTE[ttsProvider];
        const minutes = credits / creditsPerMin;
        if (minutes < 60) {
          suffixText = `(~${Math.floor(minutes)}m)`;
        } else {
          const hours = Math.floor(minutes / 60);
          const mins = Math.floor(minutes % 60);
          suffixText = mins > 0 ? `(~${hours}h ${mins}m)` : `(~${hours}h)`;
        }
      }
    }
  }
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

  // Determine operation type from operationId prefix
  const operationType: OperationType | null = operationId
    ? operationId.startsWith('translate-')
      ? 'translation'
      : operationId.startsWith('transcribe-')
        ? 'transcription'
        : operationId.startsWith('dub-')
          ? 'dubbing'
          : null
    : null;

  // Show credit balance for AI operations
  const shouldShowCreditBalance = operationType !== null;

  return (
    <div className={progressContainerStyles}>
      <div className={headerStyles}>
        <div
          className={css`
            display: flex;
            align-items: center;
            gap: 15px;
          `}
        >
          <h3>{title}</h3>
          {shouldShowCreditBalance && operationType && (
            <CreditBalance
              operationType={operationType}
              suffixText={suffixText}
            />
          )}
        </div>
        <button
          className={closeButtonStyles}
          onClick={handleCloseOrCancelClick}
          disabled={isCancelling}
          aria-label="Close or cancel process"
        >
          {isCancelling ? '...' : '×'}
        </button>
      </div>
      <div className={progressBlockStyles}>
        <div className={progressLabelStyles}>
          <span>{stage}</span>
          {progress > 0 && <span>{progress.toFixed(1)}%</span>}
        </div>
        {subLabel && (
          <div
            className={css`
              margin-top: 4px;
              margin-bottom: 6px;
              font-size: 0.85rem;
              color: ${colors.grayDark};
            `}
          >
            {subLabel}
          </div>
        )}
        <div className={progressBarContainerStyles}>
          <div
            className={css`
              height: 100%;
              width: ${Math.min(progress, 100)}%;
              background-color: ${progressBarColor};
              border-radius: 10px;
              transition: width 0.3s ease;
            `}
          />
        </div>
      </div>
    </div>
  );
}
