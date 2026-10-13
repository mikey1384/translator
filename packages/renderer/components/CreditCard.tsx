import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useCreditStore } from '../state';
import BuyCreditsButton from './BuyCreditsButton';
import { colors, surfaceCardStyles } from '../styles';
import { CREDIT_PACKS } from '../../shared/constants';
import { formatTranscriptionTime } from '../utils/creditEstimates';

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
  // Credits buy transcription and dubbing; translating with the user's own
  // Claude or Codex is free. So packs and the balance are described in
  // transcription time, which every credit-paid path starts with, not in
  // translation hours, which overstated what a pack buys.
  const transcriptionTimeLabel = (amount: number | null) => {
    const time = formatTranscriptionTime(amount);
    return time
      ? t('credits.transcriptionTimeShort', '{{time}} of transcription', {
          time,
        })
      : null;
  };
  const balanceTimeLabel = transcriptionTimeLabel(credits);
  const creditPacks = [
    CREDIT_PACKS.MICRO,
    CREDIT_PACKS.STARTER,
    CREDIT_PACKS.STANDARD,
    CREDIT_PACKS.PRO,
  ] as const;

  return (
    <section
      className={cx(surfaceCardStyles, card)}
      data-translator-destination="settings-credits"
    >
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
            {balanceTimeLabel && (
              <span style={{ fontSize: '1rem', color: colors.textDim }}>
                {' '}
                ({balanceTimeLabel})
              </span>
            )}
          </span>

          {/* Pack purchase options */}
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            {creditPacks.map(pack => (
              <BuyCreditsButton
                key={pack.id}
                packId={pack.id}
                label={`${formatUsdListPrice(pack.price)} · ${transcriptionTimeLabel(
                  pack.credits
                )} (${pack.credits.toLocaleString()} cr)`}
                placement="settings-credit-card"
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
            {t(
              'settings.agentControl.pitch',
              'Translate for free with the Claude or Codex subscription you already have.'
            )}
          </p>
        </>
      ) : null}
    </section>
  );
}
