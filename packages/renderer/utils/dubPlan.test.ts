import test from 'node:test';
import assert from 'node:assert/strict';
import { dubCharCount, planDubText, segmentsForDub } from './dubPlan';

const english = [
  { original: 'Hello there, how are you doing today my friend?' },
  { original: 'I think that we should go to the market and buy some bread.' },
  { original: 'This is the best day of the whole year for all of us.' },
];

test('subtitles already in the dub language are voiced as they are', () => {
  assert.equal(planDubText(english, 'english', null), 'use-original');
  // Even when an old translation into another language is mounted.
  const withKorean = english.map(seg => ({
    ...seg,
    translation: '안녕하세요',
  }));
  assert.equal(planDubText(withKorean, 'english', 'korean'), 'use-original');
  const voiced = segmentsForDub(withKorean, 'use-original');
  assert.deepEqual(
    voiced.map(seg => seg.translation),
    english.map(seg => seg.original)
  );
});

test('missing or other-language translations are translated first', () => {
  assert.equal(planDubText(english, 'korean', null), 'translate');
  const translated = english.map(seg => ({ ...seg, translation: '번역' }));
  assert.equal(planDubText(translated, 'korean', 'korean'), 'ready');
  assert.equal(planDubText(translated, 'japanese', 'korean'), 'translate');
  // Translations of unknown language dub as they are.
  assert.equal(planDubText(translated, 'korean', null), 'ready');
});

test('the dub estimate counts what the voice will read', () => {
  const cues = [{ original: 'abc', translation: 'abcdef' }];
  assert.equal(dubCharCount(cues, 'ready'), 6);
  assert.equal(dubCharCount(cues, 'use-original'), 3);
  assert.equal(dubCharCount(cues, 'translate'), 3);
  assert.equal(planDubText([], 'english', null), 'ready');
});
