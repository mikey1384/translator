import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allTranslationLanguageValues,
  nativeLanguageName,
  quickPickTargetLanguages,
  TRANSLATION_LANGUAGE_NATIVE_NAMES,
} from './translation-language-native-names';

test('every output language has a native name, 39 in all', () => {
  const values = allTranslationLanguageValues();
  assert.equal(values.length, 39);
  assert.equal(new Set(values).size, values.length);
  for (const value of values) {
    assert.ok(TRANSLATION_LANGUAGE_NATIVE_NAMES[value], value);
  }
  assert.equal(nativeLanguageName('korean'), '한국어');
});

test('quick picks: current choice, then UI language, then recent; max three', () => {
  assert.deepEqual(
    quickPickTargetLanguages({
      current: 'arabic',
      uiLanguageTarget: 'english',
      recent: ['korean', 'arabic', 'spanish', 'japanese'],
    }),
    ['arabic', 'english', 'korean']
  );
  assert.deepEqual(
    quickPickTargetLanguages({
      current: 'original',
      uiLanguageTarget: 'korean',
      recent: ['not-a-language', 'korean'],
    }),
    ['korean']
  );
});
