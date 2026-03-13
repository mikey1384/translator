import { css } from '@emotion/css';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AI_MODEL_DISPLAY_NAMES,
  AI_MODELS,
  CREDITS_PER_AUDIO_HOUR,
  estimateVideoSuggestionUsdPerSearch,
  getExactAiModelDisplayName,
  getStage5ReviewOption,
  getStage5ReviewOptionForPreference,
  PRICE_MARGIN,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  SUMMARY_QUALITY_MULTIPLIER,
  TTS_CREDITS_PER_MINUTE,
  USD_PER_CREDIT,
} from '../../../shared/constants';
import { colors } from '../../styles';
import { useUIStore } from '../../state/ui-store';
import { useCreditStore } from '../../state/credit-store';
import { useAiStore } from '../../state/ai-store';
import Switch from '../../components/Switch';
import {
  CREDITS_PER_SUMMARY_AUDIO_HOUR,
  estimateDubbingHours,
  estimateTranslationCreditsPerHour,
  estimateSummaryHours,
  estimateTranslatableHours,
  formatCredits,
  formatHours,
} from '../../utils/creditEstimates';

const reviewProviderCardStyles = css`
  margin-top: -2px;
  padding: 10px 14px 12px;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  background: ${colors.white};
`;

const reviewProviderLabelStyles = css`
  margin-bottom: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  color: ${colors.text};
`;

const reviewProviderOptionsStyles = css`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const reviewProviderOptionStyles = css`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: ${colors.text};
  font-size: 0.9rem;
`;

const reviewProviderOptionCopyStyles = css`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const reviewProviderOptionMetaStyles = css`
  color: ${colors.gray};
  font-size: 0.82rem;
`;

