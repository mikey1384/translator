import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFindRegex,
  collectMatchRows,
  countMatches,
  replaceMatches,
  splitByMatches,
  textMatches,
} from './subtitleFind';
import { collectMatchIndices } from '../containers/EditSubtitles/edit-subtitles-helpers';

test('find is literal and case-insensitive by default', () => {
  assert.equal(textMatches('Keep going?', '?'), true);
  assert.equal(textMatches('It is', 'it'), true);
  assert.equal(replaceMatches('Hi Mr. Smith', 'mr.', 'Dr.'), 'Hi Dr. Smith');
  assert.equal(replaceMatches('cost 5', '5', '$&'), 'cost $&');
  assert.equal(buildFindRegex('   '), null);
});

test('match case and whole word narrow the matches', () => {
  const opts = { matchCase: true, wholeWord: true };
  assert.equal(
    replaceMatches('it with It it.', 'it', 'X', opts),
    'X with It X.'
  );
  assert.equal(
    replaceMatches('it with', 'it', 'X', { wholeWord: true }),
    'X with'
  );
  assert.equal(textMatches('With', 'it', { wholeWord: true }), false);
  // Word characters in any script.
  assert.equal(textMatches('사랑해요', '사랑', { wholeWord: true }), false);
  assert.equal(textMatches('사랑 해요', '사랑', { wholeWord: true }), true);
});

test('empty replacement deletes the matches', () => {
  assert.equal(replaceMatches('(laughs) ok', '(laughs) ', ''), 'ok');
});

test('highlight pieces and match indices use the same rules', () => {
  assert.deepEqual(splitByMatches('a Cat cat', 'cat', { matchCase: true }), [
    { text: 'a Cat ', match: false },
    { text: 'cat', match: true },
  ]);
  const subs = [
    { id: '1', index: 1, start: 0, end: 1, original: 'with', translation: '' },
    { id: '2', index: 2, start: 1, end: 2, original: 'x', translation: 'it' },
  ];
  assert.deepEqual(collectMatchIndices(subs as any, 'it'), [0, 1]);
  assert.deepEqual(
    collectMatchIndices(subs as any, 'it', { wholeWord: true }),
    [1]
  );
});

test('the find counter counts matches, not lines', () => {
  assert.equal(countMatches('Why? Really?', '?'), 2);
  assert.equal(countMatches('', '?'), 0);
  const rows = [
    { original: 'Why? Really?', translation: '왜?' },
    { original: 'no', translation: '' },
    { original: 'Ok?', translation: '' },
  ];
  // Row 0 has three matches (two in the original, one in the translation).
  assert.deepEqual(collectMatchRows(rows, '?'), [0, 0, 0, 2]);
  assert.deepEqual(collectMatchRows(rows, '   '), []);
});
