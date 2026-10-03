/**
 * Dubbing is ElevenLabs-only. OpenAI TTS (tts-1, tts-1-hd, gpt-4o-mini-tts)
 * shuts down on 2027-01-06, so saved OpenAI voice names are mapped to the
 * closest ElevenLabs voice. The Stage5 servers use the same table, so a voice
 * resolves identically whether it is mapped here or server-side.
 */
export const LEGACY_OPENAI_DUB_VOICE_MAP = {
  alloy: 'adam',
  echo: 'brian',
  fable: 'emily',
  onyx: 'josh',
  nova: 'rachel',
  shimmer: 'sarah',
} as const;

export type LegacyOpenAiDubVoice = keyof typeof LEGACY_OPENAI_DUB_VOICE_MAP;

/** Voices offered in the voice picker and agent tools. */
export const ELEVENLABS_DUB_VOICE_OPTIONS = [
  { value: 'rachel', fallback: 'Rachel' },
  { value: 'adam', fallback: 'Adam' },
  { value: 'josh', fallback: 'Josh' },
  { value: 'sarah', fallback: 'Sarah' },
  { value: 'charlie', fallback: 'Charlie' },
  { value: 'emily', fallback: 'Emily' },
  { value: 'matilda', fallback: 'Matilda' },
  { value: 'brian', fallback: 'Brian' },
] as const;

export type ElevenLabsDubVoice =
  (typeof ELEVENLABS_DUB_VOICE_OPTIONS)[number]['value'];

export const ELEVENLABS_DUB_VOICES: readonly ElevenLabsDubVoice[] =
  ELEVENLABS_DUB_VOICE_OPTIONS.map(option => option.value);

export const DEFAULT_DUB_VOICE: ElevenLabsDubVoice = 'rachel';

export function isLegacyOpenAiDubVoice(
  voice: unknown
): voice is LegacyOpenAiDubVoice {
  return (
    typeof voice === 'string' &&
    Object.prototype.hasOwnProperty.call(
      LEGACY_OPENAI_DUB_VOICE_MAP,
      voice.trim().toLowerCase()
    )
  );
}

/**
 * Map a legacy OpenAI voice name to its ElevenLabs replacement. Any other
 * value (ElevenLabs names, raw ElevenLabs voice IDs) is returned trimmed and
 * otherwise unchanged; empty input returns an empty string.
 */
export function normalizeDubVoice(voice: unknown): string {
  if (typeof voice !== 'string') return '';
  const trimmed = voice.trim();
  if (!trimmed) return '';
  const lowered = trimmed.toLowerCase();
  if (isLegacyOpenAiDubVoice(lowered)) {
    return LEGACY_OPENAI_DUB_VOICE_MAP[lowered];
  }
  return trimmed;
}
