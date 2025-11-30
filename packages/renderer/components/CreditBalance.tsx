import { css } from '@emotion/css';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreditStore, useTaskStore } from '../state';
import { useAiStore } from '../state';
import { colors } from '../styles';

const creditBalanceContainer = css`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid ${colors.primary}33;
  border-radius: 20px;
  font-size: 0.85rem;
  color: ${colors.primary};
  cursor: default;
`;

const creditIcon = css`
  width: 16px;
  height: 16px;
  opacity: 0.8;
`;

const creditText = css`
  font-weight: 500;
  white-space: nowrap;
`;

const modelSubtext = css`
  font-size: 0.75rem;
  color: ${colors.textDim};
  white-space: nowrap;
  margin-left: 4px;
`;

const loadingText = css`
  color: ${colors.textDim};
  font-style: italic;
`;

const errorText = css`
  color: ${colors.danger};
  font-size: 0.8rem;
`;

export type OperationType =
  | 'transcription'
  | 'translation'
  | 'dubbing'
  | 'general';

interface CreditBalanceProps {
  // Optional suffix shown inside the pill, e.g. "(6h)"
  suffixText?: ReactNode;
  // Operation type to determine context-aware provider display
  operationType?: OperationType;
}

/**
 * Determine what provider is being used for a specific operation type.
 * Returns: 'credits' | 'openai' | 'anthropic' | 'elevenlabs' | 'mixed'
 */
function useActiveProvider(
  operationType: OperationType
): 'credits' | 'openai' | 'anthropic' | 'elevenlabs' | 'mixed' {
  const useByoMaster = useAiStore(s => s.useByoMaster);

  // OpenAI
  const byoUnlocked = useAiStore(s => s.byoUnlocked);
  const useByo = useAiStore(s => s.useByo);
  const keyPresent = useAiStore(s => s.keyPresent);
  const hasOpenAi = byoUnlocked && useByoMaster && useByo && keyPresent;

  // Anthropic
  const byoAnthropicUnlocked = useAiStore(s => s.byoAnthropicUnlocked);
  const useByoAnthropic = useAiStore(s => s.useByoAnthropic);
  const anthropicKeyPresent = useAiStore(s => s.anthropicKeyPresent);
  const hasAnthropic =
    byoAnthropicUnlocked &&
    useByoMaster &&
    useByoAnthropic &&
    anthropicKeyPresent;

  // ElevenLabs
  const byoElevenLabsUnlocked = useAiStore(s => s.byoElevenLabsUnlocked);
  const useByoElevenLabs = useAiStore(s => s.useByoElevenLabs);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);
  const hasElevenLabs =
    byoElevenLabsUnlocked &&
    useByoMaster &&
    useByoElevenLabs &&
    elevenLabsKeyPresent;

  // User preferences
  const preferClaudeTranslation = useAiStore(s => s.preferClaudeTranslation);
  const preferredTranscriptionProvider = useAiStore(
    s => s.preferredTranscriptionProvider
  );
  const preferredDubbingProvider = useAiStore(s => s.preferredDubbingProvider);

  // If master toggle is off, always show credits
  if (!useByoMaster) {
    return 'credits';
  }

  switch (operationType) {
    case 'transcription': {
      // Check user's transcription provider preference
      if (preferredTranscriptionProvider === 'stage5') {
        return 'credits';
      }
      if (preferredTranscriptionProvider === 'elevenlabs' && hasElevenLabs) {
        return 'elevenlabs';
      }
      if (preferredTranscriptionProvider === 'openai' && hasOpenAi) {
        return 'openai';
      }
      // Fallback logic: ElevenLabs > OpenAI > Stage5
      if (hasElevenLabs) return 'elevenlabs';
      if (hasOpenAi) return 'openai';
      return 'credits';
    }

    case 'translation': {
      // Translation uses draft model (GPT or Sonnet) + review model (Opus or GPT)
      // Draft logic (matches translator.ts getDraftModel):
      //   1. If preferClaudeTranslation && hasAnthropic → Sonnet
      //   2. Else if hasOpenAi → GPT
      //   3. Else if hasAnthropic (no OpenAI) → Sonnet (fallback to available provider)
      //   4. Else → GPT via Stage5
      // Review: If hasAnthropic → Opus, else GPT enhanced
      let draftUsesAnthropic = false;
      let draftUsesOpenAi = false;
      if (preferClaudeTranslation && hasAnthropic) {
        draftUsesAnthropic = true;
      } else if (hasOpenAi) {
        draftUsesOpenAi = true;
      } else if (hasAnthropic) {
        // Fallback: if only Anthropic available, use it regardless of preference
        draftUsesAnthropic = true;
      }
      const draftUsesByo = draftUsesAnthropic || draftUsesOpenAi;

      const reviewUsesAnthropic = hasAnthropic;
      const reviewUsesOpenAi = !reviewUsesAnthropic && hasOpenAi;
      const reviewUsesByo = reviewUsesAnthropic || reviewUsesOpenAi;

      // If both phases use BYO (same or different providers)
      if (draftUsesByo && reviewUsesByo) {
        // If both use Anthropic, show Anthropic
        if (draftUsesAnthropic && reviewUsesAnthropic) return 'anthropic';
        // If both use OpenAI, show OpenAI
        if (draftUsesOpenAi && reviewUsesOpenAi) return 'openai';
        // Mixed providers
        return 'mixed';
      }
      // If either phase uses Stage5
      if (!draftUsesByo || !reviewUsesByo) {
        // Partial BYO - show mixed to indicate not purely credits
        if (draftUsesByo || reviewUsesByo) return 'mixed';
        return 'credits';
      }
      return 'credits';
    }

    case 'dubbing': {
      // Check user's dubbing provider preference
      if (preferredDubbingProvider === 'stage5') {
        return 'credits';
      }
      if (preferredDubbingProvider === 'elevenlabs' && hasElevenLabs) {
        return 'elevenlabs';
      }
      if (preferredDubbingProvider === 'openai' && hasOpenAi) {
        return 'openai';
      }
      // Fallback logic: ElevenLabs > OpenAI > Stage5
      if (hasElevenLabs) return 'elevenlabs';
      if (hasOpenAi) return 'openai';
      return 'credits';
    }

    case 'general':
    default: {
      // For header/general display, show API key if any BYO is active
      if (hasOpenAi || hasAnthropic || hasElevenLabs) {
        return 'mixed'; // Generic "using API keys"
      }
      return 'credits';
    }
  }
}

