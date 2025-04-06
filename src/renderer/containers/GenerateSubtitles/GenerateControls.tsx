import { css } from '@emotion/css';
import Button from '../../components/Button.js';
import { colors } from '../../styles.js';

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
        3. Generate Subtitles:
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
        {isGenerating ? 'Generating...' : 'Generate Subtitles Now'}
      </Button>
    </div>
  );
}
