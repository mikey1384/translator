import assert from 'node:assert/strict';
import test from 'node:test';
import { historyCopiesForUrl } from './localDownloadCopy.js';

test('a page never reuses a different embedded video or an ambiguous legacy download', () => {
  const url = 'https://example.com/page';
  const history = [
    { sourceUrl: url, localPath: '/a.mp4', webVideoId: 'a' },
    { sourceUrl: url, localPath: '/b.mp4', webVideoId: 'b' },
    { sourceUrl: url, localPath: '/legacy.mp4' },
  ];
  assert.deepEqual(
    historyCopiesForUrl(history, url, 'b').map(v => v.localPath),
    ['/b.mp4']
  );
  assert.deepEqual(historyCopiesForUrl(history, url, 'unknown'), []);
});

test('a pasted link finds earlier downloads of the same video, newest first', () => {
  const history = [
    {
      sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      localPath: '/lib/old.mp4',
      downloadedAtIso: '2026-10-01T00:00:00Z',
    },
    {
      sourceUrl: 'https://youtu.be/jNQXAC9IVRw?si=abc',
      localPath: '/lib/new.mp4',
      downloadedAtIso: '2026-10-10T00:00:00Z',
    },
    {
      sourceUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      localPath: '/lib/other.mp4',
      downloadedAtIso: '2026-10-11T00:00:00Z',
    },
    {
      sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      downloadedAtIso: '2026-10-12T00:00:00Z',
    },
  ];
  assert.deepEqual(
    historyCopiesForUrl(history, 'youtube.com/watch?v=jNQXAC9IVRw').map(
      item => item.localPath
    ),
    ['/lib/new.mp4', '/lib/old.mp4']
  );
  assert.deepEqual(historyCopiesForUrl(history, ''), []);
});
