import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../../components/design-system/index.js';

const DISMISSED_KEY = 'translator.welcomeCreditsHintDismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function WelcomeCreditsHint() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed) return null;

  return (
    <Alert
      variant="success"
      onClose={() => {
        setDismissed(true);
        try {
          window.localStorage.setItem(DISMISSED_KEY, '1');
        } catch {
          // Shown again next launch; harmless.
        }
      }}
    >
      {t(
        'generateSubtitles.welcomeCredits.message',
        'You have free credits to try transcription and translation (about 20 minutes of video).'
      )}
    </Alert>
  );
}
