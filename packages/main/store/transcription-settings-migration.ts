/**
 * One-time (idempotent) migration for the ElevenLabs-only transcription
 * change.
 *
 * OpenAI whisper-1 shuts down on 2027-02-26 and its replacement returns no
 * timestamps, so transcription is served by ElevenLabs Scribe only. Profiles
 * saved by older app versions may still hold 'openai' as the transcription
 * preference; rewrite it to 'elevenlabs' so every reader (main, renderer,
 * agent context) agrees. Mirrors dubbing-settings-migration.ts.
 *
 * The old Quality Transcription switch lived in renderer localStorage
 * ('savedQualityTranscription'); it no longer affects anything and is
 * simply ignored.
 */
type MinimalSettingsStore = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
};

export const TRANSCRIPTION_SETTINGS_MIGRATION_KEYS = [
  'preferredTranscriptionProvider',
] as const;

export type TranscriptionSettingsMigrationKey =
  (typeof TRANSCRIPTION_SETTINGS_MIGRATION_KEYS)[number];

export function migrateLegacyOpenAiTranscriptionSettings(
  store: MinimalSettingsStore
): TranscriptionSettingsMigrationKey[] {
  const changed: TranscriptionSettingsMigrationKey[] = [];
  for (const key of TRANSCRIPTION_SETTINGS_MIGRATION_KEYS) {
    let value: unknown;
    try {
      value = store.get(key);
    } catch {
      continue;
    }
    if (value === 'openai') {
      store.set(key, 'elevenlabs');
      changed.push(key);
    }
  }
  return changed;
}
