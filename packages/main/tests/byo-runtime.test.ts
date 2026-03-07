import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasOpenAiByoAvailable,
  hasStrictByoConfiguredCoverage,
  hasStrictByoActiveCoverage,
  resolveDubbingProvider,
  resolveSummaryProvider,
  resolveTranscriptionProvider,
  resolveTranslationDraftProvider,
  resolveTranslationReviewProvider,
  type ByoRuntimeState,
} from '../../renderer/state/byo-runtime.ts';

function createRuntimeState(
  overrides: Partial<ByoRuntimeState> = {}
): ByoRuntimeState {
  return {
    useStrictByoMode: false,
    byoUnlocked: false,
    byoAnthropicUnlocked: false,
    byoElevenLabsUnlocked: false,
    useByo: false,
    useByoAnthropic: false,
    useByoElevenLabs: false,
    keyPresent: false,
    anthropicKeyPresent: false,
    elevenLabsKeyPresent: false,
    preferClaudeTranslation: false,
    preferClaudeReview: false,
    preferClaudeSummary: false,
    preferredTranscriptionProvider: 'stage5',
    preferredDubbingProvider: 'stage5',
    stage5DubbingTtsProvider: 'openai',
    ...overrides,
  };
}

test('BYO providers stay inactive until the app is set to use API keys', () => {
  const state = createRuntimeState({
    byoUnlocked: true,
    useByo: true,
    keyPresent: true,
  });

  assert.equal(hasOpenAiByoAvailable(state), false);
  assert.equal(resolveTranslationDraftProvider(state), 'stage5');
  assert.equal(resolveTranslationReviewProvider(state), 'stage5');
  assert.equal(resolveSummaryProvider(state), 'stage5');
  assert.equal(hasStrictByoActiveCoverage(state), false);
});

test('Strict coverage still requires the explicit strict toggle and full provider coverage', () => {
  const anthropicOnlyState = createRuntimeState({
    useStrictByoMode: true,
    byoAnthropicUnlocked: true,
    useByoAnthropic: true,
    anthropicKeyPresent: true,
    preferClaudeTranslation: true,
    preferClaudeReview: true,
    preferClaudeSummary: true,
  });

  const anthropicPlusElevenLabsState = createRuntimeState({
    ...anthropicOnlyState,
    byoElevenLabsUnlocked: true,
    useByoElevenLabs: true,
    elevenLabsKeyPresent: true,
  });
  const openAiPlusElevenLabsState = createRuntimeState({
    useStrictByoMode: true,
    byoUnlocked: true,
    useByo: true,
    keyPresent: true,
    byoElevenLabsUnlocked: true,
    useByoElevenLabs: true,
    elevenLabsKeyPresent: true,
  });

  assert.equal(hasStrictByoConfiguredCoverage(openAiPlusElevenLabsState), true);
  assert.equal(hasStrictByoActiveCoverage(openAiPlusElevenLabsState), true);
  assert.equal(hasStrictByoActiveCoverage(anthropicOnlyState), false);
  assert.equal(hasStrictByoActiveCoverage(anthropicPlusElevenLabsState), true);
});

test('Audio provider preferences fall back to BYO providers once API-key mode is enabled', () => {
  const stage5PreferredState = createRuntimeState({
    useStrictByoMode: true,
    byoUnlocked: true,
    useByo: true,
    keyPresent: true,
    preferredTranscriptionProvider: 'stage5',
    preferredDubbingProvider: 'stage5',
  });
  const openAiPreferredState = createRuntimeState({
    ...stage5PreferredState,
    preferredTranscriptionProvider: 'openai',
    preferredDubbingProvider: 'openai',
  });

  assert.equal(resolveTranscriptionProvider(stage5PreferredState), 'openai');
  assert.equal(resolveDubbingProvider(stage5PreferredState), 'openai');
  assert.equal(resolveTranscriptionProvider(openAiPreferredState), 'openai');
  assert.equal(resolveDubbingProvider(openAiPreferredState), 'openai');
});
