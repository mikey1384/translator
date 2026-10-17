import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFunction } from 'i18next';
import { ERROR_CODES } from '../../../shared/constants';

// The helpers pull in i18n, which reads browser globals at import time.
const storage = new Map<string, string>();
(globalThis as any).localStorage ??= {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
};
(globalThis as any).window ??= {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  // Stores subscribe to IPC events at import; every call is a no-op.
  electron: new Proxy({}, { get: () => () => (async () => undefined)() }),
};
const { describeClipCutFailure } =
  await import('./TranscriptSummaryPanel.helpers');

// Returns the key, so the test reads which message was picked.
const t = ((key: string) => key) as unknown as TFunction;
const sourceGone = new Error(ERROR_CODES.SOURCE_VIDEO_UNAVAILABLE);

test('a lost intermediate file is a retryable failure, not a missing video', async () => {
  const message = await describeClipCutFailure(
    sourceGone,
    t,
    '/videos/talk.mp4',
    async () => true
  );
  assert.equal(message, 'summary.clipError.generic');
});

test('a really missing video says so', async () => {
  const message = await describeClipCutFailure(
    sourceGone,
    t,
    '/videos/talk.mp4',
    async () => false
  );
  assert.notEqual(message, 'summary.clipError.generic');
  assert.match(message, /removed|sourceVideoUnavailable/);
});

test('other failures stay generic without checking the file', async () => {
  let checked = false;
  const message = await describeClipCutFailure(
    new Error('ffmpeg exited with code 1'),
    t,
    '/videos/talk.mp4',
    async () => {
      checked = true;
      return true;
    }
  );
  assert.equal(message, 'summary.clipError.generic');
  assert.equal(checked, false);
});
