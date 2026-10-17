import test from 'node:test';
import assert from 'node:assert/strict';
import { sentenceLanguageName } from './languageName';

test('language names read naturally inside sentences', () => {
  assert.equal(sentenceLanguageName('Español', 'es'), 'español');
  assert.equal(sentenceLanguageName('Coréen', 'fr'), 'coréen');
  assert.equal(sentenceLanguageName('Tiếng Việt', 'vi'), 'tiếng Việt');
  assert.equal(sentenceLanguageName('Chinês (simplificado)', 'pt'), 'chinês');
  assert.equal(sentenceLanguageName('中文（简体）', 'zh-CN'), '中文');
  assert.equal(sentenceLanguageName('Deutsch', 'de'), 'Deutsch');
  assert.equal(sentenceLanguageName('한국어', 'ko'), '한국어');
  assert.equal(sentenceLanguageName('English', 'en'), 'English');
});
