import {
  DEFAULT_DUB_VOICE,
  ELEVENLABS_DUB_VOICES,
  normalizeDubVoice,
} from '../../shared/constants/dub-voices';

export const DUB_VOICE_STORAGE_KEY = 'savedDubVoice';

// ElevenLabs voices the app accepts. Dubbing is ElevenLabs-only; legacy
// OpenAI names (alloy, echo, ...) are mapped via normalizeDubVoice first.
export const ALLOWED_DUB_VOICES: ReadonlySet<string> = new Set([
  ...ELEVENLABS_DUB_VOICES,
  'bella',
  'antoni',
  'domi',
  'elli',
  'arnold',
  'sam',
]);

/** Map legacy names, then fall back to the default for unknown voices. */
export function resolveAllowedDubVoice(voice: unknown): string {
  const normalized = normalizeDubVoice(voice);
  return ALLOWED_DUB_VOICES.has(normalized) ? normalized : DEFAULT_DUB_VOICE;
}

type DubVoiceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Read the saved dub voice, migrating a legacy OpenAI voice name to its
 * ElevenLabs replacement in storage. Idempotent: once migrated, later reads
 * return the stored ElevenLabs voice without writing.
 */
export function readAndMigrateStoredDubVoice(storage: DubVoiceStorage): string {
  let stored: string | null = null;
  try {
    stored = storage.getItem(DUB_VOICE_STORAGE_KEY);
  } catch {
    return DEFAULT_DUB_VOICE;
  }
  if (!stored) return DEFAULT_DUB_VOICE;
  const migrated = normalizeDubVoice(stored);
  if (!ALLOWED_DUB_VOICES.has(migrated)) return DEFAULT_DUB_VOICE;
  if (migrated !== stored) {
    try {
      storage.setItem(DUB_VOICE_STORAGE_KEY, migrated);
    } catch {
      // Storage write failures only skip persistence; the mapped voice is used.
    }
  }
  return migrated;
}
