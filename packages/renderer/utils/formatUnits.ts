/**
 * Durations and credit amounts in the UI language's own units and digits
 * ("5h 21m", "5시간 21분", "۵ ساعت ۲۱ دقیقه"). Every place that shows time
 * or credits goes through here so no screen hard-codes English "h"/"m"/"cr".
 * Without an explicit locale they follow the current UI language.
 */

import { getI18n } from 'react-i18next';

function currentUiLocale(): string {
  try {
    return getI18n()?.language || 'en';
  } catch {
    return 'en';
  }
}

type DurationUnit = 'hour' | 'minute' | 'second';

const unitFormats = new Map<string, Intl.NumberFormat>();

function unitDisplayFor(locale: string): 'narrow' | 'short' {
  // English reads best as "5h 21m"; elsewhere narrow units fall back to
  // Latin letters (fa, ja) or bare initials (uk), so use the short form.
  return /^en\b/i.test(locale) ? 'narrow' : 'short';
}

function formatUnit(value: number, unit: DurationUnit, locale: string): string {
  const key = `${locale}|${unit}`;
  let format = unitFormats.get(key);
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale, {
        style: 'unit',
        unit,
        unitDisplay: unitDisplayFor(locale),
      });
    } catch {
      format = new Intl.NumberFormat('en', {
        style: 'unit',
        unit,
        unitDisplay: 'narrow',
      });
    }
    unitFormats.set(key, format);
  }
  return format.format(value);
}

/** Whole minutes as "45m" / "2h 30m"; under a minute reads "<1m". */
export function formatDurationMinutes(
  totalMinutes: number,
  locale = currentUiLocale()
): string {
  const safe = Number.isFinite(totalMinutes) ? Math.max(0, totalMinutes) : 0;
  const rounded = Math.round(safe);
  if (rounded < 1) return `<${formatUnit(1, 'minute', locale)}`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return formatUnit(m, 'minute', locale);
  return m > 0
    ? `${formatUnit(h, 'hour', locale)} ${formatUnit(m, 'minute', locale)}`
    : formatUnit(h, 'hour', locale);
}

export function formatDurationHours(
  hours: number,
  locale = currentUiLocale()
): string {
  return formatDurationMinutes(hours * 60, locale);
}

/** Like formatDurationMinutes, but shows seconds below one minute ("30s"). */
export function formatDurationSeconds(
  seconds: number,
  locale = currentUiLocale()
): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (safe < 60) return formatUnit(Math.floor(safe), 'second', locale);
  return formatDurationMinutes(Math.floor(safe / 60), locale);
}

const compactFormats = new Map<string, Intl.NumberFormat>();

/** A credit amount, compact in the UI language: 850, 4.6K, 168K, 16.8만. */
export function formatCreditAmount(
  credits: number,
  locale = currentUiLocale()
): string {
  const safe = Number.isFinite(credits) ? Math.max(0, Math.ceil(credits)) : 0;
  const digits = safe < 10_000 ? 1 : 0;
  const key = `${locale}|${digits}`;
  let format = compactFormats.get(key);
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: digits,
      });
    } catch {
      format = new Intl.NumberFormat('en', {
        notation: 'compact',
        maximumFractionDigits: digits,
      });
    }
    compactFormats.set(key, format);
  }
  return format.format(safe);
}

/** A clip length as "1m 20s" / "45s" in the UI language's units. */
export function formatDurationMinSec(
  seconds: number,
  locale = currentUiLocale()
): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (safe < 60) return formatUnit(safe, 'second', locale);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return s > 0
    ? `${formatDurationMinutes(m, locale)} ${formatUnit(s, 'second', locale)}`
    : formatDurationMinutes(m, locale);
}
