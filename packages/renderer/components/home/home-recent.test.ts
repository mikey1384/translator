import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalRecentItem, mergeHomeRecentItems } from './home-recent';

const iso = (ms: number) => new Date(ms).toISOString();

test('local files join downloads, newest first, capped at three', () => {
  const merged = mergeHomeRecentItems(
    [
      {
        id: 'd1',
        sourceUrl: 'https://y/1',
        title: 'One',
        downloadedAtIso: iso(1000),
        localPath: '/dl/1.mp4',
      },
      {
        id: 'd2',
        sourceUrl: 'https://y/2',
        title: 'Two',
        downloadedAtIso: iso(3000),
        localPath: '/dl/2.mp4',
      },
    ],
    [
      { path: '/Movies/clip.mp4', name: 'clip.mp4', openedAt: 4000 },
      { path: '/Movies/old.mp4', name: 'old.mp4', openedAt: 500 },
    ]
  );
  assert.deepEqual(
    merged.map(item => item.title),
    ['clip.mp4', 'Two', 'One']
  );
  assert.equal(isLocalRecentItem(merged[0]), true);
  assert.equal(merged[0].localPath, '/Movies/clip.mp4');
  assert.equal(isLocalRecentItem(merged[1]), false);
});

test('a downloaded file reopened from disk stays one card, moved to the front', () => {
  const merged = mergeHomeRecentItems(
    [
      {
        id: 'd1',
        sourceUrl: 'https://y/1',
        title: 'One',
        downloadedAtIso: iso(1000),
        localPath: '/dl/1.mp4',
      },
      {
        id: 'd2',
        sourceUrl: 'https://y/2',
        title: 'Two',
        downloadedAtIso: iso(2000),
        localPath: '/dl/2.mp4',
      },
    ],
    [{ path: '/DL/1.mp4', name: '1.mp4', openedAt: 5000 }]
  );
  assert.deepEqual(
    merged.map(item => item.id),
    ['d1', 'd2']
  );
});

test('duplicate downloads of one link show once', () => {
  const merged = mergeHomeRecentItems(
    [
      {
        id: 'a',
        sourceUrl: 'https://y/1',
        title: 'A',
        downloadedAtIso: iso(2000),
        localPath: '/dl/a.mp4',
      },
      {
        id: 'b',
        sourceUrl: 'https://y/1',
        title: 'B',
        downloadedAtIso: iso(1000),
        localPath: '/dl/b.mp4',
      },
    ],
    []
  );
  assert.deepEqual(
    merged.map(item => item.id),
    ['a']
  );
});
