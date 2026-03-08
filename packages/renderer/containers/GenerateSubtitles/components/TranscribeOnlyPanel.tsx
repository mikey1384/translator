import { cx } from '@emotion/css';
import { CircleAlert, Mic } from 'lucide-react';
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
              <div className={workflowPanelWarningIconStyles} aria-hidden="true">
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
