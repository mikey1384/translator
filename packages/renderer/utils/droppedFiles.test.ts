import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDroppedFile, pickDroppedFile } from './droppedFiles.js';

test('dropped files are classified by type or extension', () => {
  assert.equal(classifyDroppedFile({ name: 'memo.m4a', type: '' }), 'media');
  assert.equal(
    classifyDroppedFile({ name: 'clip', type: 'video/mp4' }),
    'media'
  );
  assert.equal(classifyDroppedFile({ name: 'take.MTS' }), 'media');
  assert.equal(classifyDroppedFile({ name: 'episode.srt' }), 'subtitle');
  assert.equal(
    classifyDroppedFile({ name: 'notes.txt', type: 'text/plain' }),
    'other'
  );
});

test('a drop acts on the first video, else the first .srt', () => {
  const files = [
    { name: 'notes.txt' },
    { name: 'episode.srt' },
    { name: 'clip.mov' },
  ];
  assert.deepEqual(pickDroppedFile(files), { file: files[2], kind: 'media' });
  assert.deepEqual(pickDroppedFile(files.slice(0, 2)), {
    file: files[1],
    kind: 'subtitle',
  });
  assert.deepEqual(pickDroppedFile([files[0]]), {
    file: files[0],
    kind: 'other',
  });
  assert.equal(pickDroppedFile([]), null);
});
