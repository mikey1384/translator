import { css } from '@emotion/css';
import LogoDisplay from '../components/LogoDisplay';
import LanguageSwitcher from '../components/LanguageSwitcher';
import CreditBalance from '../components/CreditBalance';
import SettingsButton from '../components/SettingsButton';
import { subtleSurfaceCardStyles } from '../styles';
import { spacing } from '../components/design-system/tokens.js';

const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: ${spacing.lg};
  padding: ${spacing.lg};
  margin-bottom: ${spacing.md};
`;

const leftGroup = css`
  display: flex;
  align-items: center;
  gap: ${spacing.xl};
  min-width: 0;
`;

const rightGroup = css`
  display: flex;
  align-items: center;
  gap: ${spacing.xl};
  flex-wrap: wrap;
  justify-content: flex-end;
`;

export default function Header() {
  return (
    <div className={`${subtleSurfaceCardStyles} ${headerRow}`}>
      <div className={leftGroup}>
        <LogoDisplay />
        <LanguageSwitcher />
      </div>

      <div className={rightGroup}>
        <CreditBalance />
        <SettingsButton />
      </div>
    </div>
  );
}
