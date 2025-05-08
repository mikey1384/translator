import { css } from '@emotion/css';
import { useUIStore } from '../state';
import LogoDisplay from '../components/LogoDisplay';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';

const headerBtn = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  gap: 15px;
`;

export default function Header() {
  const { t } = useTranslation();
  const { showSettings, toggleSettings } = useUIStore();

  return (
    <div className={headerBtn}>
      {showSettings ? (
        <button
          className={css`
            padding: 8px 15px;
            font-size: 0.9em;
            background: #eee;
            border: 1px solid #ccc;
            border-radius: 4px;
            cursor: pointer;
          `}
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
        <button className={headerBtn} onClick={() => toggleSettings(true)}>
          {t('common.settings')}
        </button>
      )}
    </div>
  );
}
