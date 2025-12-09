import { css } from '@emotion/css';
import LogoDisplay from '../components/LogoDisplay';
import LanguageSwitcher from '../components/LanguageSwitcher';
import CreditBalance from '../components/CreditBalance';
import SettingsButton from '../components/SettingsButton';

const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  gap: 15px;
`;

export default function Header() {
  return (
    <div className={headerRow}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <LogoDisplay />
        <LanguageSwitcher />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '25px' }}>
        <CreditBalance />
        <SettingsButton />
      </div>
    </div>
  );
}
