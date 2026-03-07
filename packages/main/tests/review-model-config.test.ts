import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getStage5TranslationReasoning,
  resolveTranslationReviewModelConfig,
} from '../utils/review-model-routing.ts';
import {
  STAGE5_REVIEW_TRANSLATION_MODEL,
} from '../../shared/constants/index.ts';

test('Stage5 review defaults to GPT-5.4 without reasoning when no BYO review path is active', () => {
  assert.deepEqual(
    resolveTranslationReviewModelConfig({
      prefersClaude: true,
      canUseAnthropicByo: false,
      canUseOpenAiByo: false,
    }),
    {
      model: STAGE5_REVIEW_TRANSLATION_MODEL,
    }
  );
});

test('OpenAI BYO review now uses GPT-5.4 without reasoning when that path is active', () => {
  assert.deepEqual(
    resolveTranslationReviewModelConfig({
      prefersClaude: false,
      canUseAnthropicByo: false,
      canUseOpenAiByo: true,
    }),
    {
      model: STAGE5_REVIEW_TRANSLATION_MODEL,
    }
  );
});

test('Stage5 review requests strip reasoning before they are sent to the API', () => {
  assert.equal(
    getStage5TranslationReasoning({
      translationPhase: 'review',
      reasoning: { effort: 'high' },
    }),
    undefined
  );

  assert.deepEqual(
    getStage5TranslationReasoning({
      translationPhase: 'draft',
      reasoning: { effort: 'high' },
    }),
    { effort: 'high' }
  );
});
