import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateLegacyOpenAiDubbingSettings } from '../store/dubbing-settings-migration.js';
import {
  APP_SETTINGS_DEFAULTS,
  normalizeDubbingProviderSetting,
  normalizeStage5DubbingTtsProviderSetting,
} from '../store/settings-schema.js';
import {
  getApiKeyModeDubbingBlocker,
  resolveDubbingRoute,
} from '../services/dubbing-provider-routing.js';
import {
  ELEVENLABS_VOICES,
  resolveVoiceId,
} from '../services/elevenlabs-client.js';

function fakeStore(initial: Record<string, unknown>) {
  const data = { ...initial };
  const writes: Array<[string, unknown]> = [];
  return {
    data,
    writes,
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => {
      writes.push([key, value]);
      data[key] = value;
    },
  };
}

test('new profiles default dubbing to ElevenLabs', () => {
  assert.equal(APP_SETTINGS_DEFAULTS.preferredDubbingProvider, 'elevenlabs');
  assert.equal(APP_SETTINGS_DEFAULTS.stage5DubbingTtsProvider, 'elevenlabs');
});

test('migration rewrites saved OpenAI dubbing preferences to ElevenLabs once', () => {
  const store = fakeStore({
    preferredDubbingProvider: 'openai',
    stage5DubbingTtsProvider: 'openai',
  });

  assert.deepEqual(migrateLegacyOpenAiDubbingSettings(store), [
    'preferredDubbingProvider',
    'stage5DubbingTtsProvider',
  ]);
  assert.equal(store.data.preferredDubbingProvider, 'elevenlabs');
  assert.equal(store.data.stage5DubbingTtsProvider, 'elevenlabs');

  // Idempotent: a second launch writes nothing.
  const writesAfterFirstRun = store.writes.length;
  assert.deepEqual(migrateLegacyOpenAiDubbingSettings(store), []);
  assert.equal(store.writes.length, writesAfterFirstRun);
});

test('migration leaves ElevenLabs, Stage5 and missing values untouched', () => {
  const store = fakeStore({
    preferredDubbingProvider: 'stage5',
    stage5DubbingTtsProvider: 'elevenlabs',
  });
  assert.deepEqual(migrateLegacyOpenAiDubbingSettings(store), []);
  assert.equal(store.writes.length, 0);
  assert.equal(store.data.preferredDubbingProvider, 'stage5');

  const empty = fakeStore({});
  assert.deepEqual(migrateLegacyOpenAiDubbingSettings(empty), []);
  assert.equal(empty.writes.length, 0);
});

test('readers normalize legacy openai dubbing values to ElevenLabs', () => {
  assert.equal(normalizeDubbingProviderSetting('openai'), 'elevenlabs');
  assert.equal(normalizeDubbingProviderSetting('elevenlabs'), 'elevenlabs');
  assert.equal(normalizeDubbingProviderSetting('stage5'), 'stage5');
  assert.equal(normalizeDubbingProviderSetting('bogus'), 'elevenlabs');
  assert.equal(
    normalizeStage5DubbingTtsProviderSetting('openai'),
    'elevenlabs'
  );
  assert.equal(
    normalizeStage5DubbingTtsProviderSetting(undefined),
    'elevenlabs'
  );
});

test('dubbing never routes to OpenAI: an OpenAI-only user dubs with Stage5 credits', () => {
  for (const preference of ['openai', 'elevenlabs', 'stage5', undefined]) {
    for (const apiKeyMode of [false, true]) {
      const route = resolveDubbingRoute({
        preference,
        apiKeyMode,
        hasElevenLabsByo: false,
      });
      assert.equal(route, 'stage5', `${preference}/${apiKeyMode}`);
    }
  }
});

test('BYO ElevenLabs dubs with the user key unless Stage5 is explicitly chosen', () => {
  assert.equal(
    resolveDubbingRoute({
      preference: 'openai',
      apiKeyMode: true,
      hasElevenLabsByo: true,
    }),
    'elevenlabs'
  );
  assert.equal(
    resolveDubbingRoute({
      preference: 'elevenlabs',
      apiKeyMode: true,
      hasElevenLabsByo: true,
    }),
    'elevenlabs'
  );
  assert.equal(
    resolveDubbingRoute({
      preference: 'stage5',
      apiKeyMode: false,
      hasElevenLabsByo: true,
    }),
    'stage5'
  );
  // API key mode never spends Stage5 credits, so 'stage5' falls to the key.
  assert.equal(
    resolveDubbingRoute({
      preference: 'stage5',
      apiKeyMode: true,
      hasElevenLabsByo: true,
    }),
    'elevenlabs'
  );
});

test('API key mode explains which ElevenLabs requirement blocks dubbing', () => {
  assert.equal(
    getApiKeyModeDubbingBlocker({
      elevenLabsUnlocked: false,
      elevenLabsToggleEnabled: false,
      elevenLabsKeyPresent: false,
    }),
    'elevenlabs-not-unlocked'
  );
  assert.equal(
    getApiKeyModeDubbingBlocker({
      elevenLabsUnlocked: true,
      elevenLabsToggleEnabled: false,
      elevenLabsKeyPresent: true,
    }),
    'elevenlabs-disabled'
  );
  assert.equal(
    getApiKeyModeDubbingBlocker({
      elevenLabsUnlocked: true,
      elevenLabsToggleEnabled: true,
      elevenLabsKeyPresent: false,
    }),
    'elevenlabs-key-missing'
  );
  assert.equal(
    getApiKeyModeDubbingBlocker({
      elevenLabsUnlocked: true,
      elevenLabsToggleEnabled: true,
      elevenLabsKeyPresent: true,
    }),
    null
  );
});

test('BYO ElevenLabs maps legacy OpenAI voice names to their mapped voice', () => {
  const expected = {
    alloy: ELEVENLABS_VOICES.adam,
    echo: ELEVENLABS_VOICES.brian,
    fable: ELEVENLABS_VOICES.emily,
    onyx: ELEVENLABS_VOICES.josh,
    nova: ELEVENLABS_VOICES.rachel,
    shimmer: ELEVENLABS_VOICES.sarah,
  };
  for (const [legacy, voiceId] of Object.entries(expected)) {
    assert.equal(resolveVoiceId(legacy), voiceId, legacy);
    assert.equal(resolveVoiceId(legacy.toUpperCase()), voiceId, legacy);
  }
  // ElevenLabs names, raw voice IDs and defaults are unchanged.
  assert.equal(resolveVoiceId('rachel'), ELEVENLABS_VOICES.rachel);
  assert.equal(resolveVoiceId('pNInz6obpgDQGcFmaJgB'), 'pNInz6obpgDQGcFmaJgB');
  assert.equal(resolveVoiceId(undefined), ELEVENLABS_VOICES.adam);
  assert.equal(resolveVoiceId('unknown'), ELEVENLABS_VOICES.adam);
});
