import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCreditBalanceState } from './creditBalanceState';
import { CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR } from '../../shared/constants';

const perMinute = CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR / 60;
const base = { loading: false, monthlyFree: null, history: null };

test('an unreachable server never reads as "no minutes left"', () => {
  assert.equal(
    resolveCreditBalanceState({ ...base, credits: 0, offline: true }),
    'offline'
  );
  assert.equal(
    resolveCreditBalanceState({ ...base, credits: null, offline: true }),
    'offline'
  );
  // Online, the same zero is a real empty balance.
  assert.equal(resolveCreditBalanceState({ ...base, credits: 0 }), 'empty');
});

test('a cached positive balance still shows while offline', () => {
  assert.equal(
    resolveCreditBalanceState({
      ...base,
      credits: perMinute * 90,
      offline: true,
    }),
    'paid'
  );
});
