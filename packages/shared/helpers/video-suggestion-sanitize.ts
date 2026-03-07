import type { VideoSuggestionRecency as VideoSuggestionRecencyValue } from '@shared-types/app';

const DISALLOWED_CHARS_REGEX = /[<>{}`[\]|]/g;
const WHITESPACE_REGEX = /\s+/g;
const HTTP_URL_REGEX = /^https?:\/\//i;

const EXPLICIT_YEAR_REGEX = /\b(?:19|20)\d{2}\s*(?:年|년|year)?\b/gi;
const EXPLICIT_MONTH_REGEX = /\b(?:\d{1,2})\s*(?:月|월|month|months)\b/gi;
const EN_MONTH_NAME_REGEX =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;
const DATE_TEXT_REGEX = /\b\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?\b/g;

export function sanitizeVideoSuggestionCountry(value: unknown): string {
  return String(value ?? '')
    .replace(WHITESPACE_REGEX, ' ')
    .replace(DISALLOWED_CHARS_REGEX, '')
    .trim()
    .slice(0, 60);
}

export function sanitizeVideoSuggestionPreference(value: unknown): string {
  return String(value ?? '')
    .replace(WHITESPACE_REGEX, ' ')
    .replace(DISALLOWED_CHARS_REGEX, '')
    .trim()
    .slice(0, 80);
}

export function sanitizeVideoSuggestionHistoryPath(value: unknown): string {
  return String(value ?? '')
    .replace(DISALLOWED_CHARS_REGEX, '')
    .trim()
    .slice(0, 4096);
}

export function sanitizeVideoSuggestionWebUrl(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!HTTP_URL_REGEX.test(text)) return '';
  return text.slice(0, 2000);
}

export function isVideoSuggestionRecency(
  value: unknown
): value is VideoSuggestionRecencyValue {
  return (
    value === 'any' ||
    value === 'day' ||
    value === 'week' ||
    value === 'month' ||
    value === 'year'
  );
}

function stripExplicitDateTokens(text: string): string {
  return String(text ?? '')
    .replace(EXPLICIT_YEAR_REGEX, ' ')
    .replace(EXPLICIT_MONTH_REGEX, ' ')
    .replace(EN_MONTH_NAME_REGEX, ' ')
    .replace(DATE_TEXT_REGEX, ' ')
    .replace(WHITESPACE_REGEX, ' ')
    .trim();
}

function stripAsciiControlChars(text: string): string {
  let sanitized = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    sanitized += code <= 0x1f ? ' ' : char;
  }
  return sanitized;
}

export function sanitizeVideoSuggestionSearchKeywords(value: unknown): string {
  return stripAsciiControlChars(stripExplicitDateTokens(String(value ?? '')))
    .replace(WHITESPACE_REGEX, ' ')
    .trim()
    .slice(0, 180);
}
