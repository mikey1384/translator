const CONTROL_CHARACTERS = /\p{Cc}+/gu;

function assertMaximum(maximum: number): void {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new TypeError('Metadata bounds must be positive safe integers.');
  }
}

export function boundedMetadataText(
  value: unknown,
  maximumCharacters: number
): string | null {
  assertMaximum(maximumCharacters);
  const cleaned = String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!cleaned) return null;
  let bounded = '';
  let characters = 0;
  for (const character of cleaned) {
    if (characters >= maximumCharacters) break;
    bounded += character;
    characters += 1;
  }
  return bounded || null;
}

export function boundedSourceIdentity(
  value: unknown,
  maximumCharacters: number
): string | null {
  assertMaximum(maximumCharacters);
  if (
    typeof value !== 'string' &&
    !(typeof value === 'number' && Number.isFinite(value))
  ) {
    return null;
  }
  const rawIdentity = String(value);
  if (rawIdentity.length > maximumCharacters * 2) return null;
  const identity = rawIdentity.trim();
  if (!identity) return null;
  let characters = 0;
  for (const character of identity) {
    if (/\p{Cc}/u.test(character)) return null;
    characters += character.length > 0 ? 1 : 0;
    if (characters > maximumCharacters) return null;
  }
  return identity;
}

export function safeHttpMetadataUrl(
  value: unknown,
  maximumCharacters = 32_768
): string | null {
  const candidate = boundedSourceIdentity(value, maximumCharacters);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    parsed.hash = '';
    const normalized = parsed.toString();
    return boundedSourceIdentity(normalized, maximumCharacters);
  } catch {
    return null;
  }
}

export function finitePositiveMetadataNumber(
  value: unknown,
  { maximum = Number.MAX_SAFE_INTEGER, integer = false } = {}
): number | null {
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number <= 0 ||
    number > maximum ||
    (integer && !Number.isSafeInteger(number))
  ) {
    return null;
  }
  return number;
}
