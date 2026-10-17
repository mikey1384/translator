import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { sweepStaleRenderTempDirs } from '../utils/render-temp-sweep.js';

const HOUR = 60 * 60 * 1000;

function fakeFs(entries: Record<string, { dir: boolean; mtimeMs: number }>) {
  const removed: string[] = [];
  return {
    removed,
    fs: {
      readdir: async () => Object.keys(entries),
      stat: async (p: string) => {
        const e = entries[path.basename(p)];
        if (!e) throw new Error('ENOENT');
        return { isDirectory: () => e.dir, mtimeMs: e.mtimeMs };
      },
      rm: async (p: string) => {
        removed.push(path.basename(p));
      },
    },
  };
}

test('removes only stale, unowned subtitle-render dirs', async () => {
  const now = 10 * HOUR;
  const { fs, removed } = fakeFs({
    'subtitle-render-old': { dir: true, mtimeMs: now - 3 * HOUR },
    'subtitle-render-recent': { dir: true, mtimeMs: now - 10 * 60 * 1000 },
    'subtitle-render-live': { dir: true, mtimeMs: now - 5 * HOUR },
    'subtitle-render-file': { dir: false, mtimeMs: now - 5 * HOUR },
    'other-app-dir': { dir: true, mtimeMs: now - 9 * HOUR },
  });
  const result = await sweepStaleRenderTempDirs({
    tempRoot: '/tmp-root',
    liveDirs: ['/tmp-root/subtitle-render-live'],
    fs,
    now,
  });
  assert.deepEqual(removed, ['subtitle-render-old']);
  assert.deepEqual(result, [path.resolve('/tmp-root/subtitle-render-old')]);
});

test('an unreadable temp root sweeps nothing', async () => {
  const result = await sweepStaleRenderTempDirs({
    tempRoot: '/nope',
    liveDirs: [],
    fs: {
      readdir: async () => {
        throw new Error('EACCES');
      },
      stat: async () => {
        throw new Error('unreachable');
      },
      rm: async () => {},
    },
  });
  assert.deepEqual(result, []);
});
