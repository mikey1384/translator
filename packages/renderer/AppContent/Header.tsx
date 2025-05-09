import { css } from '@emotion/css';
import { useUIStore } from '../state';
import LogoDisplay from '../components/LogoDisplay';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { colors } from '../styles';

const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  gap: 15px;
`;

const settingsButton = css`
  padding: 8px 15px;
  font-size: 0.9em;
  background-color: ${colors.grayLight};
  color: ${colors.dark};
  border: 1px solid ${colors.border};
  border-radius: 4px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  box-shadow: none;

  &:hover {
    background-color: ${colors.light};
    border-color: ${colors.primary};
  }
`;

export default function Header() {
  const { t } = useTranslation();
  const { showSettings, toggleSettings } = useUIStore();

  return (
    <div className={headerRow}>
      {showSettings ? (
        <button
          className={settingsButton}
          onClick={() => toggleSettings(false)}
        >
          {t('common.backToApp')}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <LogoDisplay />
          <LanguageSwitcher />
        </div>
      )}

      {!showSettings && (
        <button className={settingsButton} onClick={() => toggleSettings(true)}>
          {t('common.settings')}
        </button>
      )}
    </div>
  );
}
