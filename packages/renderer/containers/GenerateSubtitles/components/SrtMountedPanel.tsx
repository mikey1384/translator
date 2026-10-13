import { cx } from '@emotion/css';
import { FileCheck2 } from 'lucide-react';
import type { SubtitleDisplayMode } from '@shared-types/app';
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
import { useCreditCostEstimates } from '../../../hooks/useCreditCostEstimates';
import { TTS_CREDITS_PER_MINUTE } from '../../../../shared/constants';
import {
  workflowPanelActionGroupStyles,
  workflowPanelBadgeStyles,
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
  const subtitleDisplayMode = useUIStore(s => s.subtitleDisplayMode);
  const setSubtitleDisplayMode = useUIStore(s => s.setSubtitleDisplayMode);
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

  const { dubbingEstimate, translationEstimate, formatCostLabel } =
    useCreditCostEstimates();

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

        <div className={workflowPanelInlineFieldStyles}>
          <label htmlFor="subtitle-display-mode-select">
            {t('subtitles.displayModeLabel', 'Subtitle display')}:
          </label>
          <select
            id="subtitle-display-mode-select"
            className={selectStyles}
            value={subtitleDisplayMode}
            onChange={e =>
              setSubtitleDisplayMode(e.target.value as SubtitleDisplayMode)
            }
            disabled={isDisabled}
          >
            <option value="original">
              {t('editSubtitles.workspace.originalLabel', 'Original')}
            </option>
            <option value="translation">
              {t(
                'editSubtitles.workspace.translationMode',
                'Translation-only mode'
              )}
            </option>
            <option value="dual">
              {t('editSubtitles.workspace.dualMode', 'Dual text mode')}
            </option>
          </select>
        </div>

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
          {translationEstimate &&
            !isTranslating &&
            !translationEstimate.isByo && (
              <span className={translationCostClassName}>
                {formatCostLabel(translationEstimate.estimatedCredits)}
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
            <span
              className={dubbingCostClassName}
              title={
                dubbingEstimate.blockedInApiKeyMode
                  ? t(
                      'settings.byoPreferences.dubbingRequiresElevenLabs',
                      'Dubbing uses ElevenLabs only. Add an ElevenLabs API key to dub with your own keys. Without one, dubbing uses Stage5 credits, which are not used while your API keys are on.'
                    )
                  : t(
                      'subtitles.dubCostHint',
                      'ElevenLabs voice: ~{{rate}} credits per minute of speech. This estimate is shown before dubbing starts.',
                      {
                        rate: Math.round(TTS_CREDITS_PER_MINUTE.elevenlabs),
                      }
                    )
              }
            >
              {dubbingEstimate.blockedInApiKeyMode
                ? 'ElevenLabs'
                : `${formatCostLabel(dubbingEstimate.estimatedCredits)} · ElevenLabs`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
