import React from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';

// Define Key Status Type (can be shared or moved to a types file)
type ApiKeyStatus = {
  openai: boolean;
  anthropic: boolean;
} | null;

interface ApiKeyLockProps {
  apiKeyStatus: ApiKeyStatus;
  isLoadingKeyStatus: boolean;
  onNavigateToSettings: (show: boolean) => void;
}

// Add styles for the locked state - copied from index.tsx
const lockedContainerStyles = css`
  padding: 2rem 1.5rem;
  border: 1px solid ${colors.border}; // Use theme border color
  border-radius: 8px;
  background-color: ${colors.light}; // Use secondary dark background
  text-align: center;
  margin-bottom: 1rem;
`;

const lockedTitleStyles = css`
  font-size: 1.1rem;
  font-weight: 600;
  color: ${colors.dark}; // Use light text color
  margin-bottom: 0.75rem;
`;

const lockedProgressStyles = css`
  font-size: 1rem;
  color: ${colors.grayDark}; // Use secondary light text
  margin-bottom: 1.5rem;
  span {
    font-weight: bold;
    color: ${colors.primary}; // Use primary accent color
  }
`;

const goToSettingsButtonStyles = css`
  padding: 8px 16px;
  font-size: 0.9rem;
  background-color: ${colors.grayLight}; // Use surface color for background
  color: ${colors.dark}; // Use light text color
  border: 1px solid ${colors.border}; // Use theme border color
  border-radius: 6px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  box-shadow: none; // Flat design

  &:hover {
    background-color: ${colors.border}; // Slightly darker on hover
    border-color: ${colors.primary};
    color: ${colors.dark};
  }
`;

const ApiKeyLock: React.FC<ApiKeyLockProps> = ({
  apiKeyStatus,
  isLoadingKeyStatus,
  onNavigateToSettings,
}) => {
  // Calculate key status
  const keysSetCount = apiKeyStatus
    ? (apiKeyStatus.openai ? 1 : 0) + (apiKeyStatus.anthropic ? 1 : 0)
    : 0;
  const allKeysSet = keysSetCount === 2;

  if (isLoadingKeyStatus) {
    return <p>Loading API Key status...</p>;
  }

  if (allKeysSet) {
    return null; // Don't render anything if keys are set
  }

  return (
    <div className={lockedContainerStyles}>
      <div className={lockedTitleStyles}>API Key Setup Required</div>
      <div className={lockedProgressStyles}>
        Required Keys Set: <span>{keysSetCount}</span>/2
      </div>
      <p
        style={{
          fontSize: '0.9rem',
          color: colors.gray,
          marginBottom: '1rem',
        }}
      >
        Please add your OpenAI and Anthropic API keys in the settings to enable
        subtitle generation and translation.
      </p>
      <button
        className={goToSettingsButtonStyles}
        onClick={() => onNavigateToSettings(true)}
        title="Go to Settings to add API Keys"
      >
        Go to Settings
      </button>
    </div>
  );
};

export default ApiKeyLock;
