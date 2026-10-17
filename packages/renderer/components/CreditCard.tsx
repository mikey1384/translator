import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useCreditStore } from '../state';
import { useCreditCheckout } from './BuyCreditsButton';
import { colors, fonts, surfaceCardStyles } from '../styles';
import { CREDIT_PACKS } from '../../shared/constants';
import { estimateTranscriptionHours } from '../utils/creditEstimates';

type Pack = (typeof CREDIT_PACKS)[keyof typeof CREDIT_PACKS];

const card = css`
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;

  @media (max-width: 640px) {
    padding: 18px;
  }
`;

const headRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 20px;
`;

const eyebrow = css`
  margin: 0 0 6px;
  font-size: 0.85rem;
  color: ${colors.textDim};
`;

const balanceStyles = css`
  margin: 0;
  font-family: ${fonts.display};
  font-size: clamp(1.9rem, 4vw, 2.4rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.05;
  color: ${colors.text};
`;

const balanceMeta = css`
  margin: 0;
  font-size: 0.9rem;
  color: ${colors.textDim};
  text-align: end;

  @media (max-width: 640px) {
    text-align: start;
  }
`;

const packGrid = css`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 700px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const packCard = css`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 132px;
  padding: 18px 16px 14px;
  border-radius: 16px;
  border: 1px solid ${colors.borderStrong};
  background: ${colors.surfaceSoft};
  color: ${colors.text};
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    transform 0.15s ease,
    background 0.15s ease;

  &:hover:not(:disabled) {
    border-color: ${colors.primary};
    background: ${colors.surfaceRaised};
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: 2px solid ${colors.primary};
    outline-offset: 2px;
  }

  &:disabled {
    cursor: progress;
    opacity: 0.7;
  }
`;

const featuredPack = css`
  border-color: ${colors.primary};
`;

const badge = css`
  position: absolute;
  top: -10px;
  left: 14px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
  background: ${colors.surfaceRaised};
  border: 1px solid ${colors.borderStrong};
  color: ${colors.muted};
`;

const featuredBadge = css`
  background: ${colors.primary};
  border-color: ${colors.primary};
  color: ${colors.onPrimary};
`;

const priceStyles = css`
  font-family: ${fonts.display};
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.02em;
`;

const amountStyles = css`
  margin-top: 6px;
  font-size: 1rem;
  font-weight: 600;
  color: ${colors.primary};
`;

const subStyles = css`
  font-size: 0.8rem;
  color: ${colors.textDim};
`;

const valueStyles = css`
  margin-top: auto;
  padding-top: 8px;
  font-size: 0.78rem;
  color: ${colors.success};
`;

const footStyles = css`
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: ${colors.textDim};
`;

const freeLink = css`
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: ${colors.primaryLight};
  text-decoration: underline;
  text-underline-offset: 0.16em;
  cursor: pointer;

  &:hover {
    color: ${colors.text};
  }
`;

// Fulfilled purchases so far: $1 leads, $50 has the lowest price per minute.
const PACK_BADGES: Partial<Record<Pack['id'], 'popular' | 'value'>> = {
  MICRO: 'popular',
  PRO: 'value',
};

const BASE_CREDITS_PER_DOLLAR =
  CREDIT_PACKS.MICRO.credits / CREDIT_PACKS.MICRO.price;

function formatUsd(price: number, locale: string): string {
  try {
    // Prices are always US dollars: "$5" reads everywhere, and dropping the
    // bidi marks keeps RTL text from splitting the symbol off the number.
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0,
    })
      .format(price)
      .replace(/[\u200e\u200f\u061c]/g, '');
  } catch {
    return `$${price}`;
  }
}

/** "5h 21m" in the user's language and numerals, via Intl units. */
function formatDuration(hours: number, locale: string): string {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const unit = (value: number, kind: 'hour' | 'minute') => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: kind,
        unitDisplay: 'narrow',
      }).format(value);
    } catch {
      return `${value}${kind === 'hour' ? 'h' : 'm'}`;
    }
  };
  if (h === 0) return unit(Math.max(1, m), 'minute');
  return m > 0 ? `${unit(h, 'hour')} ${unit(m, 'minute')}` : unit(h, 'hour');
}

function formatRefreshDate(isoDay: string, locale: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return isoDay;
  }
}

