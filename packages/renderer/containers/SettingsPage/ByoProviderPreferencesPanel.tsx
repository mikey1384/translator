import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, type ReactNode } from 'react';
import type { VideoSuggestionModelPreference } from '@shared-types/app';
import {
  AI_MODEL_DISPLAY_NAMES,
  AI_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
} from '../../../shared/constants';
import { resolveEffectiveVideoSuggestionModel } from '../../../shared/helpers/video-suggestion-model-preference';
import { colors } from '../../styles';
import { useAiStore } from '../../state';
import { useUIStore } from '../../state/ui-store';
import {
  hasAnthropicByoConfigured,
  hasElevenLabsByoConfigured,
  hasOpenAiByoConfigured,
  resolveDubbingProvider,
  resolveTranscriptionProvider,
  resolveTranslationDraftModel,
  resolveTranslationDraftProvider,
  resolveTranslationReviewModel,
  type ByoRuntimeState,
  type RuntimeProvider,
} from '../../state/byo-runtime';
import { BYO_PROVIDERS } from './byo-provider-config';
import {
  byoSidebarCardStyles,
  settingsCardTitleStyles,
  settingsMetaTextStyles,
} from './styles';

type DirectVideoSuggestionModelPreference = Exclude<
  VideoSuggestionModelPreference,
  'default' | 'quality'
>;

const sectionTitle = css`
  font-size: 0.85rem;
  font-weight: 500;
  color: ${colors.text};
`;

const sectionTitleWithChoiceStyles = css`
  margin-bottom: 8px;
`;

const sectionTitleStaticStyles = css`
  margin-bottom: 4px;
`;

const optionListStyles = css`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const radioLabel = css`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 4px;
  box-sizing: border-box;
  min-width: 0;
`;

const radioLabelDisabled = css`
  opacity: 0.55;
  cursor: not-allowed;
`;

const radioLabelSelected = css`
  background: rgba(67, 97, 238, 0.1);
`;

const infoText = css`
  font-size: 0.85rem;
  color: ${colors.textDim};
  padding-left: 4px;
`;

const radioInputStyles = css`
  accent-color: ${colors.primary};
`;

const optionLabelTextStyles = css`
  display: block;
  min-width: 0;
  font-size: 0.85rem;
  color: ${colors.text};
  overflow-wrap: anywhere;
`;

const optionLabelTextDisabledStyles = css`
  color: ${colors.textDim};
`;

const priceText = css`
  display: inline-block;
  color: ${colors.textDim};
  margin-left: 6px;
  overflow-wrap: anywhere;
`;

const panelDenseGapStyles = css`
  gap: 12px;
`;

const panelRelaxedGapStyles = css`
  gap: 16px;
