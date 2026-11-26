import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasAnyByoEntitlementUnlocked,
  hasApiKeyModeActiveCoverage,
  hasApiKeyModeConfiguredCoverage,
  resolveSummaryProvider,
  resolveTranslationDraftProvider,
  resolveTranslationReviewProvider,
  type ByoRuntimeState,
} from './byo-runtime';

const baseState: ByoRuntimeState = {
  useApiKeysMode: true,
  byoUnlocked: true,
  byoAnthropicUnlocked: true,
  byoGeminiUnlocked: true,
  byoElevenLabsUnlocked: true,
  stage5AnthropicReviewAvailable: true,
  useByo: false,
  useByoAnthropic: false,
  useByoGemini: false,
  useByoElevenLabs: false,
  keyPresent: false,
  anthropicKeyPresent: false,
  geminiKeyPresent: false,
  elevenLabsKeyPresent: false,
  preferClaudeTranslation: false,
  preferClaudeReview: false,
  preferClaudeSummary: true,
  preferredTranscriptionProvider: 'elevenlabs',
  preferredDubbingProvider: 'elevenlabs',
  stage5DubbingTtsProvider: 'elevenlabs',
};

test('Gemini-only BYO satisfies entitlement, configured coverage, and active coverage', () => {
  const geminiOnly: ByoRuntimeState = {
    ...baseState,
    byoUnlocked: false,
    byoAnthropicUnlocked: false,
    byoElevenLabsUnlocked: false,
    byoGeminiUnlocked: true,
    useByoGemini: true,
    geminiKeyPresent: true,
  };

  assert.equal(hasAnyByoEntitlementUnlocked(geminiOnly), true);
  assert.equal(hasApiKeyModeConfiguredCoverage(geminiOnly), true);
  assert.equal(hasApiKeyModeActiveCoverage(geminiOnly), true);
  assert.equal(resolveTranslationDraftProvider(geminiOnly), 'gemini');
  assert.equal(resolveTranslationReviewProvider(geminiOnly), 'gemini');
  assert.equal(resolveSummaryProvider(geminiOnly), 'gemini');
});

test('3-provider preferences select Gemini when configured and preserve legacy preferClaude* when unset', () => {
  const allThree: ByoRuntimeState = {
    ...baseState,
    useByo: true,
    useByoAnthropic: true,
    useByoGemini: true,
    keyPresent: true,
    anthropicKeyPresent: true,
    geminiKeyPresent: true,
    preferredTranslationProvider: 'gemini',
    preferredReviewProvider: 'gemini',
    preferredSummaryProvider: 'gemini',
  };

  assert.equal(resolveTranslationDraftProvider(allThree), 'gemini');
  assert.equal(resolveTranslationReviewProvider(allThree), 'gemini');
  assert.equal(resolveSummaryProvider(allThree), 'gemini');

  // Legacy preferClaude* still works when preferred*Provider is omitted
  const legacyClaude: ByoRuntimeState = {
    ...allThree,
    preferredTranslationProvider: undefined,
    preferredReviewProvider: undefined,
    preferredSummaryProvider: undefined,
    preferClaudeTranslation: true,
    preferClaudeReview: false,
    preferClaudeSummary: true,
  };
  assert.equal(resolveTranslationDraftProvider(legacyClaude), 'anthropic');
  assert.equal(resolveTranslationReviewProvider(legacyClaude), 'openai');
  assert.equal(resolveSummaryProvider(legacyClaude), 'anthropic');
});
