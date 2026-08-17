import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyTranslationOutcome,
  isTranslationMeaningfulUse,
} from '../services/translation-funnel.js';

test('translation outcomes stay mutually exclusive and privacy-safe', () => {
  assert.equal(
    classifyTranslationOutcome({ success: true }),
    'translation_completed'
  );
  assert.equal(
    classifyTranslationOutcome({
      success: false,
      blockedReason: 'insufficient_credits',
      cancelled: true,
    }),
    'translation_credit_blocked'
  );
  assert.equal(
    classifyTranslationOutcome({ success: false, cancelled: true }),
    'translation_cancelled'
  );
  assert.equal(
    classifyTranslationOutcome({ success: false }),
    'translation_failed'
  );
});

test('only a completed translation counts as meaningful use', () => {
  assert.equal(isTranslationMeaningfulUse('translation_completed'), true);
  assert.equal(isTranslationMeaningfulUse('translation_started'), false);
  assert.equal(isTranslationMeaningfulUse('translation_credit_blocked'), false);
  assert.equal(isTranslationMeaningfulUse('translation_cancelled'), false);
  assert.equal(isTranslationMeaningfulUse('translation_failed'), false);
});
