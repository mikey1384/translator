import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useCallback, useMemo, type ReactNode } from 'react';
import type {
  ByoGeminiDraftModel,
  ByoGeminiReviewModel,
  ByoGeminiSummaryModel,
  ByoTextProviderPreference,
  VideoSuggestionModelPreference,
} from '@shared-types/app';
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
  hasGeminiByoConfigured,
  hasOpenAiByoConfigured,
  resolveDubbingProvider,
  resolveEffectiveTranslationReviewModel,
  resolveTranscriptionProvider,
  resolveTranslationDraftModel,
  resolveTranslationDraftProvider,
  type ByoRuntimeState,
  type RuntimeProvider,
} from '../../state/byo-runtime';
import { BYO_PROVIDERS } from './byo-provider-config';
import {
  byoSidebarCardStyles,
  settingsCardTitleStyles,
  settingsMetaTextStyles,
} from './styles';
import { getReviewPassLabel, getReviewProviderLabel } from './utils';

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
  background: rgba(255, 216, 77, 0.1);
`;

const infoText = css`
  font-size: 0.85rem;
  color: ${colors.textDim};
  padding-inline-start: 4px;
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
  margin-inline-start: 6px;
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
        translate('settings.byoPreferences.stage5Credits', 'Stage5 minutes')
      ),
      price: '',
    };
  }

  const option = options[provider];
  if (!option) {
    return {
      label: String(
        translate('settings.byoPreferences.stage5Credits', 'Stage5 minutes')
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
  const { t, i18n } = useTranslation();

  const keyPresent = useAiStore(state => state.keyPresent);
  const anthropicKeyPresent = useAiStore(state => state.anthropicKeyPresent);
  const geminiKeyPresent = useAiStore(state => state.geminiKeyPresent);
  const elevenLabsKeyPresent = useAiStore(state => state.elevenLabsKeyPresent);
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(state => state.byoAnthropicUnlocked);
  const byoGeminiUnlocked = useAiStore(state => state.byoGeminiUnlocked);
  const byoElevenLabsUnlocked = useAiStore(
    state => state.byoElevenLabsUnlocked
  );
  const stage5AnthropicReviewAvailable = useAiStore(
    state => state.stage5AnthropicReviewAvailable
  );
  const useApiKeysMode = useAiStore(state => state.useApiKeysMode);
  const useByo = useAiStore(state => state.useByo);
  const useByoAnthropic = useAiStore(state => state.useByoAnthropic);
  const useByoGemini = useAiStore(state => state.useByoGemini);
  const useByoElevenLabs = useAiStore(state => state.useByoElevenLabs);

  const preferredTranscriptionProvider = useAiStore(
    state => state.preferredTranscriptionProvider
  );
  const preferredDubbingProvider = useAiStore(
    state => state.preferredDubbingProvider
  );
  const preferClaudeTranslation = useAiStore(
    state => state.preferClaudeTranslation
  );
  const preferClaudeReview = useAiStore(state => state.preferClaudeReview);
  const preferClaudeSummary = useAiStore(state => state.preferClaudeSummary);
  const preferredTranslationProvider = useAiStore(
    state => state.preferredTranslationProvider
  );
  const setPreferredTranslationProvider = useAiStore(
    state => state.setPreferredTranslationProvider
  );
  const preferredReviewProvider = useAiStore(
    state => state.preferredReviewProvider
  );
  const setPreferredReviewProvider = useAiStore(
    state => state.setPreferredReviewProvider
  );
  const preferredSummaryProvider = useAiStore(
    state => state.preferredSummaryProvider
  );
  const setPreferredSummaryProvider = useAiStore(
    state => state.setPreferredSummaryProvider
  );
  const byoGeminiDraftModel = useAiStore(state => state.byoGeminiDraftModel);
  const setByoGeminiDraftModel = useAiStore(
    state => state.setByoGeminiDraftModel
  );
  const byoGeminiReviewModel = useAiStore(state => state.byoGeminiReviewModel);
  const setByoGeminiReviewModel = useAiStore(
    state => state.setByoGeminiReviewModel
  );
  const byoGeminiSummaryModel = useAiStore(
    state => state.byoGeminiSummaryModel
  );
  const setByoGeminiSummaryModel = useAiStore(
    state => state.setByoGeminiSummaryModel
  );
  const qualityTranslation = useUIStore(state => state.qualityTranslation);
  const setQualityTranslation = useUIStore(
    state => state.setQualityTranslation
  );
  const summaryEffortLevel = useUIStore(state => state.summaryEffortLevel);
  const setSummaryEffortLevel = useUIStore(
    state => state.setSummaryEffortLevel
  );
  const byoVideoSuggestionModel = useAiStore(
    state => state.byoVideoSuggestionModel
  );
  const setByoVideoSuggestionModel = useAiStore(
    state => state.setByoVideoSuggestionModel
  );
  const stage5DubbingTtsProvider = useAiStore(
    state => state.stage5DubbingTtsProvider
  );

  const runtimeState = useMemo<ByoRuntimeState>(
    () => ({
      useApiKeysMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      byoGeminiUnlocked,
      byoElevenLabsUnlocked,
      stage5AnthropicReviewAvailable,
      useByo,
      useByoAnthropic,
      useByoGemini,
      useByoElevenLabs,
      keyPresent,
      anthropicKeyPresent,
      geminiKeyPresent,
      elevenLabsKeyPresent,
      preferClaudeTranslation,
      preferClaudeReview,
      preferClaudeSummary,
      preferredTranslationProvider,
      preferredReviewProvider,
      preferredSummaryProvider,
      byoGeminiDraftModel,
      byoGeminiReviewModel,
      byoGeminiSummaryModel,
      preferredTranscriptionProvider,
      preferredDubbingProvider,
      stage5DubbingTtsProvider,
    }),
    [
      useApiKeysMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      byoGeminiUnlocked,
      byoElevenLabsUnlocked,
      stage5AnthropicReviewAvailable,
      useByo,
      useByoAnthropic,
      useByoGemini,
      useByoElevenLabs,
      keyPresent,
      anthropicKeyPresent,
      geminiKeyPresent,
      elevenLabsKeyPresent,
      preferClaudeTranslation,
      preferClaudeReview,
      preferClaudeSummary,
      preferredTranslationProvider,
      preferredReviewProvider,
      preferredSummaryProvider,
      byoGeminiDraftModel,
      byoGeminiReviewModel,
      byoGeminiSummaryModel,
      preferredTranscriptionProvider,
      preferredDubbingProvider,
      stage5DubbingTtsProvider,
    ]
  );

  const hasOpenAiConfigured = hasOpenAiByoConfigured(runtimeState);
  const hasAnthropicConfigured = hasAnthropicByoConfigured(runtimeState);
  const hasGeminiConfigured = hasGeminiByoConfigured(runtimeState);
  const hasElevenLabsConfigured = hasElevenLabsByoConfigured(runtimeState);

  const showStackPanel =
    hasOpenAiConfigured ||
    hasAnthropicConfigured ||
    hasGeminiConfigured ||
    hasElevenLabsConfigured;
  // Transcription is ElevenLabs Scribe only; show the row whenever any audio
  // or translation BYO key is configured so OpenAI-only users learn
  // transcription needs ElevenLabs.
  const showTranscriptionRow =
    hasOpenAiConfigured || hasGeminiConfigured || hasElevenLabsConfigured;
  const showTranslationRows =
    hasOpenAiConfigured || hasAnthropicConfigured || hasGeminiConfigured;
  // Dubbing is ElevenLabs-only; show the row whenever any audio BYO key is
  // configured so OpenAI-only users learn dubbing needs ElevenLabs.
  const showDubbingRow =
    hasOpenAiConfigured || hasGeminiConfigured || hasElevenLabsConfigured;
  const showVideoSuggestionRow = showTranslationRows;
  const hasTranslationChoice =
    (hasOpenAiConfigured && hasAnthropicConfigured) || hasGeminiConfigured;
  const hasReviewChoice = showTranslationRows;
  const hasSummaryChoice = showTranslationRows;
  const canUseOpenAiVideoSuggestionModel = hasOpenAiConfigured;
  const canUseAnthropicVideoSuggestionModel = hasAnthropicConfigured;
  const canUseGeminiVideoSuggestionModel = hasGeminiConfigured;
  const hasVideoSuggestionChoice =
    canUseOpenAiVideoSuggestionModel ||
    canUseAnthropicVideoSuggestionModel ||
    canUseGeminiVideoSuggestionModel;
  const hasProviderChoice =
    hasTranslationChoice ||
    hasReviewChoice ||
    hasSummaryChoice ||
    hasVideoSuggestionChoice;

  const transcriptionProvider = resolveTranscriptionProvider(runtimeState);
  const translationDraftModel = resolveTranslationDraftModel(runtimeState);
  const translationDraftProvider =
    resolveTranslationDraftProvider(runtimeState);
  const translationReviewModel =
    resolveEffectiveTranslationReviewModel(runtimeState);
  const effectiveReviewProvider: ByoTextProviderPreference =
    translationReviewModel === AI_MODELS.CLAUDE_OPUS
      ? 'anthropic'
      : translationReviewModel === AI_MODELS.GEMINI_NEON ||
          translationReviewModel === AI_MODELS.GEMINI_CARBON
        ? 'gemini'
        : 'openai';
  const dubbingProvider = resolveDubbingProvider(runtimeState);
  const resolvedVideoSuggestionModel = useMemo(
    () =>
      resolveEffectiveVideoSuggestionModel({
        // This panel configures BYO behavior, independent of current mode.
        apiKeyModeEnabled: true,
        byoModel: byoVideoSuggestionModel,
        translationDraftModel,
        translationReviewModel,
        availableByoModels: [
          canUseOpenAiVideoSuggestionModel ? AI_MODELS.GPT : null,
          canUseOpenAiVideoSuggestionModel
            ? STAGE5_REVIEW_TRANSLATION_MODEL
            : null,
          canUseAnthropicVideoSuggestionModel ? AI_MODELS.CLAUDE_SONNET : null,
          canUseAnthropicVideoSuggestionModel ? AI_MODELS.CLAUDE_OPUS : null,
          canUseGeminiVideoSuggestionModel ? AI_MODELS.GEMINI_HYDROGEN : null,
          canUseGeminiVideoSuggestionModel ? AI_MODELS.GEMINI_NEON : null,
          canUseGeminiVideoSuggestionModel ? AI_MODELS.GEMINI_CARBON : null,
        ],
      }),
    [
      canUseAnthropicVideoSuggestionModel,
      canUseGeminiVideoSuggestionModel,
      canUseOpenAiVideoSuggestionModel,
      byoVideoSuggestionModel,
      translationDraftModel,
      translationReviewModel,
    ]
  );
  const selectedVideoSuggestionModel: DirectVideoSuggestionModelPreference =
    byoVideoSuggestionModel === 'follow-draft' ||
    byoVideoSuggestionModel === 'follow-review'
      ? resolvedVideoSuggestionModel
      : byoVideoSuggestionModel;
  const videoSuggestionUsesDirectGpt =
    selectedVideoSuggestionModel === AI_MODELS.GPT;
  const videoSuggestionUsesDirectGpt54 =
    selectedVideoSuggestionModel === STAGE5_REVIEW_TRANSLATION_MODEL;
  const videoSuggestionUsesSonnet =
    selectedVideoSuggestionModel === AI_MODELS.CLAUDE_SONNET;
  const videoSuggestionUsesOpus =
    selectedVideoSuggestionModel === AI_MODELS.CLAUDE_OPUS;
  const videoSuggestionUsesGeminiHydrogen =
    selectedVideoSuggestionModel === AI_MODELS.GEMINI_HYDROGEN;
  const videoSuggestionUsesGeminiNeon =
    selectedVideoSuggestionModel === AI_MODELS.GEMINI_NEON;
  const videoSuggestionUsesGeminiCarbon =
    selectedVideoSuggestionModel === AI_MODELS.GEMINI_CARBON;
  const showVideoSuggestionRuntimeHint =
    useApiKeysMode &&
    selectedVideoSuggestionModel !== resolvedVideoSuggestionModel;
  const videoSuggestionLegacyFollowHint =
    byoVideoSuggestionModel === 'follow-draft'
      ? String(
          t(
            'settings.byoPreferences.videoSuggestionLegacyFollowDraft',
            'Your earlier setting is kept: this follows your draft translation model until you choose a model here.'
          )
        )
      : byoVideoSuggestionModel === 'follow-review'
        ? String(
            t(
              'settings.byoPreferences.videoSuggestionLegacyFollowReview',
              'Your earlier setting is kept: this follows your review translation model until you choose a model here.'
            )
          )
        : null;
  const videoSuggestionRuntimeHint = showVideoSuggestionRuntimeHint
    ? `${String(
        t(
          'settings.byoPreferences.runtimeFallback',
          'Runtime fallback in API key mode'
        )
      )} • ${
        AI_MODEL_DISPLAY_NAMES[resolvedVideoSuggestionModel] ??
        resolvedVideoSuggestionModel
      }`
    : null;
  const videoSuggestionFooter = [
    videoSuggestionLegacyFollowHint,
    videoSuggestionRuntimeHint,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' • ');
  const handleVideoSuggestionModelChange = useCallback(
    async (value: DirectVideoSuggestionModelPreference) => {
      const result = await setByoVideoSuggestionModel(value);
      if (!result.success) {
        console.error(
          'Failed to update BYO video suggestion model:',
          result.error
        );
      }
    },
    [setByoVideoSuggestionModel]
  );
  const videoSuggestionOptions = useMemo<PreferenceRowProps['options']>(() => {
    const options: PreferenceRowProps['options'] = [
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
          'Needs the API-key unlock, your OpenAI key, and the OpenAI switch turned on.'
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
          'Needs the API-key unlock, your OpenAI key, and the OpenAI switch turned on.'
        ),
        onSelect: () =>
          handleVideoSuggestionModelChange(STAGE5_REVIEW_TRANSLATION_MODEL),
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
          'Needs the API-key unlock, your Anthropic key, and the Anthropic switch turned on.'
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
          'Needs the API-key unlock, your Anthropic key, and the Anthropic switch turned on.'
        ),
        onSelect: () => handleVideoSuggestionModelChange(AI_MODELS.CLAUDE_OPUS),
      },
      {
        value: AI_MODELS.GEMINI_HYDROGEN,
        label: t(
          BYO_PROVIDERS.videoSuggestion.geminiHydrogen.labelKey,
          BYO_PROVIDERS.videoSuggestion.geminiHydrogen.fallback
        ),
        price: BYO_PROVIDERS.videoSuggestion.geminiHydrogen.price,
        selected: videoSuggestionUsesGeminiHydrogen,
        disabled: !canUseGeminiVideoSuggestionModel,
        disabledReason: t(
          'settings.byoPreferences.videoSuggestionModelRequiresGemini',
          'Needs the API-key unlock and your Google Gemini key.'
        ),
        onSelect: () =>
          handleVideoSuggestionModelChange(AI_MODELS.GEMINI_HYDROGEN),
      },
      {
        value: AI_MODELS.GEMINI_NEON,
        label: t(
          BYO_PROVIDERS.videoSuggestion.geminiNeon.labelKey,
          BYO_PROVIDERS.videoSuggestion.geminiNeon.fallback
        ),
        price: BYO_PROVIDERS.videoSuggestion.geminiNeon.price,
        selected: videoSuggestionUsesGeminiNeon,
        disabled: !canUseGeminiVideoSuggestionModel,
        disabledReason: t(
          'settings.byoPreferences.videoSuggestionModelRequiresGemini',
          'Needs the API-key unlock and your Google Gemini key.'
        ),
        onSelect: () => handleVideoSuggestionModelChange(AI_MODELS.GEMINI_NEON),
      },
      {
        value: AI_MODELS.GEMINI_CARBON,
        label: t(
          BYO_PROVIDERS.videoSuggestion.geminiCarbon.labelKey,
          BYO_PROVIDERS.videoSuggestion.geminiCarbon.fallback
        ),
        price: BYO_PROVIDERS.videoSuggestion.geminiCarbon.price,
        selected: videoSuggestionUsesGeminiCarbon,
        disabled: !canUseGeminiVideoSuggestionModel,
        disabledReason: t(
          'settings.byoPreferences.videoSuggestionModelRequiresGemini',
          'Needs the API-key unlock and your Google Gemini key.'
        ),
        onSelect: () =>
          handleVideoSuggestionModelChange(AI_MODELS.GEMINI_CARBON),
      },
    ];

    return options;
  }, [
    canUseAnthropicVideoSuggestionModel,
    canUseGeminiVideoSuggestionModel,
    canUseOpenAiVideoSuggestionModel,
    handleVideoSuggestionModelChange,
    t,
    videoSuggestionUsesDirectGpt,
    videoSuggestionUsesDirectGpt54,
    videoSuggestionUsesGeminiCarbon,
    videoSuggestionUsesGeminiHydrogen,
    videoSuggestionUsesGeminiNeon,
    videoSuggestionUsesOpus,
    videoSuggestionUsesSonnet,
  ]);

  const handleTranslationDraftSelect = async (
    provider: ByoTextProviderPreference,
    geminiModel?: ByoGeminiDraftModel
  ) => {
    if (provider === 'gemini' && geminiModel) {
      await setByoGeminiDraftModel(geminiModel);
    }
    const result = await setPreferredTranslationProvider(provider);
    if (!result.success) {
      console.error('Failed to update translation provider:', result.error);
    }
  };

  const handleReviewModeChange = async (
    value: 'off' | 'openai' | 'anthropic' | 'gemini-neon' | 'gemini-carbon'
  ) => {
    if (value === 'off') {
      setQualityTranslation(false);
      return;
    }

    setQualityTranslation(true);
    if (value === 'gemini-neon' || value === 'gemini-carbon') {
      const model: ByoGeminiReviewModel =
        value === 'gemini-carbon'
          ? AI_MODELS.GEMINI_CARBON
          : AI_MODELS.GEMINI_NEON;
      await setByoGeminiReviewModel(model);
      await setPreferredReviewProvider('gemini');
      return;
    }
    await setPreferredReviewProvider(value);
  };

  const handleSummaryModeChange = async (
    provider: ByoTextProviderPreference,
    effort: 'standard' | 'high',
    geminiModel?: ByoGeminiSummaryModel
  ) => {
    setSummaryEffortLevel(effort);
    if (provider === 'gemini' && geminiModel) {
      await setByoGeminiSummaryModel(geminiModel);
    }
    const result = await setPreferredSummaryProvider(provider);
    if (!result.success) {
      console.error('Failed to update summary provider:', result.error);
    }
  };

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
          ? t('settings.byoPreferences.title', 'Provider preferences')
          : t('settings.byoStack.title', 'Your AI stack')}
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
          hasChoice={false}
          radioName="transcriptionProvider"
          options={[]}
          infoProvider={
            hasElevenLabsConfigured
              ? {
                  label: t(
                    BYO_PROVIDERS.transcription.elevenlabs.labelKey,
                    BYO_PROVIDERS.transcription.elevenlabs.fallback
                  ),
                  price: BYO_PROVIDERS.transcription.elevenlabs.price,
                }
              : getProviderInfo(t, transcriptionProvider, {
                  elevenlabs: BYO_PROVIDERS.transcription.elevenlabs,
                })
          }
          footer={
            hasElevenLabsConfigured
              ? null
              : t(
                  'settings.byoPreferences.transcriptionRequiresElevenLabs',
                  'Transcription uses ElevenLabs Scribe only. Add an ElevenLabs API key to transcribe with your own keys. Without one, transcription uses your Stage5 minutes, which aren’t used while your own keys are on. Your OpenAI key is still used for translation.'
                )
          }
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
              selected: preferredTranslationProvider === 'openai',
              disabled: !hasOpenAiConfigured,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresOpenAi',
                'Needs the API-key unlock, your OpenAI key, and the OpenAI switch turned on.'
              ),
              onSelect: () => void handleTranslationDraftSelect('openai'),
            },
            {
              value: 'anthropic',
              label: t(
                BYO_PROVIDERS.translationDraft.anthropic.labelKey,
                BYO_PROVIDERS.translationDraft.anthropic.fallback
              ),
              price: BYO_PROVIDERS.translationDraft.anthropic.price,
              selected: preferredTranslationProvider === 'anthropic',
              disabled: !hasAnthropicConfigured,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresAnthropic',
                'Needs the API-key unlock, your Anthropic key, and the Anthropic switch turned on.'
              ),
              onSelect: () => void handleTranslationDraftSelect('anthropic'),
            },
            {
              value: AI_MODELS.GEMINI_FLASH_LITE,
              label: t(
                BYO_PROVIDERS.translationDraft.geminiFlashLite.labelKey,
                BYO_PROVIDERS.translationDraft.geminiFlashLite.fallback
              ),
              price: BYO_PROVIDERS.translationDraft.geminiFlashLite.price,
              selected:
                preferredTranslationProvider === 'gemini' &&
                byoGeminiDraftModel === AI_MODELS.GEMINI_FLASH_LITE,
              disabled: !hasGeminiConfigured,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresGemini',
                'Needs the API-key unlock and your Google Gemini key.'
              ),
              onSelect: () =>
                void handleTranslationDraftSelect(
                  'gemini',
                  AI_MODELS.GEMINI_FLASH_LITE
                ),
            },
            {
              value: AI_MODELS.GEMINI_HYDROGEN,
              label: t(
                BYO_PROVIDERS.translationDraft.geminiHydrogen.labelKey,
                BYO_PROVIDERS.translationDraft.geminiHydrogen.fallback
              ),
              price: BYO_PROVIDERS.translationDraft.geminiHydrogen.price,
              selected:
                preferredTranslationProvider === 'gemini' &&
                byoGeminiDraftModel === AI_MODELS.GEMINI_HYDROGEN,
              disabled: !hasGeminiConfigured,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresGemini',
                'Needs the API-key unlock and your Google Gemini key.'
              ),
              onSelect: () =>
                void handleTranslationDraftSelect(
                  'gemini',
                  AI_MODELS.GEMINI_HYDROGEN
                ),
            },
            {
              value: AI_MODELS.GEMINI_NEON,
              label: t(
                BYO_PROVIDERS.translationDraft.geminiNeon.labelKey,
                BYO_PROVIDERS.translationDraft.geminiNeon.fallback
              ),
              price: BYO_PROVIDERS.translationDraft.geminiNeon.price,
              selected:
                preferredTranslationProvider === 'gemini' &&
                byoGeminiDraftModel === AI_MODELS.GEMINI_NEON,
              disabled: !hasGeminiConfigured,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresGemini',
                'Needs the API-key unlock and your Google Gemini key.'
              ),
              onSelect: () =>
                void handleTranslationDraftSelect(
                  'gemini',
                  AI_MODELS.GEMINI_NEON
                ),
            },
          ]}
          infoProvider={getProviderInfo(t, translationDraftProvider, {
            openai: BYO_PROVIDERS.translationDraft.openai,
            anthropic: BYO_PROVIDERS.translationDraft.anthropic,
            gemini:
              byoGeminiDraftModel === AI_MODELS.GEMINI_FLASH_LITE
                ? BYO_PROVIDERS.translationDraft.geminiFlashLite
                : byoGeminiDraftModel === AI_MODELS.GEMINI_NEON
                  ? BYO_PROVIDERS.translationDraft.geminiNeon
                  : BYO_PROVIDERS.translationDraft.geminiHydrogen,
          })}
        />
      )}

      {showTranslationRows && (
        <PreferenceRow
          title={getReviewPassLabel(t, i18n)}
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
              label: getReviewProviderLabel(t, i18n, 'openai'),
              price: BYO_PROVIDERS.review.openai.price,
              selected:
                qualityTranslation && effectiveReviewProvider === 'openai',
              disabled: !hasOpenAiConfigured,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresOpenAi',
                'Needs the API-key unlock, your OpenAI key, and the OpenAI switch turned on.'
              ),
              onSelect: () => void handleReviewModeChange('openai'),
            },
            {
              value: 'anthropic',
              label: getReviewProviderLabel(t, i18n, 'anthropic'),
              price: BYO_PROVIDERS.review.anthropic.price,
              selected:
                qualityTranslation && effectiveReviewProvider === 'anthropic',
              disabled: !hasAnthropicConfigured,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresAnthropic',
                'Needs the API-key unlock, your Anthropic key, and the Anthropic switch turned on.'
              ),
              onSelect: () => void handleReviewModeChange('anthropic'),
            },
            {
              value: 'gemini-neon',
              label: t(
                BYO_PROVIDERS.review.geminiNeon.labelKey,
                BYO_PROVIDERS.review.geminiNeon.fallback
              ),
              price: BYO_PROVIDERS.review.geminiNeon.price,
              selected:
                qualityTranslation &&
                effectiveReviewProvider === 'gemini' &&
                byoGeminiReviewModel === AI_MODELS.GEMINI_NEON,
              disabled: !hasGeminiConfigured,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresGemini',
                'Needs the API-key unlock and your Google Gemini key.'
              ),
              onSelect: () => void handleReviewModeChange('gemini-neon'),
            },
            {
              value: 'gemini-carbon',
              label: t(
                BYO_PROVIDERS.review.geminiCarbon.labelKey,
                BYO_PROVIDERS.review.geminiCarbon.fallback
              ),
              price: BYO_PROVIDERS.review.geminiCarbon.price,
              selected:
                qualityTranslation &&
                effectiveReviewProvider === 'gemini' &&
                byoGeminiReviewModel === AI_MODELS.GEMINI_CARBON,
              disabled: !hasGeminiConfigured,
              disabledReason: t(
                'settings.byoPreferences.videoSuggestionModelRequiresGemini',
                'Needs the API-key unlock and your Google Gemini key.'
              ),
              onSelect: () => void handleReviewModeChange('gemini-carbon'),
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
              selected:
                summaryEffortLevel !== 'high' &&
                preferredSummaryProvider === 'openai',
              disabled: !hasOpenAiConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresOpenAi',
                'Needs the API-key unlock and your OpenAI key.'
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
              selected:
                summaryEffortLevel !== 'high' &&
                preferredSummaryProvider === 'anthropic',
              disabled: !hasAnthropicConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresAnthropic',
                'Needs the API-key unlock and your Anthropic key.'
              ),
              onSelect: () =>
                void handleSummaryModeChange('anthropic', 'standard'),
            },
            {
              value: 'gemini-standard',
              label: t(
                BYO_PROVIDERS.summary.standard.geminiHydrogen.labelKey,
                BYO_PROVIDERS.summary.standard.geminiHydrogen.fallback
              ),
              price: BYO_PROVIDERS.summary.standard.geminiHydrogen.price,
              selected:
                summaryEffortLevel !== 'high' &&
                preferredSummaryProvider === 'gemini',
              disabled: !hasGeminiConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresGemini',
                'Needs the API-key unlock and your Google Gemini key.'
              ),
              onSelect: () =>
                void handleSummaryModeChange(
                  'gemini',
                  'standard',
                  AI_MODELS.GEMINI_HYDROGEN
                ),
            },
            {
              value: 'openai-high',
              label: t(
                BYO_PROVIDERS.summary.high.openai.labelKey,
                BYO_PROVIDERS.summary.high.openai.fallback
              ),
              price: BYO_PROVIDERS.summary.high.openai.price,
              selected:
                summaryEffortLevel === 'high' &&
                preferredSummaryProvider === 'openai',
              disabled: !hasOpenAiConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresOpenAi',
                'Needs the API-key unlock and your OpenAI key.'
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
              selected:
                summaryEffortLevel === 'high' &&
                preferredSummaryProvider === 'anthropic',
              disabled: !hasAnthropicConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresAnthropic',
                'Needs the API-key unlock and your Anthropic key.'
              ),
              onSelect: () => void handleSummaryModeChange('anthropic', 'high'),
            },
            {
              value: 'gemini-neon-high',
              label: t(
                BYO_PROVIDERS.summary.high.geminiNeon.labelKey,
                BYO_PROVIDERS.summary.high.geminiNeon.fallback
              ),
              price: BYO_PROVIDERS.summary.high.geminiNeon.price,
              selected:
                summaryEffortLevel === 'high' &&
                preferredSummaryProvider === 'gemini' &&
                byoGeminiSummaryModel !== AI_MODELS.GEMINI_CARBON,
              disabled: !hasGeminiConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresGemini',
                'Needs the API-key unlock and your Google Gemini key.'
              ),
              onSelect: () =>
                void handleSummaryModeChange(
                  'gemini',
                  'high',
                  AI_MODELS.GEMINI_NEON
                ),
            },
            {
              value: 'gemini-carbon-high',
              label: t(
                BYO_PROVIDERS.summary.high.geminiCarbon.labelKey,
                BYO_PROVIDERS.summary.high.geminiCarbon.fallback
              ),
              price: BYO_PROVIDERS.summary.high.geminiCarbon.price,
              selected:
                summaryEffortLevel === 'high' &&
                preferredSummaryProvider === 'gemini' &&
                byoGeminiSummaryModel === AI_MODELS.GEMINI_CARBON,
              disabled: !hasGeminiConfigured,
              disabledReason: t(
                'settings.byoPreferences.summaryRequiresGemini',
                'Needs the API-key unlock and your Google Gemini key.'
              ),
              onSelect: () =>
                void handleSummaryModeChange(
                  'gemini',
                  'high',
                  AI_MODELS.GEMINI_CARBON
                ),
            },
          ]}
        />
      )}

      {showDubbingRow && (
        <PreferenceRow
          title={t('settings.byoPreferences.dubbing', 'Dubbing')}
          hasChoice={false}
          radioName="dubbingProvider"
          options={[]}
          infoProvider={
            hasElevenLabsConfigured
              ? {
                  label: t(
                    BYO_PROVIDERS.dubbing.elevenlabs.labelKey,
                    BYO_PROVIDERS.dubbing.elevenlabs.fallback
                  ),
                  price: BYO_PROVIDERS.dubbing.elevenlabs.price,
                }
              : getProviderInfo(t, dubbingProvider, {
                  elevenlabs: BYO_PROVIDERS.dubbing.elevenlabs,
                })
          }
          footer={
            hasElevenLabsConfigured
              ? null
              : t(
                  'settings.byoPreferences.dubbingRequiresElevenLabs',
                  'Dubbing uses ElevenLabs only. Add an ElevenLabs API key to dub with your own keys. Without one, dubbing uses your Stage5 minutes, which aren’t used while your own keys are on.'
                )
          }
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
          options={videoSuggestionOptions}
          infoProvider={{
            label: t(
              'settings.byoPreferences.videoSuggestionModelUnavailable',
              'No video recommendation model is available with your own keys. Turn on your OpenAI, Anthropic, or Google Gemini key to use this.'
            ),
            price: '',
          }}
          footer={videoSuggestionFooter || null}
        />
      )}
    </div>
  );
}
