/**
 * Numbers built in code (percentages, counts, sizes) in the UI language's
 * own digits, the way i18n interpolation already formats `{{count}}`:
 * Persian "۶۵٪", Bengali "৬৫%", Marathi "६५%". Without an explicit locale
 * they follow the current UI language.
 */

import { getI18n } from 'react-i18next';

function currentUiLocale(): string {
  try {
    return getI18n()?.language || 'en';
  } catch {
    return 'en';
  }
}

const formats = new Map<string, Intl.NumberFormat>();

function getFormat(
  locale: string,
  key: string,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat {
  const cacheKey = `${locale}|${key}`;
  let format = formats.get(cacheKey);
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale, options);
    } catch {
      format = new Intl.NumberFormat('en', options);
    }
    formats.set(cacheKey, format);
  }
  return format;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** A 0–100 percentage: "65%", "۶۵٪", "65 %" (fr, de). */
export function formatPercent(
  percent: number,
  locale = currentUiLocale(),
  fractionDigits = 0
): string {
  return getFormat(locale, `pct${fractionDigits}`, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(finite(percent) / 100);
}

/** A whole count with grouping: "350,000", "۳۵۰٬۰۰۰". */
export function formatUiInteger(
  value: number,
  locale = currentUiLocale()
): string {
  return getFormat(locale, 'int', { maximumFractionDigits: 0 }).format(
    Math.round(finite(value))
  );
}

/** A plain decimal with a fixed number of digits: "0.50", "۰٫۵۰". */
export function formatUiDecimal(
  value: number,
  fractionDigits: number,
  locale = currentUiLocale()
): string {
  return getFormat(locale, `dec${fractionDigits}`, {
    useGrouping: false,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(finite(value));
}

const BYTE_UNITS = [
  'byte',
  'kilobyte',
  'megabyte',
  'gigabyte',
  'terabyte',
] as const;

/** A file or disk size in local units: "12 MB", "1.4 GB", "۱٫۴ گیگابایت". */
export function formatByteSize(
  bytes: number,
  locale = currentUiLocale()
): string {
  let value = Math.max(0, finite(bytes));
  let index = 0;
  while (value >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024;
    index++;
  }
  const digits = index <= 1 || value >= 10 ? 0 : 1;
  return getFormat(locale, `size-${BYTE_UNITS[index]}-${digits}`, {
    style: 'unit',
    unit: BYTE_UNITS[index],
    unitDisplay: 'short',
    maximumFractionDigits: digits,
  }).format(value);
}
