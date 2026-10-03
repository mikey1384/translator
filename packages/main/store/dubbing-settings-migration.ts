/**
 * One-time (idempotent) migration for the ElevenLabs-only dubbing change.
 *
 * OpenAI TTS (tts-1, tts-1-hd, gpt-4o-mini-tts) shuts down on 2027-01-06, so
 * dubbing is served by ElevenLabs only. Profiles saved by older app versions
 * may still hold 'openai' in either dubbing preference; rewrite them to
 * 'elevenlabs' so every reader (main, renderer, agent context) agrees.
 *
 * The saved dub voice lives in renderer localStorage and is migrated there
 * (see packages/renderer/state/ui-store.ts); BYO/Stage5 requests additionally
 * map legacy OpenAI voice names at send time.
 */
type MinimalSettingsStore = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
};

export const DUBBING_SETTINGS_MIGRATION_KEYS = [
  'preferredDubbingProvider',
  'stage5DubbingTtsProvider',
] as const;

export type DubbingSettingsMigrationKey =
  (typeof DUBBING_SETTINGS_MIGRATION_KEYS)[number];

export function migrateLegacyOpenAiDubbingSettings(
  store: MinimalSettingsStore
): DubbingSettingsMigrationKey[] {
  const changed: DubbingSettingsMigrationKey[] = [];
  for (const key of DUBBING_SETTINGS_MIGRATION_KEYS) {
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
