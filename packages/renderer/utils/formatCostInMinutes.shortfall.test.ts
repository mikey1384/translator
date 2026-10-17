import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFunction } from 'i18next';
import { formatCostOfBalanceInMinutes } from './formatCostInMinutes';
import { CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR } from '../../shared/constants';

const perMinute = CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR / 60;
const t = ((_key: string, fallback: string, vars: Record<string, string>) =>
  fallback.replace(
    /\{\{(\w+)\}\}/g,
    (_m, name) => vars[name]
  )) as unknown as TFunction;

test('a balance that cannot cover the cost is not quoted ("of your 0m")', () => {
  assert.equal(formatCostOfBalanceInMinutes(t, perMinute * 6, 0, 'en'), '~6m');
  assert.equal(
    formatCostOfBalanceInMinutes(t, perMinute * 6, perMinute * 2, 'en'),
    '~6m'
  );
  assert.equal(
    formatCostOfBalanceInMinutes(t, perMinute * 6, perMinute * 6, 'en'),
    '~6m of your 6m'
  );
});
