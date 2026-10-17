import assert from 'node:assert/strict';
import test from 'node:test';

import { processVideoUrl } from '../services/url-processor/index.js';
import {
  buildSourceGuardPrintArgs,
  createSourceGuard,
  LONG_VIDEO_CONFIRM_SECONDS,
  SINGLE_VIDEO_ARGS,
  UrlSourceRejectedError,
  type SourceGuard,
} from '../services/url-processor/source-guard.js';

// Read through a call so an earlier null check doesn't narrow the getter.
const rejectionOf = (guard: SourceGuard) => guard.rejection;

// What yt-dlp prints for buildSourceGuardPrintArgs(), per printed field.
function guardLine(key: string, value: string): string {
  return `__stage5_guard__${key}\t${value}`;
}

test('the guard prints ride on yt-dlp extraction stages, before any media', () => {
  const args = buildSourceGuardPrintArgs();
  const templates = args.filter((_, index) => index % 2 === 1);
  assert.ok(args.every((arg, index) => index % 2 === 1 || arg === '--print'));
  assert.ok(
    templates.some(
      t => t.startsWith('pre_process:') && t.includes('%(playlist_id)s')
    )
  );
  assert.ok(
    templates.some(
      t => t.startsWith('pre_process:') && t.includes('%(live_status)s')
    )
  );
  assert.ok(
    templates.some(
      t => t.startsWith('before_dl:') && t.includes('filesize_approx')
    )
  );
});

test('yt-dlp never fetches more than one entry of a link', () => {
  assert.ok(SINGLE_VIDEO_ARGS.includes('--no-playlist'));
  const index = SINGLE_VIDEO_ARGS.indexOf('--playlist-items');
  assert.ok(index >= 0);
  assert.equal(SINGLE_VIDEO_ARGS[index + 1], '1');
});

test('a YouTube playlist entry is refused as a collection', () => {
  const guard = createSourceGuard({ isYouTube: true });
  assert.equal(
    guard.applyLine(guardLine('playlist_id', 'UCz75RVbH8q2jdBJ4SnwuZZQ')),
    true
  );
  assert.equal(guard.rejection?.code, 'collection_url');
});

test('single videos and non-YouTube multi-video posts pass', () => {
  const youtube = createSourceGuard({ isYouTube: true });
  youtube.applyLine(guardLine('playlist_id', 'NA'));
  youtube.applyLine(guardLine('live_status', 'not_live'));
  youtube.applyLine(guardLine('duration', '19'));
  youtube.applyLine(guardLine('filesize', '475961'));
  youtube.noteOutputLine('[download]  12.0% of 465.00KiB');
  assert.equal(youtube.rejection, null);

  // An X post with two videos is a "playlist" to yt-dlp; --playlist-items 1
  // takes its first video instead of refusing the post.
  const x = createSourceGuard({ isYouTube: false });
  x.applyLine(guardLine('playlist_id', '1790000000000000000'));
  assert.equal(x.rejection, null);
});

test('live and upcoming broadcasts are refused', () => {
  for (const status of ['is_live', 'is_upcoming', 'post_live']) {
    const guard = createSourceGuard({ isYouTube: true });
    guard.applyLine(guardLine('live_status', status));
    assert.equal(guard.rejection?.code, 'live_stream', status);
  }
  const ended = createSourceGuard({ isYouTube: true });
  ended.applyLine(guardLine('live_status', 'was_live'));
  assert.equal(ended.rejection, null);
});

test('a long video stops before downloading with its length and size', () => {
  const guard = createSourceGuard({ isYouTube: true });
  guard.applyLine(guardLine('duration', String(3 * 3600)));
  assert.equal(rejectionOf(guard), null, 'waits for the chosen format size');
  guard.applyLine(guardLine('filesize', '4100000000'));
  const rejection = rejectionOf(guard);
  assert.ok(rejection instanceof UrlSourceRejectedError);
  assert.equal(rejection.code, 'long_video');
  assert.equal(rejection.durationSec, 3 * 3600);
  assert.equal(rejection.estimatedBytes, 4_100_000_000);
});

test('a long video without a printed size stops at the first progress line', () => {
  const guard = createSourceGuard({ isYouTube: false });
  guard.applyLine(guardLine('duration', String(LONG_VIDEO_CONFIRM_SECONDS)));
  guard.applyLine(guardLine('filesize', 'NA'));
  assert.equal(guard.rejection?.code, 'long_video');
  assert.equal(guard.rejection?.estimatedBytes, undefined);

  const noSizeLine = createSourceGuard({ isYouTube: false });
  noSizeLine.applyLine(guardLine('duration', '7200'));
  noSizeLine.noteOutputLine('[info] Downloading 1 format(s): 18');
  assert.equal(rejectionOf(noSizeLine), null);
  noSizeLine.noteOutputLine('[download]   0.1% of 2.00GiB');
  assert.equal(rejectionOf(noSizeLine)?.code, 'long_video');
});

test('a confirmed long video downloads', () => {
  const guard = createSourceGuard({ isYouTube: true, allowLongVideo: true });
  guard.applyLine(guardLine('duration', '36000'));
  guard.applyLine(guardLine('filesize', '9000000000'));
  guard.noteOutputLine('[download]   1.0% of 8.38GiB');
  assert.equal(guard.rejection, null);
});

test('non-guard output is left for the progress parser', () => {
  const guard = createSourceGuard({ isYouTube: true });
  assert.equal(guard.applyLine('[download]  50.0% of 1.00MiB'), false);
  assert.equal(guard.applyLine('__stage5_meta__title\tMe at the zoo'), false);
});

test('channel and playlist links are refused before yt-dlp runs', async () => {
  let downloads = 0;
  for (const url of [
    'https://www.youtube.com/@BlenderStudio/videos',
    'https://www.youtube.com/playlist?list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb',
  ]) {
    await assert.rejects(
      processVideoUrl(
        url,
        '1080p',
        undefined,
        'collection-guard-test',
        {
          fileManager: { getTempDir: () => '/nonexistent' } as any,
          ffmpeg: {} as any,
        },
        {
          downloadVideoFromPlatformImpl: (async () => {
            downloads += 1;
            throw new Error('must not download');
          }) as any,
        }
      ),
      (error: unknown) =>
        error instanceof UrlSourceRejectedError &&
        error.code === 'collection_url'
    );
  }
  assert.equal(downloads, 0);
});

test('a refusal from the download is not retried or turned into a cookie prompt', async () => {
  let downloads = 0;
  await assert.rejects(
    processVideoUrl(
      'https://www.youtube.com/watch?v=live0000000',
      '1080p',
      undefined,
      'live-guard-test',
      {
        fileManager: { getTempDir: () => '/nonexistent' } as any,
        ffmpeg: {} as any,
      },
      {
        downloadVideoFromPlatformImpl: (async () => {
          downloads += 1;
          throw new UrlSourceRejectedError('live_stream');
        }) as any,
      }
    ),
    (error: unknown) =>
      error instanceof UrlSourceRejectedError && error.code === 'live_stream'
  );
  assert.equal(downloads, 1);
});
