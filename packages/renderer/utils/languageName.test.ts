import test from 'node:test';
import assert from 'node:assert/strict';
import { intoLanguageName, sentenceLanguageName } from './languageName';

test('language names read naturally inside sentences', () => {
  assert.equal(sentenceLanguageName('Español', 'es'), 'español');
  assert.equal(sentenceLanguageName('Coréen', 'fr'), 'coréen');
  assert.equal(sentenceLanguageName('Tiếng Việt', 'vi'), 'tiếng Việt');
  assert.equal(sentenceLanguageName('Chinês (simplificado)', 'pt'), 'chinês');
  assert.equal(sentenceLanguageName('中文（简体）', 'zh-CN'), '中文');
  assert.equal(sentenceLanguageName('Deutsch', 'de'), 'Deutsch');
  assert.equal(sentenceLanguageName('한국어', 'ko'), '한국어');
  assert.equal(sentenceLanguageName('English', 'en'), 'English');
  assert.equal(sentenceLanguageName('ஆங்கிலம்', 'ta'), 'ஆங்கில');
  assert.equal(sentenceLanguageName('கொரிய', 'ta'), 'கொரிய');
});

test('"into X" forms for languages that inflect the name', () => {
  assert.equal(intoLanguageName('english', 'englanti', 'fi'), 'englanniksi');
  assert.equal(intoLanguageName('english', 'англійська', 'uk'), 'англійську');
  assert.equal(intoLanguageName('farsi', 'farsí', 'cs'), 'perštiny');
  // Everyone else keeps the sentence name.
  assert.equal(intoLanguageName('english', 'inglés', 'es'), 'inglés');
});
