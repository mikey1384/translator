import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSummaryModelConfig } from '../utils/summary-model-routing.ts';
import {
  AI_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
} from '../../shared/constants/index.ts';

test('Stage5 summary defaults to GPT-5.4 for high effort', () => {
  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'high',
      prefersClaude: true,
      canUseAnthropicByo: false,
      canUseOpenAiByo: false,
    }),
    {
      model: STAGE5_REVIEW_TRANSLATION_MODEL,
      provider: 'stage5',
    }
  );
});

test('Stage5 summary defaults to GPT-5.1 for standard effort', () => {
  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'standard',
      prefersClaude: true,
      canUseAnthropicByo: false,
      canUseOpenAiByo: false,
    }),
    {
      model: AI_MODELS.GPT,
      provider: 'stage5',
    }
  );
});

test('BYO OpenAI summary uses GPT-5.4 for high effort', () => {
  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'high',
      prefersClaude: false,
      canUseAnthropicByo: false,
      canUseOpenAiByo: true,
    }),
    {
      model: STAGE5_REVIEW_TRANSLATION_MODEL,
      provider: 'openai',
    }
  );
});

test('BYO Anthropic summary keeps Claude Opus for high effort', () => {
  assert.deepEqual(
    resolveSummaryModelConfig({
      effortLevel: 'high',
      prefersClaude: true,
      canUseAnthropicByo: true,
      canUseOpenAiByo: true,
    }),
    {
      model: AI_MODELS.CLAUDE_OPUS,
      provider: 'anthropic',
    }
  );
});
