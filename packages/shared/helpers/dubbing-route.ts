/**
 * Dubbing provider routing, shared by main (request routing) and renderer
 * (Dub / voice-preview buttons) so both agree on when dubbing is blocked. Dubbing is ElevenLabs-only: a BYO ElevenLabs key
 * is used when available, otherwise Stage5 credits (which also synthesize
 * with ElevenLabs eleven_v4). An OpenAI key never routes dubbing.
 */
export type DubbingRoute = 'elevenlabs' | 'stage5';

export function resolveDubbingRoute({
  preference,
  apiKeyMode,
  hasElevenLabsByo,
}: {
  /** Stored preference; legacy 'openai' is treated as 'elevenlabs'. */
  preference: unknown;
  apiKeyMode: boolean;
  /** ElevenLabs BYO entitlement + key + toggle (toggle implies API key mode). */
  hasElevenLabsByo: boolean;
}): DubbingRoute {
  if (preference === 'stage5' && !apiKeyMode) return 'stage5';
  return hasElevenLabsByo ? 'elevenlabs' : 'stage5';
}

/**
 * Reason dubbing cannot run when API key mode is on and no BYO ElevenLabs
 * route is available (Stage5 credits are not used in API key mode).
 */
export type ApiKeyModeDubbingBlocker =
  | 'elevenlabs-not-unlocked'
  | 'elevenlabs-disabled'
  | 'elevenlabs-key-missing';

export function getApiKeyModeDubbingBlocker({
  elevenLabsUnlocked,
  elevenLabsToggleEnabled,
  elevenLabsKeyPresent,
}: {
  elevenLabsUnlocked: boolean;
  elevenLabsToggleEnabled: boolean;
  elevenLabsKeyPresent: boolean;
}): ApiKeyModeDubbingBlocker | null {
  if (!elevenLabsUnlocked) return 'elevenlabs-not-unlocked';
  if (!elevenLabsToggleEnabled) return 'elevenlabs-disabled';
  if (!elevenLabsKeyPresent) return 'elevenlabs-key-missing';
  return null;
}

/** English messages main throws for each blocker (renderer shows i18n copy). */
export const API_KEY_MODE_DUBBING_BLOCKER_MESSAGES: Record<
  Exclude<ApiKeyModeDubbingBlocker, 'elevenlabs-key-missing'>,
  string
> = {
  'elevenlabs-not-unlocked':
    'Dubbing uses ElevenLabs. BYO ElevenLabs is not unlocked for this account. Turn off API key mode to dub with Stage5 credits, or unlock ElevenLabs BYO to continue.',
  'elevenlabs-disabled':
    'Dubbing uses ElevenLabs. BYO ElevenLabs is disabled in Settings. Enable it to dub with your own API keys, or turn off API key mode to dub with Stage5 credits.',
};
