import Button from '../../components/Button.js';
import { useTranslation } from 'react-i18next';

interface ProgressDisplayProps {
  downloadComplete: boolean;
  downloadedVideoPath: string | null;
  onSaveOriginalVideo: () => void;
  inputMode: 'file' | 'url';
  didDownloadFromUrl: boolean;
}

export default function ProgressDisplay({
  downloadComplete,
  downloadedVideoPath,
  onSaveOriginalVideo,
  didDownloadFromUrl,
}: ProgressDisplayProps) {
  const { t } = useTranslation();

  if (didDownloadFromUrl && downloadComplete && downloadedVideoPath) {
    return (
      <div style={{ marginBottom: '15px', textAlign: 'center' }}>
        <Button
          variant="success"
          size="sm"
          onClick={onSaveOriginalVideo}
          title={`Save the downloaded file: ${downloadedVideoPath}`}
        >
          {t('input.saveOriginalVideo')}
        </Button>
      </div>
    );
  }

  return null;
}
