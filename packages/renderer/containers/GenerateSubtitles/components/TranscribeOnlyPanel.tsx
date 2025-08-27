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
      `}
    >
      <Button
        onClick={onTranscribe}
        disabled={disabled || isTranscribing}
        size="lg"
        variant="primary"
        isLoading={isTranscribing}
      >
        {isTranscribing
          ? t('subtitles.generating')
          : t('subtitles.transcribeOnly', 'Transcribe Audio')}
      </Button>
    </div>
  );
}
