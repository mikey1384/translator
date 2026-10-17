import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTranscriptionCreditsForSeconds,
  formatCreditBalance,
  formatTranscriptionTime,
} from './creditEstimates';
import { CREDIT_PACKS } from '../../shared/constants';
import * as creditEstimatesModule from './creditEstimates';

test('the transcription estimate matches what the server bills', () => {
  // stage5-api billed exactly 20,394 credits for a 2,622 s video (2026-10-12).
  assert.equal(estimateTranscriptionCreditsForSeconds(2622), 20394);
  assert.equal(estimateTranscriptionCreditsForSeconds(0), 0);
  assert.equal(estimateTranscriptionCreditsForSeconds(Number.NaN), 0);
});

test('packs are described in transcription time', () => {
  assert.equal(formatTranscriptionTime(CREDIT_PACKS.MICRO.credits), '32m');
  assert.equal(formatTranscriptionTime(CREDIT_PACKS.STARTER.credits), '5h 21m');
  assert.equal(
    formatTranscriptionTime(CREDIT_PACKS.STANDARD.credits),
    '12h 30m'
  );
  assert.equal(formatTranscriptionTime(CREDIT_PACKS.PRO.credits), '85h 43m');
  assert.equal(formatTranscriptionTime(0), null);
  assert.equal(formatTranscriptionTime(null), null);
});

test('balances are shown compactly without the estimate marker', () => {
  assert.equal(formatCreditBalance(850), '850');
  assert.equal(formatCreditBalance(4614), '4.6K');
  assert.equal(formatCreditBalance(167506), '168K');
  assert.equal(formatCreditBalance(-5), '0');
});

test('a dub asks first when it would use a quarter or more of the balance', () => {
  const { shouldConfirmDubCost } = creditEstimatesModule;
  assert.equal(shouldConfirmDubCost(132_219, 165_906), true); // the 2026-10-12 case
  assert.equal(shouldConfirmDubCost(337, 53_926), false);
  assert.equal(shouldConfirmDubCost(20_000, 80_000), true);
  assert.equal(shouldConfirmDubCost(19_999, 80_000), false);
  assert.equal(shouldConfirmDubCost(5_000, null), false);
  assert.equal(shouldConfirmDubCost(0, 1_000), false);
});

test('the dub confirm asks only for a large credit-paid dub', () => {
  const { dubCostConfirmPrompt } = creditEstimatesModule;
  const big = {
    estimatedCredits: 20_000,
    isByo: false,
    blockedInApiKeyMode: false,
  };
  assert.deepEqual(dubCostConfirmPrompt(big, 80_000), {
    estimatedCredits: 20_000,
    balance: 80_000,
  });
  assert.equal(
    dubCostConfirmPrompt({ ...big, estimatedCredits: 1_000 }, 80_000),
    null
  );
  // Own keys pay for it, or the run is refused elsewhere: no minutes question.
  assert.equal(dubCostConfirmPrompt({ ...big, isByo: true }, 80_000), null);
  assert.equal(
    dubCostConfirmPrompt({ ...big, blockedInApiKeyMode: true }, 80_000),
    null
  );
  assert.equal(dubCostConfirmPrompt(big, null), null);
  assert.equal(dubCostConfirmPrompt(null, 80_000), null);
});
