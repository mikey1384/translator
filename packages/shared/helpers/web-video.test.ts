import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDiscoverWebVideo } from './web-video.js';
test('ordinary pages get discovery; existing platform and direct-media links keep the fast path', () => {
  assert.equal(shouldDiscoverWebVideo('https://example.com/article'), true);
  assert.equal(
    shouldDiscoverWebVideo('https://youtube.com.evil.example/watch'),
    true
  );
  for (const url of [
    'https://www.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://vimeo.com/123',
    'https://x.com/a/status/123',
    'https://example.com/a.mp4?signature=xyz',
    'https://example.com/a.m3u8',
    'https://example.com/a.mpd',
    'file:///video',
  ])
    assert.equal(shouldDiscoverWebVideo(url), false, url);
});
