import { useTranslation } from 'react-i18next';
import { Alert } from './design-system/index.js';
import { localizeErrorText } from '../utils/userFacingError';

interface Props {
  message: string;
  onClose: () => void;
}

export default function ErrorBanner({ message, onClose }: Props) {
  const { t } = useTranslation();
  // Codes and English main-process messages are shown in the UI language;
  // text a caller already translated passes through.
  const text = localizeErrorText(message, t as any);
  if (!text) return null;

  return (
    <Alert variant="error" onClose={onClose}>
      {text}
    </Alert>
  );
}
