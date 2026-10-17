import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCreditAmount,
  formatDurationHours,
  formatDurationMinutes,
  formatDurationSeconds,
} from './formatUnits';
import {
  creditsToVideoMinutes,
  formatCredits,
  formatDubbingTime,
  formatHours,
} from './creditEstimates';
import { CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR } from '../../shared/constants';

test('English durations keep the compact "2h 5m" form', () => {
  assert.equal(formatDurationMinutes(125), '2h 5m');
  assert.equal(formatDurationMinutes(45), '45m');
  assert.equal(formatDurationMinutes(120), '2h');
  assert.equal(formatDurationMinutes(0.2), '<1m');
  assert.equal(formatDurationHours(1.5), '1h 30m');
  assert.equal(formatDurationSeconds(30), '30s');
  assert.equal(formatHours(2.0833), '2h 5m');
});

test('other UI languages get their own units and digits, not English letters', () => {
  assert.equal(formatDurationMinutes(125, 'ko'), '2시간 5분');
  const fa = formatDurationMinutes(125, 'fa');
  assert.ok(!/[hm]/.test(fa), fa);
  assert.ok(/[۰-۹]/.test(fa), fa);
  const ar = formatDurationMinutes(0.2, 'ar');
  assert.ok(!/m/.test(ar), ar);
  assert.ok(!/[a-z]/i.test(formatDurationSeconds(30, 'ja')));
});

test('Japanese and Chinese write units right after the number', () => {
  assert.equal(formatDurationMinutes(32, 'ja'), '32分');
  assert.equal(formatDurationMinutes(0.2, 'ja'), '<1分');
  assert.equal(formatDurationMinutes(125, 'ja'), '2時間5分');
  assert.equal(formatDurationSeconds(12, 'ja'), '12秒');
  assert.ok(!/\s/.test(formatDurationMinutes(125, 'zh-TW')));
  // Languages that do space their units keep the space.
  assert.equal(formatDurationMinutes(32, 'de'), '32 Min.');
});

test('credit amounts are compact and localized', () => {
  assert.equal(formatCreditAmount(850), '850');
  assert.equal(formatCreditAmount(4614), '4.6K');
  assert.equal(formatCreditAmount(167506), '168K');
  assert.equal(formatCreditAmount(-3), '0');
  assert.equal(formatCredits(58), '~58');
  assert.ok(/만/.test(formatCreditAmount(167506, 'ko')));
});

test('dubbing time is localized and never overstates', () => {
  assert.equal(formatDubbingTime(4_200 * 90), '~1h 30m');
  assert.ok(!/[hms]/.test(formatDubbingTime(4_200 * 90, 'elevenlabs', 'ko')));
});

test('credits convert to minutes of video at the transcription rate', () => {
  assert.equal(creditsToVideoMinutes(CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR), 60);
  assert.equal(creditsToVideoMinutes(-1), 0);
});
