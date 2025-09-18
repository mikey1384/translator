import Button from '../../components/Button.js';
import { useTranslation } from 'react-i18next';

interface SaveDubbedVideoButtonProps {
  dubbedVideoPath: string | null;
  onSaveDubbedVideo: () => void;
  disabled?: boolean;
}

export default function SaveDubbedVideoButton({
  dubbedVideoPath,
  onSaveDubbedVideo,
  disabled = false,
}: SaveDubbedVideoButtonProps) {
  const { t } = useTranslation();

  if (!dubbedVideoPath) return null;

  return (
    <div style={{ marginBottom: '12px', textAlign: 'center' }}>
      <Button
        variant="success"
        size="sm"
        onClick={onSaveDubbedVideo}
        disabled={disabled}
        title={dubbedVideoPath}
      >
        {t('input.saveDubbedVideo')}
      </Button>
    </div>
  );
}
