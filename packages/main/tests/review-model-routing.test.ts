import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveByoTranslationReviewModelConfig,
  resolveStage5TranslationReviewModelConfig,
} from '../utils/review-model-routing.js';

test('Stage5 review model config preserves the selected Anthropic family when Claude review is preferred', () => {
  assert.equal(
    resolveStage5TranslationReviewModelConfig({
      prefersClaude: true,
      stage5AnthropicReviewAvailable: true,
    }).model,
    'claude-opus-4-7'
  );
});

test('Stage5 review model config keeps the selected Anthropic family even if cached capability is false', () => {
  assert.equal(
    resolveStage5TranslationReviewModelConfig({
      prefersClaude: true,
      stage5AnthropicReviewAvailable: false,
    }).model,
    'claude-opus-4-7'
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
