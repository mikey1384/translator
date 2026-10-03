import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DUB_VOICE_STORAGE_KEY,
  readAndMigrateStoredDubVoice,
  resolveAllowedDubVoice,
} from './dub-voice-storage.js';
import {
  getDubbingActionState,
  isDubbingBlockedInApiKeyMode,
  isDubbingByo,
  resolveDubbingCreditProvider,
  resolveDubbingProvider,
} from './byo-runtime.js';
import {
  estimateDubbingCreditsFromChars,
  estimateDubbingHours,
  formatDubbingTime,
  PREVIEW_TTS_CREDITS,
  TTS_CREDITS_PER_CHAR,
} from '../utils/creditEstimates.js';
import {
  estimateDubbingUsdPerHour,
  estimateTtsCredits,
  STAGE5_TTS_MODEL_ELEVEN_V4,
  TTS_CREDITS_PER_MINUTE,
} from '../../shared/constants/index.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: Array<[string, string]> = [];
  return {
    data,
    writes,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push([key, value]);
      data.set(key, value);
    },
  };
}

test('saved OpenAI voice names migrate to the mapped ElevenLabs voice once', () => {
  const table = {
    alloy: 'adam',
    echo: 'brian',
    fable: 'emily',
    onyx: 'josh',
    nova: 'rachel',
    shimmer: 'sarah',
  };
  for (const [legacy, mapped] of Object.entries(table)) {
    const storage = memoryStorage({ [DUB_VOICE_STORAGE_KEY]: legacy });
    assert.equal(readAndMigrateStoredDubVoice(storage), mapped);
    assert.equal(storage.data.get(DUB_VOICE_STORAGE_KEY), mapped);
    // Idempotent: the next launch reads the migrated voice without writing.
    const writes = storage.writes.length;
    assert.equal(readAndMigrateStoredDubVoice(storage), mapped);
    assert.equal(storage.writes.length, writes);
  }
});

test('saved ElevenLabs voices are kept; unknown or missing fall back to rachel', () => {
  const kept = memoryStorage({ [DUB_VOICE_STORAGE_KEY]: 'matilda' });
  assert.equal(readAndMigrateStoredDubVoice(kept), 'matilda');
  assert.equal(kept.writes.length, 0);

  assert.equal(readAndMigrateStoredDubVoice(memoryStorage()), 'rachel');
  assert.equal(
    readAndMigrateStoredDubVoice(
      memoryStorage({ [DUB_VOICE_STORAGE_KEY]: 'robot' })
    ),
    'rachel'
  );
});

test('setting a dub voice maps legacy names and rejects unknown voices', () => {
  assert.equal(resolveAllowedDubVoice('onyx'), 'josh');
  assert.equal(resolveAllowedDubVoice('brian'), 'brian');
  assert.equal(resolveAllowedDubVoice('nope'), 'rachel');
});

const baseState = {
  useApiKeysMode: false,
  byoElevenLabsUnlocked: false,
  elevenLabsKeyPresent: false,
  useByoElevenLabs: false,
  preferredDubbingProvider: 'elevenlabs' as const,
};

test('an OpenAI-only user dubs with Stage5 credits (ElevenLabs), never OpenAI', () => {
  // The dubbing resolver does not even look at OpenAI key state.
  assert.equal(resolveDubbingProvider(baseState), 'stage5');
  assert.equal(
    resolveDubbingProvider({ ...baseState, useApiKeysMode: true }),
    'stage5'
  );
  assert.equal(isDubbingByo(baseState), false);
  assert.equal(resolveDubbingCreditProvider(baseState), 'elevenlabs');
});

