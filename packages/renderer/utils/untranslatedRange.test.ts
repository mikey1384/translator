import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allUntranslatedIds,
  isUntranslatedCue,
  selectMissingSegments,
  startIndexForTime,
  untranslatedRunFrom,
} from './untranslatedRange';

// 1-3 translated, 4-8 untranslated (6 has no text), 9-10 translated,
// 11-12 untranslated.
const cues = [
  ['a', 'A'],
  ['b', 'B'],
  ['c', 'C'],
  ['d', ''],
  ['e', undefined],
  ['', ''],
  ['g', '  '],
  ['h', ''],
  ['i', 'I'],
  ['j', 'J'],
  ['k', ''],
  ['l', ''],
].map(([original, translation], index) => ({
  id: `c${index + 1}`,
  start: index * 2,
  end: index * 2 + 1.5,
  original,
  translation,
}));

test('a line counts as untranslated only when it has text and no translation', () => {
  assert.equal(isUntranslatedCue(cues[0]), false);
  assert.equal(isUntranslatedCue(cues[3]), true);
  assert.equal(isUntranslatedCue(cues[5]), false);
  assert.equal(isUntranslatedCue(cues[6]), true);
});

test('from an untranslated line the run stops before the next translated line', () => {
  const run = untranslatedRunFrom(cues, 3);
  assert.deepEqual(run, {
    firstIndex: 3,
    lastIndex: 7,
    ids: ['c4', 'c5', 'c7', 'c8'],
    stopIndex: 8,
  });
});

test('starting inside a gap covers only the rest of that gap', () => {
  assert.deepEqual(untranslatedRunFrom(cues, 6)?.ids, ['c7', 'c8']);
});

test('from a translated line the run starts at the next gap, never re-sending translated lines', () => {
  const run = untranslatedRunFrom(cues, 0);
  assert.equal(run?.firstIndex, 3);
  assert.deepEqual(run?.ids, ['c4', 'c5', 'c7', 'c8']);
  const later = untranslatedRunFrom(cues, 8);
  assert.deepEqual(later, {
    firstIndex: 10,
    lastIndex: 11,
    ids: ['c11', 'c12'],
    stopIndex: -1,
  });
});

test('nothing untranslated ahead gives no run', () => {
  const done = cues.slice(0, 3);
  assert.equal(untranslatedRunFrom(done, 0), null);
  assert.equal(untranslatedRunFrom(cues, 99), null);
  assert.equal(untranslatedRunFrom(cues, -1), null);
});

test('the default start is the line at the playback time', () => {
  assert.equal(startIndexForTime(cues, 7), 3);
  assert.equal(
    untranslatedRunFrom(cues, startIndexForTime(cues, 13))?.ids.join(),
    'c7,c8'
  );
});

test('"all untranslated lines" takes every gap', () => {
  assert.deepEqual(allUntranslatedIds(cues), [
    'c4',
    'c5',
    'c7',
    'c8',
    'c11',
    'c12',
  ]);
});

test('a range request sends only its untranslated lines', () => {
  // c1 is translated: listing it must not re-translate it.
  assert.deepEqual(
    selectMissingSegments(cues, ['c1', 'c4', 'c6', 'c7']).map(c => c.id),
    ['c4', 'c7']
  );
  assert.deepEqual(
    selectMissingSegments(cues).map(c => c.id),
    allUntranslatedIds(cues)
  );
});
