import assert from 'node:assert/strict';
import test from 'node:test';
import { selectHighlightsByCue } from './highlight-selection.js';
const cues = [
  { id: 'a', index: 1, start: 2.3, end: 4, original: 'Hook.' },
  { id: 'b', index: 2, start: 4, end: 10.8, original: 'Payoff.' },
];
const selection = {
  id: 'try-ai',
  startCueId: 'a',
  endCueId: 'b',
  title: '직접 해보세요',
};
test('selection is bound to real full cue boundaries', () => {
  assert.deepEqual(
    selectHighlightsByCue(cues, [selection]).map(h => [
      h.start,
      h.end,
      h.lineStart,
      h.lineEnd,
    ]),
    [[2.3, 10.8, 1, 2]]
  );
  assert.throws(() =>
    selectHighlightsByCue(cues, [{ ...selection, startCueId: 'missing' }])
  );
  assert.throws(() =>
    selectHighlightsByCue(cues, [
      { ...selection, startCueId: 'b', endCueId: 'a' },
    ])
  );
  assert.throws(() => selectHighlightsByCue(cues, [selection, selection]));
  assert.deepEqual(selectHighlightsByCue(cues, []), []);
});
