import test from 'node:test';
import assert from 'node:assert/strict';
import { fileTitle } from './fileTitle';

test('tab titles drop the file extension', () => {
  assert.equal(fileTitle('/Users/a/Movies/My Clip.final.mp4'), 'My Clip.final');
  assert.equal(fileTitle('C:\\videos\\talk.webm'), 'talk');
  assert.equal(fileTitle('/tmp/noext'), 'noext');
});
