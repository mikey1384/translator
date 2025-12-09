import { css } from '@emotion/css';
import { colors } from '../../../styles.js';
import Button from '../../../components/Button.js';
import { useTranslation } from 'react-i18next';

interface TranscribeOnlyPanelProps {
  onTranscribe: () => void;
  isTranscribing: boolean;
  disabled?: boolean;
  statusMessage?: string | null;
}

export default function TranscribeOnlyPanel({
  onTranscribe,
  isTranscribing,
  disabled = false,
  statusMessage = null,
}: TranscribeOnlyPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className={css`
        margin-top: 10px;
        padding: 20px;
        border: 1px solid ${colors.border};
        border-radius: 6px;
        background-color: ${colors.surface};
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 10px;
      `}
    >
      <Button
        onClick={onTranscribe}
        disabled={disabled || isTranscribing}
        size="lg"
        variant="primary"
        isLoading={isTranscribing}
      >
        {isTranscribing ? t('subtitles.generating') : t('input.transcribeOnly')}
      </Button>

      {statusMessage && (
        <div
          className={css`
            font-size: 0.9rem;
            color: ${colors.warning};
            text-align: center;
            line-height: 1.4;
          `}
        >
          {statusMessage}
        </div>
      )}

      <div
        className={css`
          font-size: 0.9rem;
          color: ${colors.gray};
          text-align: center;
        `}
      >
        {t(
          'input.featuresUnlockAfterTranscription',
          'After transcription, translation and other controls will appear.'
        )}
      </div>
    </div>
  );
}
