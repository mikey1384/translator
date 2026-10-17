import { useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import {
  intoLanguageName,
  sentenceLanguageName,
} from '../../utils/languageName';
import Button from '../Button';
import { useCreditCheckout } from '../BuyCreditsButton';
import { useCreditStore, useUIStore, useVideoStore } from '../../state';
import {
  freePreviewKey,
  useFreePreviewStore,
  type FreePreview,
} from '../../state/free-preview-store';
import {
  creditsToFinish,
  packToFinish,
  previewMinuteSplit,
} from '../../utils/freePreview';
import {
  freePreviewPlanningCredits,
  resumeFreePreview,
} from '../../utils/freePreviewRun';
import * as SystemIPC from '../../ipc/system';
import { logButton } from '../../utils/logger';
import { colors, fonts } from '../../styles';
import { formatUsd } from '../../utils/formatUsd';

const card = css`
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 20px;
  border-radius: 18px;
  background: ${colors.surface};
  border: 1px solid ${colors.borderStrong};
  animation: freePreviewRise 0.35s cubic-bezier(0.2, 0.7, 0.2, 1) both;

  @keyframes freePreviewRise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  @media (max-width: 760px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const textCol = css`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const title = css`
  margin: 0;
  font-family: ${fonts.display};
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: ${colors.text};
`;

const body = css`
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.45;
  color: ${colors.textDim};
`;

const actions = css`
  display: flex;
  gap: 10px;
  flex: none;
  flex-wrap: wrap;
`;

const quietLine = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 16px;
  background: ${colors.surface};
  border: 1px solid ${colors.border};
  font-size: 0.9rem;
  color: ${colors.textDim};
`;

const dot = css`
  width: 7px;
  height: 7px;
  border-radius: 4px;
  background: ${colors.primary};
  flex: none;
  margin-inline-end: 10px;
`;

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
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

/** The preview for what is open, if one is waiting on the user. */
export function useActiveFreePreview(): FreePreview | null {
  const key = useVideoStore(s =>
    freePreviewKey({
      originalPath: s.originalPath,
      path: s.path,
      sourceUrl: s.sourceUrl,
    })
  );
  return useFreePreviewStore(s => (key ? (s.items[key] ?? null) : null));
}

/** True while the offer card carries the screen's one yellow action. */
export function useFreePreviewOfferShowing(): boolean {
  const preview = useActiveFreePreview();
  return Boolean(preview && preview.status !== 'dismissed');
}

export default function FreePreviewOffer() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const preview = useActiveFreePreview();
  const credits = useCreditStore(s => s.credits);
  const authoritative = useCreditStore(s => s.authoritative);
  const monthlyFree = useCreditStore(s => s.monthlyFree);
  const checkoutPending = useCreditStore(s => s.checkoutPending);
  const checkoutUnresolved = useCreditStore(s => s.checkoutUnresolved);
  const quality = useUIStore(s => s.qualityTranslation);
  const setStatus = useFreePreviewStore(s => s.setStatus);

  const remainingSecs = preview
    ? Math.max(0, preview.durationSecs - preview.coveredSecs)
    : 0;
  const balance =
    typeof credits === 'number' ? freePreviewPlanningCredits(credits) : 0;
  const { pack, coversAll } = packToFinish({
    remainingSecs,
    credits: balance,
    qualityEnabled: Boolean(quality),
  });
  const canFinishNow =
    authoritative &&
    balance >= creditsToFinish(remainingSecs, Boolean(quality));

  const { loading, start } = useCreditCheckout({
    packId: pack.id,
    placement: 'free-preview-offer',
    onCheckoutCreated: () => {
      if (preview) setStatus(preview.key, 'checkout');
    },
  });

  // Paid: pick up where the preview stopped once the minutes cover the rest.
  useEffect(() => {
    if (!preview || preview.status !== 'checkout') return;
    if (canFinishNow) void resumeFreePreview(preview.key);
  }, [preview, canFinishNow]);

  // Checkout closed without paying: the offer comes back.
  const wasWaiting = useRef(false);
  useEffect(() => {
    const waiting = checkoutPending || checkoutUnresolved;
    if (
      wasWaiting.current &&
      !waiting &&
      preview?.status === 'checkout' &&
      !canFinishNow
    ) {
      setStatus(preview.key, 'offer');
    }
    wasWaiting.current = waiting;
  }, [checkoutPending, checkoutUnresolved, preview, canFinishNow, setStatus]);

  if (!preview) return null;

  const { covered, total, remaining } = previewMinuteSplit(preview);
  const price = formatUsd(pack.price, locale);
  const languageName = sentenceLanguageName(
    t(`languages.${preview.language}`, { defaultValue: preview.language }),
    locale
  );
  const languageInto = intoLanguageName(preview.language, languageName, locale);

  const finishNow = () => {
    logButton('free_preview_finish_now');
    void resumeFreePreview(preview.key);
  };
  const buy = () => {
    logButton('free_preview_finish_buy', { packId: pack.id });
    void SystemIPC.trackPurchaseEvent('free_preview_offer_clicked', {
      packId: pack.id,
      placement: 'free-preview-offer',
    }).catch(() => {});
    void start();
  };
  const notNow = () => {
    logButton('free_preview_not_now');
    setStatus(preview.key, 'dismissed');
    void SystemIPC.trackPurchaseEvent('free_preview_dismissed', {
      placement: 'free-preview-offer',
    }).catch(() => {});
  };

  if (preview.status === 'dismissed') {
    return (
      <div className={quietLine} role="status">
        <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <span className={dot} aria-hidden="true" />
          {preview.coveredSecs > 0
            ? t(
                'freePreview.quietPreview',
                'Preview · {{covered}} of {{total}} min',
                {
                  covered,
                  total,
                }
              )
            : t('freePreview.quietNone', 'Not subtitled yet · {{total}} min', {
                total,
              })}
        </span>
        <Button
          variant="text"
          size="sm"
          onClick={canFinishNow ? finishNow : buy}
          disabled={loading}
        >
          {preview.coveredSecs > 0
            ? canFinishNow
              ? t('freePreview.finishShort', 'Finish the video')
              : t('freePreview.finishShortPrice', 'Finish for {{price}}', {
                  price,
                })
            : // Nothing was started, so there is nothing to "finish".
              canFinishNow
              ? t('home.makeItSpeak', 'Make it speak {{language}}', {
                  language: languageName,
                  languageInto,
                })
              : t(
                  'freePreview.noneCta',
                  'Make it speak {{language}} · {{price}}',
                  { language: languageName, languageInto, price }
                )}
        </Button>
      </div>
    );
  }

  if (preview.status === 'checkout') {
    return (
      <div className={card} role="status" aria-live="polite">
        <div className={textCol}>
          <p className={title}>
            {t('freePreview.checkoutTitle', 'Finish paying in your browser')}
          </p>
          <p className={body}>
            {t(
              'freePreview.checkoutBody',
              'We opened a secure Stripe checkout for the {{price}} pack. Translator picks up right where it left off as soon as it’s done. No need to click anything here.',
              { price }
            )}
          </p>
        </div>
        <div className={actions}>
          <Button
            variant="secondary"
            onClick={() => setStatus(preview.key, 'offer')}
          >
            {t('freePreview.checkoutBack', 'Back')}
          </Button>
        </div>
      </div>
    );
  }

  if (preview.status === 'resuming') {
    return (
      <div className={card} role="status" aria-live="polite">
        <div className={textCol}>
          <p className={title}>
            {t('freePreview.resumingTitle', 'Finishing the video')}
          </p>
          <p className={body}>
            {t(
              'freePreview.resumingBody',
              'Picking up at {{time}} and making the rest speak {{language}}…',
              {
                time: formatClock(preview.coveredSecs),
                language: languageName,
                languageInto,
              }
            )}
          </p>
        </div>
      </div>
    );
  }

  const failed = preview.status === 'failed';
  const headline = failed
    ? t('freePreview.failedTitle', 'Finishing stopped')
    : preview.coveredSecs > 0
      ? t(
          'freePreview.offerTitle',
          'That was the first {{covered}} of {{total}} minutes.',
          {
            covered,
            total,
            count: total,
          }
        )
      : t('freePreview.noneTitle', 'This video is {{total}} minutes.', {
          total,
          count: total,
        });

  let detail: string;
  if (failed && !canFinishNow) {
    detail = t(
      'freePreview.failedNeedMinutes',
      'Everything finished so far is kept. You need more minutes to finish the remaining {{remaining}} minutes.',
      { remaining, count: remaining }
    );
  } else if (failed && preview.failure === 'network') {
    detail = t(
      'freePreview.failedNetwork',
      'The connection dropped. Everything finished so far is kept. Try again when you’re back online.'
    );
  } else if (failed) {
    detail = t(
      'freePreview.failedBody',
      'Everything finished so far is kept. Try again to finish the rest.'
    );
  } else if (canFinishNow) {
    detail = t(
      'freePreview.enoughBody',
      'You have enough minutes to finish the remaining {{remaining}} minutes now.',
      { remaining, count: remaining }
    );
  } else if (preview.coveredSecs > 0) {
    detail = coversAll
      ? t(
          'freePreview.offerBody',
          'Finish the whole video for {{price}}. It covers the remaining {{remaining}} minutes, and what’s left over stays for your next video.',
          { price, remaining, count: remaining }
        )
      : t(
          'freePreview.offerBodyLong',
          'The {{price}} pack covers most of the remaining {{remaining}} minutes.',
          { price, remaining, count: remaining }
        );
  } else if (monthlyFree) {
    // Not "your free minutes are used up": someone who bought minutes may
    // never have had this month's top-up. A low balance does get the next one.
    detail = t(
      'freePreview.noneBodyNextFree',
      'Free minutes top up again on {{date}}, or make it speak {{language}} now for {{price}}.',
      {
        date: formatRefreshDate(monthlyFree.refreshesOn, locale),
        language: languageName,
        languageInto,
        price,
      }
    );
  } else {
    detail = t(
      'freePreview.noneBody',
      'Make the whole video speak {{language}} for {{price}}.',
      { language: languageName, languageInto, price }
    );
  }

  const primaryLabel = canFinishNow
    ? failed
      ? t('freePreview.retry', 'Try again')
      : t('freePreview.finishShort', 'Finish the video')
    : preview.coveredSecs > 0
      ? t('freePreview.finishCta', 'Finish the video · {{price}}', { price })
      : t('freePreview.noneCta', 'Make it speak {{language}} · {{price}}', {
          language: languageName,
          languageInto,
          price,
        });

  return (
    <div className={card} role="region" aria-label={headline}>
      <div className={textCol}>
        <p className={title}>{headline}</p>
        <p className={body}>{detail}</p>
      </div>
      <div className={actions}>
        <Button
          variant="primary"
          size="lg"
          onClick={canFinishNow ? finishNow : buy}
          disabled={loading}
        >
          {loading ? t('credits.redirectingToPayment') : primaryLabel}
        </Button>
        <Button variant="secondary" size="lg" onClick={notNow}>
          {t('freePreview.notNow', 'Not now')}
        </Button>
      </div>
    </div>
  );
}
