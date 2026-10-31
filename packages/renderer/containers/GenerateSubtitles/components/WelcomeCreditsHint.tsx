import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../../components/design-system/index.js';
import { WELCOME_CREDITS } from '../../../../shared/constants';
import { subtitledVideoMinutes } from '../../../utils/creditEstimates';

const DISMISSED_KEY = 'translator.welcomeCreditsHintDismissed';
// 6,300 welcome credits subtitle about 12 minutes of video (rounded down).
const WELCOME_SUBTITLED_MINUTES = subtitledVideoMinutes(WELCOME_CREDITS);

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
        'You have free minutes to try transcription and translation (about {{minutes}} minutes of video).',
        { minutes: WELCOME_SUBTITLED_MINUTES }
      )}
    </Alert>
  );
}
