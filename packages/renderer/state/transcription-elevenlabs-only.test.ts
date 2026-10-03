import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTranscriptionActionState,
  hasApiKeyModeActiveCoverage,
  hasApiKeyModeConfiguredCoverage,
  hasByoAudioConfiguredCoverage,
  isTranscriptionBlockedInApiKeyMode,
  isTranscriptionByo,
  normalizeTranscriptionPreference,
  resolveTranscriptionProvider,
} from './byo-runtime.js';
import { estimateTranscriptionHours } from '../utils/creditEstimates.js';
import { buildPhaseDurationPlan } from '../utils/progressEta.js';
import { BYO_PROVIDERS } from '../containers/SettingsPage/byo-provider-config.js';
import {
  CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR,
  estimateTranscriptionUsdPerHour,
} from '../../shared/constants/index.js';

const baseState = {
  useApiKeysMode: false,
  byoElevenLabsUnlocked: false,
  elevenLabsKeyPresent: false,
  useByoElevenLabs: false,
  preferredTranscriptionProvider: 'elevenlabs' as const,
};

const elevenLabsByo = {
  ...baseState,
  useApiKeysMode: true,
  byoElevenLabsUnlocked: true,
  elevenLabsKeyPresent: true,
  useByoElevenLabs: true,
};

test('saved transcription preferences normalize; legacy openai becomes elevenlabs', () => {
  assert.equal(normalizeTranscriptionPreference('openai'), 'elevenlabs');
  assert.equal(normalizeTranscriptionPreference('elevenlabs'), 'elevenlabs');
  assert.equal(normalizeTranscriptionPreference('stage5'), 'stage5');
  assert.equal(normalizeTranscriptionPreference(undefined), 'elevenlabs');
  assert.equal(normalizeTranscriptionPreference('whisper'), 'elevenlabs');
});

test('an OpenAI-only user transcribes with Stage5 credits (Scribe), never OpenAI', () => {
  // The transcription resolver does not even look at OpenAI key state.
  assert.equal(resolveTranscriptionProvider(baseState), 'stage5');
  assert.equal(
    resolveTranscriptionProvider({
      ...baseState,
      preferredTranscriptionProvider: 'openai',
    }),
    'stage5'
  );
  assert.equal(isTranscriptionByo(baseState), false);
  assert.deepEqual(getTranscriptionActionState(baseState), {
    kind: 'credits',
  });
});

test('BYO ElevenLabs transcribes on the user key; legacy openai preference too', () => {
  assert.equal(resolveTranscriptionProvider(elevenLabsByo), 'elevenlabs');
  assert.equal(
    resolveTranscriptionProvider({
      ...elevenLabsByo,
      preferredTranscriptionProvider: 'openai',
    }),
    'elevenlabs'
  );
  assert.deepEqual(getTranscriptionActionState(elevenLabsByo), {
    kind: 'byo',
  });
  // Explicit Stage5 outside API key mode stays on credits.
  assert.equal(
    resolveTranscriptionProvider({
      ...elevenLabsByo,
      useApiKeysMode: false,
      preferredTranscriptionProvider: 'stage5',
    }),
    'stage5'
  );
});

test('API key mode without a usable ElevenLabs key blocks transcription before it starts', () => {
  const apiKeyOnly = { ...baseState, useApiKeysMode: true };
  assert.deepEqual(getTranscriptionActionState(apiKeyOnly), {
    kind: 'blocked',
    blocker: 'elevenlabs-not-unlocked',
  });
  assert.equal(isTranscriptionBlockedInApiKeyMode(apiKeyOnly), true);
  assert.deepEqual(
    getTranscriptionActionState({
      ...apiKeyOnly,
      byoElevenLabsUnlocked: true,
      elevenLabsKeyPresent: true,
    }),
    { kind: 'blocked', blocker: 'elevenlabs-disabled' }
  );
  assert.deepEqual(
    getTranscriptionActionState({
      ...apiKeyOnly,
      byoElevenLabsUnlocked: true,
      useByoElevenLabs: true,
    }),
    { kind: 'blocked', blocker: 'elevenlabs-key-missing' }
  );
  // A Stage5 preference cannot escape the block: API key mode never spends
  // Stage5 credits.
  assert.equal(
    isTranscriptionBlockedInApiKeyMode({
      ...apiKeyOnly,
      preferredTranscriptionProvider: 'stage5',
    }),
    true
  );
  assert.equal(isTranscriptionBlockedInApiKeyMode(elevenLabsByo), false);
  assert.equal(isTranscriptionBlockedInApiKeyMode(baseState), false);
});

