import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { migrateLegacyOpenAiTranscriptionSettings } from '../store/transcription-settings-migration.js';
import {
  APP_SETTINGS_DEFAULTS,
  normalizeTranscriptionProviderSetting,
} from '../store/settings-schema.js';
import {
  API_KEY_MODE_TRANSCRIPTION_BLOCKER_MESSAGES,
  getApiKeyModeTranscriptionBlocker,
  resolveTranscriptionRoute,
} from '../services/transcription-provider-routing.js';
import {
  chooseScribeRoute,
  isTransientNetworkError,
  runScribeWithRetries,
  SCRIBE_MAX_ATTEMPTS,
  transcriptionTooLargeError,
} from '../services/subtitle-processing/pipeline/scribe-runner.js';
import {
  formatTranscriptionFailure,
  getStage5TranscriptionErrorCode,
} from '../../shared/helpers/transcription-route.js';
import {
  ERROR_CODES,
  STAGE5_TRANSCRIPTION_MAX_AUDIO_HOURS,
  STAGE5_TRANSCRIPTION_OPUS_KBPS,
  maxTranscriptionAudioHours,
} from '../../shared/constants/index.js';
import { ASR_OPUS_BITRATE } from '../services/subtitle-processing/constants.js';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

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

const noSleep = async () => {};

test('new profiles default transcription to ElevenLabs', () => {
  assert.equal(
    APP_SETTINGS_DEFAULTS.preferredTranscriptionProvider,
    'elevenlabs'
  );
});

test('migration rewrites a saved OpenAI (Whisper) transcription preference once', () => {
  const store = fakeStore({ preferredTranscriptionProvider: 'openai' });

  assert.deepEqual(migrateLegacyOpenAiTranscriptionSettings(store), [
    'preferredTranscriptionProvider',
  ]);
  assert.equal(store.data.preferredTranscriptionProvider, 'elevenlabs');

  // Idempotent: a second launch writes nothing.
  const writesAfterFirstRun = store.writes.length;
  assert.deepEqual(migrateLegacyOpenAiTranscriptionSettings(store), []);
  assert.equal(store.writes.length, writesAfterFirstRun);
});

test('migration leaves ElevenLabs, Stage5 and missing values untouched', () => {
  for (const value of ['elevenlabs', 'stage5']) {
    const store = fakeStore({ preferredTranscriptionProvider: value });
    assert.deepEqual(migrateLegacyOpenAiTranscriptionSettings(store), []);
    assert.equal(store.writes.length, 0);
    assert.equal(store.data.preferredTranscriptionProvider, value);
  }
  const empty = fakeStore({});
  assert.deepEqual(migrateLegacyOpenAiTranscriptionSettings(empty), []);
  assert.equal(empty.writes.length, 0);

  // A store that throws on read never blocks startup.
  const throwing = {
    get: () => {
      throw new Error('corrupt');
    },
    set: () => {
      throw new Error('should not write');
    },
  };
  assert.deepEqual(migrateLegacyOpenAiTranscriptionSettings(throwing), []);
});

