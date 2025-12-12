import { css } from '@emotion/css';
import { colors, selectStyles } from '../../../styles.js';
import { useTranslation } from 'react-i18next';
import Button from '../../../components/Button.js';
import { useUIStore } from '../../../state/ui-store';
import {
  TRANSLATION_LANGUAGES_BASE,
  TRANSLATION_LANGUAGE_GROUPS,
} from '../../../constants/translation-languages';
import { useTaskStore } from '../../../state/task-store';
import { useUrlStore } from '../../../state/url-store';
import { useSubStore } from '../../../state/subtitle-store';
import { useAiStore } from '../../../state/ai-store';
import { useCreditStore } from '../../../state/credit-store';
import { useMemo } from 'react';
import {
  CREDITS_PER_1K_TOKENS_PROMPT,
  CREDITS_PER_1K_TOKENS_COMPLETION,
  TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER,
  TRANSLATION_QUALITY_MULTIPLIER,
} from '../../../../shared/constants';
import { formatCredits } from '../../../utils/creditEstimates';

// TTS credits per character (based on pricing.ts calculations with margin)
// OpenAI tts-1: $15/1M chars * 2 margin / USD_PER_CREDIT ≈ 1.05 credits/char
// ElevenLabs: $200/1M chars * 2 margin / USD_PER_CREDIT ≈ 14 credits/char
const TTS_CREDITS_PER_CHAR = {
  openai: 1.05,
  elevenlabs: 14,
} as const;

// Translation credits estimation: input tokens ≈ chars/4, output ≈ input
function estimateTranslationCredits(
  charCount: number,
  qualityEnabled: boolean
): number {
  const inputTokens = Math.ceil(charCount / 4);
  const outputTokens = inputTokens; // Translation output is roughly same size as input
  const baseCredits = Math.ceil(
    (inputTokens / 1000) * CREDITS_PER_1K_TOKENS_PROMPT +
      (outputTokens / 1000) * CREDITS_PER_1K_TOKENS_COMPLETION
  );
  const withOverhead = Math.ceil(
    baseCredits * TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER
  );
  return qualityEnabled
    ? Math.ceil(withOverhead * TRANSLATION_QUALITY_MULTIPLIER)
    : withOverhead;
}

interface SrtMountedPanelProps {
  srtPath?: string | null;
  onTranslate?: () => void;
  isTranslating?: boolean;
  onDub?: () => void;
  isDubbing?: boolean;
  disabled?: boolean;
  targetLanguage?: string;
  onTargetLanguageChange?: (lang: string) => void;
  disableDub?: boolean;
}

