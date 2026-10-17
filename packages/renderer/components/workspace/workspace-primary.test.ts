import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseWorkspacePrimary,
  type WorkspacePrimaryInput,
} from './workspace-primary';

const base: WorkspacePrimaryInput = {
  busy: false,
  hasVideo: true,
  hasEditor: true,
  previewStands: false,
  count: 3,
  translated: 0,
  missing: 3,
  sourceLanguage: 'korean',
  targetLanguage: 'english',
};

test('a video with no subtitles offers to make it speak', () => {
  assert.equal(
    chooseWorkspacePrimary({ ...base, count: 0, translated: 0, missing: 0 }),
    'makeItSpeak'
  );
});

test('a standing offer, even dismissed, keeps the duplicate button away', () => {
  assert.equal(
    chooseWorkspacePrimary({
      ...base,
      count: 0,
      translated: 0,
      missing: 0,
      previewStands: true,
    }),
    'none'
  );
});

test('untranslated lines in another language offer translation', () => {
  assert.equal(chooseWorkspacePrimary(base), 'translate');
});

test('lines already in the target language go straight to export', () => {
  assert.equal(
    chooseWorkspacePrimary({ ...base, sourceLanguage: 'english' }),
    'export'
  );
  assert.equal(
    chooseWorkspacePrimary({
      ...base,
      sourceLanguage: 'english',
      hasVideo: false,
    }),
    'save'
  );
});

test('partly translated subtitles offer to translate the missing lines', () => {
  assert.equal(
    chooseWorkspacePrimary({ ...base, translated: 2, missing: 1 }),
    'translateMissing'
  );
  assert.equal(
    chooseWorkspacePrimary({ ...base, translated: 3, missing: 0 }),
    'export'
  );
});

test('nothing while a job runs', () => {
  assert.equal(chooseWorkspacePrimary({ ...base, busy: true }), 'none');
});