test('the transcription migration is wired into the settings store', () => {
  const source = readSource('packages/main/store/settings-store.ts');
  assert.match(source, /migrateLegacyOpenAiTranscriptionSettings\(/);
});

test('readers normalize legacy openai transcription values to ElevenLabs', () => {
  assert.equal(normalizeTranscriptionProviderSetting('openai'), 'elevenlabs');
  assert.equal(
    normalizeTranscriptionProviderSetting('elevenlabs'),
    'elevenlabs'
  );
  assert.equal(normalizeTranscriptionProviderSetting('stage5'), 'stage5');
  assert.equal(normalizeTranscriptionProviderSetting('bogus'), 'elevenlabs');
  assert.equal(normalizeTranscriptionProviderSetting(undefined), 'elevenlabs');
});

test('transcription never routes to OpenAI: without ElevenLabs BYO it is Stage5', () => {
  for (const preference of ['openai', 'elevenlabs', 'stage5', undefined]) {
    for (const apiKeyMode of [false, true]) {
      const route = resolveTranscriptionRoute({
        preference,
        apiKeyMode,
        hasElevenLabsByo: false,
      });
      assert.equal(route, 'stage5', `${preference}/${apiKeyMode}`);
    }
  }
});

test('BYO ElevenLabs transcribes with the user key unless Stage5 is explicitly chosen', () => {
  assert.equal(
    resolveTranscriptionRoute({
      preference: 'openai',
      apiKeyMode: true,
      hasElevenLabsByo: true,
    }),
    'elevenlabs'
  );
  assert.equal(
    resolveTranscriptionRoute({
      preference: 'stage5',
      apiKeyMode: false,
      hasElevenLabsByo: true,
    }),
    'stage5'
  );
  // API key mode never spends Stage5 credits, so 'stage5' falls to the key.
  assert.equal(
    resolveTranscriptionRoute({
      preference: 'stage5',
      apiKeyMode: true,
      hasElevenLabsByo: true,
    }),
    'elevenlabs'
  );
});

test('API key mode explains which ElevenLabs requirement blocks transcription', () => {
  const cases = [
    [false, false, false, 'elevenlabs-not-unlocked'],
    [true, false, true, 'elevenlabs-disabled'],
    [true, true, false, 'elevenlabs-key-missing'],
    [true, true, true, null],
  ] as const;
  for (const [unlocked, toggle, key, expected] of cases) {
    assert.equal(
      getApiKeyModeTranscriptionBlocker({
        elevenLabsUnlocked: unlocked,
        elevenLabsToggleEnabled: toggle,
        elevenLabsKeyPresent: key,
      }),
      expected
    );
  }
  // Every blocker message says transcription uses ElevenLabs and that the
  // translation key keeps working.
  for (const message of Object.values(
    API_KEY_MODE_TRANSCRIPTION_BLOCKER_MESSAGES
  )) {
    assert.match(message, /^Transcription uses ElevenLabs Scribe\./);
    assert.match(message, /still used for translation/);
  }
  assert.equal(
    Object.keys(API_KEY_MODE_TRANSCRIPTION_BLOCKER_MESSAGES).length,
    3
  );
});

test('Stage5 routes are chosen by size and duration only', () => {
  const route = (fileSizeMB: number, durationSec: number) =>
    chooseScribeRoute({ useByoElevenLabs: false, fileSizeMB, durationSec });
  assert.equal(route(10, 60), 'stage5-direct');
  assert.equal(route(94.9, 160), 'stage5-direct');
  assert.equal(route(95, 60), 'stage5-r2');
  assert.equal(route(10, 161), 'stage5-r2');
  assert.equal(route(500, 3600), 'stage5-r2');
  assert.equal(route(500.1, 3600), 'stage5-too-large');
  // BYO ElevenLabs always goes direct to ElevenLabs.
  assert.equal(
    chooseScribeRoute({
      useByoElevenLabs: true,
      fileSizeMB: 900,
      durationSec: 99_999,
    }),
    'byo-elevenlabs'
  );
});

test('the 500MB limit is about 36 hours of Stage5 transcription audio', () => {
  // Stage5 audio is mono 16 kHz Opus at 32 kbps (ASR_OPUS_BITRATE).
  assert.equal(STAGE5_TRANSCRIPTION_OPUS_KBPS, 32);
  assert.equal(ASR_OPUS_BITRATE, '32k');
  // 500 MiB * 8 bits / 32,000 bps = 131,072 s = 36.4 h.
  assert.equal(STAGE5_TRANSCRIPTION_MAX_AUDIO_HOURS, 36);
  // At the BYO ElevenLabs bitrate (64 kbps) it would be ~18 h.
  assert.equal(maxTranscriptionAudioHours(64), 18);

  const error = transcriptionTooLargeError();
  assert.ok(error.message.startsWith(ERROR_CODES.TRANSCRIPTION_FILE_TOO_LARGE));
  assert.match(error.message, /about 36 hours/);
  assert.match(error.message, /Split the video/);
});

test('Scribe retries transient errors, then fails clearly with no Whisper fallback', async () => {
  let calls = 0;
  const retries: number[] = [];
  await assert.rejects(
    runScribeWithRetries({
      run: async () => {
        calls += 1;
        const error: any = new Error('socket hang up');
        error.code = 'ECONNRESET';
        throw error;
      },
      label: 'test',
      sleep: noSleep,
      onRetry: attempt => retries.push(attempt),
    }),
    (error: any) => {
      assert.ok(
        error.message.startsWith(ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE)
      );
      assert.match(error.message, /try again in a few minutes/);
      return true;
    }
  );
  assert.equal(calls, SCRIBE_MAX_ATTEMPTS);
  assert.deepEqual(retries, [1, 2]);
});

test('Scribe succeeds after a transient failure', async () => {
  let calls = 0;
  const result = await runScribeWithRetries({
    run: async () => {
      calls += 1;
      if (calls === 1) {
        const error: any = new Error('Bad gateway');
        error.response = { status: 502 };
        throw error;
      }
      return 'ok';
    },
    label: 'test',
    sleep: noSleep,
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('non-transient Scribe failures end the job at once with the original error', async () => {
  const nonTransient = [
    new Error(ERROR_CODES.INSUFFICIENT_CREDITS),
    new Error(
      formatTranscriptionFailure(ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE)
    ),
    new Error(formatTranscriptionFailure(ERROR_CODES.ELEVENLABS_KEY_REQUIRED)),
    new Error(ERROR_CODES.ELEVENLABS_KEY_INVALID),
  ];
  for (const original of nonTransient) {
    let calls = 0;
    await assert.rejects(
      runScribeWithRetries({
        run: async () => {
          calls += 1;
          throw original;
        },
        label: 'test',
        sleep: noSleep,
      }),
      error => error === original
    );
    assert.equal(calls, 1, original.message);
  }
});

test('cancellation and durable detach signals pass through untouched', async () => {
  const abort = new DOMException('Operation cancelled', 'AbortError');
  await assert.rejects(
    runScribeWithRetries({
      run: async () => {
        throw abort;
      },
      label: 'test',
      sleep: noSleep,
    }),
    error => error === abort
  );

  const detached: any = new Error('detached');
  detached.code = 'DURABLE_TRANSCRIPTION_DETACHED';
  detached.response = { status: 503 };
  let calls = 0;
  await assert.rejects(
    runScribeWithRetries({
      run: async () => {
        calls += 1;
        throw detached;
      },
      label: 'test',
      sleep: noSleep,
    }),
    error => error === detached
  );
  assert.equal(calls, 1);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runScribeWithRetries({
      run: async () => 'never',
      signal: controller.signal,
      label: 'test',
      sleep: noSleep,
    }),
    (error: any) => error?.name === 'AbortError'
  );
});

test('a mapped provider-unavailable error is not retried by the client', () => {
  const mapped = new Error(
    formatTranscriptionFailure(ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE)
  );
  assert.equal(isTransientNetworkError(mapped), false);
  const rawGateway: any = new Error('Request failed with status code 502');
  rawGateway.response = { status: 502 };
  assert.equal(isTransientNetworkError(rawGateway), true);
});

test('Stage5 transcription error contract maps to app error codes', () => {
  assert.equal(
    getStage5TranscriptionErrorCode(402, { error: 'insufficient-credits' }),
    ERROR_CODES.INSUFFICIENT_CREDITS
  );
  assert.equal(
    getStage5TranscriptionErrorCode(402, undefined),
    ERROR_CODES.INSUFFICIENT_CREDITS
  );
  assert.equal(
    getStage5TranscriptionErrorCode(502, {
      error: 'transcription-provider-unavailable',
      message: 'Scribe is down',
    }),
    ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE
  );
  assert.equal(
    getStage5TranscriptionErrorCode(400, {
      error: 'elevenlabs-key-required',
      message: 'needs key',
    }),
    ERROR_CODES.ELEVENLABS_KEY_REQUIRED
  );
  // A failed durable job reports the same code without an HTTP status.
  assert.equal(
    getStage5TranscriptionErrorCode(undefined, {
      status: 'failed',
      error: 'transcription-provider-unavailable',
    }),
    ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE
  );
  // Legacy servers: a Whisper offer is a plain failure, never a dialog.
  assert.equal(
    getStage5TranscriptionErrorCode(409, {
      error: 'transcription-fallback-confirmation-required',
      reason: 'insufficient-credits',
    }),
    ERROR_CODES.INSUFFICIENT_CREDITS
  );
  assert.equal(
    getStage5TranscriptionErrorCode(409, {
      error: 'transcription-fallback-confirmation-required',
      reason: 'provider-unavailable',
    }),
    ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE
  );
  assert.equal(getStage5TranscriptionErrorCode(500, { error: 'boom' }), null);
  assert.equal(getStage5TranscriptionErrorCode(503, 'html'), null);
});

test('no transcription code path can call OpenAI transcription or Whisper', () => {
  const pass = readSource(
    'packages/main/services/subtitle-processing/pipeline/transcribe-pass.ts'
  );
  assert.doesNotMatch(pass, /'whisper-1'|AI_MODELS\.WHISPER|transcribeChunk/);
  assert.doesNotMatch(pass, /showMessageBox|from 'electron'/);
  assert.doesNotMatch(pass, /qualityTranscription/);
  assert.match(pass, /assertTranscriptionAvailable\(\)/);

  const openAiClient = readSource('packages/main/services/openai-client.ts');
  assert.doesNotMatch(
    openAiClient,
    /audio\/transcriptions|transcribeWithOpenAi/
  );

  const aiProvider = readSource('packages/main/services/ai-provider.ts');
  assert.doesNotMatch(aiProvider, /transcribeWithOpenAi/);

  const stage5Client = readSource('packages/main/services/stage5-client.ts');
  assert.doesNotMatch(stage5Client, /AI_MODELS\.WHISPER/);
  assert.match(stage5Client, /STAGE5_SCRIBE_REQUEST_MODEL = 'scribe_v2'/);

  for (const removed of [
    'packages/main/services/subtitle-processing/transcriber.ts',
    'packages/main/services/subtitle-processing/gap-repair.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(repositoryRoot, removed)), false);
  }
});
