export function resolveCheckoutCountryHintFromLocale(
  rawLocale: string | null | undefined
): string | null {
  const normalized = String(rawLocale || '')
    .replace(/_/g, '-')
    .trim();

  if (!normalized) {
    return null;
  }

  const parts = normalized.split('-').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i];
    if (/^[a-z]{2}$/i.test(part)) {
      return part.toUpperCase();
    }
  }

  return null;
}
