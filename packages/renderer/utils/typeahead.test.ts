import assert from 'node:assert/strict';
import test from 'node:test';
import { createTypeaheadBuffer, findTypeaheadMatch } from './typeahead';

const items = [
  { value: 'en', names: ['English'] },
  { value: 'da', names: ['Dansk', 'Danish'] },
  { value: 'de', names: ['Deutsch', 'German'] },
  { value: 'es', names: ['Español', 'Spanish'] },
  { value: 'et', names: ['Eesti', 'Estonian'] },
  { value: 'el', names: ['Ελληνικά', 'Greek'] },
  { value: 'ja', names: ['日本語', 'Japanese'] },
];

test('an accumulated prefix finds the right language', () => {
  assert.equal(findTypeaheadMatch(items, 'deu', 'en'), 'de');
  assert.equal(findTypeaheadMatch(items, 'd', 'en'), 'da');
  assert.equal(findTypeaheadMatch(items, 'de', 'da'), 'de');
});

test('repeating a letter cycles through its matches', () => {
  assert.equal(findTypeaheadMatch(items, 'e', 'en'), 'es');
  assert.equal(findTypeaheadMatch(items, 'ee', 'es'), 'et');
  assert.equal(findTypeaheadMatch(items, 'eee', 'et'), 'en');
});

test('Latin and accent-free names reach non-Latin endonyms', () => {
  assert.equal(findTypeaheadMatch(items, 'ja', 'en'), 'ja');
  assert.equal(findTypeaheadMatch(items, 'gre', 'en'), 'el');
  assert.equal(findTypeaheadMatch(items, 'espa', 'en'), 'es');
  assert.equal(findTypeaheadMatch(items, 'ελ', 'en'), 'el');
  assert.equal(findTypeaheadMatch(items, 'zz', 'en'), null);
});

test('the buffer starts over after a pause', () => {
  const buffer = createTypeaheadBuffer(500);
  assert.equal(buffer.push('d', 1000), 'd');
  assert.equal(buffer.push('e', 1200), 'de');
  assert.equal(buffer.push('u', 1400), 'deu');
  assert.equal(buffer.push('e', 2500), 'e');
});
