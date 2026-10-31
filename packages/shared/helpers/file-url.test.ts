import test from 'node:test';
import assert from 'node:assert/strict';
import { toFileUrl } from './file-url.js';

test('file URLs keep "#" and "?" inside the filename', () => {
  const url = toFileUrl(
    '/Users/a/Library/downloaded-media/#nba #76ers [7633246628794666270].mp4'
  );
  assert.equal(
    url,
    'file:///Users/a/Library/downloaded-media/%23nba%20%2376ers%20%5B7633246628794666270%5D.mp4'
  );
  const parsed = new URL(url);
  assert.equal(parsed.hash, '');
  assert.equal(
    decodeURIComponent(parsed.pathname),
    '/Users/a/Library/downloaded-media/#nba #76ers [7633246628794666270].mp4'
  );
  assert.equal(new URL(toFileUrl('/v/what?.mp4')).search, '');
  assert.equal(toFileUrl('/v/100% real.mp4'), 'file:///v/100%25%20real.mp4');
});

test('Windows drive paths, relative paths and existing URLs', () => {
  assert.equal(
    toFileUrl('C:\\Users\\a\\#clip.mp4'),
    'file:///C:/Users/a/%23clip.mp4'
  );
  assert.equal(toFileUrl('videos/a b.mp4'), 'file:///videos/a%20b.mp4');
  assert.equal(toFileUrl('file:///already.mp4'), 'file:///already.mp4');
  assert.equal(toFileUrl(''), '');
  assert.equal(
    toFileUrl('/한국어 영상.mp4'),
    `file:///${encodeURIComponent('한국어 영상.mp4')}`
  );
});
