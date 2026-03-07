export type CheckoutEntitlement =
  | 'byo_openai'
  | 'byo_anthropic'
  | 'byo_elevenlabs';

export interface EntitlementSnapshotLike {
  byoOpenAi?: boolean | null;
  byoAnthropic?: boolean | null;
  byoElevenLabs?: boolean | null;
}

export function normalizeCheckoutEntitlement(
  value: unknown
): CheckoutEntitlement | null {
  if (value === 'byo_openai') return 'byo_openai';
  if (value === 'byo_anthropic') return 'byo_anthropic';
  if (value === 'byo_elevenlabs') return 'byo_elevenlabs';
  return null;
}

export function hasUnlockedCheckoutEntitlement(
  snapshot: EntitlementSnapshotLike | null | undefined,
  entitlement: CheckoutEntitlement | null
): boolean {
  if (!snapshot || !entitlement) {
    return false;
  }

  switch (entitlement) {
    case 'byo_openai':
      return Boolean(snapshot.byoOpenAi);
    case 'byo_anthropic':
      return Boolean(snapshot.byoAnthropic);
    case 'byo_elevenlabs':
      return Boolean(snapshot.byoElevenLabs);
    default:
      return false;
  }
}