`;

interface PreferenceRowProps {
  title: string;
  hasChoice: boolean;
  radioName: string;
  options: Array<{
    value: string;
    label: string;
    price?: string;
    selected: boolean;
    disabled?: boolean;
    disabledReason?: string;
    onSelect: () => void;
  }>;
  infoProvider?: {
    label: string;
    price?: string;
  };
  footer?: ReactNode;
}

function PreferenceRow({
  title,
  hasChoice,
  radioName,
  options,
  infoProvider,
  footer,
}: PreferenceRowProps) {
  return (
    <div>
      <div
        className={cx(
          sectionTitle,
          hasChoice ? sectionTitleWithChoiceStyles : sectionTitleStaticStyles
        )}
      >
        {title}
      </div>
      {hasChoice ? (
        <div className={optionListStyles}>
          {options.map(opt => (
            <label
              key={opt.value}
              className={`${radioLabel} ${opt.selected ? radioLabelSelected : ''} ${
                opt.disabled ? radioLabelDisabled : ''
              }`}
              title={opt.disabled ? opt.disabledReason : undefined}
            >
              <input
                type="radio"
                name={radioName}
                checked={opt.selected}
                disabled={opt.disabled}
                onChange={opt.onSelect}
                className={radioInputStyles}
              />
              <span
                className={cx(
                  optionLabelTextStyles,
                  opt.disabled && optionLabelTextDisabledStyles
                )}
              >
                {opt.label}
                {opt.price ? (
                  <span className={priceText}>{opt.price}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      ) : (
        infoProvider && (
          <div className={infoText}>
            {infoProvider.label}
            {infoProvider.price ? (
              <span className={priceText}>{infoProvider.price}</span>
            ) : null}
          </div>
        )
      )}
      {footer ? <div className={infoText}>{footer}</div> : null}
    </div>
  );
}

function getProviderInfo(
  translate: (key: string, fallback: string) => unknown,
  provider: RuntimeProvider,
  options: Partial<
    Record<
      Exclude<RuntimeProvider, 'stage5'>,
      { labelKey: string; fallback: string; price: string }
    >
  >
) {
  if (provider === 'stage5') {
    return {
      label: String(
        translate('settings.byoPreferences.stage5Credits', 'Stage5 credits')
      ),
      price: '',
    };
  }

  const option = options[provider];
  if (!option) {
    return {
      label: String(
        translate('settings.byoPreferences.stage5Credits', 'Stage5 credits')
      ),
      price: '',
    };
  }

  return {
    label: String(translate(option.labelKey, option.fallback)),
    price: option.price,
  };
}

export default function ByoProviderPreferencesPanel() {
  const { t } = useTranslation();

  const keyPresent = useAiStore(state => state.keyPresent);
  const anthropicKeyPresent = useAiStore(state => state.anthropicKeyPresent);
  const elevenLabsKeyPresent = useAiStore(state => state.elevenLabsKeyPresent);
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(state => state.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(
    state => state.byoElevenLabsUnlocked
  );
  const useStrictByoMode = useAiStore(state => state.useStrictByoMode);
  const useByo = useAiStore(state => state.useByo);
  const useByoAnthropic = useAiStore(state => state.useByoAnthropic);
  const useByoElevenLabs = useAiStore(state => state.useByoElevenLabs);

  const preferredTranscriptionProvider = useAiStore(
    state => state.preferredTranscriptionProvider
  );
  const setPreferredTranscriptionProvider = useAiStore(
    state => state.setPreferredTranscriptionProvider
  );
  const preferredDubbingProvider = useAiStore(
    state => state.preferredDubbingProvider
  );
  const setPreferredDubbingProvider = useAiStore(
    state => state.setPreferredDubbingProvider
  );
  const preferClaudeTranslation = useAiStore(
    state => state.preferClaudeTranslation
  );
  const setPreferClaudeTranslation = useAiStore(
    state => state.setPreferClaudeTranslation
  );
  const preferClaudeReview = useAiStore(state => state.preferClaudeReview);
  const setPreferClaudeReview = useAiStore(
    state => state.setPreferClaudeReview
  );
  const preferClaudeSummary = useAiStore(state => state.preferClaudeSummary);
  const setPreferClaudeSummary = useAiStore(
    state => state.setPreferClaudeSummary
  );
  const qualityTranslation = useUIStore(state => state.qualityTranslation);
  const setQualityTranslation = useUIStore(
    state => state.setQualityTranslation
  );
  const summaryEffortLevel = useUIStore(state => state.summaryEffortLevel);
  const setSummaryEffortLevel = useUIStore(
    state => state.setSummaryEffortLevel
  );
  const videoSuggestionModelPreference = useAiStore(
    state => state.videoSuggestionModelPreference
  );
  const setVideoSuggestionModelPreference = useAiStore(
    state => state.setVideoSuggestionModelPreference
  );
  const stage5DubbingTtsProvider = useAiStore(
    state => state.stage5DubbingTtsProvider
  );

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

  const hasOpenAiConfigured = hasOpenAiByoConfigured(runtimeState);
  const hasAnthropicConfigured = hasAnthropicByoConfigured(runtimeState);
  const hasElevenLabsConfigured = hasElevenLabsByoConfigured(runtimeState);

  const showStackPanel =
    hasOpenAiConfigured || hasAnthropicConfigured || hasElevenLabsConfigured;
  const showTranscriptionRow = hasOpenAiConfigured || hasElevenLabsConfigured;
  const showTranslationRows = hasOpenAiConfigured || hasAnthropicConfigured;
  const showDubbingRow = hasOpenAiConfigured || hasElevenLabsConfigured;
  const showVideoSuggestionRow = hasOpenAiConfigured || hasAnthropicConfigured;
  const hasTranscriptionChoice = hasOpenAiConfigured && hasElevenLabsConfigured;
  const hasTranslationChoice = hasOpenAiConfigured && hasAnthropicConfigured;
  const hasReviewChoice = showTranslationRows;
  const hasSummaryChoice = showTranslationRows;
  const hasDubbingChoice = hasOpenAiConfigured && hasElevenLabsConfigured;
  const canUseOpenAiVideoSuggestionModel = hasOpenAiConfigured;
  const canUseAnthropicVideoSuggestionModel = hasAnthropicConfigured;
  const hasVideoSuggestionChoice =
    canUseOpenAiVideoSuggestionModel || canUseAnthropicVideoSuggestionModel;
  const hasProviderChoice =
    hasTranscriptionChoice ||
    hasTranslationChoice ||
    hasReviewChoice ||
    hasSummaryChoice ||
    hasDubbingChoice ||
    hasVideoSuggestionChoice;

  const transcriptionProvider = resolveTranscriptionProvider(runtimeState);
  const translationDraftModel = resolveTranslationDraftModel(runtimeState);
  const translationDraftProvider =
    resolveTranslationDraftProvider(runtimeState);
  const translationReviewModel =
    resolveTranslationReviewModel(runtimeState).model;
  const dubbingProvider = resolveDubbingProvider(runtimeState);
  const resolvedVideoSuggestionModel = useMemo(
    () =>
      resolveEffectiveVideoSuggestionModel({
        preference: videoSuggestionModelPreference,
        strictByoModeEnabled: useStrictByoMode,
        translationDraftModel,
        translationReviewModel,
        availableByoModels: [
          canUseOpenAiVideoSuggestionModel ? AI_MODELS.GPT : null,
          canUseOpenAiVideoSuggestionModel
            ? STAGE5_REVIEW_TRANSLATION_MODEL
            : null,
          canUseAnthropicVideoSuggestionModel ? AI_MODELS.CLAUDE_SONNET : null,
          canUseAnthropicVideoSuggestionModel ? AI_MODELS.CLAUDE_OPUS : null,
        ],
      }),
    [
      canUseAnthropicVideoSuggestionModel,
      canUseOpenAiVideoSuggestionModel,
      translationDraftModel,
      translationReviewModel,
      useStrictByoMode,
      videoSuggestionModelPreference,
    ]
  );
  const selectedVideoSuggestionModel =
    videoSuggestionModelPreference === 'default' ||
    videoSuggestionModelPreference === 'quality'
      ? resolvedVideoSuggestionModel
      : videoSuggestionModelPreference;
  const videoSuggestionUsesDirectGpt =
    selectedVideoSuggestionModel === AI_MODELS.GPT;
  const videoSuggestionUsesDirectGpt54 =
    selectedVideoSuggestionModel === STAGE5_REVIEW_TRANSLATION_MODEL;
  const videoSuggestionUsesSonnet =
    selectedVideoSuggestionModel === AI_MODELS.CLAUDE_SONNET;
  const videoSuggestionUsesOpus =
    selectedVideoSuggestionModel === AI_MODELS.CLAUDE_OPUS;
  const showVideoSuggestionRuntimeHint =
    !useStrictByoMode &&
    videoSuggestionModelPreference !== resolvedVideoSuggestionModel;
  const videoSuggestionRuntimeHint = showVideoSuggestionRuntimeHint
    ? `${String(
        t('settings.byoPreferences.stage5Credits', 'Stage5 credits')
      )} • ${
        AI_MODEL_DISPLAY_NAMES[resolvedVideoSuggestionModel] ??
        resolvedVideoSuggestionModel
      }`
    : null;

  const handleTranscriptionProviderChange = async (
    provider: 'elevenlabs' | 'openai'
  ) => {
    const result = await setPreferredTranscriptionProvider(provider);
    if (!result.success) {
      console.error('Failed to update transcription provider:', result.error);
    }
  };

  const handleDubbingProviderChange = async (
    provider: 'elevenlabs' | 'openai'
  ) => {
    const result = await setPreferredDubbingProvider(provider);
    if (!result.success) {
      console.error('Failed to update dubbing provider:', result.error);
    }
  };

  const handleTranslationProviderChange = async (value: boolean) => {
    const result = await setPreferClaudeTranslation(value);
    if (!result.success) {
      console.error('Failed to update translation provider:', result.error);
    }
  };

  const handleReviewProviderChange = async (value: boolean) => {
    const result = await setPreferClaudeReview(value);
    if (!result.success) {
      console.error('Failed to update review provider:', result.error);
    }
  };

  const handleReviewModeChange = async (
    value: 'off' | 'openai' | 'anthropic'
  ) => {
    if (value === 'off') {
      setQualityTranslation(false);
      return;
    }

    setQualityTranslation(true);
    await handleReviewProviderChange(value === 'anthropic');
  };

  const handleSummaryProviderChange = async (value: boolean) => {
    const result = await setPreferClaudeSummary(value);
    if (!result.success) {
      console.error('Failed to update summary provider:', result.error);
    }
  };

  const handleSummaryModeChange = async (
    provider: 'openai' | 'anthropic',
    effort: 'standard' | 'high'
  ) => {
    setSummaryEffortLevel(effort);
    await handleSummaryProviderChange(provider === 'anthropic');
  };

  const handleVideoSuggestionModelChange = async (
    value: DirectVideoSuggestionModelPreference
  ) => {
    const result = await setVideoSuggestionModelPreference(value);
    if (!result.success) {
      console.error(
        'Failed to update video suggestion model preference:',
        result.error
      );
    }
  };

  useEffect(() => {
    if (!useStrictByoMode) return;
    if (
      videoSuggestionModelPreference === 'default' ||
      videoSuggestionModelPreference === 'quality'
    ) {
      return;
    }
    if (videoSuggestionModelPreference === resolvedVideoSuggestionModel) return;

    void (async () => {
      const result = await setVideoSuggestionModelPreference(
        resolvedVideoSuggestionModel
      );
      if (!result.success) {
        console.error(
          'Failed to coerce unsupported video suggestion model preference:',
          result.error
        );
      }
    })();
  }, [
    resolvedVideoSuggestionModel,
    setVideoSuggestionModelPreference,
    useStrictByoMode,
    videoSuggestionModelPreference,
  ]);

  if (!showStackPanel) return null;

  return (
    <div
      className={cx(
        byoSidebarCardStyles,
        hasProviderChoice ? panelRelaxedGapStyles : panelDenseGapStyles
      )}
    >
      <h3 className={settingsCardTitleStyles}>
        {hasProviderChoice
          ? t('settings.byoPreferences.title', 'Provider Preferences')
          : t('settings.byoStack.title', 'Your AI Stack')}
      </h3>
      <p className={settingsMetaTextStyles}>
        {t(
          'settings.byoPreferences.pricingHintHeuristic',
          'Estimated cost using current app heuristics'
        )}
      </p>

      {showTranscriptionRow && (
        <PreferenceRow
          title={t('settings.byoPreferences.transcription', 'Transcription')}
          hasChoice={hasTranscriptionChoice}
          radioName="transcriptionProvider"
          options={[
            {
              value: 'openai',
              label: t(
                BYO_PROVIDERS.transcription.openai.labelKey,
                BYO_PROVIDERS.transcription.openai.fallback
              ),
              price: BYO_PROVIDERS.transcription.openai.price,
              selected: preferredTranscriptionProvider === 'openai',
              onSelect: () => handleTranscriptionProviderChange('openai'),
            },
            {
              value: 'elevenlabs',
              label: t(
                BYO_PROVIDERS.transcription.elevenlabs.labelKey,
                BYO_PROVIDERS.transcription.elevenlabs.fallback
              ),
              price: BYO_PROVIDERS.transcription.elevenlabs.price,
              selected: preferredTranscriptionProvider === 'elevenlabs',
              onSelect: () => handleTranscriptionProviderChange('elevenlabs'),
            },
          ]}
          infoProvider={getProviderInfo(t, transcriptionProvider, {
            openai: BYO_PROVIDERS.transcription.openai,
            elevenlabs: BYO_PROVIDERS.transcription.elevenlabs,
          })}
        />
      )}

      {showTranslationRows && (
        <PreferenceRow
          title={t(
            'settings.byoPreferences.translationDraft',
            'Translation (Draft)'
          )}
          hasChoice={hasTranslationChoice}
          radioName="translationProvider"
          options={[
            {
              value: 'openai',
              label: t(
                BYO_PROVIDERS.translationDraft.openai.labelKey,
                BYO_PROVIDERS.translationDraft.openai.fallback
              ),
              price: BYO_PROVIDERS.translationDraft.openai.price,
              selected: !preferClaudeTranslation,
              onSelect: () => handleTranslationProviderChange(false),
            },
            {
              value: 'anthropic',
              label: t(
                BYO_PROVIDERS.translationDraft.anthropic.labelKey,
                BYO_PROVIDERS.translationDraft.anthropic.fallback
              ),
              price: BYO_PROVIDERS.translationDraft.anthropic.price,
              selected: preferClaudeTranslation,
              onSelect: () => handleTranslationProviderChange(true),
            },
          ]}
          infoProvider={getProviderInfo(t, translationDraftProvider, {
            openai: BYO_PROVIDERS.translationDraft.openai,
            anthropic: BYO_PROVIDERS.translationDraft.anthropic,
          })}
        />
      )}

      {showTranslationRows && (
        <PreferenceRow
          title={t('settings.byoPreferences.reviewPass', 'Review Pass')}
          hasChoice={hasReviewChoice}
          radioName="reviewPass"
          options={[
            {
              value: 'off',
              label: t('settings.byoPreferences.off', 'Off'),
              selected: !qualityTranslation,
              onSelect: () => void handleReviewModeChange('off'),
            },
            {
              value: 'openai',
              label: t(
                BYO_PROVIDERS.review.openai.labelKey,
                BYO_PROVIDERS.review.openai.fallback
              ),
              price: BYO_PROVIDERS.review.openai.price,
              selected: qualityTranslation && !preferClaudeReview,
              disabled: !hasOpenAiConfigured,
              disabledReason: t(
                'settings.byoPreferences.reviewRequiresOpenAi',
                'Requires OpenAI BYO unlock and key.'
              ),
              onSelect: () => void handleReviewModeChange('openai'),
            },
            {
              value: 'anthropic',
              label: t(
                BYO_PROVIDERS.review.anthropic.labelKey,
                BYO_PROVIDERS.review.anthropic.fallback
              ),
              price: BYO_PROVIDERS.review.anthropic.price,
              selected: qualityTranslation && preferClaudeReview,
              disabled: !hasAnthropicConfigured,
              disabledReason: t(
                'settings.byoPreferences.reviewRequiresAnthropic',
                'Requires Anthropic BYO unlock and key.'
              ),
              onSelect: () => void handleReviewModeChange('anthropic'),
            },
          ]}
        />
      )}

      {showTranslationRows && (
        <PreferenceRow
          title={t('settings.byoPreferences.summary', 'Summary')}
          hasChoice={hasSummaryChoice}
          radioName="summaryMode"
          options={[
            {
              value: 'openai-standard',
              label: t(
                BYO_PROVIDERS.summary.standard.openai.labelKey,
                BYO_PROVIDERS.summary.standard.openai.fallback
              ),
              price: BYO_PROVIDERS.summary.standard.openai.price,
              selected: summaryEffortLevel !== 'high' && !preferClaudeSummary,
              disabled: !hasOpenAiConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresOpenAi',
                'Requires OpenAI BYO unlock and key.'
              ),
              onSelect: () =>
                void handleSummaryModeChange('openai', 'standard'),
            },
            {
              value: 'anthropic-standard',
              label: t(
                BYO_PROVIDERS.summary.standard.anthropic.labelKey,
                BYO_PROVIDERS.summary.standard.anthropic.fallback
              ),
              price: BYO_PROVIDERS.summary.standard.anthropic.price,
              selected: summaryEffortLevel !== 'high' && preferClaudeSummary,
              disabled: !hasAnthropicConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresAnthropic',
                'Requires Anthropic BYO unlock and key.'
              ),
              onSelect: () =>
                void handleSummaryModeChange('anthropic', 'standard'),
            },
            {
              value: 'openai-high',
              label: t(
                BYO_PROVIDERS.summary.high.openai.labelKey,
                BYO_PROVIDERS.summary.high.openai.fallback
              ),
              price: BYO_PROVIDERS.summary.high.openai.price,
              selected: summaryEffortLevel === 'high' && !preferClaudeSummary,
              disabled: !hasOpenAiConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresOpenAi',
                'Requires OpenAI BYO unlock and key.'
              ),
              onSelect: () => void handleSummaryModeChange('openai', 'high'),
            },
            {
              value: 'anthropic-high',
              label: t(
                BYO_PROVIDERS.summary.high.anthropic.labelKey,
                BYO_PROVIDERS.summary.high.anthropic.fallback
              ),
              price: BYO_PROVIDERS.summary.high.anthropic.price,
              selected: summaryEffortLevel === 'high' && preferClaudeSummary,
              disabled: !hasAnthropicConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresAnthropic',
                'Requires Anthropic BYO unlock and key.'
              ),
              onSelect: () => void handleSummaryModeChange('anthropic', 'high'),
            },
          ]}
        />
      )}

      {showDubbingRow && (
        <PreferenceRow
          title={t('settings.byoPreferences.dubbing', 'Dubbing')}
          hasChoice={hasDubbingChoice}
          radioName="dubbingProvider"
          options={[
            {
              value: 'openai',
              label: t(
                BYO_PROVIDERS.dubbing.openai.labelKey,
                BYO_PROVIDERS.dubbing.openai.fallback
              ),
              price: BYO_PROVIDERS.dubbing.openai.price,
              selected: preferredDubbingProvider === 'openai',
              onSelect: () => handleDubbingProviderChange('openai'),
            },
            {
              value: 'elevenlabs',
              label: t(
                BYO_PROVIDERS.dubbing.elevenlabs.labelKey,
                BYO_PROVIDERS.dubbing.elevenlabs.fallback
              ),
              price: BYO_PROVIDERS.dubbing.elevenlabs.price,
              selected: preferredDubbingProvider === 'elevenlabs',
              onSelect: () => handleDubbingProviderChange('elevenlabs'),
            },
          ]}
          infoProvider={getProviderInfo(t, dubbingProvider, {
            openai: BYO_PROVIDERS.dubbing.openai,
            elevenlabs: BYO_PROVIDERS.dubbing.elevenlabs,
          })}
        />
      )}

      {showVideoSuggestionRow && (
        <PreferenceRow
          title={t(
            'settings.performanceQuality.videoSuggestionModel.label',
            'Video Recommendation Model'
          )}
          hasChoice={hasVideoSuggestionChoice}
          radioName="videoSuggestionModel"
          options={[
            {
              value: AI_MODELS.GPT,
              label: t(
                BYO_PROVIDERS.videoSuggestion.gpt.labelKey,
                BYO_PROVIDERS.videoSuggestion.gpt.fallback
              ),
              price: BYO_PROVIDERS.videoSuggestion.gpt.price,
              selected: videoSuggestionUsesDirectGpt,
              disabled: !canUseOpenAiVideoSuggestionModel,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresOpenAi',
                'Requires OpenAI BYO unlock, key, and toggle.'
              ),
              onSelect: () => handleVideoSuggestionModelChange(AI_MODELS.GPT),
            },
            {
              value: STAGE5_REVIEW_TRANSLATION_MODEL,
              label: t(
                BYO_PROVIDERS.videoSuggestion.gptHigh.labelKey,
                BYO_PROVIDERS.videoSuggestion.gptHigh.fallback
              ),
              price: BYO_PROVIDERS.videoSuggestion.gptHigh.price,
              selected: videoSuggestionUsesDirectGpt54,
              disabled: !canUseOpenAiVideoSuggestionModel,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresOpenAi',
                'Requires OpenAI BYO unlock, key, and toggle.'
              ),
              onSelect: () =>
                handleVideoSuggestionModelChange(
                  STAGE5_REVIEW_TRANSLATION_MODEL
                ),
            },
            {
              value: AI_MODELS.CLAUDE_SONNET,
              label: t(
                BYO_PROVIDERS.videoSuggestion.sonnet.labelKey,
                BYO_PROVIDERS.videoSuggestion.sonnet.fallback
              ),
              price: BYO_PROVIDERS.videoSuggestion.sonnet.price,
              selected: videoSuggestionUsesSonnet,
              disabled: !canUseAnthropicVideoSuggestionModel,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresAnthropic',
                'Requires Anthropic BYO unlock, key, and toggle.'
              ),
              onSelect: () =>
                handleVideoSuggestionModelChange(AI_MODELS.CLAUDE_SONNET),
            },
            {
              value: AI_MODELS.CLAUDE_OPUS,
              label: t(
                BYO_PROVIDERS.videoSuggestion.opus.labelKey,
                BYO_PROVIDERS.videoSuggestion.opus.fallback
              ),
              price: BYO_PROVIDERS.videoSuggestion.opus.price,
              selected: videoSuggestionUsesOpus,
              disabled: !canUseAnthropicVideoSuggestionModel,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresAnthropic',
                'Requires Anthropic BYO unlock, key, and toggle.'
              ),
              onSelect: () =>
                handleVideoSuggestionModelChange(AI_MODELS.CLAUDE_OPUS),
            },
          ]}
          infoProvider={{
            label: t(
              'settings.byoPreferences.videoSuggestionModelUnavailable',
              'No BYO video recommendation model is currently available. Enable OpenAI or Anthropic BYO for this feature.'
            ),
            price: '',
          }}
          footer={videoSuggestionRuntimeHint}
        />
      )}
    </div>
  );
}
