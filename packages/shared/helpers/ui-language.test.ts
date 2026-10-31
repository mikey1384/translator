import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchSupportedUiLanguage,
  migrateUntouchedLanguageDefault,
  resolveAppUiLanguage,
  resolveSystemUiLanguage,
} from './ui-language';

function memoryStore(initial: Record<string, unknown>) {
  const data = { ...initial };
  return {
    data,
    get: (k: string) => data[k],
    set: (k: string, v: unknown) => {
      data[k] = v;
    },
    delete: (k: string) => {
      delete data[k];
    },
  };
}

test('system tags map onto bundled languages', () => {
  assert.equal(matchSupportedUiLanguage('pt-BR'), 'pt');
  assert.equal(matchSupportedUiLanguage('es-419'), 'es');
  assert.equal(matchSupportedUiLanguage('zh_Hant_TW'), 'zh-TW');
  assert.equal(matchSupportedUiLanguage('zh-Hans-CN'), 'zh-CN');
  assert.equal(matchSupportedUiLanguage('nb-NO'), 'no');
  assert.equal(matchSupportedUiLanguage('fil-PH'), 'tl');
  assert.equal(matchSupportedUiLanguage('ka-GE'), null);
  assert.equal(resolveSystemUiLanguage(['ka-GE', 'pt-BR', 'en-US']), 'pt');
  assert.equal(resolveSystemUiLanguage(['ka-GE']), 'en');
  assert.equal(resolveSystemUiLanguage([]), 'en');
});

test('a fresh install follows the system language', () => {
  assert.equal(
    resolveAppUiLanguage({ stored: undefined, systemPreferred: ['pt-BR'] }),
    'pt'
  );
  assert.equal(
    resolveAppUiLanguage({ stored: undefined, systemPreferred: ['vi-VN'] }),
    'vi'
  );
});

test('an explicit choice wins over the system language', () => {
  assert.equal(
    resolveAppUiLanguage({ stored: 'en', systemPreferred: ['pt-BR'] }),
    'en'
  );
  assert.equal(
    resolveAppUiLanguage({ stored: 'ko', systemPreferred: ['pt-BR'] }),
    'ko'
  );
});

test('the old untouched "en" default is dropped; real picks become explicit', () => {
  const untouched = memoryStore({ app_language_preference: 'en' });
  assert.equal(migrateUntouchedLanguageDefault(untouched), 'follow-system');
  assert.equal(untouched.data.app_language_preference, undefined);
  assert.equal(
    resolveAppUiLanguage({
      stored: untouched.data.app_language_preference,
      systemPreferred: ['pt-BR'],
    }),
    'pt'
  );

  const picked = memoryStore({ app_language_preference: 'ko' });
  assert.equal(migrateUntouchedLanguageDefault(picked), 'explicit');
  assert.equal(picked.data.app_language_explicit, true);
  assert.equal(picked.data.app_language_preference, 'ko');

  const explicitEnglish = memoryStore({
    app_language_preference: 'en',
    app_language_explicit: true,
  });
  assert.equal(migrateUntouchedLanguageDefault(explicitEnglish), 'unchanged');
  assert.equal(explicitEnglish.data.app_language_preference, 'en');

  // Idempotent.
  assert.equal(migrateUntouchedLanguageDefault(untouched), 'unchanged');
  assert.equal(migrateUntouchedLanguageDefault(picked), 'unchanged');
});
