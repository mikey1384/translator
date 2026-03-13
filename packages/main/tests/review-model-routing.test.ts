import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveByoTranslationReviewModelConfig,
  resolveStage5TranslationReviewModelConfig,
} from '../utils/review-model-routing.js';

test('Stage5 review model config preserves the selected Anthropic family when backend support is available', () => {
  assert.equal(
    resolveStage5TranslationReviewModelConfig({
      prefersClaude: true,
      stage5AnthropicReviewAvailable: true,
    }).model,
    'claude-opus-4-6'
  );
});

test('Stage5 review model config falls back to OpenAI when backend Anthropic support is unavailable', () => {
  assert.equal(
    resolveStage5TranslationReviewModelConfig({
      prefersClaude: true,
      stage5AnthropicReviewAvailable: false,
    }).model,
    'gpt-5.4'
  );
});

test('API key review model config falls back to the available provider family', () => {
  assert.equal(
    resolveByoTranslationReviewModelConfig({
      prefersClaude: true,
      canUseAnthropicByo: false,
      canUseOpenAiByo: true,
    }).model,
    'gpt-5.4'
  );
});
