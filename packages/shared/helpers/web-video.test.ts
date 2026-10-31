import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canFallBackToWebVideoBrowser,
  shouldDiscoverWebVideo,
  siteDisplayName,
} from './web-video.js';
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

test('only non-YouTube platform links may fall back to the in-app browser', () => {
  for (const url of [
    'https://www.reddit.com/r/a/comments/1x/title/',
    'https://www.instagram.com/reel/abc/',
    'https://www.tiktok.com/@a/video/1',
  ])
    assert.equal(canFallBackToWebVideoBrowser(url), true, url);
  for (const url of [
    'https://www.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://example.com/article',
    'https://v.redd.it/abc/HLSPlaylist.m3u8',
    'file:///video',
    'not a url',
  ])
    assert.equal(canFallBackToWebVideoBrowser(url), false, url);
});

test('site names are readable for known platforms and fall back to the host', () => {
  assert.equal(
    siteDisplayName('https://www.instagram.com/reel/x/'),
    'Instagram'
  );
  assert.equal(siteDisplayName('https://old.reddit.com/r/x'), 'Reddit');
  assert.equal(siteDisplayName('https://x.com/a/status/1'), 'X');
  assert.equal(siteDisplayName('https://www.ndtv.com/video/x'), 'ndtv.com');
  assert.equal(siteDisplayName('nope'), '');
});
