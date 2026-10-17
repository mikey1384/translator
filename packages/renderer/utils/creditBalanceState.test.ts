import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCreditBalanceState } from './creditBalanceState';
import { CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR } from '../../shared/constants';

const perMinute = CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR / 60;
const monthlyFree = {
  credits: 2500,
  month: '2026-10',
  refreshesOn: '2026-11-01',
};
const base = { loading: false, monthlyFree, history: null };

test('no balance yet is loading or unavailable, never hidden', () => {
  assert.equal(
    resolveCreditBalanceState({ ...base, credits: null, loading: true }),
    'loading'
  );
  assert.equal(
    resolveCreditBalanceState({ ...base, credits: null }),
    'unavailable'
  );
});

test('a device with no ledger rows is waiting for its welcome grant', () => {
  assert.equal(
    resolveCreditBalanceState({
      ...base,
      credits: 0,
      history: {
        everHadCredits: false,
        onlyWelcomeCredits: false,
        everPaid: false,
      },
    }),
    'welcomePending'
  );
});

test('an emptied device waits for the monthly top-up', () => {
  assert.equal(
    resolveCreditBalanceState({
      ...base,
      credits: 0,
      history: {
        everHadCredits: true,
        onlyWelcomeCredits: true,
        everPaid: false,
      },
    }),
    'freeBack'
  );
  assert.equal(
    resolveCreditBalanceState({ ...base, monthlyFree: null, credits: 0 }),
    'empty'
  );
});

test('paying users never get free-minute wording, even below the free allowance', () => {
  assert.equal(
    resolveCreditBalanceState({
      ...base,
      credits: perMinute * 3,
      history: {
        everHadCredits: true,
        onlyWelcomeCredits: false,
        everPaid: true,
      },
    }),
    'paid'
  );
  // Ledger not read yet: neutral "left" wording.
  assert.equal(
    resolveCreditBalanceState({ ...base, credits: perMinute * 3 }),
    'paid'
  );
});

test('free users see what is free', () => {
  const history = {
    everHadCredits: true,
    onlyWelcomeCredits: true,
    everPaid: false,
  };
  assert.equal(
    resolveCreditBalanceState({ ...base, credits: 2000, history }),
    'freeThisMonth'
  );
  assert.equal(
    resolveCreditBalanceState({ ...base, credits: 6300, history }),
    'free'
  );
});
