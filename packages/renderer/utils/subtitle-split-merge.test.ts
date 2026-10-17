import test from 'node:test';
import assert from 'node:assert/strict';
import {
  joinCueText,
  mergeCues,
  splitCue,
  splitIndexNearRatio,
} from './subtitle-split-merge';

const cue = (over: Record<string, unknown> = {}) =>
  ({
    id: 'a',
    index: 1,
    start: 10,
    end: 14,
    original: 'one two three four',
    translation: 'uno dos tres cuatro',
    words: [{ start: 0, end: 1, word: 'one' }],
    ...over,
  }) as any;

test('splitCue cuts at the caret and divides time by text share', () => {
  const pieces = splitCue(cue(), { field: 'original', caret: 8, newId: 'b' });
  assert.ok(pieces);
  const [first, second] = pieces!;
  assert.equal(first.original, 'one two');
  assert.equal(second.original, 'three four');
  assert.equal(first.end, 11.778);
  assert.equal(second.start, 11.778);
  assert.equal(second.end, 14);
  assert.equal(second.id, 'b');
  assert.equal(first.translation, 'uno dos');
  assert.equal(second.translation, 'tres cuatro');
  assert.equal(first.words, undefined);
});

test('splitCue without a caret cuts near the middle; too short is refused', () => {
  const [first, second] = splitCue(cue(), { newId: 'b' })!;
  assert.equal(first.original, 'one two');
  assert.equal(second.original, 'three four');
  assert.equal(splitCue(cue({ end: 10.15 }), { newId: 'b' }), null);
});

test('splitCue in the translation field splits the translation at the caret', () => {
  const [first, second] = splitCue(cue(), {
    field: 'translation',
    caret: 4,
    newId: 'b',
  })!;
  assert.equal(first.translation, 'uno');
  assert.equal(second.translation, 'dos tres cuatro');
  assert.ok(first.original.length > 0 && second.original.length > 0);
});

test('splitIndexNearRatio uses characters for text without spaces', () => {
  assert.equal(splitIndexNearRatio('こんにちは世界', 0.5), 4);
  assert.equal(splitIndexNearRatio('ab cd ef', 0.5), 5);
});

test('mergeCues joins text and spans both lines', () => {
  const merged = mergeCues(
    cue({ start: 1, end: 2, original: 'Hi', translation: 'Hola' }),
    cue({ id: 'b', start: 2.5, end: 4, original: 'there', translation: '' })
  );
  assert.equal(merged.id, 'a');
  assert.equal(merged.start, 1);
  assert.equal(merged.end, 4);
  assert.equal(merged.original, 'Hi there');
  assert.equal(merged.translation, 'Hola');
  assert.equal(joinCueText('你好', '世界'), '你好世界');
});
