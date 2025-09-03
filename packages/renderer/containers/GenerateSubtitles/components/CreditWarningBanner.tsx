import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Alert } from '../../../components/design-system/index.js';
import { logButton } from '../../../utils/logger.js';

interface CreditWarningBannerProps {
  onSettingsClick: () => void;
}

export default function CreditWarningBanner({
  onSettingsClick,
}: CreditWarningBannerProps) {
  const { t } = useTranslation();

  return (
    <Alert variant="warning">
      <Trans
        i18nKey="generateSubtitles.creditWarning.message"
        values={{
          settingsLinkText: t(
            'generateSubtitles.creditWarning.settingsLinkText'
          ),
        }}
        components={{
          settingsLink: (
            <a
              style={{
                textDecoration: 'underline',
                color: 'white',
                cursor: 'pointer',
              }}
              onClick={() => {
              try { logButton('open_settings'); } catch {}
              onSettingsClick();
            }}
            />
          ),
        }}
      />
    </Alert>
  );
}