export default function CreditBalance({
  suffixText,
  operationType = 'general',
}: CreditBalanceProps) {
  const { t } = useTranslation();
  const { credits, hours, loading, error, checkoutPending } = useCreditStore();

  // Check if dubbing is in progress and get the model being used
  const dubbingInProgress = useTaskStore(s => s.dubbing.inProgress);
  const dubbingModel = useTaskStore(s => s.dubbing.model);

  // Check if translation is in progress and get the model being used
  const translationInProgress = useTaskStore(s => s.translation.inProgress);
  const translationModel = useTaskStore(s => s.translation.model);

  const activeProvider = useActiveProvider(operationType);

  // Model info is now shown in progress stage text, not in the credit badge
  // Keep these variables for potential future use but don't display in badge
  void dubbingInProgress;
  void dubbingModel;
  void translationInProgress;
  void translationModel;

  // Show provider-specific badge for BYO usage
  if (activeProvider !== 'credits') {
    let badgeText: string;
    switch (activeProvider) {
      case 'openai':
        badgeText = t('credits.usingOpenAi', 'Using OpenAI');
        break;
      case 'anthropic':
        badgeText = t('credits.usingAnthropic', 'Using Claude');
        break;
      case 'elevenlabs':
        badgeText = t('credits.usingElevenLabs', 'Using ElevenLabs');
        break;
      case 'mixed':
      default:
        badgeText = t('credits.usingApiKey', 'Using API Keys');
        break;
    }

    return (
      <div className={creditBalanceContainer}>
        <span className={creditText}>🔑 {badgeText}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={creditBalanceContainer}>
        <span className={loadingText}>⏳ {t('credits.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={creditBalanceContainer}>
        <span className={errorText}>⚠️ {t('common.error.unexpected')}</span>
      </div>
    );
  }

  if (checkoutPending) {
    return (
      <div className={creditBalanceContainer}>
        <span className={creditText}>
          🔄 {t('credits.redirectingToPayment', 'Opening secure checkout…')}
        </span>
      </div>
    );
  }

  if (credits !== null && hours !== null) {
    // Hide component completely when credits are 0
    if (credits === 0) {
      return null;
    }

    // Normal display for credits > 0
    return (
      <div className={creditBalanceContainer}>
        <svg
          className={creditIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span className={creditText}>{credits.toLocaleString()}</span>
        {suffixText && (
          <span
            className={css`
              color: ${colors.textDim};
              font-weight: 400;
              font-size: 0.85rem;
            `}
          >
            {suffixText}
          </span>
        )}
      </div>
    );
  }

  return null;
}
