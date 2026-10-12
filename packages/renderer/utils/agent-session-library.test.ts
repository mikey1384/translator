import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldStoreAgentSessionTranslation } from './agent-session-library.js';

const translated = [{ translation: '안녕하세요.' }, { translation: '좋아요.' }];

test('a fully translated job session with a source is stored', () => {
  assert.equal(
    shouldStoreAgentSessionTranslation({
      segments: translated,
      targetLanguage: 'Korean',
      sourceVideoPath: '/videos/talk.mp4',
    }),
    true
  );
  assert.equal(
    shouldStoreAgentSessionTranslation({
      segments: translated,
      targetLanguage: 'Korean',
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
    }),
    true
  );
});

test('a partial or empty job session is never stored', () => {
  assert.equal(
    shouldStoreAgentSessionTranslation({
      segments: [{ translation: '안녕하세요.' }, { translation: '  ' }],
      targetLanguage: 'Korean',
      sourceVideoPath: '/videos/talk.mp4',
    }),
    false
  );
  assert.equal(
    shouldStoreAgentSessionTranslation({
      segments: [],
      targetLanguage: 'Korean',
      sourceVideoPath: '/videos/talk.mp4',
    }),
    false
  );
});

test('transcript-only plans and sourceless sessions are never stored', () => {
  assert.equal(
    shouldStoreAgentSessionTranslation({
      segments: translated,
      targetLanguage: 'translation-not-requested',
      sourceVideoPath: '/videos/talk.mp4',
    }),
    false
  );
  assert.equal(
    shouldStoreAgentSessionTranslation({
      segments: translated,
      targetLanguage: '',
      sourceVideoPath: '/videos/talk.mp4',
    }),
    false
  );
  assert.equal(
    shouldStoreAgentSessionTranslation({
      segments: translated,
      targetLanguage: 'Korean',
    }),
    false
  );
});
