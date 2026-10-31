/**
 * Costs and balances in MINUTES of video, the unit users buy ("≈ 32m of
 * video" on the packs, "4h 17m left" on the card). Every tool cost line
 * (dub, summary, translate, voice preview, highlights, video search) and every
 * balance goes through here instead of showing raw credits.
 *
 * One credit-to-minute rate (transcription time, see creditsToVideoMinutes)
 * is used everywhere so a cost can be compared with the balance directly.
 */

import type { TFunction } from 'i18next';
import { creditsToVideoMinutes } from './creditEstimates';
import { formatDurationMinutes, formatMinuteUnit } from './formatUnits';

export type MinutesKind =
  /** A cost estimate: "~6m", "<1m" for tiny costs. Rounded up. */
  | 'estimate'
  /** What is left: "4h 17m", "0m". Rounded down so it never overpromises. */
  | 'balance'
  /** A known amount (a pack, a grant, a transfer): "32m". Rounded down. */
  | 'exact';

export type FormatCostInMinutesOptions = {
  kind?: MinutesKind;
  locale?: string;
};

/** Whole minutes of video for a credit amount, rounded the way `kind` needs. */
export function creditsToWholeMinutes(
  credits: number | null | undefined,
  kind: MinutesKind = 'estimate'
): number {
  const minutes = creditsToVideoMinutes(Number(credits));
  if (kind === 'estimate') return Math.ceil(minutes);
  // Balances and known amounts never overpromise.
  return Math.floor(minutes);
}

/**
 * A credit amount as minutes of video in the UI language's units:
 * estimate "~6m" / "~2h 5m" / "<1m", balance "4h 17m" / "0m", exact "32m".
 */
export function formatCostInMinutes(
  credits: number | null | undefined,
  { kind = 'estimate', locale }: FormatCostInMinutesOptions = {}
): string {
  const safe = Number(credits);
  const raw = Number.isFinite(safe) ? creditsToVideoMinutes(safe) : 0;
  if (kind === 'balance') {
    const whole = Math.floor(raw);
    return whole < 1
      ? formatMinuteUnit(0, locale)
      : formatDurationMinutes(whole, locale);
  }
  if (kind === 'exact') {
    return formatDurationMinutes(Math.floor(raw), locale);
  }
  // A cost above zero but under a minute still costs something: "<1m".
  if (raw > 0 && raw < 1) return formatDurationMinutes(0, locale);
  return `~${formatDurationMinutes(Math.ceil(raw), locale)}`;
}

/**
 * "~6m of your 4h 17m" when the balance is known, else just "~6m". Use for a
 * cost shown next to the button that spends it.
 */
export function formatCostOfBalanceInMinutes(
  t: TFunction,
  cost: number,
  balance: number | null | undefined,
  locale?: string
): string {
  const costText = formatCostInMinutes(cost, { kind: 'estimate', locale });
  // "~6m of your 0m" reads oddly (L8): when the balance can't cover the cost,
  // show the cost alone and let the "not enough minutes" note explain.
  if (
    typeof balance !== 'number' ||
    !Number.isFinite(balance) ||
    balance < cost
  ) {
    return costText;
  }
  return String(
    t('credits.costOfBalanceMinutes', '{{cost}} of your {{balance}}', {
      cost: costText,
      balance: formatCostInMinutes(balance, { kind: 'balance', locale }),
    })
  );
}
