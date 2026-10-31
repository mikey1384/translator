import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  UPCOMING_LIVE_RE,
  classifyUrlDownloadFailureDetail,
} from '../services/url-processor/failure-taxonomy.js';
import {
  mapDownloadError,
  mapErrorToUserFriendly,
} from '../services/url-processor/error-map.js';

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

test('Instagram audience restrictions remain source failures and explain account access safely', () => {
  const diagnostics =
    "ERROR: [Instagram] DIYC3Z9T6q5: This content isn't available to everyone: It can't be seen by certain audiences.";
  const error = Object.assign(
    new Error(
      'Command failed: yt-dlp --socket-timeout 10 --ffmpeg-location /bin/ffmpeg'
    ),
    { stdout: `${diagnostics}\nsigned-media-token=must-not-escape` }
  );

  assert.deepEqual(classifyUrlDownloadFailureDetail(error), {
    code: 'private_or_restricted',
    phase: 'source_access',
    httpStatus: null,
    canAttemptPublicAutomaticCaptions: false,
  });
  const message = mapErrorToUserFriendly({
    rawErrorMessage: error.message,
    stderrContent: error.stdout,
  });
  assert.match(message, /restricted to certain audiences/);
  assert.match(message, /If your account can view it/);
  assert.match(message, /Settings/);
  assert.doesNotMatch(message, /must-not-escape|DIYC3Z9T6q5|--socket/);
});

// Real yt-dlp --verbose output: the argv echo carries "--socket-timeout",
// which once made every failure look like a network error.
const VERBOSE_UNAVAILABLE_STDERR = [
  "[debug] Command-line config: ['--verbose', '--no-playlist', '--socket-timeout', '30', '--retries', '3', 'https://www.youtube.com/watch?v=zzzzzzzzzz0']",
  '[debug] Encodings: locale UTF-8, fs utf-8, pref UTF-8',
  '[debug] yt-dlp version stable@2026.09.01',
  '[youtube] Extracting URL: https://www.youtube.com/watch?v=zzzzzzzzzz0',
  '[youtube] zzzzzzzzzz0: Downloading webpage',
  'ERROR: [youtube] zzzzzzzzzz0: This video is unavailable',
].join('\n');

test('an unavailable video maps to its own code, not network or generic', () => {
  const mapped = mapDownloadError({
    rawErrorMessage: 'Command failed with exit code 1',
    stderrContent: VERBOSE_UNAVAILABLE_STDERR,
  });
  assert.equal(mapped.code, 'unavailable');
  assert.equal(
    classifyUrlDownloadFailureDetail({ stderr: VERBOSE_UNAVAILABLE_STDERR })
      .code,
    'private_or_restricted'
  );
});

test('the verbose argv echo alone is not a network failure', () => {
  const echoOnly = VERBOSE_UNAVAILABLE_STDERR.split('\n')
    .slice(0, 3)
    .join('\n');
  assert.equal(
    classifyUrlDownloadFailureDetail({ stderr: echoOnly }).code,
    'unknown'
  );
  assert.equal(
    classifyUrlDownloadFailureDetail({
      stderr: 'ERROR: Unable to download webpage: <urlopen error timed out>',
    }).code,
    'network'
  );
});

test('region locks and removed videos get their own codes', () => {
  assert.equal(
    mapDownloadError({
      rawErrorMessage:
        'ERROR: [youtube] abc: The uploader has not made this video available in your country',
    }).code,
    'region_locked'
  );
  assert.equal(
    mapDownloadError({
      rawErrorMessage:
        'ERROR: [youtube] abc: This video has been removed by the uploader',
    }).code,
    'unavailable'
  );
});

test('an ended live stream without a replay is unavailable, not a bug report', () => {
  const stderr =
    'ERROR: [youtube] abcdefghijk: This live stream recording is not available.';
  assert.equal(
    mapDownloadError({
      rawErrorMessage: 'yt-dlp exited 1',
      stderrContent: stderr,
    }).code,
    'unavailable'
  );
});

test('members-only videos ask the user to connect the site', () => {
  const stderr =
    'ERROR: [youtube] abcdefghijk: Join this channel to get access to members-only content like this video, and other exclusive perks.';
  assert.equal(
    mapDownloadError({
      rawErrorMessage: 'yt-dlp exited 1',
      stderrContent: stderr,
    }).code,
    'login_required'
  );
});

test('premieres and scheduled streams are recognised as upcoming live', () => {
  assert.ok(
    UPCOMING_LIVE_RE.test('ERROR: [youtube] abcdefghijk: Premieres in 3 hours')
  );
  assert.ok(
    UPCOMING_LIVE_RE.test(
      'ERROR: [youtube] abcdefghijk: This live event will begin in 2 days.'
    )
  );
  assert.ok(!UPCOMING_LIVE_RE.test('ERROR: This video is unavailable'));
});

// Real yt-dlp 2026.10.26 output for the public-URL checks of 2026-10-31.
const INSTAGRAM_EMPTY_MEDIA =
  'ERROR: [Instagram] C-aN3yTg7Uq: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in. If it is not, then use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Otherwise, if the post is accessible in browser without being logged-in, please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using  yt-dlp -U';
const REDDIT_AUTH =
  'ERROR: [Reddit] 1xeaia1: Account authentication is required. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies';
const INSTAGRAM_RATE_LIMIT_LOGIN =
  'ERROR: [Instagram] abc: Requested content is not available, rate-limit reached or login required. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (instagram) to provide account credentials';

test('sign-in-only posts name the site instead of an unexplained failure', () => {
  const cases: Array<[string, string, string]> = [
    [
      INSTAGRAM_EMPTY_MEDIA,
      'https://www.instagram.com/reel/C-aN3yTg7Uq/',
      'Instagram',
    ],
    [
      REDDIT_AUTH,
      'https://www.reddit.com/r/a/comments/1xeaia1/title/',
      'Reddit',
    ],
    [
      INSTAGRAM_RATE_LIMIT_LOGIN,
      'https://www.instagram.com/p/abc/',
      'Instagram',
    ],
    [
      'ERROR: [generic] This video requires login',
      'https://videos.example.org/watch/1',
      'videos.example.org',
    ],
  ];
  for (const [stderr, url, site] of cases) {
    assert.equal(
      classifyUrlDownloadFailureDetail({ stderr }).code,
      'login_required',
      site
    );
    const mapped = mapDownloadError({
      rawErrorMessage: 'yt-dlp exited 1',
      stderrContent: stderr,
      url,
    });
    assert.equal(mapped.code, 'sign_in_required', site);
    assert.equal(
      mapped.message,
      `This post needs you to sign in to ${site}. Translator can't download private or sign-in-only posts.`
    );
  }
});

test('YouTube sign-in walls keep the Connect advice, and bot checks stay human checks', () => {
  assert.equal(
    mapDownloadError({
      rawErrorMessage: 'yt-dlp exited 1',
      stderrContent:
        'ERROR: [youtube] abc: Join this channel to get access to members-only content like this video',
      url: 'https://www.youtube.com/watch?v=abc',
    }).code,
    'login_required'
  );
  assert.equal(
    classifyUrlDownloadFailureDetail({
      stderr:
        "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.",
    }).code,
    'human_verification'
  );
});
