import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Alert } from '../../../components/design-system/index.js';
import MicroCreditCheckoutButton from '../../../components/MicroCreditCheckoutButton.js';
import { logButton } from '../../../utils/logger.js';

interface CreditWarningBannerProps {
  onSettingsClick: () => void;
}

export default function CreditWarningBanner({
  onSettingsClick,
}: CreditWarningBannerProps) {
  const { t } = useTranslation();

  return (
    <Alert variant="info">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '12px',
        }}
      >
        {/* One paragraph: in the flex column each Trans piece became its own
            line, leaving the closing period stranded below the link. */}
        <p style={{ margin: 0 }}>
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
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    try {
                      logButton('open_settings');
                    } catch {
                      // Ignore logging errors
                    }
                    onSettingsClick();
                  }}
                />
              ),
            }}
          />
        </p>
        <MicroCreditCheckoutButton placement="zero-credit-banner" />
      </div>
    </Alert>
  );
}
