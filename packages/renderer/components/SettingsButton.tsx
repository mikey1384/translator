import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../state';
import { logButton } from '../utils/logger';
import { colors } from '../styles';

const textButtonStyles = css`
  padding: 8px 15px;
  font-size: 0.9em;
  background-color: ${colors.grayLight};
  color: ${colors.text};
  border: 1px solid ${colors.border};
  border-radius: 4px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  box-shadow: none;

  &:hover {
    background-color: ${colors.surface};
    border-color: ${colors.primary};
  }
`;

const iconButtonStyles = css`
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: ${colors.gray};
  display: flex;
  align-items: center;
  &:hover {
    color: ${colors.text};
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
    return (
      <button
        className={iconButtonStyles}
        onClick={handleClick}
        aria-label="Settings"
        title="Settings"
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
    <button className={textButtonStyles} onClick={handleClick}>
      {t('common.settings')}
    </button>
  );
}
