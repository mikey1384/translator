import React from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../../components/design-system/index.js';

interface CreditWarningBannerProps {
  onSettingsClick: () => void;
}

export default function CreditWarningBanner({
  onSettingsClick,
}: CreditWarningBannerProps) {
  const { t } = useTranslation();

  return (
    <Alert variant="warning">
      {t('generateSubtitles.creditWarning.message', {
        settingsLink: (
          <a
            style={{
              textDecoration: 'underline',
              color: 'white',
              cursor: 'pointer',
            }}
            onClick={onSettingsClick}
          >
            {t('generateSubtitles.creditWarning.settingsLinkText')}
          </a>
        ),
      })}
    </Alert>
  );
}
