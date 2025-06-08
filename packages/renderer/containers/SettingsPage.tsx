import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import CreditCard from '../components/CreditCard';
import { colors } from '../styles';
import { useCreditStore } from '../state/credit-store';
import { useEffect } from 'react';

export default function SettingsPage() {
  const { t } = useTranslation();
  useEffect(() => {
    useCreditStore.getState().refresh();
  }, []);

  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: 48px;
        padding: 30px 0;
      `}
    >
      {/* —————————————————  TITLE  ————————————————— */}
      <header
        className={css`
          max-width: 700px;
          margin: 0 auto;
          border-bottom: 1px solid ${colors.border};
          padding-bottom: 18px;
        `}
      >
        <h1
          className={css`
            font-size: 1.8em;
            color: ${colors.dark};
            margin: 0;
          `}
        >
          {t('settings.title')}
        </h1>
        <p
          className={css`
            margin-top: 10px;
            font-size: 0.95em;
            color: ${colors.grayDark};
            line-height: 1.4;
          `}
        >
          {t('settings.creditsDescription')}
        </p>
      </header>

      {/* —————————————————  CREDIT CARD  ————————————————— */}
      <CreditCard />
    </div>
  );
}
