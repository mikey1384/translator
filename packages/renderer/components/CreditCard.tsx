import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useCreditStore } from '../state';
import BuyCreditsButton from './BuyCreditsButton';
import { colors, surfaceCardStyles } from '../styles';
import { CREDIT_PACKS } from '../../shared/constants';
import { estimateTranslatableHours } from '../utils/creditEstimates';

const card = css`
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

function formatUsdListPrice(price: number): string {
  return `US$${price}`;
}

export default function CreditCard() {
  const { t } = useTranslation();
  const credits = useCreditStore(s => s.credits);
  const hours = useCreditStore(s => s.hours);
  const loading = useCreditStore(s => s.loading);
  const error = useCreditStore(s => s.error);
  const translationHoursLabel = t(
    'credits.translationHoursShort',
    'translation hrs'
  );
  const fmtHours = (v: number | null | undefined) =>
    typeof v === 'number'
      ? v.toLocaleString(undefined, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })
      : '';
  const sharedHoursRemaining = estimateTranslatableHours(credits, false);
  const creditPacks = [
    CREDIT_PACKS.MICRO,
    CREDIT_PACKS.STARTER,
    CREDIT_PACKS.STANDARD,
    CREDIT_PACKS.PRO,
  ] as const;

  return (
    <section className={cx(surfaceCardStyles, card)}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: colors.text }}>
        {t('credits.title')}
      </h2>

      {loading ? (
        <p style={{ color: colors.textDim }}>{t('credits.loading')}</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : credits !== null && hours !== null ? (
        <>
          <span className={balanceTxt}>
            {credits.toLocaleString()}
            <span style={{ fontSize: '1rem', fontWeight: 400 }}>
              {' '}
              {t('credits.credits')}
            </span>
            <span style={{ fontSize: '1rem', color: colors.textDim }}>
              {' '}
              ({`${fmtHours(sharedHoursRemaining)} ${translationHoursLabel}`})
            </span>
          </span>

          {/* Pack purchase options */}
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            {creditPacks.map(pack => (
              <BuyCreditsButton
                key={pack.id}
                packId={pack.id}
                // Product decision: keep the app-facing list price in USD.
                // Korean checkout may settle in KRW for local payment reliability,
                // but those KRW amounts are payment-rail details, not CTA copy.
                label={`${formatUsdListPrice(pack.price)} · ${fmtHours(
                  estimateTranslatableHours(pack.credits, false)
                )} ${translationHoursLabel} (${pack.credits.toLocaleString()} cr)`}
              />
            ))}
          </div>

          {/* Credits description under buttons */}
          <p
            style={{
              marginTop: 4,
              fontSize: '.95rem',
              color: colors.textDim,
              lineHeight: 1.4,
            }}
          >
            {t('settings.creditsDescription')}
          </p>
        </>
      ) : null}
    </section>
  );
}
