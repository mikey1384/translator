import { colors } from '../../styles.js';
import Button from '../../components/Button.js';

interface ProgressDisplayProps {
  isProcessingUrl: boolean;
  progressPercent: number;
  progressStage: string;
  downloadComplete: boolean;
  downloadedVideoPath: string | null;
  onSaveOriginalVideo: () => void;
  inputMode: 'file' | 'url';
  didDownloadFromUrl: boolean;
}

export default function ProgressDisplay({
  isProcessingUrl,
  progressPercent,
  progressStage,
  downloadComplete,
  downloadedVideoPath,
  onSaveOriginalVideo,
  didDownloadFromUrl,
}: ProgressDisplayProps) {
  if (isProcessingUrl && progressPercent > 0 && !downloadComplete) {
    return (
      <div
        style={{
          marginBottom: '15px',
          padding: '10px',
          border: `1px solid ${colors.border}`,
          borderRadius: '4px',
          backgroundColor: colors.light,
        }}
      >
        <div
          style={{
            marginBottom: '5px',
            fontSize: '0.9em',
            color: colors.grayDark,
          }}
        >
          {progressStage}
        </div>
        <div
          style={{
            height: '8px',
            backgroundColor: colors.grayLight,
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progressPercent}%`,
              height: '100%',
              backgroundColor: colors.primary,
              transition: 'width 0.2s ease-out',
            }}
          />
        </div>
      </div>
    );
  }

  if (didDownloadFromUrl && downloadComplete && downloadedVideoPath) {
    return (
      <div style={{ marginBottom: '15px', textAlign: 'center' }}>
        <Button
          variant="success"
          size="sm"
          onClick={onSaveOriginalVideo}
          title={`Save the downloaded file: ${downloadedVideoPath}`}
        >
          Save Original Video
        </Button>
      </div>
    );
  }

  return null;
}
