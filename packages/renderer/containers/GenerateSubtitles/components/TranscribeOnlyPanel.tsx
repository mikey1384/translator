import { cx } from '@emotion/css';
import Button from '../../../components/Button.js';
import { useTranslation } from 'react-i18next';
import {
  workflowPanelHintStyles,
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
  isTranscribing: boolean;
  disabled?: boolean;
  statusMessage?: string | null;
  className?: string;
}

export default function TranscribeOnlyPanel({
  onTranscribe,
  isTranscribing,
  disabled = false,
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
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3v18" />
            <path d="M8 7h4a4 4 0 0 1 0 8H8" />
          </svg>
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
              <div className={workflowPanelWarningIconStyles} aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
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
          disabled={disabled || isTranscribing}
          size="lg"
          variant="primary"
          isLoading={isTranscribing}
        >
          {isTranscribing
            ? t('subtitles.generating')
            : t('input.transcribeOnly')}
        </Button>
      </div>
    </div>
  );
}
