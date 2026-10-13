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
