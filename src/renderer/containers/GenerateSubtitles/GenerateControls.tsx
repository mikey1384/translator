import { css } from '@emotion/css';
import Button from '../../components/Button.js';
import { colors } from '../../styles.js';
import { useTranslation } from 'react-i18next';

interface GenerateControlsProps {
  videoFile: File | null;
  videoFilePath?: string | null;
  isGenerating: boolean;
  isProcessingUrl: boolean;
  handleGenerateSubtitles: () => void;
}

export default function GenerateControls({
  videoFile,
  videoFilePath,
  isGenerating,
  isProcessingUrl,
  handleGenerateSubtitles,
}: GenerateControlsProps) {
  const { t } = useTranslation();

  return (
    <div
      className={css`
        margin-top: 10px;
        padding: 20px;
        border: 1px solid ${colors.border};
        border-radius: 6px;
        background-color: ${colors.light};
      `}
    >
      <label
        className={css`
          margin-right: 12px;
        `}
      >
        3. {t('subtitles.generate')}:
      </label>
      <Button
        onClick={handleGenerateSubtitles}
        disabled={
          (!videoFile && !videoFilePath) || isGenerating || isProcessingUrl
        }
        size="md"
        variant="primary"
        isLoading={isGenerating}
      >
        {isGenerating ? t('subtitles.generating') : t('subtitles.generateNow')}
      </Button>
    </div>
  );
}
