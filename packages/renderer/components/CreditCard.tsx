import { css, cx } from '@emotion/css';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import * as SystemIPC from '@ipc/system';
import { formatDurationHours } from '../utils/formatUnits';
import { useCreditStore } from '../state';
import Button from './Button';
import { useCreditCheckout } from './BuyCreditsButton';
import { colors, fonts, surfaceCardStyles } from '../styles';
import { CREDIT_PACKS } from '../../shared/constants';
import { estimateTranscriptionHours } from '../utils/creditEstimates';
import {
  creditsToWholeMinutes,
  formatCostInMinutes,
} from '../utils/formatCostInMinutes';
import { resolveCreditBalanceState } from '../utils/creditBalanceState';
import { formatUsd } from '../utils/formatUsd';

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

// The pack whose Stripe page is open: clearly marked while the others stay
// clickable, so changing your mind is one click.
const waitingPack = css`
  border-color: ${colors.primary};
  background: ${colors.surfaceRaised};
  box-shadow: 0 0 0 2px ${colors.primary};
`;

const waitingRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin: 0;
  font-size: 0.9rem;
  color: ${colors.text};
`;

const spinner = css`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid ${colors.borderStrong};
  border-top-color: ${colors.primary};
  animation: credit-card-spin 0.9s linear infinite;
  flex: none;

  @keyframes credit-card-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const successRow = css`
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: ${colors.success};
`;

