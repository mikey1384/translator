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

export default function CreditCard() {
  const { t } = useTranslation();
  const credits = useCreditStore(s => s.credits);
  const hours = useCreditStore(s => s.hours);
  const loading = useCreditStore(s => s.loading);
  const error = useCreditStore(s => s.error);
  const checkoutPending = useCreditStore(s => s.checkoutPending);
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

  return (
    <section className={cx(surfaceCardStyles, card)}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: colors.text }}>
        {t('credits.title')}
      </h2>

      {loading ? (
        <p style={{ color: colors.textDim }}>{t('credits.loading')}</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : checkoutPending ? (
        <p style={{ color: colors.primary }}>🔄 Processing payment...</p>
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
            <BuyCreditsButton
              packId={CREDIT_PACKS.MICRO.id}
              label={`$${CREDIT_PACKS.MICRO.price} · ${fmtHours(
                estimateTranslatableHours(CREDIT_PACKS.MICRO.credits, false)
              )} ${translationHoursLabel} (${CREDIT_PACKS.MICRO.credits.toLocaleString()} cr)`}
            />
            <BuyCreditsButton
              packId={CREDIT_PACKS.STARTER.id}
              label={`$${CREDIT_PACKS.STARTER.price} · ${fmtHours(
                estimateTranslatableHours(CREDIT_PACKS.STARTER.credits, false)
              )} ${translationHoursLabel} (${CREDIT_PACKS.STARTER.credits.toLocaleString()} cr)`}
            />
            <BuyCreditsButton
              packId={CREDIT_PACKS.STANDARD.id}
              label={`$${CREDIT_PACKS.STANDARD.price} · ${fmtHours(
                estimateTranslatableHours(CREDIT_PACKS.STANDARD.credits, false)
              )} ${translationHoursLabel} (${CREDIT_PACKS.STANDARD.credits.toLocaleString()} cr)`}
            />
            <BuyCreditsButton
              packId={CREDIT_PACKS.PRO.id}
              label={`$${CREDIT_PACKS.PRO.price} · ${fmtHours(
                estimateTranslatableHours(CREDIT_PACKS.PRO.credits, false)
              )} ${translationHoursLabel} (${CREDIT_PACKS.PRO.credits.toLocaleString()} cr)`}
            />
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

          {checkoutPending && (
            <p
              style={{
                fontSize: '.9rem',
                color: colors.primary,
                textAlign: 'center',
                fontStyle: 'italic',
              }}
            >
              ⏳ Confirming payment with bank...
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
