import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMissingLinesTarget } from './missingLinesTarget';

const english = [
  'Okay, so what are we doing today?',
  'I think we should go to the store and get some food.',
  'You know, that is not what I said.',
  'They were here just a minute ago.',
];
const korean = [
  '안녕하세요, 오늘 뭐 할 거예요?',
  '저는 잘 모르겠어요.',
  '그들은 방금 전까지 여기 있었어요.',
  '그건 제가 한 말이 아니에요.',
];

test('English lines, none translated, English target: ask for a language', () => {
  const lines = english.map(original => ({ original, translation: '' }));
  assert.equal(chooseMissingLinesTarget(lines, 'english'), null);
});

test('none translated: the workspace target language is used', () => {
  const lines = english.map(original => ({ original, translation: '' }));
  assert.equal(chooseMissingLinesTarget(lines, 'korean'), 'korean');
});

test('some translated: the missing lines follow the language of the others', () => {
  const lines = [
    ...korean.map((translation, i) => ({ original: english[i], translation })),
    ...english.map(original => ({ original, translation: '' })),
  ];
  // Translated lines are Korean, even though the workspace says Spanish.
  assert.equal(chooseMissingLinesTarget(lines, 'spanish'), 'korean');
});

test('no usable target ("original") asks for a language', () => {
  const lines = korean.map(original => ({ original, translation: '' }));
  assert.equal(chooseMissingLinesTarget(lines, 'original'), null);
  assert.equal(chooseMissingLinesTarget(lines, ''), null);
});
