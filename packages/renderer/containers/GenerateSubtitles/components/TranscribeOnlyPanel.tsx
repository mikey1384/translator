import { css } from '@emotion/css';
import { colors } from '../../../styles.js';
import Button from '../../../components/Button.js';
import { useTranslation } from 'react-i18next';

interface TranscribeOnlyPanelProps {
  onTranscribe: () => void;
  isTranscribing: boolean;
  disabled?: boolean;
}

export default function TranscribeOnlyPanel({
  onTranscribe,
  isTranscribing,
  disabled = false,
}: TranscribeOnlyPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className={css`
        margin-top: 10px;
        padding: 20px;
        border: 1px solid ${colors.border};
        border-radius: 6px;
        background-color: ${colors.light};
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