const badge = css`
  position: absolute;
  top: -10px;
  inset-inline-start: 14px;
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

/** "5h 21m" in the user's language and numerals. */
function formatDuration(hours: number, locale: string): string {
  return formatDurationHours(hours, locale);
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

function PackCard({
  pack,
  locale,
  waiting,
  unresolved,
}: {
  pack: Pack;
  locale: string;
  waiting: boolean;
  // The app stopped hearing back about this payment; it may already be paid.
  unresolved: boolean;
}) {
  const { t } = useTranslation();
  const { loading, start } = useCreditCheckout({
    packId: pack.id,
    placement: 'settings-credit-card',
    // The card records one "shown" for all four packs.
    trackShown: false,
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
      className={cx(
        packCard,
        kind === 'popular' && featuredPack,
        waiting && waitingPack
      )}
      onClick={() => void start()}
      disabled={loading}
      aria-current={waiting ? 'true' : undefined}
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
        ) : waiting ? (
          unresolved ? (
            t('credits.checkingPayment', 'Checking your payment…')
          ) : (
            t('credits.waitingForPayment', 'Waiting for payment…')
          )
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
  const retryLoad = useCreditStore(s => s.retryLoad);
  const monthlyFree = useCreditStore(s => s.monthlyFree);
  const checkoutUnresolved = useCreditStore(s => s.checkoutUnresolved);
  const checkoutPending = useCreditStore(s => s.checkoutPending);
  const checkoutPackId = useCreditStore(s => s.checkoutPackId);
  const checkoutSuccess = useCreditStore(s => s.checkoutSuccess);
  const chooseAnotherPack = useCreditStore(s => s.chooseAnotherPack);
  const checkPaymentNow = useCreditStore(s => s.checkPaymentNow);
  const history = useCreditStore(s => s.history);
  const offline = useCreditStore(s => s.offline);
  const waitingForPayment = checkoutPending || checkoutUnresolved;

  useEffect(() => {
    // One "shown" per card view, not one per pack (L9).
    void SystemIPC.trackPurchaseEvent('credit_checkout_button_shown', {
      placement: 'settings-credit-card',
    }).catch(() => {});
  }, []);

  // Credits buy transcription and dubbing; translating with the user's own
  // Claude or Codex is free. So packs and the balance are described in
  // transcription time, which every credit-paid path starts with. Same
  // words as the header pill: "4h 17m left".
  const balanceState = resolveCreditBalanceState({
    credits,
    loading,
    monthlyFree,
    history,
    offline,
  });
  const balanceText =
    balanceState === 'offline'
      ? t('credits.balanceOffline', 'Can’t check your minutes right now')
      : balanceState === 'welcomePending'
        ? t('credits.balanceNoneYet', 'No minutes yet')
        : creditsToWholeMinutes(credits, 'balance') < 1
          ? t('credits.balanceNone', 'No minutes left')
          : t('credits.timeLeft', '{{time}} left', {
              time: formatCostInMinutes(credits, { kind: 'balance', locale }),
            });

  let meta: string | null = null;
  if (balanceState === 'offline') {
    meta = t(
      'credits.offlineNote',
      'Translator can’t reach Stage5. Your balance shows again once you’re back online.'
    );
  } else if (balanceState === 'welcomePending') {
    // The server didn't create this device yet (welcome grants are capped
    // per network), so no monthly top-up date applies to it.
    meta = t(
      'credits.welcomePendingNote',
      'Your free minutes are on the way. They usually arrive the next time you open Translator.'
    );
  } else if (monthlyFree) {
    const freeMinutes = Math.floor(
      (estimateTranscriptionHours(monthlyFree.credits) ?? 0) * 60
    );
    meta = t(
      'credits.monthlyFreeNote',
      '{{minutes}} free minutes every month · next on {{date}}',
      {
        minutes: freeMinutes,
        count: freeMinutes,
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
      {loading && credits === null && !offline ? (
        <p className={footStyles}>{t('credits.loading')}</p>
      ) : error && credits === null ? (
        <div
          role="alert"
          style={{ display: 'flex', alignItems: 'center', gap: 12 }}
        >
          <p style={{ color: colors.danger, margin: 0 }}>
            {t(
              error,
              'Your balance couldn’t be loaded. Check your connection and try again.'
            )}
          </p>
          <Button variant="secondary" size="sm" onClick={retryLoad}>
            {t('common.retry', 'Retry')}
          </Button>
        </div>
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
              <PackCard
                key={pack.id}
                pack={pack}
                locale={locale}
                waiting={waitingForPayment && checkoutPackId === pack.id}
                unresolved={checkoutUnresolved}
              />
            ))}
          </div>

          {checkoutSuccess ? (
            <p className={successRow} role="status">
              {checkoutSuccess.creditsAdded && checkoutSuccess.creditsAdded > 0
                ? t(
                    'credits.success.addedLong',
                    'Payment received. +{{time}} added to your minutes.',
                    {
                      time: formatCostInMinutes(checkoutSuccess.creditsAdded, {
                        kind: 'exact',
                        locale,
                      }),
                    }
                  )
                : t(
                    'credits.success.arrivedLong',
                    'Payment received. Your minutes are here.'
                  )}
            </p>
          ) : waitingForPayment ? (
            <p className={waitingRow} role="status">
              <span className={spinner} aria-hidden="true" />
              <span>
                {checkoutUnresolved
                  ? t(
                      'credits.checkoutUnresolved',
                      'If you already paid, your minutes will appear here shortly. Still paying? Finish in your browser.'
                    )
                  : t(
                      'credits.checkoutWaiting',
                      'Finish paying in your browser. Your minutes appear here on their own.'
                    )}
              </span>
              {checkoutUnresolved ? (
                <button
                  type="button"
                  className={freeLink}
                  onClick={checkPaymentNow}
                >
                  {t('credits.checkPaymentNow', 'Check now')}
                </button>
              ) : null}
              <button
                type="button"
                className={freeLink}
                onClick={chooseAnotherPack}
              >
                {t(
                  'credits.chooseAnotherPack',
                  'Changed your mind? Choose another pack'
                )}
              </button>
            </p>
          ) : null}

          <p className={footStyles}>
            {t(
              'credits.checkoutNote',
              'One-time payment through Stripe, in your browser. No account or subscription. Minutes arrive on their own.'
            )}{' '}
            {t(
              'credits.dubbingNote',
              'Adding a translation uses about 10% more minutes; dubbing uses more.'
            )}{' '}
            <button
              type="button"
              className={freeLink}
              onClick={scrollToAgentControl}
            >
              {/* Names the section it scrolls to; the section itself carries
                  the pitch sentence, so it isn't shown twice. */}
              {t(
                'settings.agentControl.freeTitle',
                'Translate free with your own AI'
              )}
            </button>
          </p>
        </>
      )}
    </section>
  );
}
