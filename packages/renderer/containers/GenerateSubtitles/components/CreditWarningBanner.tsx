import React from 'react';
import { Trans } from 'react-i18next';
import { Alert } from '../../../components/design-system/index.js';

interface CreditWarningBannerProps {
  onSettingsClick: () => void;
}

export default function CreditWarningBanner({
  onSettingsClick,
}: CreditWarningBannerProps) {
  return (
    <Alert variant="warning">
      <Trans
        i18nKey="generateSubtitles.creditWarning.message"
        components={{
          settingsLink: (
            <a
              style={{
                textDecoration: 'underline',
                color: 'white',
                cursor: 'pointer',
              }}
              onClick={onSettingsClick}
            />
          ),
        }}
      />
    </Alert>
  );
}
