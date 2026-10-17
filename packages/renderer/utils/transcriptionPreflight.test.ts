import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptionBalanceIsShort } from './creditShortfall';
import { estimateTranscriptionCreditsForSeconds } from './creditEstimates';

test('a known balance below the tail cost is refused before any upload', () => {
  assert.equal(
    transcriptionBalanceIsShort({
      seconds: 70,
      credits: 0,
      authoritative: true,
    }),
    true
  );
  const enough = estimateTranscriptionCreditsForSeconds(72);
  assert.equal(
    transcriptionBalanceIsShort({
      seconds: 70,
      credits: enough,
      authoritative: true,
    }),
    false
  );
});

test('an unknown balance lets the server decide', () => {
  assert.equal(
    transcriptionBalanceIsShort({
      seconds: 70,
      credits: 0,
      authoritative: false,
    }),
    false
  );
  assert.equal(
    transcriptionBalanceIsShort({
      seconds: 70,
      credits: null,
      authoritative: true,
    }),
    false
  );
});
