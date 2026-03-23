import { css, cx } from '@emotion/css';
import { CircleAlert, Mic } from 'lucide-react';
import Button from '../../../components/Button.js';
import { useTranslation } from 'react-i18next';
import { breakpoints, selectStyles } from '../../../styles.js';
import {
  TRANSLATION_LANGUAGE_GROUPS,
  TRANSLATION_LANGUAGES_BASE,
} from '../../../constants/translation-languages';
import {
  workflowPanelHintStyles,
  workflowPanelInlineFieldStyles,
  workflowPanelLeadIconStyles,
  workflowPanelLeadStyles,
  workflowPanelMutedStyles,
  workflowPanelStyles,
  workflowPanelTextBlockStyles,
  workflowPanelWarningBoxStyles,
  workflowPanelWarningContentStyles,
  workflowPanelWarningIconStyles,
} from '../../../components/workflow-surface-styles';
import { spacing } from '../../../components/design-system/tokens.js';

const transcribeOnlyPanelShellStyles = css`
  align-items: flex-start;
`;

const transcribeOnlyPanelLeadColumnStyles = css`
  flex: 1 1 0;
  min-width: 0;
  max-width: 440px;
`;

const transcribeOnlyPanelControlsColumnStyles = css`
  display: grid;
  gap: ${spacing.md};
  width: min(460px, 100%);
  flex: 0 1 460px;
  margin-left: auto;
  align-items: stretch;

  @media (max-width: ${breakpoints.tabletMaxWidth}) {
    width: 100%;
    flex-basis: auto;
    margin-left: 0;
  }
`;

const transcribeOnlyPanelLanguageFieldStyles = css`
  display: grid;
  gap: ${spacing.xs};
  color: inherit;
  width: 100%;

  label {
    text-align: center;
  }

  select {
    width: 100%;
  }
`;

const transcribeOnlyPanelActionRowStyles = css`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${spacing.sm};

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    grid-template-columns: 1fr;
  }
`;

const transcribeOnlyPanelActionCellStyles = css`
  min-width: 0;

  &:only-child {
    grid-column: 1 / -1;
  }
`;

interface TranscribeOnlyPanelProps {
  onTranscribe: () => void;
  onTranslate?: () => void;
  onCreateHighlight?: () => void;
  onProcessingLanguageChange?: (value: string) => void;
  isTranscribing: boolean;
  isTranslating?: boolean;
  isCreatingHighlight?: boolean;
  disabled?: boolean;
  createHighlightDisabled?: boolean;
  processingLanguage?: string;
  statusMessage?: string | null;
  className?: string;
}

export default function TranscribeOnlyPanel({
  onTranscribe,
  onTranslate,
  onCreateHighlight,
  onProcessingLanguageChange,
  isTranscribing,
  isTranslating = false,
  isCreatingHighlight = false,
  disabled = false,
  createHighlightDisabled = false,
  processingLanguage = 'english',
  statusMessage = null,
  className,
}: TranscribeOnlyPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cx(
        workflowPanelStyles,
        workflowPanelMutedStyles,
        transcribeOnlyPanelShellStyles,
        className
      )}
    >
      <div
        className={cx(
          workflowPanelLeadStyles,
          transcribeOnlyPanelLeadColumnStyles
        )}
      >
        <div className={workflowPanelLeadIconStyles} aria-hidden="true">
          <Mic size={18} strokeWidth={2.2} />
        </div>
        <div className={workflowPanelTextBlockStyles}>
          <p className={workflowPanelHintStyles}>
            {t(
              'input.preSubtitleActionsHint',
              'Transcribe, translate, or generate highlights from this video.'
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
      <div className={transcribeOnlyPanelControlsColumnStyles}>
        <Button
          onClick={onTranscribe}
          disabled={
            disabled || isTranscribing || isTranslating || isCreatingHighlight
          }
          size="lg"
          variant="secondary"
          isLoading={isTranscribing}
          fullWidth
        >
          {isTranscribing
            ? t('subtitles.generating')
            : t('input.transcribeOnly')}
        </Button>
        {onTranslate || onCreateHighlight ? (
          <>
            {onProcessingLanguageChange ? (
              <div
                className={cx(
                  workflowPanelInlineFieldStyles,
                  transcribeOnlyPanelLanguageFieldStyles
                )}
              >
                <label htmlFor="transcribe-highlight-language-select">
                  {t('subtitles.outputLanguage')}:
                </label>
                <select
                  id="transcribe-highlight-language-select"
                  className={selectStyles}
                  value={processingLanguage}
                  onChange={event =>
                    onProcessingLanguageChange(event.target.value)
                  }
                  disabled={disabled || isTranslating || isCreatingHighlight}
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
            <div className={transcribeOnlyPanelActionRowStyles}>
              {onTranslate ? (
                <div className={transcribeOnlyPanelActionCellStyles}>
                  <Button
                    onClick={onTranslate}
                    disabled={
                      disabled ||
                      isTranscribing ||
                      isTranslating ||
                      isCreatingHighlight
                    }
                    size="lg"
                    variant="primary"
                    isLoading={isTranslating}
                    fullWidth
                  >
                    {t('subtitles.translate', 'Translate')}
                  </Button>
                </div>
              ) : null}
              {onCreateHighlight ? (
                <div className={transcribeOnlyPanelActionCellStyles}>
                  <Button
                    onClick={onCreateHighlight}
                    disabled={
                      disabled ||
                      createHighlightDisabled ||
                      isTranslating ||
                      isCreatingHighlight
                    }
                    size="lg"
                    variant="warning"
                    isLoading={isCreatingHighlight}
                    fullWidth
                  >
                    {t('summary.generate', 'Generate highlights')}
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
