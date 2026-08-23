import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyUrlDownloadFailureDetail } from '../services/url-processor/failure-taxonomy.js';
import { mapErrorToUserFriendly } from '../services/url-processor/error-map.js';

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'youtube-media-403-auto-captions'
);

async function fixture(name: string): Promise<string> {
  return fs.readFile(path.join(fixtureDir, name), 'utf8');
}

test('the local fixture permits caption recovery only for a media-transfer 403', async () => {
  const detail = classifyUrlDownloadFailureDetail(
    new Error(await fixture('download-error.txt'))
  );

  assert.deepEqual(detail, {
    code: 'http_403_media',
    phase: 'media_transfer',
    httpStatus: 403,
    canAttemptPublicAutomaticCaptions: true,
  });
});

test('a webpage 403 never enters caption-only recovery', async () => {
  const detail = classifyUrlDownloadFailureDetail(
    new Error(await fixture('source-error.txt'))
  );

  assert.deepEqual(detail, {
    code: 'http_403_source',
    phase: 'source_access',
    httpStatus: 403,
    canAttemptPublicAutomaticCaptions: false,
  });
});

test('login, human checks, private videos, and ambiguous 403s remain closed', () => {
  const samples = [
    'Sign in to confirm you are not a bot. HTTP Error 403',
    'This video is private. HTTP Error 403',
    'HTTP Error 403: Forbidden',
    'Unable to download video data: Forbidden',
  ];

  for (const sample of samples) {
    assert.equal(
      classifyUrlDownloadFailureDetail(new Error(sample))
        .canAttemptPublicAutomaticCaptions,
      false,
      sample
    );
  }
});

test('a numeric identifier containing 403 is not treated as an HTTP status', () => {
  const detail = classifyUrlDownloadFailureDetail(
    new Error(
      '[download] Unable to download video data for video fixture403: connection closed'
    )
  );

  assert.equal(detail.code, 'unknown');
  assert.equal(detail.httpStatus, null);
  assert.equal(detail.canAttemptPublicAutomaticCaptions, false);
});

test('a failed recovery maps HTTP 403 to app copy instead of raw yt-dlp text', async () => {
  const raw = await fixture('download-error.txt');
  assert.equal(
    mapErrorToUserFriendly({ rawErrorMessage: raw }),
    'Video download was blocked (HTTP 403), and no public automatic captions could be recovered.'
  );
  assert.equal(
    mapErrorToUserFriendly({
      rawErrorMessage:
        'ERROR: Unable to download webpage: HTTP Error 403: Forbidden',
    }),
    'This site refused access to the video (HTTP 403).'
  );
});

test('an unknown failure never returns raw upstream diagnostics to the UI', () => {
  const secretMarker = 'signed-media-token=must-not-escape';
  const result = mapErrorToUserFriendly({
    rawErrorMessage: `Unexpected extractor failure (${secretMarker})`,
    stderrContent: `opaque stderr (${secretMarker})`,
  });

  assert.equal(
    result,
    'Video download failed. Please try again or use a different URL.'
  );
  assert.doesNotMatch(result, /must-not-escape/);
});
