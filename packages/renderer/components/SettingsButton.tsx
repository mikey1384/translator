import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../state';
import { logButton } from '../utils/logger';
import { colors } from '../styles';
import Button from './Button';
import { borderRadius } from './design-system/tokens.js';

const iconButtonStyles = css`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.full};
  width: 38px;
  height: 38px;
  padding: 0;
  cursor: pointer;
  color: ${colors.textDim};
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    color: ${colors.text};
    border-color: ${colors.borderStrong};
    background: rgba(255, 255, 255, 0.06);
  }
`;

interface SettingsButtonProps {
  variant?: 'text' | 'icon';
  size?: number;
}

export default function SettingsButton({
  variant = 'text',
  size = 18,
}: SettingsButtonProps) {
  const { t } = useTranslation();
  const toggleSettings = useUIStore(s => s.toggleSettings);

  const handleClick = () => {
    try {
      logButton('open_settings');
    } catch {
      // Ignore logging errors
    }
    toggleSettings(true);
  };

  if (variant === 'icon') {
    const settingsLabel = t('common.settings', 'Settings');
    return (
      <button
        className={iconButtonStyles}
        onClick={handleClick}
        aria-label={settingsLabel}
        title={settingsLabel}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleClick}>
      {t('common.settings')}
    </Button>
  );
}
