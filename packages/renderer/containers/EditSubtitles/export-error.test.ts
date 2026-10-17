import assert from 'node:assert/strict';
import test from 'node:test';
import type { TFunction } from 'i18next';

import { exportErrorMessage } from './export-error';

const t = ((key: string) => `t:${key}`) as unknown as TFunction;
const sourceVideo = {
  isUnavailable: (message: string) => message === 'source-video-unavailable',
  message: () => 'source gone',
};

test('export failures never show raw English from the main process', () => {
  const cases: Array<[string, string]> = [
    ['insufficient-disk-space', 't:common.error.insufficientDiskSpace'],
    ['ENOSPC: no space left on device', 't:common.error.insufficientDiskSpace'],
    ['source-video-unavailable', 'source gone'],
    [
      "EACCES: permission denied, mkdir 'subtitle-render-x'",
      't:export.error.permission',
    ],
    [
      'Video export tools could not be downloaded. Check your connection.',
      't:export.error.tools',
    ],
    ['ffmpeg direct merge exited with 1', 't:export.error.generic'],
    [
      'Subtitle render options conflict with the canonical render spec (display width).',
      't:export.error.generic',
    ],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(exportErrorMessage(raw, t, sourceVideo), expected, raw);
  }
});
