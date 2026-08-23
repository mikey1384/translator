import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

test('single-cue translation failures cannot report success or complete the editor', () => {
  const handlerSource = fs.readFileSync(
    path.join(repositoryRoot, 'packages/main/handlers/subtitle-handlers.ts'),
    'utf8'
  );
  const handlerStart = handlerSource.indexOf(
    'export async function handleTranslateOneLine'
  );
  const handlerEnd = handlerSource.indexOf(
    'export async function handleTranscribeOneLine',
    handlerStart
  );
  const handler = handlerSource.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.doesNotMatch(handler, /success:\s*!isCancel/);
  assert.match(handler, /success:\s*false,[\s\S]*cancelled:\s*isCancel/);

  const editorSource = fs.readFileSync(
    path.join(
      repositoryRoot,
      'packages/renderer/containers/EditSubtitles/SubtitleList/SubtitleItem/SubtitleEditor/index.tsx'
    ),
    'utf8'
  );
  assert.match(editorSource, /if \(res\.cancelled\) return;/);
  assert.match(editorSource, /if \(!res\.success\)/);
  assert.match(editorSource, /if \(!translated\)/);
});
