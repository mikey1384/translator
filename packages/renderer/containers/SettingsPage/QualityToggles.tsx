import { css } from '@emotion/css';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AI_MODEL_DISPLAY_NAMES,
  AI_MODELS,
  CREDITS_PER_AUDIO_HOUR,
  estimateVideoSuggestionUsdPerSearch,
  PRICE_MARGIN,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  SUMMARY_QUALITY_MULTIPLIER,
  TTS_CREDITS_PER_MINUTE,
  TRANSLATION_QUALITY_MULTIPLIER,
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
  estimateSummaryHours,
  estimateTranslatableHours,
  formatCredits,
  formatHours,
} from '../../utils/creditEstimates';

export default function QualityToggles() {
  const { t } = useTranslation();
  const qualityTranslation = useUIStore(s => s.qualityTranslation);
  const setQualityTranslation = useUIStore(s => s.setQualityTranslation);
  const summaryEffortLevel = useUIStore(s => s.summaryEffortLevel);
  const setSummaryEffortLevel = useUIStore(s => s.setSummaryEffortLevel);
  const credits = useCreditStore(s => s.credits);
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
  const videoSuggestionQualityEnabled =
    videoSuggestionModelPreference === 'quality' ||
    videoSuggestionModelPreference === AI_MODELS.CLAUDE_OPUS ||
    videoSuggestionModelPreference === STAGE5_REVIEW_TRANSLATION_MODEL;

  // Calculate estimated video hours for translation (normal and HQ modes)
  const translationNormalHours = estimateTranslatableHours(credits, false);
  const translationHqHours = estimateTranslatableHours(credits, true);
  const translationNormalCreditsPerHour = CREDITS_PER_AUDIO_HOUR;
  const translationHqCreditsPerHour = Math.ceil(
    CREDITS_PER_AUDIO_HOUR * TRANSLATION_QUALITY_MULTIPLIER
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
  const qualityVideoSuggestionCredits = Math.ceil(
    (estimateVideoSuggestionUsdPerSearch(STAGE5_REVIEW_TRANSLATION_MODEL) *
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
              model: t(
                'settings.performanceQuality.qualityTranslation.modelOn',
                'GPT-5.1 draft + GPT-5.4 review'
              ),
              estimateHours: translationHqHours,
            })
          : renderHelp({
              rate: translationNormalCreditsPerHour,
              unit: 'perHour',
              model: t(
                'settings.performanceQuality.qualityTranslation.modelOff',
                'GPT-5.1 draft only'
              ),
              estimateHours: translationNormalHours,
            })
      )}
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
              model: AI_MODEL_DISPLAY_NAMES[STAGE5_REVIEW_TRANSLATION_MODEL],
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
