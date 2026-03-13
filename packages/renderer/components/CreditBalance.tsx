import { css, cx } from '@emotion/css';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreditStore, useTaskStore } from '../state';
import { useAiStore } from '../state';
import { colors, metaPillStyles } from '../styles';
import {
  hasAnthropicByoAvailable,
  hasElevenLabsByoAvailable,
  hasOpenAiByoAvailable,
  resolveDubbingProvider,
  resolveTranscriptionProvider,
  resolveTranslationDraftProvider,
  resolveTranslationReviewProvider,
  type ByoRuntimeState,
} from '../state/byo-runtime';

const creditBalanceContainer = css`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 0.85rem;
  color: ${colors.primaryLight};
  cursor: default;
`;

const creditIcon = css`
  width: 16px;
  height: 16px;
  opacity: 0.88;
`;

const creditText = css`
  font-weight: 500;
  white-space: nowrap;
`;

const loadingText = css`
  color: ${colors.textDim};
  font-style: italic;
`;

const errorText = css`
  color: ${colors.danger};
  font-size: 0.8rem;
`;

const providerPillStyles = css`
  color: ${colors.primaryLight};
`;

const checkoutTextStyles = css`
  color: ${colors.primaryLight};
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
  const useApiKeysMode = useAiStore(s => s.useApiKeysMode);
  const byoUnlocked = useAiStore(s => s.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(s => s.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(s => s.byoElevenLabsUnlocked);
  const stage5AnthropicReviewAvailable = useAiStore(
    s => s.stage5AnthropicReviewAvailable
  );
  const useByo = useAiStore(s => s.useByo);
  const keyPresent = useAiStore(s => s.keyPresent);
  const useByoAnthropic = useAiStore(s => s.useByoAnthropic);
  const anthropicKeyPresent = useAiStore(s => s.anthropicKeyPresent);
  const useByoElevenLabs = useAiStore(s => s.useByoElevenLabs);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);
  const preferClaudeTranslation = useAiStore(s => s.preferClaudeTranslation);
  const preferClaudeReview = useAiStore(s => s.preferClaudeReview);
  const preferClaudeSummary = useAiStore(s => s.preferClaudeSummary);
  const preferredTranscriptionProvider = useAiStore(
    s => s.preferredTranscriptionProvider
  );
  const preferredDubbingProvider = useAiStore(s => s.preferredDubbingProvider);
  const stage5DubbingTtsProvider = useAiStore(s => s.stage5DubbingTtsProvider);

  const runtimeState = useMemo<ByoRuntimeState>(
    () => ({
      useApiKeysMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      byoElevenLabsUnlocked,
      stage5AnthropicReviewAvailable,
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
      useApiKeysMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      byoElevenLabsUnlocked,
      stage5AnthropicReviewAvailable,
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

  switch (operationType) {
    case 'transcription': {
      const provider = resolveTranscriptionProvider(runtimeState);
      return provider === 'stage5' ? 'credits' : provider;
    }

    case 'translation': {
      const draftProvider = resolveTranslationDraftProvider(runtimeState);
      const reviewProvider = resolveTranslationReviewProvider(runtimeState);
      if (draftProvider === 'stage5' && reviewProvider === 'stage5') {
        return 'credits';
      }
      if (draftProvider === reviewProvider && draftProvider !== 'stage5') {
        return draftProvider;
      }
      return 'mixed';
    }

    case 'dubbing': {
      const provider = resolveDubbingProvider(runtimeState);
      return provider === 'stage5' ? 'credits' : provider;
    }

    case 'general':
    default: {
      const activeProviders = [
        hasOpenAiByoAvailable(runtimeState) ? 'openai' : null,
        hasAnthropicByoAvailable(runtimeState) ? 'anthropic' : null,
        hasElevenLabsByoAvailable(runtimeState) ? 'elevenlabs' : null,
      ].filter(Boolean) as Array<'openai' | 'anthropic' | 'elevenlabs'>;

      if (activeProviders.length === 0) {
        return 'credits';
      }
      if (activeProviders.length === 1) {
        return activeProviders[0];
      }
      return 'mixed';
    }
  }
}

export default function CreditBalance({
  suffixText,
  operationType = 'general',
}: CreditBalanceProps) {
  const { t } = useTranslation();
  const credits = useCreditStore(s => s.credits);
  const hours = useCreditStore(s => s.hours);
  const loading = useCreditStore(s => s.loading);
  const error = useCreditStore(s => s.error);
  const checkoutPending = useCreditStore(s => s.checkoutPending);

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
      <div className={cx(metaPillStyles, creditBalanceContainer, providerPillStyles)}>
        <span className={creditText}>{badgeText}</span>
        {suffixText && (
          <span
            className={css`
              color: ${colors.textDim};
              font-weight: 400;
              font-size: 0.8rem;
            `}
          >
            {suffixText}
          </span>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cx(metaPillStyles, creditBalanceContainer)}>
        <span className={loadingText}>{t('credits.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cx(metaPillStyles, creditBalanceContainer)}>
        <span className={errorText}>{t('common.error.unexpected')}</span>
      </div>
    );
  }

  if (checkoutPending) {
    return (
      <div className={cx(metaPillStyles, creditBalanceContainer)}>
        <span className={cx(creditText, checkoutTextStyles)}>
          {t('credits.redirectingToPayment', 'Opening secure checkout…')}
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
      <div className={cx(metaPillStyles, creditBalanceContainer)}>
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
              font-size: 0.8rem;
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
