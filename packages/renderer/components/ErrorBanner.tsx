import { Alert } from './design-system/index.js';

interface Props {
  message: string;
  onClose: () => void;
}

export default function ErrorBanner({ message, onClose }: Props) {
  if (!message) return null;

  return (
    <Alert variant="error" onClose={onClose}>
      {message}
    </Alert>
  );
}
