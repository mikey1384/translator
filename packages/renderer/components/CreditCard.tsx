import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useCreditStore } from '../state';
import BuyCreditsButton from './BuyCreditsButton';
import AdminResetButton from './AdminResetButton';
import { colors } from '../styles';
import {
  CREDIT_PACKS,
  CREDITS_PER_TRANSLATION_AUDIO_HOUR,
} from '../../shared/constants';

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
  const { credits, hours, loading, error, checkoutPending } = useCreditStore();
  const translateHoursRemaining =
    credits !== null
      ? Math.floor(credits / CREDITS_PER_TRANSLATION_AUDIO_HOUR)
      : null;

  return (
    <section className={card}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
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
              (
              {`${t('input.transcribeOnly')} ${Math.floor(hours)} ${t('credits.hours')}`}
              {typeof translateHoursRemaining === 'number'
                ? ` · ${t('subtitles.translation')} ${translateHoursRemaining} ${t('credits.hours')}`
                : ''}
              )
            </span>
          </span>

          {/* Pack purchase options */}
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <BuyCreditsButton
              packId={CREDIT_PACKS.STARTER.id}
              label={`$${CREDIT_PACKS.STARTER.price} · ${t('input.transcribeOnly')} ${Math.floor(CREDIT_PACKS.STARTER.hours)} ${t('credits.hours')} · ${t('subtitles.translation')} ${Math.floor(
                CREDIT_PACKS.STARTER.credits /
                  CREDITS_PER_TRANSLATION_AUDIO_HOUR
              )} ${t('credits.hours')} (${CREDIT_PACKS.STARTER.credits.toLocaleString()} cr)`}
            />
            <BuyCreditsButton
              packId={CREDIT_PACKS.STANDARD.id}
              label={`$${CREDIT_PACKS.STANDARD.price} · ${t('input.transcribeOnly')} ${Math.floor(CREDIT_PACKS.STANDARD.hours)} ${t('credits.hours')} · ${t('subtitles.translation')} ${Math.floor(
                CREDIT_PACKS.STANDARD.credits /
                  CREDITS_PER_TRANSLATION_AUDIO_HOUR
              )} ${t('credits.hours')} (${CREDIT_PACKS.STANDARD.credits.toLocaleString()} cr)`}
            />
            <BuyCreditsButton
              packId={CREDIT_PACKS.PRO.id}
              label={`$${CREDIT_PACKS.PRO.price} · ${t('input.transcribeOnly')} ${Math.floor(CREDIT_PACKS.PRO.hours)} ${t('credits.hours')} · ${t('subtitles.translation')} ${Math.floor(
                CREDIT_PACKS.PRO.credits / CREDITS_PER_TRANSLATION_AUDIO_HOUR
              )} ${t('credits.hours')} (${CREDIT_PACKS.PRO.credits.toLocaleString()} cr)`}
            />
          </div>

          {/* Admin reset button (only shows for admin device) */}
          <AdminResetButton />

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

          <p
            className="hint"
            style={{ fontSize: '.85rem', color: colors.grayDark }}
          >
            {t('credits.description', {
              pack1Price: CREDIT_PACKS.STARTER.price,
              pack1Hours: Math.floor(CREDIT_PACKS.STARTER.hours),
              pack2Price: CREDIT_PACKS.STANDARD.price,
              pack2Hours: Math.floor(CREDIT_PACKS.STANDARD.hours),
              pack3Price: CREDIT_PACKS.PRO.price,
              pack3Hours: Math.floor(CREDIT_PACKS.PRO.hours),
            })}
          </p>
        </>
      ) : null}
    </section>
  );
}
