import React from 'react';
import { Alert } from '../../../components/design-system/index.js';

interface CreditWarningBannerProps {
  onSettingsClick: () => void;
}

export default function CreditWarningBanner({
  onSettingsClick,
}: CreditWarningBannerProps) {
  return (
    <Alert variant="warning">
      Purchase credits in{' '}
      <a
        style={{
          textDecoration: 'underline',
          color: 'white',
          cursor: 'pointer',
        }}
        onClick={onSettingsClick}
      >
        Settings
      </a>{' '}
      to continue.
    </Alert>
  );
}
