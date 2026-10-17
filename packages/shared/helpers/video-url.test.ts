import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalVideoSourceKey,
  classifyVideoCollectionUrl,
  normalizeVideoUrlInput,
  youtubeVideoIdFromUrl,
} from './video-url.js';

test('links pasted without a scheme get https://', () => {
  assert.equal(
    normalizeVideoUrlInput('www.youtube.com/watch?v=jNQXAC9IVRw'),
    'https://www.youtube.com/watch?v=jNQXAC9IVRw'
  );
  assert.equal(
    normalizeVideoUrlInput('  youtu.be/jNQXAC9IVRw  '),
    'https://youtu.be/jNQXAC9IVRw'
  );
  assert.equal(
    normalizeVideoUrlInput('tiktok.com/@user/video/123'),
    'https://tiktok.com/@user/video/123'
  );
});

test('the first link is pulled out of a shared blurb', () => {
  assert.equal(
    normalizeVideoUrlInput(
      'Watch this! https://youtu.be/jNQXAC9IVRw?si=abc. So good'
    ),
    'https://youtu.be/jNQXAC9IVRw?si=abc'
  );
  assert.equal(
    normalizeVideoUrlInput('(https://x.com/a/status/1)'),
    'https://x.com/a/status/1'
  );
  assert.equal(
    normalizeVideoUrlInput('see youtu.be/jNQXAC9IVRw, thanks'),
    'https://youtu.be/jNQXAC9IVRw'
  );
});

test('text without a link is rejected', () => {
  assert.equal(normalizeVideoUrlInput('not a url'), null);
  assert.equal(normalizeVideoUrlInput(''), null);
  assert.equal(normalizeVideoUrlInput('mailto:a@b.com'), null);
  assert.equal(normalizeVideoUrlInput('file:///Users/me/a.mp4'), null);
  assert.equal(normalizeVideoUrlInput('hello.'), null);
});

test('YouTube ids come from every single-video link shape', () => {
  for (const link of [
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://m.youtube.com/watch?v=jNQXAC9IVRw&t=10',
    'youtu.be/jNQXAC9IVRw',
    'https://www.youtube.com/shorts/jNQXAC9IVRw',
    'https://www.youtube.com/live/jNQXAC9IVRw',
    'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL123',
  ]) {
    assert.equal(youtubeVideoIdFromUrl(link), 'jNQXAC9IVRw', link);
  }
  assert.equal(youtubeVideoIdFromUrl('https://www.youtube.com/@x'), null);
});

test('two links to one video share a source key', () => {
  assert.equal(
    canonicalVideoSourceKey('https://youtu.be/jNQXAC9IVRw?si=x'),
    canonicalVideoSourceKey('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  );
  assert.equal(
    canonicalVideoSourceKey(
      'https://www.tiktok.com/@a/video/1?is_from_webapp=1'
    ),
    canonicalVideoSourceKey('tiktok.com/@a/video/1/')
  );
  assert.notEqual(
    canonicalVideoSourceKey('https://vimeo.com/1'),
    canonicalVideoSourceKey('https://vimeo.com/2')
  );
});

test('channel, playlist and search links are recognised as collections', () => {
  const cases: Array<[string, 'channel' | 'playlist' | null]> = [
    ['https://www.youtube.com/@BlenderStudio/videos', 'channel'],
    ['https://www.youtube.com/@BlenderStudio', 'channel'],
    ['youtube.com/@BlenderStudio/shorts', 'channel'],
    ['https://www.youtube.com/channel/UCz75RVbH8q2jdBJ4SnwuZZQ', 'channel'],
    ['https://www.youtube.com/c/BlenderFoundation', 'channel'],
    ['https://www.youtube.com/user/BlenderFoundation/videos', 'channel'],
    ['https://www.youtube.com/playlist?list=PL123', 'playlist'],
    ['https://www.youtube.com/watch?list=PL123', 'playlist'],
    ['https://www.youtube.com/results?search_query=blender', 'playlist'],
    ['https://www.tiktok.com/@someone', 'channel'],
    // Single videos stay downloadable.
    ['https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL123', null],
    ['https://www.youtube.com/@BlenderStudio/live', null],
    ['https://www.tiktok.com/@someone/video/123', null],
    ['https://vimeo.com/1', null],
    ['not a url', null],
  ];
  for (const [link, expected] of cases) {
    assert.equal(classifyVideoCollectionUrl(link), expected, link);
  }
});
