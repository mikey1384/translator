import Button from '../../components/Button.js';
import { useTranslation } from 'react-i18next';

interface SaveOriginalVideoButtonProps {
  downloadComplete: boolean;
  downloadedVideoPath: string | null;
  onSaveOriginalVideo: () => void;
  inputMode: 'file' | 'url';
  didDownloadFromUrl: boolean;
}

export default function SaveOriginalVideoButton({
  downloadComplete,
  downloadedVideoPath,
  onSaveOriginalVideo,
  didDownloadFromUrl,
}: SaveOriginalVideoButtonProps) {
  const { t } = useTranslation();

  if (didDownloadFromUrl && downloadComplete && downloadedVideoPath) {
    return (
      <div style={{ marginBottom: '15px', textAlign: 'center' }}>
        <Button
          variant="warning"
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