export default function SrtMountedPanel({
  srtPath,
  onTranslate,
  isTranslating = false,
  onDub,
  isDubbing = false,
  disabled = false,
  targetLanguage,
  onTargetLanguageChange,
  disableDub = false,
}: SrtMountedPanelProps) {
  const { t } = useTranslation();
  const showOriginalText = useUIStore(s => s.showOriginalText);
  const setShowOriginalText = useUIStore(s => s.setShowOriginalText);
  const isTranscribing = useTaskStore(s => !!s.transcription.inProgress);
  const isTranslationTaskActive = useTaskStore(s => !!s.translation.inProgress);
  const isMergeInProgress = useTaskStore(s => !!s.merge.inProgress);
  const isSummaryInProgress = useTaskStore(s => !!s.summary.inProgress);
  const isDownloadInProgress = useUrlStore(s => s.download.inProgress);
  const isTranslationBusy = isTranslating || isTranslationTaskActive;
  const isDisabled =
    disabled ||
    isTranslationBusy ||
    isTranscribing ||
    isMergeInProgress ||
    isSummaryInProgress;
  const isDubDisabled =
    disabled ||
    disableDub ||
    isTranscribing ||
    isTranslationBusy ||
    isDubbing ||
    isMergeInProgress ||
    isSummaryInProgress ||
    isDownloadInProgress;

  // Dubbing cost estimation
  const segments = useSubStore(s => s.segments);
  const order = useSubStore(s => s.order);
  const credits = useCreditStore(s => s.credits);
  const preferredDubbingProvider = useAiStore(s => s.preferredDubbingProvider);
  const stage5DubbingTtsProvider = useAiStore(s => s.stage5DubbingTtsProvider);
  const useByoMaster = useAiStore(s => s.useByoMaster);
  const useByoElevenLabs = useAiStore(s => s.useByoElevenLabs);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);

  // Calculate total character count from subtitles (use translation if available, else original)
  const dubbingEstimate = useMemo(() => {
    let charCount = 0;
    for (const id of order) {
      const seg = segments[id];
      if (!seg) continue;
      const text = (seg.translation || seg.original || '').trim();
      charCount += text.length;
    }
    if (charCount === 0) return null;

    // Determine which TTS provider will be used
    let ttsProvider: 'openai' | 'elevenlabs' = 'openai';
    if (useByoMaster && useByoElevenLabs && elevenLabsKeyPresent) {
      // BYO ElevenLabs - no Stage5 credits used
      ttsProvider = 'elevenlabs';
    } else if (preferredDubbingProvider === 'stage5') {
      // Stage5 credits - use user's selected TTS provider preference
      ttsProvider = stage5DubbingTtsProvider;
    } else if (preferredDubbingProvider === 'openai') {
      ttsProvider = 'openai';
    }

    // For BYO keys, we don't show credit estimates (user pays directly)
    const isByo =
      useByoMaster &&
      ((preferredDubbingProvider === 'elevenlabs' &&
        useByoElevenLabs &&
        elevenLabsKeyPresent) ||
        preferredDubbingProvider === 'openai');

    // Regular TTS: credits based on character count
    const creditsPerChar = TTS_CREDITS_PER_CHAR[ttsProvider];
    const estimatedCredits = Math.ceil(charCount * creditsPerChar);

    return {
      charCount,
      ttsProvider,
      estimatedCredits,
      isByo,
      hasEnoughCredits: isByo || credits == null || credits >= estimatedCredits,
    };
  }, [
    order,
    segments,
    credits,
    preferredDubbingProvider,
    stage5DubbingTtsProvider,
    useByoMaster,
    useByoElevenLabs,
    elevenLabsKeyPresent,
  ]);

  // Translation cost estimation
  const qualityTranslation = useUIStore(s => s.qualityTranslation);
  const keyPresent = useAiStore(s => s.keyPresent); // BYO OpenAI key
  const useByo = useAiStore(s => s.useByo);

  const translationEstimate = useMemo(() => {
    let charCount = 0;
    for (const id of order) {
      const seg = segments[id];
      if (!seg) continue;
      // Translation is based on original text
      const text = (seg.original || '').trim();
      charCount += text.length;
    }
    if (charCount === 0) return null;

    // For BYO keys, we don't show credit estimates (user pays directly)
    const isByo = useByoMaster && useByo && keyPresent;

    const estimatedCredits = estimateTranslationCredits(
      charCount,
      qualityTranslation
    );
    return {
      charCount,
      estimatedCredits,
      isByo,
      hasEnoughCredits: isByo || credits == null || credits >= estimatedCredits,
      qualityEnabled: qualityTranslation,
    };
  }, [
    order,
    segments,
    credits,
    qualityTranslation,
    useByoMaster,
    useByo,
    keyPresent,
  ]);

  return (
    <div
      className={css`
        margin-top: 10px;
        padding: 20px;
        border: 1px solid ${colors.success};
        border-radius: 6px;
        background-color: ${colors.success}0F;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
      `}
    >
      <div
        className={css`
          display: flex;
          align-items: center;
          gap: 12px;
        `}
      >
        <span
          className={css`
            color: ${colors.success};
            font-size: 1.2rem;
          `}
        >
          ✓
        </span>
        <div>
          <div
            className={css`
              font-weight: 600;
              color: ${colors.text};
            `}
          >
            {t('input.srtLoaded', 'Transcription Complete')}
          </div>
          {srtPath && (
            <div
              className={css`
                font-size: 0.9rem;
                color: ${colors.gray};
                margin-top: 2px;
              `}
            >
              {srtPath.split(/[/\\]/).pop()}
            </div>
          )}
        </div>
      </div>

      <div
        className={css`
          display: flex;
          align-items: center;
          gap: 12px;
        `}
      >
        <label
          className={css`
            margin-right: 6px;
          `}
        >
          {t('subtitles.outputLanguage')}:
        </label>
        <select
          className={selectStyles}
          value={targetLanguage}
          onChange={e => onTargetLanguageChange?.(e.target.value)}
          disabled={isDisabled}
        >
          {TRANSLATION_LANGUAGES_BASE.map(opt => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
          {TRANSLATION_LANGUAGE_GROUPS.map(group => (
            <optgroup key={group.labelKey} label={t(group.labelKey)}>
              {group.options.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <div
          className={css`
            margin-top: 8px;
          `}
        >
          <label
            className={css`
              display: inline-flex;
              align-items: center;
              cursor: pointer;
            `}
          >
            <input
              type="checkbox"
              checked={showOriginalText}
              onChange={e => setShowOriginalText(e.target.checked)}
              className={css`
                margin-right: 6px;
                accent-color: #4361ee;
              `}
            />
            {t('subtitles.showOriginalText')}
          </label>
        </div>

        <div
          className={css`
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
          `}
        >
          <Button
            variant="primary"
            size="md"
            onClick={onTranslate}
            disabled={isDisabled}
            isLoading={isTranslating}
          >
            {t('subtitles.translate', 'Translate')}
          </Button>
          {translationEstimate &&
            !isTranslating &&
            !translationEstimate.isByo && (
              <span
                className={css`
                  font-size: 0.75rem;
                  color: ${translationEstimate.hasEnoughCredits
                    ? colors.gray
                    : colors.danger};
                  text-align: center;
                `}
              >
                {formatCredits(translationEstimate.estimatedCredits)} cr
                {translationEstimate.qualityEnabled && (
                  <span
                    className={css`
                      color: ${colors.primaryDark};
                      margin-left: 2px;
                    `}
                  >
                    {t('subtitles.qualityBadge', '(hq)')}
                  </span>
                )}
              </span>
            )}
        </div>
        <div
          className={css`
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
          `}
        >
          <Button
            variant="secondary"
            size="md"
            onClick={onDub}
            disabled={isDubDisabled}
            isLoading={isDubbing}
          >
            {t('subtitles.dub', 'Dub Voice')}
          </Button>
          {dubbingEstimate && !isDubbing && !dubbingEstimate.isByo && (
            <span
              className={css`
                font-size: 0.75rem;
                color: ${dubbingEstimate.hasEnoughCredits
                  ? colors.gray
                  : colors.danger};
                text-align: center;
              `}
            >
              {formatCredits(dubbingEstimate.estimatedCredits)} cr
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
