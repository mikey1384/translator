import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useCreditStore, useUIStore } from '../state';
import { colors } from '../styles';
import { formatCostInMinutes } from '../utils/formatCostInMinutes';
import { resolveCreditBalanceState } from '../utils/creditBalanceState';
import { logButton } from '../utils/logger';
import CreditBalance, { useActiveProvider } from './CreditBalance';

const pill = css`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid ${colors.border};
  background: ${colors.surface};
  color: ${colors.muted};
  font: inherit;
  font-size: 0.85rem;
  white-space: nowrap;
  min-width: 0;
  max-width: 100%;
  cursor: pointer;

  &:hover {
    border-color: ${colors.borderStrong};
    color: ${colors.text};
  }

  &:focus-visible {
    outline: 2px solid ${colors.primaryLight};
    outline-offset: 2px;
  }
`;

const pillText = css`
  overflow: hidden;
  text-overflow: ellipsis;
`;

const dot = (color: string) => css`
  width: 7px;
  height: 7px;
  border-radius: 4px;
  background: ${color};
  flex: none;
`;

function formatRefreshDate(isoDay: string, locale: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return isoDay;
  }
}

function openCreditsSettings() {
  logButton('header_credit_pill');
  useUIStore.getState().toggleSettings(true);
  window.setTimeout(() => {
    document
      .querySelector<HTMLElement>(
        '[data-translator-destination="settings-credits"]'
      )
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

/**
 * The header's calm balance, in the same words as the Settings card ("4h 17m
 * left"), with free minutes named as such only for devices that never paid.
 * It never disappears: while the balance loads (or can't) it reads
 * "Minutes", so there is always a way to get more. API-key users keep the
 * provider badge.
 */
export default function CreditMinutesPill() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const provider = useActiveProvider('general');
  const credits = useCreditStore(s => s.credits);
  const loading = useCreditStore(s => s.loading);
  const monthlyFree = useCreditStore(s => s.monthlyFree);
  const history = useCreditStore(s => s.history);
  const offline = useCreditStore(s => s.offline);
  const checkoutSuccess = useCreditStore(s => s.checkoutSuccess);

  if (provider !== 'credits') return <CreditBalance />;

  const state = resolveCreditBalanceState({
    credits,
    loading,
    monthlyFree,
    history,
    offline,
  });
  const time = formatCostInMinutes(credits, { kind: 'balance', locale });

  let text: string;
  let tone: string;
  if (checkoutSuccess) {
    tone = colors.success;
    text =
      checkoutSuccess.creditsAdded && checkoutSuccess.creditsAdded > 0
        ? t('credits.success.added', '+{{time}} added', {
            time: formatCostInMinutes(checkoutSuccess.creditsAdded, {
              kind: 'exact',
              locale,
            }),
          })
        : t('credits.success.arrived', 'Your minutes are here');
  } else {
    switch (state) {
      case 'loading':
      case 'unavailable':
        tone = colors.gray;
        text = t('credits.pill.neutral', 'Minutes');
        break;
      case 'offline':
        tone = colors.gray;
        text = t('credits.pill.offline', 'Minutes · offline');
        break;
      case 'welcomePending':
        tone = colors.gray;
        text = t('credits.pill.welcomePending', 'Free minutes on the way');
        break;
      case 'freeBack':
        tone = colors.gray;
        text = t('credits.pill.freeBack', 'Free minutes back on {{date}}', {
          date: formatRefreshDate(monthlyFree?.refreshesOn ?? '', locale),
        });
        break;
      case 'empty':
        tone = colors.gray;
        text = t('credits.pill.empty', 'Get minutes');
        break;
      case 'freeThisMonth':
        tone = colors.success;
        text = t('credits.pill.freeTimeThisMonth', '{{time}} free this month', {
          time,
        });
        break;
      case 'free':
        tone = colors.success;
        text = t('credits.pill.freeTime', '{{time}} free', { time });
        break;
      default:
        tone = colors.primary;
        text = t('credits.timeLeft', '{{time}} left', { time });
    }
  }

  return (
    <button
      type="button"
      className={pill}
      onClick={openCreditsSettings}
      title={t('credits.pill.title', 'Credits and plans')}
    >
      <span className={dot(tone)} aria-hidden="true" />
      <span className={pillText}>
        <bdi>{text}</bdi>
      </span>
    </button>
  );
}
