import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AI_MODELS,
  CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR,
  PREVIEW_TTS_CREDITS,
  SUMMARY_QUALITY_MULTIPLIER,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  STAGE5_TRANSCRIPTION_MODEL_PRICING,
  STAGE5_TRANSLATION_MODEL_PRICING,
  STAGE5_TTS_MODEL_PRICING,
  STAGE5_TTS_MODEL_ELEVEN_MULTILINGUAL,
  STAGE5_TTS_MODEL_STANDARD,
  TTS_CREDITS_PER_MINUTE,
  estimateDubbingUsdPerHour,
  estimateSummaryUsdPerHour,
  estimateTranscriptCharsToTokens,
  estimateTranslationUsdPerHour,
  estimateTranscriptionUsdPerHour,
  estimateVideoSuggestionUsdPerSearch,
  estimateTtsCredits,
} from '../../shared/constants/index.ts';

test('shared pricing reflects current Stage5 ElevenLabs transcription and TTS rates', () => {
  assert.equal(Math.round(CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR), 28_000);
  assert.equal(Math.round(TTS_CREDITS_PER_MINUTE.elevenlabs), 9_450);

  assert.equal(
    PREVIEW_TTS_CREDITS.elevenlabs,
    estimateTtsCredits({
      characters: 5,
      model: STAGE5_TTS_MODEL_ELEVEN_MULTILINGUAL,
    })
  );
  assert.equal(
    PREVIEW_TTS_CREDITS.openai,
    estimateTtsCredits({
      characters: 5,
      model: STAGE5_TTS_MODEL_STANDARD,
    })
  );
});

test('shared pricing mirrors the backend model catalog when stage5-api is available', async () => {
  const backendModuleUrl = new URL(
    '../../../../stage5-api/src/lib/model-catalog.ts',
    import.meta.url
  );

  if (!existsSync(fileURLToPath(backendModuleUrl))) {
    return;
  }

  const backend = await import(backendModuleUrl.href);

  assert.deepEqual(
    STAGE5_TRANSLATION_MODEL_PRICING,
    backend.STAGE5_TRANSLATION_MODEL_PRICES
  );
  assert.deepEqual(
    STAGE5_TRANSCRIPTION_MODEL_PRICING,
    backend.STAGE5_TRANSCRIPTION_MODEL_PRICES
  );
  assert.deepEqual(STAGE5_TTS_MODEL_PRICING, backend.STAGE5_TTS_MODEL_PRICES);
});

test('shared BYO estimate helpers reflect current vendor heuristics', () => {
  const roundRange = (value: unknown) => {
    assert.ok(value && typeof value === 'object');
    const { minUsd, maxUsd } = value as { minUsd: number; maxUsd: number };
    return {
      minUsd: Number(minUsd.toFixed(2)),
      maxUsd: Number(maxUsd.toFixed(2)),
    };
  };

  assert.equal(estimateTranscriptCharsToTokens(45_000), 11_250);

  assert.equal(Number(estimateTranslationUsdPerHour(AI_MODELS.GPT).toFixed(2)), 0.18);
  assert.ok(
    estimateTranslationUsdPerHour(STAGE5_REVIEW_TRANSLATION_MODEL) >
      estimateTranslationUsdPerHour(AI_MODELS.GPT)
  );
  assert.equal(
    Number(estimateTranslationUsdPerHour(AI_MODELS.CLAUDE_SONNET).toFixed(2)),
    0.29
  );
  assert.equal(
    Number(estimateTranslationUsdPerHour(AI_MODELS.CLAUDE_OPUS).toFixed(2)),
    0.48
  );

  assert.equal(Number(estimateSummaryUsdPerHour(AI_MODELS.GPT).toFixed(2)), 0.11);
  assert.equal(
    Number(estimateSummaryUsdPerHour(AI_MODELS.CLAUDE_SONNET).toFixed(2)),
    0.2
  );
  assert.equal(
    Number(
      (
        estimateSummaryUsdPerHour(AI_MODELS.CLAUDE_OPUS) *
        SUMMARY_QUALITY_MULTIPLIER
      ).toFixed(2)
    ),
    1.35
  );

  assert.deepEqual(roundRange(estimateTranscriptionUsdPerHour('elevenlabs')), {
    minUsd: 0.22,
    maxUsd: 0.48,
  });
  assert.deepEqual(roundRange(estimateDubbingUsdPerHour('elevenlabs')), {
    minUsd: 5.4,
    maxUsd: 13.5,
  });

  assert.equal(Number(estimateVideoSuggestionUsdPerSearch(AI_MODELS.GPT).toFixed(2)), 0.05);
  assert.equal(
    Number(
      estimateVideoSuggestionUsdPerSearch(STAGE5_REVIEW_TRANSLATION_MODEL).toFixed(2)
    ),
    0.07
  );
  assert.equal(
    Number(estimateVideoSuggestionUsdPerSearch(AI_MODELS.CLAUDE_SONNET).toFixed(2)),
    0.08
  );
});