test('API key mode without a usable ElevenLabs key blocks dubbing', () => {
  assert.equal(isDubbingBlockedInApiKeyMode(baseState), false);
  assert.equal(
    isDubbingBlockedInApiKeyMode({ ...baseState, useApiKeysMode: true }),
    true
  );
  const elevenLabsByo = {
    ...baseState,
    useApiKeysMode: true,
    byoElevenLabsUnlocked: true,
    elevenLabsKeyPresent: true,
    useByoElevenLabs: true,
  };
  assert.equal(resolveDubbingProvider(elevenLabsByo), 'elevenlabs');
  assert.equal(isDubbingBlockedInApiKeyMode(elevenLabsByo), false);
  assert.equal(
    resolveDubbingProvider({
      ...elevenLabsByo,
      useApiKeysMode: false,
      preferredDubbingProvider: 'stage5',
    }),
    'stage5'
  );
});

test('dubbing estimates use the ElevenLabs eleven_v4 price only', () => {
  assert.deepEqual(Object.keys(TTS_CREDITS_PER_MINUTE), ['elevenlabs']);
  assert.deepEqual(Object.keys(PREVIEW_TTS_CREDITS), ['elevenlabs']);
  assert.deepEqual(Object.keys(TTS_CREDITS_PER_CHAR), ['elevenlabs']);

  // eleven_v4: $80 per 1M chars, 2x margin, 35k credits per $1
  // => 5.6 credits/char; 750 spoken chars/min => 4,200 credits/min.
  assert.ok(Math.abs(TTS_CREDITS_PER_CHAR.elevenlabs - 5.6) < 1e-9);
  assert.ok(Math.abs(TTS_CREDITS_PER_MINUTE.elevenlabs - 4_200) < 1e-6);

  assert.equal(
    estimateDubbingCreditsFromChars(1_000),
    estimateTtsCredits({
      characters: 1_000,
      model: STAGE5_TTS_MODEL_ELEVEN_V4,
    })
  );
  // 1,000 chars x 5.6 credits (ceil may add 1 for float rounding).
  const thousandChars = estimateDubbingCreditsFromChars(1_000);
  assert.ok(thousandChars >= 5_600 && thousandChars <= 5_601);
  assert.ok(Math.abs((estimateDubbingHours(4_200 * 60) ?? 0) - 1) < 1e-9);
  assert.equal(formatDubbingTime(4_200 * 90), '~1h 30m');

  // BYO price shown in Settings: ElevenLabs eleven_v4 at $80/1M chars.
  const byoUsd = estimateDubbingUsdPerHour();
  assert.equal(typeof byoUsd, 'object');
  if (typeof byoUsd === 'object') {
    assert.ok(Math.abs(byoUsd.minUsd - 3.6) < 1e-9);
    assert.ok(Math.abs(byoUsd.maxUsd - 3.6) < 1e-9);
  }
});

test('voice preview and Dub share one action state; API key mode without ElevenLabs is blocked', () => {
  // Stage5 credits (not API key mode): priced preview.
  assert.deepEqual(getDubbingActionState(baseState), { kind: 'credits' });

  // OpenAI-only user in API key mode: blocked, no request, explain why.
  const apiKeyOnly = { ...baseState, useApiKeysMode: true };
  assert.deepEqual(getDubbingActionState(apiKeyOnly), {
    kind: 'blocked',
    blocker: 'elevenlabs-not-unlocked',
  });
  assert.equal(isDubbingBlockedInApiKeyMode(apiKeyOnly), true);
  assert.deepEqual(
    getDubbingActionState({
      ...apiKeyOnly,
      byoElevenLabsUnlocked: true,
      elevenLabsKeyPresent: true,
    }),
    { kind: 'blocked', blocker: 'elevenlabs-disabled' }
  );
  assert.deepEqual(
    getDubbingActionState({
      ...apiKeyOnly,
      byoElevenLabsUnlocked: true,
      useByoElevenLabs: true,
    }),
    { kind: 'blocked', blocker: 'elevenlabs-key-missing' }
  );

  // Usable BYO ElevenLabs key: free preview on the user's key.
  assert.deepEqual(
    getDubbingActionState({
      ...apiKeyOnly,
      byoElevenLabsUnlocked: true,
      useByoElevenLabs: true,
      elevenLabsKeyPresent: true,
    }),
    { kind: 'byo' }
  );
});
