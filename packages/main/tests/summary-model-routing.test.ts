import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_MODELS,
  STAGE5_CREDIT_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
} from '../../shared/constants/index.js';
import { resolveSummaryModelConfig } from '../utils/summary-model-routing.js';

test('Stage5 credits summarize on Claude Sonnet 5.5 (standard) and Opus 5.5 (high)', () => {
  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'standard',
      prefersClaude: false,
      preferredProvider: 'gemini',
      canUseAnthropicByo: false,
      canUseOpenAiByo: false,
      canUseGeminiByo: false,
    }),
    { model: STAGE5_CREDIT_MODELS.STANDARD, provider: 'stage5' }
  );
  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'high',
      prefersClaude: false,
      preferredProvider: 'gemini',
      canUseAnthropicByo: false,
      canUseOpenAiByo: false,
      canUseGeminiByo: false,
    }),
    { model: STAGE5_CREDIT_MODELS.HIGH, provider: 'stage5' }
  );
});

test('BYO Gemini summary selects Hydrogen for standard and Neon or Carbon for high', () => {
  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'standard',
      prefersClaude: false,
      preferredProvider: 'gemini',
      canUseAnthropicByo: true,
      canUseOpenAiByo: true,
      canUseGeminiByo: true,
      geminiSummaryModel: AI_MODELS.GEMINI_CARBON,
    }),
    { model: AI_MODELS.GEMINI_HYDROGEN, provider: 'gemini' }
  );

  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'high',
      prefersClaude: false,
      preferredProvider: 'gemini',
      canUseAnthropicByo: true,
      canUseOpenAiByo: true,
      canUseGeminiByo: true,
      geminiSummaryModel: AI_MODELS.GEMINI_NEON,
    }),
    { model: AI_MODELS.GEMINI_NEON, provider: 'gemini' }
  );

  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'high',
      prefersClaude: false,
      preferredProvider: 'gemini',
      canUseAnthropicByo: true,
      canUseOpenAiByo: true,
      canUseGeminiByo: true,
      geminiSummaryModel: AI_MODELS.GEMINI_CARBON,
    }),
    { model: AI_MODELS.GEMINI_CARBON, provider: 'gemini' }
  );
});

test('BYO summary falls back cleanly when preferred provider is unavailable and honors legacy prefersClaude', () => {
  // Gemini-only user gets Gemini even when legacy prefersClaude=true
  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'high',
      prefersClaude: true,
      canUseAnthropicByo: false,
      canUseOpenAiByo: false,
      canUseGeminiByo: true,
      geminiSummaryModel: AI_MODELS.GEMINI_NEON,
    }),
    { model: AI_MODELS.GEMINI_NEON, provider: 'gemini' }
  );

  // Legacy prefersClaude=false without preferredProvider routes to OpenAI
  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'high',
      prefersClaude: false,
      canUseAnthropicByo: true,
      canUseOpenAiByo: true,
      canUseGeminiByo: true,
    }),
    { model: STAGE5_REVIEW_TRANSLATION_MODEL, provider: 'openai' }
  );
});
