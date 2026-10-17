import test from 'node:test';
import assert from 'node:assert/strict';
import { allUiLanguageOptions, uiLanguageEndonym } from './ui-languages';
import en from '../locales/en.json';

test('every UI language is listed by its own name, and names are distinct', () => {
  const options = allUiLanguageOptions();
  assert.equal(options.length, 39);
  const names = options.map(uiLanguageEndonym);
  for (const [i, name] of names.entries()) {
    assert.ok(
      name && !name.startsWith('languages.') && name !== options[i].label,
      `missing native name for ${options[i].value}`
    );
  }
  // Hindi, Marathi and Telugu shared one flag; their names must differ.
  assert.equal(new Set(names).size, names.length);
});

test('every UI language label key exists in en.json', () => {
  const languages = (en as { languages: Record<string, string> }).languages;
  for (const option of allUiLanguageOptions()) {
    const key = option.label.replace(/^languages\./, '');
    assert.ok(languages[key], `languages.${key} missing in en.json`);
  }
});
