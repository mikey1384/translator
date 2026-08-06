import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TranslationSessionStore } from '../src/session-store.mjs';

const SOURCE = `1
00:00:00,000 --> 00:00:02,000
Hello there.

2
00:00:02,000 --> 00:00:04,500
How are you?
`;

test('agent translation session completes and exports dual SRT', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-agent-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.srt');
  await fs.writeFile(sourcePath, SOURCE);
  const store = new TranslationSessionStore({ root: path.join(root, 'sessions') });

  const created = await store.create({
    sourceSrt: sourcePath,
    sourceLanguage: 'English',
    targetLanguage: 'Korean',
  });
  assert.equal(created.totalCues, 2);
  assert.equal(created.pendingCues, 2);

  const batch = await store.getBatch(created.sessionId);
  assert.deepEqual(
    batch.cues.map(cue => cue.source),
    ['Hello there.', 'How are you?']
  );

  const submitted = await store.submit(created.sessionId, {
    translations: [
      { id: 'cue-1', text: '안녕하세요.' },
      { id: 'cue-2', text: '어떻게 지내세요?' },
    ],
  });
  assert.equal(submitted.pendingCues, 0);

  const outputPath = path.join(root, 'dual.srt');
  await store.export(created.sessionId, { outputPath, mode: 'dual' });
  const exported = await fs.readFile(outputPath, 'utf8');
  assert.match(exported, /Hello there\.\n안녕하세요\./);
  assert.match(exported, /How are you\?\n어떻게 지내세요\?/);
});

test('review batches allow revisions without changing source text', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-agent-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.srt');
  const translatedPath = path.join(root, 'translated.srt');
  await fs.writeFile(sourcePath, SOURCE);
  await fs.writeFile(
    translatedPath,
    SOURCE.replace('Hello there.', '안녕.').replace('How are you?', '잘 지내?')
  );
  const store = new TranslationSessionStore({ root: path.join(root, 'sessions') });
  const created = await store.create({
    sourceSrt: sourcePath,
    existingTranslationSrt: translatedPath,
    targetLanguage: 'Korean',
  });

  const batch = await store.getBatch(created.sessionId, { mode: 'review' });
  assert.equal(batch.cues.length, 2);
  await store.submit(created.sessionId, {
    mode: 'review',
    translations: [{ id: 'cue-1', text: '안녕하세요.' }],
  });
  const nextBatch = await store.getBatch(created.sessionId, { mode: 'review' });
  assert.deepEqual(nextBatch.cues.map(cue => cue.id), ['cue-2']);
});
