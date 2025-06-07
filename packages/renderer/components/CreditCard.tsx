import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useCreditStore } from '../state';
import BuyCreditsButton from './BuyCreditsButton';
import { colors } from '../styles';

const card = css`
  background: rgba(40, 40, 40, 0.6);
  border: 1px solid ${colors.border};
  border-radius: 8px;
  padding: 24px;
  max-width: 660px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const balanceTxt = css`
  font-size: 1.9rem;
  font-weight: 600;
  color: ${colors.primary};
`;

export default function CreditCard() {
  const { t } = useTranslation();
  const { balance, loading, error } = useCreditStore();

  return (
    <section className={card}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
        {t('credits.title')}
      </h2>

      {loading ? (
        <p style={{ color: colors.textDim }}>{t('credits.loading')}</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : (
        <>
          <span className={balanceTxt}>
            {(balance ?? 0).toFixed(1)}
            <span style={{ fontSize: '1rem', fontWeight: 400 }}>
              {' '}
              {t('credits.hours')}
            </span>
          </span>

          {/* single purchase option */}
          <BuyCreditsButton packId="HOUR_5" />
          <p style={{ fontSize: '.85rem', color: colors.grayDark }}>
            {t('credits.description')}
          </p>
        </>
      )}
    </section>
  );
}
