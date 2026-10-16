import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useCreditStore, useUIStore } from '../state';
import { colors } from '../styles';
import { estimateTranscriptionHours } from '../utils/creditEstimates';
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
 * The header's calm balance: credits as transcription minutes, with the
 * monthly free allowance named as such. API-key users keep the provider badge.
 */
export default function CreditMinutesPill() {
  const { t, i18n } = useTranslation();
  const provider = useActiveProvider('general');
  const credits = useCreditStore(s => s.credits);
  const loading = useCreditStore(s => s.loading);
  const monthlyFree = useCreditStore(s => s.monthlyFree);
  const onlyWelcomeCredits = useCreditStore(
    s => s.history?.onlyWelcomeCredits === true
  );

  if (provider !== 'credits') return <CreditBalance />;
  if (loading || credits === null) return null;

  const minutes = Math.floor((estimateTranscriptionHours(credits) ?? 0) * 60);
  const withinMonthlyFree =
    monthlyFree !== null && credits <= monthlyFree.credits;

  let text: string;
  let tone: string;
  if (credits <= 0 || minutes < 1) {
    tone = colors.gray;
    text = monthlyFree
      ? t('credits.pill.freeBack', 'Free minutes back on {{date}}', {
          date: formatRefreshDate(
            monthlyFree.refreshesOn,
            i18n.resolvedLanguage || i18n.language
          ),
        })
      : t('credits.pill.empty', 'Get minutes');
  } else if (withinMonthlyFree) {
    tone = colors.success;
    text = t('credits.pill.freeThisMonth', '{{count}} free min this month', {
      count: minutes,
    });
  } else if (onlyWelcomeCredits) {
    tone = colors.success;
    text = t('credits.pill.freeWelcome', '{{count}} free min', {
      count: minutes,
    });
  } else {
    tone = colors.primary;
    text = t('credits.pill.minutes', '{{count}} min of transcription', {
      count: minutes,
    });
  }

  return (
    <button
      type="button"
      className={pill}
      onClick={openCreditsSettings}
      title={t('credits.pill.title', 'Credits and plans')}
    >
      <span className={dot(tone)} aria-hidden="true" />
      <span className={pillText}>{text}</span>
    </button>
  );
}