function PackCard({ pack, locale }: { pack: Pack; locale: string }) {
  const { t } = useTranslation();
  const { loading, start } = useCreditCheckout({
    packId: pack.id,
    placement: 'settings-credit-card',
  });
  const kind = PACK_BADGES[pack.id];
  const time = formatDuration(
    estimateTranscriptionHours(pack.credits) ?? 0,
    locale
  );
  const multiplier =
    Math.round((pack.credits / pack.price / BASE_CREDITS_PER_DOLLAR) * 10) / 10;

  return (
    <button
      type="button"
      className={cx(packCard, kind === 'popular' && featuredPack)}
      onClick={() => void start()}
      disabled={loading}
      aria-label={t(
        'credits.packAria',
        '{{price}} for about {{time}} of video',
        {
          price: formatUsd(pack.price, locale),
          time,
        }
      )}
    >
      {kind ? (
        <span className={cx(badge, kind === 'popular' && featuredBadge)}>
          {kind === 'popular'
            ? t('credits.badgePopular', 'Most popular')
            : t('credits.badgeValue', 'Best value')}
        </span>
      ) : null}
      {/* Isolated so prices and durations keep their order in RTL text. */}
      <span className={priceStyles}>
        <bdi dir="ltr">{formatUsd(pack.price, locale)}</bdi>
      </span>
      <span className={amountStyles}>
        {loading ? (
          t('credits.redirectingToPayment')
        ) : (
          <bdi dir="auto">≈ {time}</bdi>
        )}
      </span>
      <span className={subStyles}>{t('credits.ofVideo', 'of video')}</span>
      {multiplier > 1 ? (
        <span className={valueStyles}>
          {t(
            'credits.moreMinutesPerDollar',
            '{{multiplier}}× the minutes per dollar',
            {
              multiplier,
            }
          )}
        </span>
      ) : null}
    </button>
  );
}

function scrollToAgentControl() {
  document
    .querySelector<HTMLElement>(
      '[data-translator-destination="settings-agent-control"]'
    )
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function CreditCard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const credits = useCreditStore(s => s.credits);
  const loading = useCreditStore(s => s.loading);
  const error = useCreditStore(s => s.error);
  const monthlyFree = useCreditStore(s => s.monthlyFree);
  const checkoutUnresolved = useCreditStore(s => s.checkoutUnresolved);
  const checkoutPending = useCreditStore(s => s.checkoutPending);

  // Credits buy transcription and dubbing; translating with the user's own
  // Claude or Codex is free. So packs and the balance are described in
  // transcription time, which every credit-paid path starts with.
  const balanceHours = estimateTranscriptionHours(credits) ?? 0;
  const balanceMinutes = Math.floor(balanceHours * 60);
  const balanceText =
    balanceMinutes < 1
      ? t('credits.balanceNone', 'No minutes left')
      : t('credits.balanceTime', '{{time}} of video', {
          time: formatDuration(balanceHours, locale),
        });

  let meta: string | null = null;
  if (monthlyFree) {
    const freeMinutes = Math.floor(
      (estimateTranscriptionHours(monthlyFree.credits) ?? 0) * 60
    );
    meta = t(
      'credits.monthlyFreeNote',
      '{{minutes}} free minutes every month · next on {{date}}',
      {
        minutes: freeMinutes,
        date: formatRefreshDate(monthlyFree.refreshesOn, locale),
      }
    );
  }

  const packs = [
    CREDIT_PACKS.MICRO,
    CREDIT_PACKS.STARTER,
    CREDIT_PACKS.STANDARD,
    CREDIT_PACKS.PRO,
  ] as const;

  return (
    <section
      className={cx(surfaceCardStyles, card)}
      data-translator-destination="settings-credits"
      aria-labelledby="settings-credits-title"
    >
      {loading && credits === null ? (
        <p className={footStyles}>{t('credits.loading')}</p>
      ) : error && credits === null ? (
        <p style={{ color: colors.danger, margin: 0 }}>{error}</p>
      ) : (
        <>
          <div className={headRow}>
            <div>
              <p className={eyebrow} id="settings-credits-title">
                {t('credits.yourMinutes', 'Your minutes')}
              </p>
              <p className={balanceStyles}>{balanceText}</p>
            </div>
            {meta ? <p className={balanceMeta}>{meta}</p> : null}
          </div>

          <div className={packGrid}>
            {packs.map(pack => (
              <PackCard key={pack.id} pack={pack} locale={locale} />
            ))}
          </div>

          <p className={footStyles}>
            {checkoutPending || checkoutUnresolved
              ? t(
                  'credits.checkoutWaiting',
                  'Finish paying in your browser. Your minutes appear here on their own.'
                )
              : t(
                  'credits.checkoutNote',
                  'One-time payment through Stripe, in your browser. No account or subscription. Minutes arrive on their own.'
                )}{' '}
            {t(
              'credits.dubbingNote',
              'Translating with credits adds about 10% per minute; dubbing uses more.'
            )}{' '}
            <button
              type="button"
              className={freeLink}
              onClick={scrollToAgentControl}
            >
              {t(
                'settings.agentControl.pitch',
                'Translate for free with the Claude or Codex subscription you already have.'
              )}
            </button>
          </p>
        </>
      )}
    </section>
  );
}
