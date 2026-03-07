import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
} from '../../shared/constants/index.ts';
import { resolveEffectiveVideoSuggestionModel } from '../../shared/helpers/video-suggestion-model-preference.ts';

test('Stage5 quality video suggestions resolve to the Stage5 review model', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      preference: 'quality',
      strictByoModeEnabled: false,
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: STAGE5_REVIEW_TRANSLATION_MODEL,
    }),
    STAGE5_REVIEW_TRANSLATION_MODEL
  );
});

test('Stage5 direct Claude Sonnet preference still resolves to the draft runtime model', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      preference: AI_MODELS.CLAUDE_SONNET,
      strictByoModeEnabled: false,
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: STAGE5_REVIEW_TRANSLATION_MODEL,
    }),
    AI_MODELS.GPT
  );
});

test('Stage5 direct Claude Opus preference resolves to the review runtime model', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      preference: AI_MODELS.CLAUDE_OPUS,
      strictByoModeEnabled: false,
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: STAGE5_REVIEW_TRANSLATION_MODEL,
    }),
    STAGE5_REVIEW_TRANSLATION_MODEL
  );
});

test('Direct GPT-5.4 preference resolves to the review runtime model', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      preference: STAGE5_REVIEW_TRANSLATION_MODEL,
      strictByoModeEnabled: false,
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: STAGE5_REVIEW_TRANSLATION_MODEL,
    }),
    STAGE5_REVIEW_TRANSLATION_MODEL
  );
});

test('Strict BYO direct GPT-5.4 preference stays on GPT-5.4 when OpenAI is available', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      preference: STAGE5_REVIEW_TRANSLATION_MODEL,
      strictByoModeEnabled: true,
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: STAGE5_REVIEW_TRANSLATION_MODEL,
      availableByoModels: [AI_MODELS.GPT, STAGE5_REVIEW_TRANSLATION_MODEL],
    }),
    STAGE5_REVIEW_TRANSLATION_MODEL
  );
});

test('Strict BYO quality still resolves to the direct BYO review model', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      preference: 'quality',
      strictByoModeEnabled: true,
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: AI_MODELS.CLAUDE_OPUS,
      availableByoModels: [AI_MODELS.GPT, AI_MODELS.CLAUDE_OPUS],
    }),
    AI_MODELS.CLAUDE_OPUS
  );
});
