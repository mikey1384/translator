import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';
import { useUIStore } from '../../state/ui-store';
import { useCreditStore } from '../../state/credit-store';
import { useAiStore } from '../../state/ai-store';
import Switch from '../../components/Switch';
import {
  CREDITS_PER_TRANSLATION_AUDIO_HOUR,
  CREDITS_PER_1K_TOKENS_PROMPT,
  CREDITS_PER_1K_TOKENS_COMPLETION,
  TRANSLATION_QUALITY_MULTIPLIER,
  SUMMARY_QUALITY_MULTIPLIER,
  TTS_CREDITS_PER_MINUTE,
} from '../../../shared/constants';

// Summary credits per audio hour estimate:
// ~45,000 chars/hour → ~11,250 input tokens, ~2,250 output tokens
const SUMMARY_INPUT_TOKENS_PER_HOUR = 11_250;
const SUMMARY_OUTPUT_TOKENS_PER_HOUR = 2_250;
const CREDITS_PER_SUMMARY_AUDIO_HOUR = Math.ceil(
  (SUMMARY_INPUT_TOKENS_PER_HOUR / 1000) * CREDITS_PER_1K_TOKENS_PROMPT +
    (SUMMARY_OUTPUT_TOKENS_PER_HOUR / 1000) * CREDITS_PER_1K_TOKENS_COMPLETION
);

/**
 * Format hours into a readable string (e.g., "2h 30m" or "45m")
 */
function formatHours(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return mins > 0 ? `${mins}m` : '<1m';
  }
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

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
  const translationNormalHours =
    typeof credits === 'number' && credits > 0
      ? credits / CREDITS_PER_TRANSLATION_AUDIO_HOUR
      : null;
  const translationHqHours =
    typeof credits === 'number' && credits > 0
      ? credits /
        (CREDITS_PER_TRANSLATION_AUDIO_HOUR * TRANSLATION_QUALITY_MULTIPLIER)
      : null;

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
    help?: string
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
            color: ${colors.dark};
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
        translationNormalHours !== null && translationHqHours !== null
          ? t(
              'settings.performanceQuality.qualityTranslation.helpWithEstimate',
              'Review phase uses ~5× more credits. Your credits: ~{{normalTime}} normal, ~{{hqTime}} HQ.',
              {
                normalTime: formatHours(translationNormalHours),
                hqTime: formatHours(translationHqHours),
              }
            )
          : t(
              'settings.performanceQuality.qualityTranslation.help',
              'On: includes review phase (~5× more credits/time). Off: skip review.'
            )
      )}
      {row(
        t(
          'settings.performanceQuality.qualitySummary.label',
          'Quality Summary'
        ),
        summaryEffortLevel === 'high',
        v => setSummaryEffortLevel(v ? 'high' : 'standard'),
        summaryNormalHours !== null && summaryHqHours !== null
          ? t(
              'settings.performanceQuality.qualitySummary.helpWithEstimate',
              'Deep analysis + highlight clips (~4× credits). Your credits: ~{{normalTime}} normal, ~{{hqTime}} HQ.',
              {
                normalTime: formatHours(summaryNormalHours),
                hqTime: formatHours(summaryHqHours),
              }
            )
          : t(
              'settings.performanceQuality.qualitySummary.help',
              'On: deep analysis + highlight clips with Claude Opus (~4× credits). Off: fast with GPT-5.1.'
            )
      )}
      {row(
        t(
          'settings.performanceQuality.qualityDubbing.label',
          'Quality Dubbing'
        ),
        stage5DubbingTtsProvider === 'elevenlabs',
        v => setStage5DubbingTtsProvider(v ? 'elevenlabs' : 'openai'),
        dubbingNormalHours !== null && dubbingHqHours !== null
          ? t(
              'settings.performanceQuality.qualityDubbing.helpWithEstimate',
              'ElevenLabs TTS (~13× credits). Your credits: ~{{normalTime}} normal, ~{{hqTime}} HQ.',
              {
                normalTime: formatHours(dubbingNormalHours),
                hqTime: formatHours(dubbingHqHours),
              }
            )
          : t(
              'settings.performanceQuality.qualityDubbing.help',
              'On: ElevenLabs TTS (premium voices, ~13× credits). Off: OpenAI TTS (good quality).'
            )
      )}
    </div>
  );
}
