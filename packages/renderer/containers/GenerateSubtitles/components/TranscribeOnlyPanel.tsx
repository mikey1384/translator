import { cx } from '@emotion/css';
import { CircleAlert, Mic } from 'lucide-react';
import Button from '../../../components/Button.js';
import { useTranslation } from 'react-i18next';
import { selectStyles } from '../../../styles.js';
import {
  TRANSLATION_LANGUAGE_GROUPS,
  TRANSLATION_LANGUAGES_BASE,
} from '../../../constants/translation-languages';
import {
  workflowPanelActionGroupStyles,
  workflowPanelHintStyles,
  workflowPanelInlineFieldStyles,
  workflowPanelLeadIconStyles,
  workflowPanelLeadStyles,
  workflowPanelMutedStyles,
  workflowPanelControlsStyles,
  workflowPanelStyles,
  workflowPanelTextBlockStyles,
  workflowPanelTitleStyles,
  workflowPanelWarningBoxStyles,
  workflowPanelWarningContentStyles,
  workflowPanelWarningIconStyles,
} from '../../../components/workflow-surface-styles';

interface TranscribeOnlyPanelProps {
  onTranscribe: () => void;
  onCreateHighlight?: () => void;
  onSummaryLanguageChange?: (value: string) => void;
  isTranscribing: boolean;
  isCreatingHighlight?: boolean;
  disabled?: boolean;
  createHighlightDisabled?: boolean;
  summaryLanguage?: string;
  statusMessage?: string | null;
  className?: string;
}

export default function TranscribeOnlyPanel({
  onTranscribe,
  onCreateHighlight,
  onSummaryLanguageChange,
  isTranscribing,
  isCreatingHighlight = false,
  disabled = false,
  createHighlightDisabled = false,
  summaryLanguage = 'english',
  statusMessage = null,
  className,
}: TranscribeOnlyPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cx(workflowPanelStyles, workflowPanelMutedStyles, className)}
    >
      <div className={workflowPanelLeadStyles}>
        <div className={workflowPanelLeadIconStyles} aria-hidden="true">
          <Mic size={18} strokeWidth={2.2} />
        </div>
        <div className={workflowPanelTextBlockStyles}>
          <h3 className={workflowPanelTitleStyles}>
            {t('input.transcribeOnly')}
          </h3>
          <p className={workflowPanelHintStyles}>
            {t(
              'input.featuresUnlockAfterTranscription',
              'After transcription, translation and other controls will appear.'
            )}
          </p>
          {statusMessage && (
            <div className={workflowPanelWarningBoxStyles} role="alert">
              <div
                className={workflowPanelWarningIconStyles}
                aria-hidden="true"
              >
                <CircleAlert size={14} strokeWidth={2.2} />
              </div>
              <div className={workflowPanelWarningContentStyles}>
                {statusMessage}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className={workflowPanelControlsStyles}>
        <Button
          onClick={onTranscribe}
          disabled={disabled || isTranscribing || isCreatingHighlight}
          size="lg"
          variant="primary"
          isLoading={isTranscribing}
        >
          {isTranscribing
            ? t('subtitles.generating')
            : t('input.transcribeOnly')}
        </Button>
        {onCreateHighlight ? (
          <div className={workflowPanelActionGroupStyles}>
            <Button
              onClick={onCreateHighlight}
              disabled={createHighlightDisabled || isCreatingHighlight}
              size="lg"
              variant="secondary"
              isLoading={isCreatingHighlight}
            >
              {t('summary.generate', 'Generate highlights')}
            </Button>
            {onSummaryLanguageChange ? (
              <div className={workflowPanelInlineFieldStyles}>
                <label htmlFor="transcribe-highlight-language-select">
                  {t('subtitles.outputLanguage')}:
                </label>
                <select
                  id="transcribe-highlight-language-select"
                  className={selectStyles}
                  value={summaryLanguage}
                  onChange={event =>
                    onSummaryLanguageChange(event.target.value)
                  }
                  disabled={createHighlightDisabled || isCreatingHighlight}
                >
                  {TRANSLATION_LANGUAGES_BASE.map(option => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                  {TRANSLATION_LANGUAGE_GROUPS.map(group => (
                    <optgroup key={group.labelKey} label={t(group.labelKey)}>
                      {group.options.map(option => (
                        <option key={option.value} value={option.value}>
                          {t(option.labelKey)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
