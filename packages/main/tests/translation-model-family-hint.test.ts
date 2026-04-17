import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTranslationModelFamilyHint } from '../utils/translation-model-family-hint.js';

test('review-phase hint follows preference by default', () => {
  assert.equal(
    resolveTranslationModelFamilyHint({
      translationPhase: 'review',
      model: 'gpt-5.4',
      prefersClaudeDraft: false,
      prefersClaudeReview: true,
    }),
    'claude'
  );
});

test('review-phase hint can be forced from concrete model', () => {
  assert.equal(
    resolveTranslationModelFamilyHint({
      translationPhase: 'review',
      model: 'gpt-5.4',
      hintSource: 'model',
      prefersClaudeDraft: false,
      prefersClaudeReview: true,
    }),
    'gpt'
  );
});

test('model-based hint resolves claude from claude model id', () => {
  assert.equal(
    resolveTranslationModelFamilyHint({
      translationPhase: 'review',
      model: 'claude-opus-4-7',
      hintSource: 'model',
      prefersClaudeDraft: false,
      prefersClaudeReview: false,
    }),
    'claude'
  );
});

test('model-based hint is undefined when model is missing', () => {
  assert.equal(
    resolveTranslationModelFamilyHint({
      translationPhase: 'review',
      hintSource: 'model',
      prefersClaudeDraft: false,
      prefersClaudeReview: true,
    }),
    undefined
  );
});
