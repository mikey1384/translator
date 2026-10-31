import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDIT_PACKS,
  CREDITS_PER_SUBTITLED_AUDIO_HOUR,
  WELCOME_CREDITS,
} from '../../shared/constants';
import { subtitledVideoMinutes } from './creditEstimates';
import { creditsToWholeMinutes } from './formatCostInMinutes';

// The numbers translator.tools/pricing quotes; keep them in step.
test('"about N minutes of video" claims are subtitled minutes, rounded down', () => {
  // Scribe 28,000/h + draft translation 2,780/h.
  assert.equal(Math.round(CREDITS_PER_SUBTITLED_AUDIO_HOUR), 30_780);
  assert.equal(subtitledVideoMinutes(WELCOME_CREDITS), 12);
  assert.equal(subtitledVideoMinutes(2_500), 4);
  assert.equal(subtitledVideoMinutes(CREDIT_PACKS.MICRO.credits), 29);
  assert.equal(subtitledVideoMinutes(CREDIT_PACKS.STARTER.credits), 292); // 4h 52m
  assert.equal(subtitledVideoMinutes(CREDIT_PACKS.STANDARD.credits), 682); // 11h 22m
  assert.equal(subtitledVideoMinutes(CREDIT_PACKS.PRO.credits), 4_678); // 77h 58m
  assert.equal(subtitledVideoMinutes(null), 0);
  assert.equal(subtitledVideoMinutes(-5), 0);
});

test('known amounts never round up', () => {
  // 6,300 credits are 13.5 transcription minutes: show 13, not 14.
  assert.equal(creditsToWholeMinutes(WELCOME_CREDITS, 'exact'), 13);
});
