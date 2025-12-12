import { css } from '@emotion/css';
import type { ReactNode } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { colors } from '../../styles';
import { useUIStore } from '../../state/ui-store';
import { useCreditStore } from '../../state/credit-store';
import { useAiStore } from '../../state/ai-store';
import Switch from '../../components/Switch';
import {
  CREDITS_PER_1K_TOKENS_PROMPT,
  CREDITS_PER_1K_TOKENS_COMPLETION,
  SUMMARY_QUALITY_MULTIPLIER,
  SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER,
  TTS_CREDITS_PER_MINUTE,
} from '../../../shared/constants';
import {
  estimateTranslatableHours,
  formatHours,
} from '../../utils/creditEstimates';

// Summary credits per audio hour estimate:
// ~45,000 chars/hour → ~11,250 input tokens, ~2,250 output tokens
const SUMMARY_INPUT_TOKENS_PER_HOUR = 11_250;
const SUMMARY_OUTPUT_TOKENS_PER_HOUR = 2_250;
const BASE_CREDITS_PER_SUMMARY_AUDIO_HOUR = Math.ceil(
  (SUMMARY_INPUT_TOKENS_PER_HOUR / 1000) * CREDITS_PER_1K_TOKENS_PROMPT +
    (SUMMARY_OUTPUT_TOKENS_PER_HOUR / 1000) * CREDITS_PER_1K_TOKENS_COMPLETION
);
const CREDITS_PER_SUMMARY_AUDIO_HOUR = Math.ceil(
  BASE_CREDITS_PER_SUMMARY_AUDIO_HOUR * SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER
);

export default function QualityToggles() {
  const { t } = useTranslation();
  const {
    qualityTranslation,
    setQualityTranslation,
    summaryEffortLevel,
    setSummaryEffortLevel,
  } = useUIStore();
  const credits = useCreditStore(s => s.credits);
  const stage5DubbingTtsProvider = useAiStore(s => s.stage5DubbingTtsProvider);
  const setStage5DubbingTtsProvider = useAiStore(
    s => s.setStage5DubbingTtsProvider
  );

  // Calculate estimated video hours for translation (normal and HQ modes)
  const translationNormalHours = estimateTranslatableHours(credits, false);
  const translationHqHours = estimateTranslatableHours(credits, true);

  // Calculate estimated video hours for summary (normal and HQ modes)
  const summaryNormalHours =
    typeof credits === 'number' && credits > 0
      ? credits / CREDITS_PER_SUMMARY_AUDIO_HOUR
      : null;
  const summaryHqHours =
    typeof credits === 'number' && credits > 0
      ? credits / (CREDITS_PER_SUMMARY_AUDIO_HOUR * SUMMARY_QUALITY_MULTIPLIER)
      : null;

  // Calculate estimated dubbing time for OpenAI (normal) and ElevenLabs (HQ)
  const dubbingNormalHours =
    typeof credits === 'number' && credits > 0
      ? credits / TTS_CREDITS_PER_MINUTE.openai / 60
      : null;
  const dubbingHqHours =
    typeof credits === 'number' && credits > 0
      ? credits / TTS_CREDITS_PER_MINUTE.elevenlabs / 60
      : null;

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
        translationNormalHours !== null && translationHqHours !== null ? (
          <Trans
            i18nKey="settings.performanceQuality.qualityTranslation.helpWithEstimate"
            defaults="<b>5× credits</b> • Your balance: ~{{normalTime}} (normal) / ~{{hqTime}} (hq)"
            values={{
              hqTime: formatHours(translationHqHours),
              normalTime: formatHours(translationNormalHours),
            }}
            components={{ b: <strong /> }}
          />
        ) : (
          <Trans
            i18nKey="settings.performanceQuality.qualityTranslation.help"
            defaults="<b>5× credits</b> • Adds review phase for higher quality"
            components={{ b: <strong /> }}
          />
        )
      )}
      {row(
        t(
          'settings.performanceQuality.qualitySummary.label',
          'Quality Summary'
        ),
        summaryEffortLevel === 'high',
        v => setSummaryEffortLevel(v ? 'high' : 'standard'),
        summaryNormalHours !== null && summaryHqHours !== null ? (
          <Trans
            i18nKey="settings.performanceQuality.qualitySummary.helpWithEstimate"
            defaults="<b>4× credits</b> • Your balance: ~{{normalTime}} (normal) / ~{{hqTime}} (hq)"
            values={{
              hqTime: formatHours(summaryHqHours),
              normalTime: formatHours(summaryNormalHours),
            }}
            components={{ b: <strong /> }}
          />
        ) : (
          <Trans
            i18nKey="settings.performanceQuality.qualitySummary.help"
            defaults="<b>4× credits</b> • Deep analysis + highlight clips with Claude Opus"
            components={{ b: <strong /> }}
          />
        )
      )}
      {row(
        t(
          'settings.performanceQuality.qualityDubbing.label',
          'Quality Dubbing'
        ),
        stage5DubbingTtsProvider === 'elevenlabs',
        v => setStage5DubbingTtsProvider(v ? 'elevenlabs' : 'openai'),
        dubbingNormalHours !== null && dubbingHqHours !== null ? (
          <Trans
            i18nKey="settings.performanceQuality.qualityDubbing.helpWithEstimate"
            defaults="<b>13× credits</b> • Your balance: ~{{normalTime}} (normal) / ~{{hqTime}} (hq)"
            values={{
              hqTime: formatHours(dubbingHqHours),
              normalTime: formatHours(dubbingNormalHours),
            }}
            components={{ b: <strong /> }}
          />
        ) : (
          <Trans
            i18nKey="settings.performanceQuality.qualityDubbing.help"
            defaults="<b>13× credits</b> • ElevenLabs TTS with premium voices"
            components={{ b: <strong /> }}
          />
        )
      )}
    </div>
  );
}
