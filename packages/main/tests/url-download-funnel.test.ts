import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyUrlDownloadFailure,
  classifyUrlSourceType,
  NeedCookiesError,
  shouldAutoCompleteYouTubeConnection,
} from '../services/url-download-funnel.js';

test('URL source classification exposes only YouTube or other', () => {
  assert.equal(
    classifyUrlSourceType('https://www.youtube.com/watch?v=private-id'),
    'youtube'
  );
  assert.equal(
    classifyUrlSourceType('https://example.com/private/video'),
    'other'
  );
  assert.equal(classifyUrlSourceType('not a URL'), 'other');
});

test('download errors collapse to allowlisted categories without returning content', () => {
  assert.equal(
    classifyUrlDownloadFailure(
      new Error('ENOSPC writing /Users/customer/private-video.mp4')
    ),
    'storage'
  );
  assert.equal(
    classifyUrlDownloadFailure(new Error('JavaScript runtime unavailable')),
    'runtime_setup'
  );
  assert.equal(
    classifyUrlDownloadFailure(new Error('private video is unavailable')),
    'site_rejected'
  );
  assert.equal(
    classifyUrlDownloadFailure(
      new Error('unable to download video data: HTTP Error 403: Forbidden')
    ),
    'site_rejected'
  );
  assert.equal(
    classifyUrlDownloadFailure(new Error('unrecognized secret error text')),
    'unknown'
  );
});

test('NeedCookiesError retains the legacy UI message and only a safe cause', () => {
  const error = new NeedCookiesError('human_verification');
  assert.equal(error.message, 'NeedCookies');
  assert.equal(error.causeCode, 'human_verification');
  assert.deepEqual(Object.keys(error).sort(), ['causeCode', 'name']);
});

test('new YouTube sign-in auto-completes only after returning to YouTube', () => {
  assert.equal(
    shouldAutoCompleteYouTubeConnection({
      hadAuthAtOpen: false,
      hasAuthNow: true,
      currentUrl: 'https://www.youtube.com/',
    }),
    true
  );
  assert.equal(
    shouldAutoCompleteYouTubeConnection({
      hadAuthAtOpen: false,
      hasAuthNow: true,
      currentUrl: 'https://accounts.google.com/signin',
    }),
    false
  );
  assert.equal(
    shouldAutoCompleteYouTubeConnection({
      hadAuthAtOpen: true,
      hasAuthNow: true,
      currentUrl: 'https://www.youtube.com/',
    }),
    false
  );
});
