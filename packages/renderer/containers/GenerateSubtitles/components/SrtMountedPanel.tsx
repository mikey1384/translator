import { cx } from '@emotion/css';
import { FileCheck2 } from 'lucide-react';
import { selectStyles } from '../../../styles.js';
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
  estimateDubbingCreditsFromChars,
  estimateTranslationCreditsFromChars,
  formatCredits,
} from '../../../utils/creditEstimates';
import {
  isDubbingByo,
  isTranslationByo,
  resolveDubbingCreditProvider,
  resolveEffectiveTranslationReviewModel,
  type ByoRuntimeState,
} from '../../../state/byo-runtime';
import {
  workflowPanelActionGroupStyles,
  workflowPanelBadgeStyles,
  workflowPanelCheckboxInputStyles,
  workflowPanelCheckboxLabelStyles,
  workflowPanelControlsStyles,
  workflowPanelCostStyles,
  workflowPanelCostWarningStyles,
  workflowPanelInlineFieldStyles,
  workflowPanelLeadIconStyles,
  workflowPanelLeadIconSuccessStyles,
  workflowPanelLeadStyles,
  workflowPanelMetaStyles,
  workflowPanelStyles,
  workflowPanelSuccessStyles,
  workflowPanelTextBlockStyles,
  workflowPanelTitleStyles,
} from '../../../components/workflow-surface-styles';

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
  className?: string;
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
  className,
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
  const byoUnlocked = useAiStore(s => s.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(s => s.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(s => s.byoElevenLabsUnlocked);
  const stage5AnthropicReviewAvailable = useAiStore(
    s => s.stage5AnthropicReviewAvailable
  );
  const preferredTranscriptionProvider = useAiStore(
    s => s.preferredTranscriptionProvider
  );
  const preferredDubbingProvider = useAiStore(s => s.preferredDubbingProvider);
  const stage5DubbingTtsProvider = useAiStore(s => s.stage5DubbingTtsProvider);
  const useApiKeysMode = useAiStore(s => s.useApiKeysMode);
  const useByo = useAiStore(s => s.useByo);
  const keyPresent = useAiStore(s => s.keyPresent);
  const anthropicKeyPresent = useAiStore(s => s.anthropicKeyPresent);
  const useByoAnthropic = useAiStore(s => s.useByoAnthropic);
  const useByoElevenLabs = useAiStore(s => s.useByoElevenLabs);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);
  const preferClaudeTranslation = useAiStore(s => s.preferClaudeTranslation);
  const preferClaudeReview = useAiStore(s => s.preferClaudeReview);
  const preferClaudeSummary = useAiStore(s => s.preferClaudeSummary);

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

    const ttsProvider = resolveDubbingCreditProvider(runtimeState);
    const isByo = isDubbingByo(runtimeState);

    // Regular TTS: credits based on character count
    const estimatedCredits = estimateDubbingCreditsFromChars(
      charCount,
      ttsProvider
    );

    return {
      charCount,
      ttsProvider,
      estimatedCredits,
      isByo,
      hasEnoughCredits: isByo || credits == null || credits >= estimatedCredits,
    };
  }, [order, segments, credits, runtimeState]);

  // Translation cost estimation
  const qualityTranslation = useUIStore(s => s.qualityTranslation);

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

    const isByo = isTranslationByo(runtimeState);
    const reviewModel = resolveEffectiveTranslationReviewModel(runtimeState);

    const estimatedCredits = estimateTranslationCreditsFromChars(
      charCount,
      qualityTranslation,
      reviewModel
    );
    return {
      charCount,
      estimatedCredits,
      isByo,
      hasEnoughCredits: isByo || credits == null || credits >= estimatedCredits,
      qualityEnabled: qualityTranslation,
    };
  }, [order, segments, credits, qualityTranslation, runtimeState]);

  const translationCostClassName = cx(
    workflowPanelCostStyles,
    translationEstimate && !translationEstimate.hasEnoughCredits
      ? workflowPanelCostWarningStyles
      : undefined
  );

  const dubbingCostClassName = cx(
    workflowPanelCostStyles,
    dubbingEstimate && !dubbingEstimate.hasEnoughCredits
      ? workflowPanelCostWarningStyles
      : undefined
  );

  return (
    <div
      className={cx(workflowPanelStyles, workflowPanelSuccessStyles, className)}
    >
      <div className={workflowPanelLeadStyles}>
        <div
          className={cx(
            workflowPanelLeadIconStyles,
            workflowPanelLeadIconSuccessStyles
          )}
          aria-hidden="true"
        >
          <FileCheck2 size={18} strokeWidth={2.2} />
        </div>
        <div className={workflowPanelTextBlockStyles}>
          <h3 className={workflowPanelTitleStyles}>
            {t('input.srtLoaded', 'Transcription Complete')}
          </h3>
          {srtPath && (
            <p className={workflowPanelMetaStyles}>
              {srtPath.split(/[/\\]/).pop()}
            </p>
          )}
        </div>
      </div>

      <div className={workflowPanelControlsStyles}>
        <div className={workflowPanelInlineFieldStyles}>
          <label htmlFor="output-language-select">
            {t('subtitles.outputLanguage')}:
          </label>
          <select
            id="output-language-select"
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
        </div>

        <label className={workflowPanelCheckboxLabelStyles}>
          <input
            type="checkbox"
            checked={showOriginalText}
            onChange={e => setShowOriginalText(e.target.checked)}
            className={workflowPanelCheckboxInputStyles}
          />
          {t('subtitles.showOriginalText')}
        </label>

        <div className={workflowPanelActionGroupStyles}>
          <Button
            variant="primary"
            size="md"
            onClick={onTranslate}
            disabled={isDisabled}
            isLoading={isTranslating}
          >
            {t('subtitles.translate', 'Translate')}
          </Button>
          {translationEstimate && !isTranslating && !translationEstimate.isByo && (
            <span className={translationCostClassName}>
              {formatCredits(translationEstimate.estimatedCredits)} cr
              {translationEstimate.qualityEnabled && (
                <span className={workflowPanelBadgeStyles}>
                  {t('subtitles.qualityBadge', '(hq)')}
                </span>
              )}
            </span>
          )}
        </div>

        <div className={workflowPanelActionGroupStyles}>
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
            <span className={dubbingCostClassName}>
              {formatCredits(dubbingEstimate.estimatedCredits)} cr
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
