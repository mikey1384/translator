import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveByoTranslationReviewModelConfig,
  resolveStage5TranslationReviewModelConfig,
} from '../utils/review-model-routing.js';

test('Stage5 credit review runs on Claude Opus 5.5 when Claude review is preferred', () => {
  assert.equal(
    resolveStage5TranslationReviewModelConfig({
      prefersClaude: true,
      stage5AnthropicReviewAvailable: true,
    }).model,
    'claude-opus-5-5'
  );
});

test('Stage5 credit review runs on Claude Opus 5.5 even if cached capability is false', () => {
  assert.equal(
    resolveStage5TranslationReviewModelConfig({
      prefersClaude: true,
      stage5AnthropicReviewAvailable: false,
    }).model,
    'claude-opus-5-5'
  );
});

test('Stage5 credit review runs on Claude Opus 5.5 when GPT review is preferred', () => {
  assert.equal(
    resolveStage5TranslationReviewModelConfig({ prefersClaude: false }).model,
    'claude-opus-5-5'
  );
});

test('API key review model config falls back to the available provider family', () => {
  assert.equal(
    resolveByoTranslationReviewModelConfig({
      prefersClaude: true,
      canUseAnthropicByo: false,
      canUseOpenAiByo: true,
    }).model,
    'gpt-5.5'
  );
});

test('API key review model config supports Gemini 4 Neon and Gemini 4 Carbon tiers', () => {
  assert.equal(
    resolveByoTranslationReviewModelConfig({
      prefersClaude: false,
      preferredProvider: 'gemini',
      canUseAnthropicByo: true,
      canUseOpenAiByo: true,
      canUseGeminiByo: true,
      geminiReviewModel: 'gemini-4-neon',
    }).model,
    'gemini-4-neon'
  );

  assert.equal(
    resolveByoTranslationReviewModelConfig({
      prefersClaude: false,
      preferredProvider: 'gemini',
      canUseAnthropicByo: true,
      canUseOpenAiByo: true,
      canUseGeminiByo: true,
      geminiReviewModel: 'gemini-4-carbon',
    }).model,
    'gemini-4-carbon'
  );

  // Gemini-only user falls back to Gemini even when legacy prefersClaude=true
  assert.equal(
    resolveByoTranslationReviewModelConfig({
      prefersClaude: true,
      canUseAnthropicByo: false,
      canUseOpenAiByo: false,
      canUseGeminiByo: true,
      geminiReviewModel: 'gemini-4-neon',
    }).model,
    'gemini-4-neon'
  );
});