const coverageBase = {
  useApiKeysMode: true,
  byoUnlocked: false,
  byoAnthropicUnlocked: false,
  byoElevenLabsUnlocked: false,
  useByo: false,
  useByoAnthropic: false,
  useByoElevenLabs: false,
  keyPresent: false,
  anthropicKeyPresent: false,
  elevenLabsKeyPresent: false,
};

test('an OpenAI key no longer counts as audio (transcription/dubbing) coverage', () => {
  const openAiOnly = {
    ...coverageBase,
    byoUnlocked: true,
    keyPresent: true,
    useByo: true,
  };
  assert.equal(hasByoAudioConfiguredCoverage(openAiOnly), false);
  assert.equal(
    hasByoAudioConfiguredCoverage({
      ...coverageBase,
      byoElevenLabsUnlocked: true,
      elevenLabsKeyPresent: true,
    }),
    true
  );

  // API key mode itself stays available on translation coverage, so an
  // OpenAI-only user keeps translating on their key (transcription shows the
  // blocked state instead of silently switching them to Stage5 credits).
  assert.equal(hasApiKeyModeConfiguredCoverage(openAiOnly), true);
  assert.equal(hasApiKeyModeActiveCoverage(openAiOnly), true);
  assert.equal(hasApiKeyModeConfiguredCoverage(coverageBase), false);
  assert.equal(hasApiKeyModeActiveCoverage(coverageBase), false);
  // ElevenLabs alone cannot translate.
  const elevenLabsOnly = {
    ...coverageBase,
    byoElevenLabsUnlocked: true,
    elevenLabsKeyPresent: true,
    useByoElevenLabs: true,
  };
  assert.equal(hasApiKeyModeConfiguredCoverage(elevenLabsOnly), false);
  assert.equal(hasApiKeyModeActiveCoverage(elevenLabsOnly), false);
});

test('Settings offers ElevenLabs Scribe only for transcription, at the Scribe price', () => {
  assert.deepEqual(Object.keys(BYO_PROVIDERS.transcription), ['elevenlabs']);
  assert.equal(
    BYO_PROVIDERS.transcription.elevenlabs.labelKey,
    'settings.byoPreferences.elevenLabsScribe'
  );
  const usd = estimateTranscriptionUsdPerHour();
  assert.equal(typeof usd, 'object');
  if (typeof usd === 'object') {
    // ElevenLabs Scribe plan tiers: $0.22-$0.48 per audio hour.
    assert.ok(Math.abs(usd.minUsd - 0.22) < 1e-9);
    assert.ok(Math.abs(usd.maxUsd - 0.48) < 1e-9);
  }
});

test('transcription credit estimates use the Scribe price', () => {
  // Scribe $0.40/hr x 2 margin x 35,000 credits per $1 = 28,000 credits/hr.
  assert.ok(Math.abs(CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR - 28_000) < 1e-6);
  assert.ok(Math.abs((estimateTranscriptionHours(28_000) ?? 0) - 1) < 1e-9);
});

test('transcription ETA always plans Scribe phases, never chunked Whisper', () => {
  for (const transcriptionProvider of [
    'stage5',
    'elevenlabs',
    'openai',
    undefined,
  ] as const) {
    for (const videoDurationSec of [120, 3 * 3600]) {
      const plan = buildPhaseDurationPlan({
        operationType: 'transcription',
        percent: 0,
        videoDurationSec,
        transcriptionProvider,
      });
      const keys = plan.map(phase => phase.phaseKey);
      assert.ok(keys.includes('transcribe_vendor'), keys.join(','));
      for (const whisperPhase of [
        'analyze_audio',
        'chunk_audio',
        'transcribe_chunks',
      ]) {
        assert.ok(!keys.includes(whisperPhase), keys.join(','));
      }
    }
  }
});
