import { css } from '@emotion/css';
import { colors } from '../../styles.js';

type ApiKeyStatus = {
  openai: boolean;
} | null;

interface ApiKeyLockProps {
  apiKeyStatus: ApiKeyStatus;
  isLoadingKeyStatus: boolean;
  onNavigateToSettings: (show: boolean) => void;
}

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

export default function ApiKeyLock({
  apiKeyStatus,
  isLoadingKeyStatus,
  onNavigateToSettings,
}: ApiKeyLockProps) {
  const keysSetCount = apiKeyStatus ? (apiKeyStatus.openai ? 1 : 0) : 0;
  const allKeysSet = keysSetCount === 1; // Changed required count to 1

  if (isLoadingKeyStatus) {
    return <p>Loading API Key status...</p>;
  }

  if (allKeysSet) {
    return null; // Don't render anything if keys are set
  }

  return (
    <div className={lockedContainerStyles}>
      <div className={lockedTitleStyles}>API Key Setup Required</div>
      <p
        style={{
          fontSize: '0.9rem',
          color: colors.gray,
          marginBottom: '1rem',
          lineHeight: '1.5',
        }}
      >
        {`To get started with subtitle generation and translation, please add your
        OpenAI API key in the settings. Don't worry if you don't know how to get
        one - we have a guide to help you!`}
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
}