export default function QualityToggles() {
  const { t } = useTranslation();
  const qualityTranslation = useUIStore(s => s.qualityTranslation);
  const setQualityTranslation = useUIStore(s => s.setQualityTranslation);
  const summaryEffortLevel = useUIStore(s => s.summaryEffortLevel);
  const setSummaryEffortLevel = useUIStore(s => s.setSummaryEffortLevel);
  const credits = useCreditStore(s => s.credits);
  const preferClaudeReview = useAiStore(s => s.preferClaudeReview);
  const stage5AnthropicReviewAvailable = useAiStore(
    s => s.stage5AnthropicReviewAvailable
  );
  const setPreferClaudeReview = useAiStore(s => s.setPreferClaudeReview);
  const stage5DubbingTtsProvider = useAiStore(s => s.stage5DubbingTtsProvider);
  const setStage5DubbingTtsProvider = useAiStore(
    s => s.setStage5DubbingTtsProvider
  );
  const videoSuggestionModelPreference = useAiStore(
    s => s.videoSuggestionModelPreference
  );
  const setVideoSuggestionModelPreference = useAiStore(
    s => s.setVideoSuggestionModelPreference
  );
  const effectivePreferClaudeReview =
    preferClaudeReview && stage5AnthropicReviewAvailable;
  const videoSuggestionQualityEnabled =
    videoSuggestionModelPreference === 'quality' ||
    videoSuggestionModelPreference === getStage5ReviewOption('anthropic').model ||
    videoSuggestionModelPreference === STAGE5_REVIEW_TRANSLATION_MODEL;
  const selectedReviewOption =
    getStage5ReviewOptionForPreference(effectivePreferClaudeReview);
  const qualityTranslationModelOn =
    selectedReviewOption.provider === 'anthropic'
    ? t(
        'settings.performanceQuality.qualityTranslation.modelOnAnthropic',
        'Standard draft + Anthropic high-end review'
      )
    : t(
        'settings.performanceQuality.qualityTranslation.modelOn',
        'Standard draft + OpenAI high-end review'
      );
  const reviewProviderOptions = [
    {
      ...getStage5ReviewOption('openai'),
      checked: !effectivePreferClaudeReview,
      label: t(
        'settings.performanceQuality.qualityTranslation.openAiHighEnd',
        'OpenAI high-end review'
      ),
      onChange: () => void setPreferClaudeReview(false),
      disabled: false,
    },
    {
      ...getStage5ReviewOption('anthropic'),
      checked: effectivePreferClaudeReview,
      label: t(
        'settings.performanceQuality.qualityTranslation.anthropicHighEnd',
        'Anthropic high-end review'
      ),
      onChange: () => {
        if (!stage5AnthropicReviewAvailable) return;
        void setPreferClaudeReview(true);
      },
      disabled: !stage5AnthropicReviewAvailable,
    },
  ].map(option => ({
    ...option,
    creditsPerHour: estimateTranslationCreditsPerHour(true, option.model),
  }));

  // Calculate estimated video hours for translation (normal and HQ modes)
  const translationNormalHours = estimateTranslatableHours(credits, false);
  const translationHqHours = estimateTranslatableHours(
    credits,
    true,
    selectedReviewOption.model
  );
  const translationNormalCreditsPerHour = CREDITS_PER_AUDIO_HOUR;
  const translationHqCreditsPerHour = estimateTranslationCreditsPerHour(
    true,
    selectedReviewOption.model
  );

  // Calculate estimated video hours for summary (normal and HQ modes)
  const summaryNormalHours = estimateSummaryHours(credits, 'standard');
  const summaryHqHours = estimateSummaryHours(credits, 'high');
  const summaryNormalCreditsPerHour = CREDITS_PER_SUMMARY_AUDIO_HOUR;
  const summaryHqCreditsPerHour = Math.ceil(
    CREDITS_PER_SUMMARY_AUDIO_HOUR * SUMMARY_QUALITY_MULTIPLIER
  );

  // Calculate estimated dubbing time for OpenAI (normal) and ElevenLabs (HQ)
  const dubbingNormalHours = estimateDubbingHours(credits, 'openai');
  const dubbingHqHours = estimateDubbingHours(credits, 'elevenlabs');
  const dubbingNormalCreditsPerMinute = TTS_CREDITS_PER_MINUTE.openai;
  const dubbingHqCreditsPerMinute = TTS_CREDITS_PER_MINUTE.elevenlabs;
  const defaultVideoSuggestionCredits = Math.ceil(
    (estimateVideoSuggestionUsdPerSearch(AI_MODELS.GPT) * PRICE_MARGIN) /
      USD_PER_CREDIT
  );
  const qualityVideoSuggestionModel = selectedReviewOption.model;
  const qualityVideoSuggestionCredits = Math.ceil(
    (estimateVideoSuggestionUsdPerSearch(qualityVideoSuggestionModel) *
      PRICE_MARGIN) /
      USD_PER_CREDIT
  );

  const formatRate = (
    value: number,
    unit: 'perHour' | 'perMinute' | 'perSearch'
  ) =>
    t(`settings.performanceQuality.rate.${unit}`, {
      credits: formatCredits(value).replace(/^~/, ''),
      defaultValue:
        unit === 'perHour'
          ? '~{{credits}} credits/hour'
          : unit === 'perMinute'
            ? '~{{credits}} credits/min'
            : '~{{credits}} credits/search',
    });

  const formatBalance = (hours: number) =>
    t('settings.performanceQuality.rate.balance', {
      time: formatHours(hours),
      defaultValue: 'Balance: ~{{time}}',
    });

  const renderHelp = ({
    rate,
    unit,
    model,
    estimateHours,
  }: {
    rate: number;
    unit: 'perHour' | 'perMinute' | 'perSearch';
    model: string;
    estimateHours?: number | null;
  }) => {
    return (
      <>
        <strong>{formatRate(rate, unit)}</strong>
        {' • '}
        {model}
        {typeof estimateHours === 'number' ? (
          <>
            {' • '}
            {formatBalance(estimateHours)}
          </>
        ) : null}
      </>
    );
  };

  const row = (
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    help?: ReactNode
  ) => (
    <div
      className={css`
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border: 1px solid ${colors.border};
        border-radius: 8px;
        background: ${colors.grayLight};
      `}
    >
      <div>
        <div
          className={css`
            font-weight: 600;
            color: ${colors.text};
          `}
        >
          {label}
        </div>
        {help ? (
          <div
            className={css`
              margin-top: 4px;
              color: ${colors.gray};
              font-size: 0.9rem;
            `}
          >
            {help}
          </div>
        ) : null}
      </div>
      <Switch checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  );

  // Note: Quality Transcription toggle removed from Stage5 credits mode.
  // Stage5 always uses ElevenLabs for transcription (not Whisper).
  // The qualityTranscription setting only affects Whisper chunking, which is
  // only used in BYO mode when user selects OpenAI/Whisper as their provider.

  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: 10px;
      `}
    >
      {row(
        t(
          'settings.performanceQuality.qualityTranslation.label',
          'Quality Translation'
        ),
        qualityTranslation,
        setQualityTranslation,
        qualityTranslation
          ? renderHelp({
              rate: translationHqCreditsPerHour,
              unit: 'perHour',
              model: qualityTranslationModelOn,
              estimateHours: translationHqHours,
            })
          : renderHelp({
              rate: translationNormalCreditsPerHour,
              unit: 'perHour',
              model: t(
                'settings.performanceQuality.qualityTranslation.modelOff',
                'Standard draft only'
              ),
              estimateHours: translationNormalHours,
            })
      )}
      {qualityTranslation ? (
        <div className={reviewProviderCardStyles}>
          <div className={reviewProviderLabelStyles}>
            {t(
              'settings.performanceQuality.qualityTranslation.reviewProvider',
              'Review Provider'
            )}
          </div>
          <div className={reviewProviderOptionsStyles}>
            {reviewProviderOptions.map(option => (
              <label
                key={option.provider}
                className={reviewProviderOptionStyles}
              >
                  <input
                    type="radio"
                    name="stage5-review-provider"
                    checked={option.checked}
                    disabled={option.disabled}
                    onChange={option.onChange}
                  />
                <span className={reviewProviderOptionCopyStyles}>
                  <span>{option.label}</span>
                  <span className={reviewProviderOptionMetaStyles}>
                    {option.disabled
                      ? t(
                          'settings.performanceQuality.qualityTranslation.backendUnavailable',
                          'Unavailable on this backend'
                        )
                      : formatRate(option.creditsPerHour, 'perHour')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {row(
        t(
          'settings.performanceQuality.qualitySummary.label',
          'Quality Summary'
        ),
        summaryEffortLevel === 'high',
        v => setSummaryEffortLevel(v ? 'high' : 'standard'),
        summaryEffortLevel === 'high'
          ? renderHelp({
              rate: summaryHqCreditsPerHour,
              unit: 'perHour',
              model: t(
                'settings.performanceQuality.qualitySummary.modelOn',
                'GPT-5.4 deep analysis + highlight clips'
              ),
              estimateHours: summaryHqHours,
            })
          : renderHelp({
              rate: summaryNormalCreditsPerHour,
              unit: 'perHour',
              model: t(
                'settings.performanceQuality.qualitySummary.modelOff',
                'GPT-5.1 standard analysis'
              ),
              estimateHours: summaryNormalHours,
            })
      )}
      {row(
        t(
          'settings.performanceQuality.qualityDubbing.label',
          'Quality Dubbing'
        ),
        stage5DubbingTtsProvider === 'elevenlabs',
        v => setStage5DubbingTtsProvider(v ? 'elevenlabs' : 'openai'),
        stage5DubbingTtsProvider === 'elevenlabs'
          ? renderHelp({
              rate: dubbingHqCreditsPerMinute,
              unit: 'perMinute',
              model: t(
                'settings.performanceQuality.qualityDubbing.modelOn',
                'ElevenLabs TTS premium voices'
              ),
              estimateHours: dubbingHqHours,
            })
          : renderHelp({
              rate: dubbingNormalCreditsPerMinute,
              unit: 'perMinute',
              model: t(
                'settings.performanceQuality.qualityDubbing.modelOff',
                'OpenAI TTS'
              ),
              estimateHours: dubbingNormalHours,
            })
      )}
      {row(
        t(
          'settings.performanceQuality.videoSuggestionModel.label',
          'Video Recommendation Quality'
        ),
        videoSuggestionQualityEnabled,
        v => setVideoSuggestionModelPreference(v ? 'quality' : 'default'),
        videoSuggestionQualityEnabled
          ? renderHelp({
              rate: qualityVideoSuggestionCredits,
              unit: 'perSearch',
              model: getExactAiModelDisplayName(qualityVideoSuggestionModel),
            })
          : renderHelp({
              rate: defaultVideoSuggestionCredits,
              unit: 'perSearch',
              model: AI_MODEL_DISPLAY_NAMES[AI_MODELS.GPT],
            })
      )}
    </div>
  );
}
