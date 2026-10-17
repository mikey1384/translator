import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditsToWholeMinutes,
  formatCostInMinutes,
  formatCostOfBalanceInMinutes,
} from './formatCostInMinutes';
import { CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR } from '../../shared/constants';

const perMinute = CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR / 60;

test('estimates round up and carry the "~" marker', () => {
  assert.equal(formatCostInMinutes(perMinute * 5.2, { locale: 'en' }), '~6m');
  assert.equal(
    formatCostInMinutes(perMinute * 125, { locale: 'en' }),
    '~2h 5m'
  );
});

test('a tiny cost reads "<1m", never "~0m"', () => {
  assert.equal(formatCostInMinutes(29, { locale: 'en' }), '<1m');
});

test('balances round down and an empty balance reads "0m"', () => {
  assert.equal(
    formatCostInMinutes(perMinute * 257.9, { kind: 'balance', locale: 'en' }),
    '4h 17m'
  );
  assert.equal(formatCostInMinutes(0, { kind: 'balance', locale: 'en' }), '0m');
  assert.equal(
    formatCostInMinutes(perMinute * 0.5, { kind: 'balance', locale: 'en' }),
    '0m'
  );
});

test('other languages get their own units', () => {
  const ko = formatCostInMinutes(perMinute * 6, { locale: 'ko' });
  assert.equal(ko, '~6분');
});

test('whole minutes follow the kind rounding', () => {
  assert.equal(creditsToWholeMinutes(perMinute * 2.5, 'balance'), 2);
  assert.equal(creditsToWholeMinutes(perMinute * 2.5, 'estimate'), 3);
  assert.equal(creditsToWholeMinutes(null, 'balance'), 0);
});

test('cost of balance names both in minutes', () => {
  const t = ((_key: string, fallback: string, vars: Record<string, string>) =>
    fallback
      .replace('{{cost}}', vars.cost)
      .replace('{{balance}}', vars.balance)) as any;
  assert.equal(
    formatCostOfBalanceInMinutes(t, perMinute * 6, perMinute * 60, 'en'),
    '~6m of your 1h'
  );
  assert.equal(
    formatCostOfBalanceInMinutes(t, perMinute * 6, null, 'en'),
    '~6m'
  );
});
