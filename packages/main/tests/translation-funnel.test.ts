import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTranslationOutcome } from '../services/translation-funnel.js';

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
