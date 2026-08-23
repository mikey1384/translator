import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ytDlpReleaseAssetName,
  ytDlpStagedBinaryName,
} from '../services/url-processor/yt-dlp-binary-names.js';

test('yt-dlp update assets stay platform-specific and never share the live name', () => {
  assert.equal(ytDlpReleaseAssetName('darwin'), 'yt-dlp_macos');
  assert.equal(ytDlpReleaseAssetName('win32'), 'yt-dlp.exe');
  assert.equal(ytDlpReleaseAssetName('linux'), 'yt-dlp');
  assert.equal(ytDlpStagedBinaryName('darwin'), 'yt-dlp.next');
  assert.equal(ytDlpStagedBinaryName('linux'), 'yt-dlp.next');
  assert.equal(ytDlpStagedBinaryName('win32'), 'yt-dlp.next.exe');
  assert.notEqual(ytDlpStagedBinaryName('darwin'), 'yt-dlp');
  assert.notEqual(ytDlpStagedBinaryName('win32'), 'yt-dlp.exe');
});
