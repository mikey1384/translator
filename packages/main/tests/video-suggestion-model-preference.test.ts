import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_MODELS, STAGE5_REVIEW_TRANSLATION_MODEL } from '../../shared/constants/index.js';
import {
  getSupportedDirectVideoSuggestionModels,
  normalizeByoVideoSuggestionModel,
  resolveEffectiveVideoSuggestionModel,
  resolveVideoSuggestionPreferenceForMode,
} from '../../shared/helpers/video-suggestion-model-preference.js';

test('Stage5 credit quality video suggestions stay on GPT-5.4 even when review prefers Claude', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      preference: 'quality',
      apiKeyModeEnabled: false,
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: AI_MODELS.CLAUDE_OPUS,
    }),
    STAGE5_REVIEW_TRANSLATION_MODEL
  );
});

test('Stage5 credit video suggestion quality coerces legacy Claude-quality selections to GPT-5.4', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      preference: AI_MODELS.CLAUDE_OPUS,
      apiKeyModeEnabled: false,
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: AI_MODELS.CLAUDE_OPUS,
    }),
    STAGE5_REVIEW_TRANSLATION_MODEL
  );
});

test('Stage5 credit video suggestion standard coerces legacy Claude Sonnet selection to GPT-5.1', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      preference: AI_MODELS.CLAUDE_SONNET,
      apiKeyModeEnabled: false,
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: AI_MODELS.CLAUDE_OPUS,
    }),
    AI_MODELS.GPT
  );
});

test('Stage5 credits direct model list is OpenAI-only by product decision', () => {
  assert.deepEqual(getSupportedDirectVideoSuggestionModels(false), [
    AI_MODELS.GPT,
    STAGE5_REVIEW_TRANSLATION_MODEL,
  ]);
});

test('BYO direct model list includes both OpenAI and Anthropic options', () => {
  assert.deepEqual(getSupportedDirectVideoSuggestionModels(true), [
    AI_MODELS.GPT,
    STAGE5_REVIEW_TRANSLATION_MODEL,
    AI_MODELS.CLAUDE_SONNET,
    AI_MODELS.CLAUDE_OPUS,
  ]);
});

test('API key mode quality video suggestions can still follow the selected BYO review model', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      preference: 'quality',
      apiKeyModeEnabled: true,
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: AI_MODELS.CLAUDE_OPUS,
      availableByoModels: [AI_MODELS.GPT, AI_MODELS.CLAUDE_OPUS],
    }),
    AI_MODELS.CLAUDE_OPUS
  );
});

test('stage5 mode preference resolves independently from BYO model setting', () => {
  assert.equal(
    resolveVideoSuggestionPreferenceForMode({
      apiKeyModeEnabled: false,
      stage5Mode: 'standard',
      byoModel: AI_MODELS.CLAUDE_OPUS,
    }),
    AI_MODELS.GPT
  );
  assert.equal(
    resolveVideoSuggestionPreferenceForMode({
      apiKeyModeEnabled: false,
      stage5Mode: 'high',
      byoModel: AI_MODELS.GPT,
    }),
    STAGE5_REVIEW_TRANSLATION_MODEL
  );
});

test('byo mode preference resolves independently from Stage5 mode setting', () => {
  assert.equal(
    resolveVideoSuggestionPreferenceForMode({
      apiKeyModeEnabled: true,
      stage5Mode: 'high',
      byoModel: AI_MODELS.CLAUDE_OPUS,
    }),
    AI_MODELS.CLAUDE_OPUS
  );
  assert.equal(
    resolveVideoSuggestionPreferenceForMode({
      apiKeyModeEnabled: true,
      stage5Mode: 'standard',
      byoModel: AI_MODELS.GPT,
    }),
    AI_MODELS.GPT
  );
});

test('legacy BYO default/quality values map to follow-draft/follow-review compatibility states', () => {
  assert.equal(normalizeByoVideoSuggestionModel('default'), 'follow-draft');
  assert.equal(normalizeByoVideoSuggestionModel('quality'), 'follow-review');
});

test('follow-draft/follow-review preserve legacy semantic preferences in API-key mode', () => {
  assert.equal(
    resolveVideoSuggestionPreferenceForMode({
      apiKeyModeEnabled: true,
      byoModel: 'follow-draft',
    }),
    'default'
  );
  assert.equal(
    resolveVideoSuggestionPreferenceForMode({
      apiKeyModeEnabled: true,
      byoModel: 'follow-review',
    }),
    'quality'
  );
});

test('legacy follow-draft/follow-review still resolve through current draft/review routing', () => {
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      apiKeyModeEnabled: true,
      byoModel: 'follow-draft',
      translationDraftModel: AI_MODELS.CLAUDE_SONNET,
      translationReviewModel: STAGE5_REVIEW_TRANSLATION_MODEL,
      availableByoModels: [
        AI_MODELS.GPT,
        STAGE5_REVIEW_TRANSLATION_MODEL,
        AI_MODELS.CLAUDE_SONNET,
      ],
    }),
    AI_MODELS.CLAUDE_SONNET
  );
  assert.equal(
    resolveEffectiveVideoSuggestionModel({
      apiKeyModeEnabled: true,
      byoModel: 'follow-review',
      translationDraftModel: AI_MODELS.GPT,
      translationReviewModel: AI_MODELS.CLAUDE_OPUS,
      availableByoModels: [AI_MODELS.GPT, AI_MODELS.CLAUDE_OPUS],
    }),
    AI_MODELS.CLAUDE_OPUS
  );
});
